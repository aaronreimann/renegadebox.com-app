//! RenegadeBox account: sign in on any device and receive its setup.
//!
//! The password never leaves the device. It is stretched with Argon2id and split into an
//! auth key (sent to the server, which stores only an HMAC of it) and a wrap key (kept
//! here) that unlocks the account key, which in turn unlocks the saved setup. The server
//! only ever holds ciphertext. Full design: docs/ACCOUNTS.md.

use std::path::{Path, PathBuf};
use std::time::Duration;

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use anyhow::{Context, Result, anyhow, bail};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use hkdf::Hkdf;
use rand::RngCore;
use rand::rngs::OsRng;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use unicode_normalization::UnicodeNormalization;
use zeroize::Zeroize;

use crate::config::{
    Config, KeyStoreKind, Profile, SECRET_ACCOUNT_KEY, SECRET_DEVICE_TOKEN, SECRET_GROK, SECRET_MASTER, SECRET_OPENROUTER, SECRET_S3,
};
use crate::crypto::{self, KdfParams, SecretKey};

pub const DEFAULT_SERVER: &str = "https://app.renegadebox.com";
pub const MIN_PASSWORD: usize = 12;
pub const DEFAULT_M_KIB: u32 = 64 * 1024;
pub const DEFAULT_T: u32 = 3;

const WRAP_MAGIC: &[u8; 4] = b"RBK1";
const SETUP_MAGIC: &[u8; 4] = b"RBS1";
const SHARED_SECRETS: [&str; 2] = [SECRET_OPENROUTER, SECRET_GROK];

/// The account this device is signed in to. Lives in config.toml; the device token and
/// account key live in the key store.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct AccountLink {
    pub server: String,
    pub email: String,
    pub account_id: String,
    /// Version of the saved setup this device last sent or applied.
    #[serde(default)]
    pub setup_version: u64,
    /// sha256 of the shared settings at that version, so unchanged settings are not re-sent.
    #[serde(default)]
    pub setup_hash: String,
    /// "google" for accounts that sign in with Google; absent for password accounts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
}

impl AccountLink {
    pub fn is_google(&self) -> bool {
        self.provider.as_deref() == Some("google")
    }
}

impl AccountLink {
    pub fn hub_url(&self) -> String {
        hub_url_for(&self.server)
    }
}

/// `https://host` -> `wss://host/api/v1/hub` (and `http` -> `ws` for local testing).
pub fn hub_url_for(server: &str) -> String {
    let base = server.trim_end_matches('/');
    let ws = if let Some(rest) = base.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = base.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        base.to_string()
    };
    format!("{ws}/api/v1/hub")
}

// ---------------------------------------------------------------- crypto

struct PasswordKeys {
    auth_key: SecretKey,
    wrap_key: SecretKey,
}

fn new_kdf() -> KdfParams {
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    KdfParams { alg: "argon2id".into(), m_kib: DEFAULT_M_KIB, t: DEFAULT_T, p: 1, salt: B64.encode(salt) }
}

/// Argon2id is deliberately slow (about half a second); call it off the async runtime.
fn derive_password_keys(password: &str, kdf: &KdfParams) -> Result<PasswordKeys> {
    if kdf.alg != "argon2id" {
        bail!("unsupported key derivation {}", kdf.alg);
    }
    // The server chooses these for existing accounts; refuse values that would hang or be weak.
    if !(19_456..=1_048_576).contains(&kdf.m_kib) || !(2..=10).contains(&kdf.t) || !(1..=4).contains(&kdf.p) {
        bail!("the server sent unusual password settings; refusing to continue");
    }
    let salt = B64.decode(&kdf.salt).context("bad salt from server")?;
    let params = Params::new(kdf.m_kib, kdf.t, kdf.p, Some(32)).map_err(|e| anyhow!("argon2 params: {e}"))?;
    let normalized: String = password.nfc().collect();
    let mut stretched = [0u8; 32];
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(normalized.as_bytes(), &salt, &mut stretched)
        .map_err(|e| anyhow!("argon2: {e}"))?;
    let hk = Hkdf::<Sha256>::new(None, &stretched);
    stretched.zeroize();
    let expand = |info: &[u8]| -> SecretKey {
        let mut okm = [0u8; 32];
        hk.expand(info, &mut okm).expect("32 bytes is a valid HKDF-SHA256 length");
        let k = SecretKey::from_bytes(&okm).expect("32 bytes");
        okm.zeroize();
        k
    };
    Ok(PasswordKeys {
        auth_key: expand(b"renegadebox account auth v1"),
        wrap_key: expand(b"renegadebox account wrap v1"),
    })
}

async fn derive_password_keys_async(password: &str, kdf: &KdfParams) -> Result<PasswordKeys> {
    let (password, kdf) = (password.to_string(), kdf.clone());
    tokio::task::spawn_blocking(move || derive_password_keys(&password, &kdf)).await?
}

fn seal(magic: &[u8; 4], key: &SecretKey, plaintext: &[u8], aad: &str) -> Result<Vec<u8>> {
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let ct = Aes256Gcm::new(&Key::<Aes256Gcm>::from(*key.as_bytes()))
        .encrypt(&Nonce::from(nonce), Payload { msg: plaintext, aad: aad.as_bytes() })
        .map_err(|_| anyhow!("encryption failed"))?;
    let mut out = Vec::with_capacity(16 + ct.len());
    out.extend_from_slice(magic);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(out)
}

fn open(magic: &[u8; 4], key: &SecretKey, sealed: &[u8], aad: &str) -> Result<Vec<u8>> {
    if sealed.len() < 4 + 12 + 16 || &sealed[..4] != magic {
        bail!("not a RenegadeBox account record");
    }
    let nonce = <[u8; 12]>::try_from(&sealed[4..16]).expect("length checked above");
    Aes256Gcm::new(&Key::<Aes256Gcm>::from(*key.as_bytes()))
        .decrypt(&Nonce::from(nonce), Payload { msg: &sealed[16..], aad: aad.as_bytes() })
        .map_err(|_| anyhow!("could not unlock the saved setup (wrong key or damaged data)"))
}

fn wrap_aad(account_id: &str) -> String {
    format!("renegadebox account key v1|{account_id}")
}

fn setup_aad(account_id: &str) -> String {
    format!("renegadebox setup v1|{account_id}")
}

fn wrap_account_key(wrap_key: &SecretKey, account_key: &SecretKey, account_id: &str) -> Result<String> {
    Ok(B64.encode(seal(WRAP_MAGIC, wrap_key, account_key.as_bytes(), &wrap_aad(account_id))?))
}

fn unwrap_account_key(wrap_key: &SecretKey, wrapped_b64: &str, account_id: &str) -> Result<SecretKey> {
    let sealed = B64.decode(wrapped_b64).context("bad account key from server")?;
    let mut raw = open(WRAP_MAGIC, wrap_key, &sealed, &wrap_aad(account_id))?;
    let key = SecretKey::from_bytes(&raw);
    raw.zeroize();
    key
}

// ---------------------------------------------------------------- setup bundle

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct StorageSetup {
    pub bucket: String,
    pub region: String,
    pub endpoint: Option<String>,
    pub access_key_id: String,
    pub secret_access_key: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct VaultSetup {
    pub master_key: String,
    pub vault_pin: String,
}

/// Everything a new device needs, encrypted under the account key before upload.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SetupBundle {
    pub v: u32,
    pub storage: StorageSetup,
    pub vault: VaultSetup,
    /// Home-relative when inside the home folder (`~/RenegadeBox`).
    pub folder: String,
    #[serde(default)]
    pub ai: crate::ai::AiRouterConfig,
    #[serde(default)]
    pub secrets: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    pub updated_by: String,
    #[serde(default)]
    pub updated_at: String,
}

impl SetupBundle {
    /// Hash of the settings that are shared between devices; ignores who saved them and when.
    fn content_hash(&self) -> Result<String> {
        let mut shared = self.clone();
        shared.updated_by.clear();
        shared.updated_at.clear();
        shared.folder.clear();
        Ok(crypto::sha256_hex(&serde_json::to_vec(&shared)?))
    }

    fn seal(&self, account_key: &SecretKey, account_id: &str) -> Result<String> {
        Ok(B64.encode(seal(SETUP_MAGIC, account_key, &serde_json::to_vec(self)?, &setup_aad(account_id))?))
    }

    fn open(blob_b64: &str, account_key: &SecretKey, account_id: &str) -> Result<Self> {
        let sealed = B64.decode(blob_b64).context("bad saved setup from server")?;
        let plain = open(SETUP_MAGIC, account_key, &sealed, &setup_aad(account_id))?;
        let bundle: SetupBundle = serde_json::from_slice(&plain).context("saved setup is not readable by this version of RenegadeBox")?;
        if bundle.v != 1 {
            bail!("the saved setup was made by a newer version of RenegadeBox; please update this app");
        }
        Ok(bundle)
    }
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn folder_to_portable(folder: &Path) -> String {
    match home().and_then(|h| folder.strip_prefix(&h).ok().map(Path::to_path_buf)) {
        Some(rest) if rest.as_os_str().is_empty() => "~".into(),
        Some(rest) => format!("~/{}", rest.display()),
        None => folder.display().to_string(),
    }
}

fn folder_from_portable(folder: &str) -> Result<PathBuf> {
    if folder == "~" {
        return home().ok_or_else(|| anyhow!("HOME not set"));
    }
    match folder.strip_prefix("~/") {
        Some(rest) => Ok(home().ok_or_else(|| anyhow!("HOME not set"))?.join(rest)),
        None => Ok(PathBuf::from(folder)),
    }
}

/// Collect this device's shareable setup from its config and key store.
pub fn bundle_from_device(profile: &Profile, cfg: &Config) -> Result<SetupBundle> {
    let mut secrets = std::collections::BTreeMap::new();
    for name in SHARED_SECRETS {
        if let Ok(v) = profile.get_secret(cfg, name) {
            secrets.insert(name.to_string(), v);
        }
    }
    Ok(SetupBundle {
        v: 1,
        storage: StorageSetup {
            bucket: cfg.bucket.clone(),
            region: cfg.region.clone(),
            endpoint: cfg.endpoint.clone(),
            access_key_id: cfg.access_key_id.clone(),
            secret_access_key: profile.get_secret(cfg, SECRET_S3)?,
        },
        vault: VaultSetup { master_key: profile.get_secret(cfg, SECRET_MASTER)?, vault_pin: cfg.vault_pin.clone() },
        folder: folder_to_portable(&cfg.folder),
        ai: cfg.ai.clone(),
        secrets,
        updated_by: cfg.device_name.clone(),
        updated_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// Write the shared parts of `bundle` into this device's config and key store. The folder,
/// device id/name and key store choice stay as they are.
fn apply_shared(profile: &Profile, cfg: &mut Config, bundle: &SetupBundle) -> Result<()> {
    if bundle.vault.vault_pin != cfg.vault_pin || profile.get_secret(cfg, SECRET_MASTER)? != bundle.vault.master_key {
        bail!("the saved setup points at a different encrypted vault than this Mac uses; sign out and sign in again to switch");
    }
    cfg.bucket = bundle.storage.bucket.clone();
    cfg.region = bundle.storage.region.clone();
    cfg.endpoint = bundle.storage.endpoint.clone();
    cfg.access_key_id = bundle.storage.access_key_id.clone();
    cfg.ai = bundle.ai.clone();
    profile.set_secret(cfg, SECRET_S3, &bundle.storage.secret_access_key)?;
    for name in SHARED_SECRETS {
        match bundle.secrets.get(name) {
            Some(v) => profile.set_secret(cfg, name, v)?,
            None => {
                let _ = profile.delete_secret(cfg, name);
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------- HTTP

/// An error the account server returned, with its machine-readable code.
#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub struct ApiError {
    pub status: u16,
    pub code: String,
    pub message: String,
    pub retry_after: Option<u64>,
    pub setup_version: Option<u64>,
}

impl ApiError {
    /// A sentence fit to show a person.
    pub fn friendly(&self) -> String {
        match self.code.as_str() {
            "invalid_credentials" => "That email and password don't match.".into(),
            "email_taken" => "There is already an account with that email. Sign in instead.".into(),
            "cancelled" => "Sign-in was cancelled.".into(),
            "expired" => "That sign-in took too long. Try again.".into(),
            "not_configured" => "Google sign-in isn't available yet.".into(),
            "rate_limited" => match self.retry_after {
                Some(s) => format!("Too many attempts. Try again in {} minutes.", s.div_ceil(60).max(1)),
                None => "Too many attempts. Try again in a few minutes.".into(),
            },
            "unauthorized" => "This Mac has been signed out of your account. Sign in again.".into(),
            _ => self.message.clone(),
        }
    }
}

#[derive(Deserialize)]
struct ErrorBody {
    error: ErrorDetail,
    #[serde(default)]
    setup_version: Option<u64>,
}

#[derive(Deserialize)]
struct ErrorDetail {
    code: String,
    message: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub client_version: String,
}

impl DeviceInfo {
    fn for_config(cfg_device_id: &str, name: &str) -> Self {
        Self {
            id: cfg_device_id.to_string(),
            name: name.to_string(),
            platform: std::env::consts::OS.to_string(),
            client_version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct Device {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub platform: Option<String>,
    #[serde(default)]
    pub client_version: Option<String>,
    #[serde(default)]
    pub last_seen_at: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub current: bool,
}

#[derive(Deserialize)]
struct PreloginResponse {
    kdf: KdfParams,
}

#[derive(Deserialize)]
struct SignupResponse {
    device_token: String,
    #[serde(default)]
    setup_version: u64,
}

#[derive(Deserialize)]
struct LoginResponse {
    account_id: String,
    device_token: String,
    wrapped_account_key: String,
    #[serde(default)]
    setup_blob: Option<String>,
    #[serde(default)]
    setup_version: u64,
}

#[derive(Deserialize)]
struct SetupResponse {
    #[serde(default)]
    setup_blob: Option<String>,
    #[serde(default)]
    setup_version: u64,
}

#[derive(Deserialize)]
struct SetupPutResponse {
    setup_version: u64,
}

#[derive(Deserialize)]
struct DevicesResponse {
    devices: Vec<Device>,
}

/// Thin client for the account API.
#[derive(Clone)]
pub struct Client {
    http: reqwest::Client,
    base: String,
}

impl Client {
    pub fn new(server: &str) -> Result<Self> {
        let server = server.trim().trim_end_matches('/');
        if !(server.starts_with("https://") || server.starts_with("http://localhost") || server.starts_with("http://127.0.0.1")) {
            bail!("the account server must use https");
        }
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(60))
            .user_agent(concat!("RenegadeBox/", env!("CARGO_PKG_VERSION")))
            .build()?;
        Ok(Self { http, base: format!("{server}/api/v1") })
    }

    async fn call<T: DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        token: Option<&str>,
        body: Option<serde_json::Value>,
    ) -> Result<T> {
        let mut req = self.http.request(method, format!("{}{path}", self.base));
        if let Some(t) = token {
            req = req.bearer_auth(t);
        }
        if let Some(b) = body {
            req = req.json(&b);
        }
        let resp = req.send().await.map_err(|e| anyhow!("could not reach the RenegadeBox account server: {e}"))?;
        let status = resp.status();
        let retry_after = resp.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok());
        let text = resp.text().await.unwrap_or_default();
        if status.is_success() {
            let text = if text.is_empty() { "null" } else { &text };
            return serde_json::from_str(text).with_context(|| format!("unexpected reply from the account server ({status})"));
        }
        let err = match serde_json::from_str::<ErrorBody>(&text) {
            Ok(b) => ApiError {
                status: status.as_u16(),
                code: b.error.code,
                message: b.error.message,
                retry_after,
                setup_version: b.setup_version,
            },
            Err(_) => ApiError {
                status: status.as_u16(),
                code: "internal".into(),
                message: format!("the account server returned an error ({status})"),
                retry_after,
                setup_version: None,
            },
        };
        Err(err.into())
    }

    async fn prelogin(&self, email: &str) -> Result<KdfParams> {
        let r: PreloginResponse = self
            .call(reqwest::Method::POST, "/prelogin", None, Some(serde_json::json!({ "email": email })))
            .await?;
        Ok(r.kdf)
    }

    pub async fn devices(&self, token: &str) -> Result<Vec<Device>> {
        let r: DevicesResponse = self.call(reqwest::Method::GET, "/devices", Some(token), None).await?;
        Ok(r.devices)
    }

    pub async fn remove_device(&self, token: &str, device_id: &str) -> Result<()> {
        let _: serde_json::Value = self
            .call(reqwest::Method::DELETE, &format!("/devices/{device_id}"), Some(token), None)
            .await?;
        Ok(())
    }
}

/// The server's error code, if `err` came from the account server.
pub fn api_error(err: &anyhow::Error) -> Option<&ApiError> {
    err.downcast_ref::<ApiError>()
}

/// A message fit to show a person for any account error.
pub fn friendly_error(err: &anyhow::Error) -> String {
    match api_error(err) {
        Some(e) => e.friendly(),
        None => format!("{err:#}"),
    }
}

fn normalize_email(email: &str) -> Result<String> {
    let e = email.trim().to_lowercase();
    if e.len() > 254 || !e.contains('@') || e.starts_with('@') || e.ends_with('@') || e.contains(char::is_whitespace) {
        bail!("enter a valid email address");
    }
    Ok(e)
}

fn check_password(password: &str) -> Result<()> {
    if password.chars().count() < MIN_PASSWORD {
        bail!("your password needs at least {MIN_PASSWORD} characters; it protects your storage keys");
    }
    Ok(())
}

// ---------------------------------------------------------------- operations

fn linked(cfg: &Config) -> Result<&AccountLink> {
    cfg.account.as_ref().ok_or_else(|| anyhow!("this device is not signed in to a RenegadeBox account"))
}

fn device_token(profile: &Profile, cfg: &Config) -> Result<String> {
    profile.get_secret(cfg, SECRET_DEVICE_TOKEN).context("this device's sign-in is missing; sign in again")
}

fn account_key(profile: &Profile, cfg: &Config) -> Result<SecretKey> {
    SecretKey::from_b64(&profile.get_secret(cfg, SECRET_ACCOUNT_KEY).context("this device's account key is missing; sign in again")?)
}

/// Create an account from a device that is already set up, and save its setup to it.
pub async fn create_account(profile: &Profile, server: &str, email: &str, password: &str) -> Result<Config> {
    let mut cfg = profile.load()?;
    if cfg.account.is_some() {
        bail!("this device is already signed in to an account");
    }
    let email = normalize_email(email)?;
    check_password(password)?;
    let client = Client::new(server)?;

    let account_id = uuid::Uuid::new_v4().to_string();
    let kdf = new_kdf();
    let keys = derive_password_keys_async(password, &kdf).await?;
    let account_key = SecretKey::random();
    let bundle = bundle_from_device(profile, &cfg)?;
    let device = DeviceInfo::for_config(&cfg.device_id, &cfg.device_name);

    let r: SignupResponse = client
        .call(
            reqwest::Method::POST,
            "/signup",
            None,
            Some(serde_json::json!({
                "email": email,
                "account_id": account_id,
                "kdf": kdf,
                "auth_key": keys.auth_key.to_b64(),
                "wrapped_account_key": wrap_account_key(&keys.wrap_key, &account_key, &account_id)?,
                "setup_blob": bundle.seal(&account_key, &account_id)?,
                "device": device,
            })),
        )
        .await?;

    profile.set_secret(&cfg, SECRET_DEVICE_TOKEN, &r.device_token)?;
    profile.set_secret(&cfg, SECRET_ACCOUNT_KEY, &account_key.to_b64())?;
    let link = AccountLink {
        server: server.trim().trim_end_matches('/').to_string(),
        email,
        account_id,
        setup_version: r.setup_version,
        setup_hash: bundle.content_hash()?,
        provider: None,
    };
    cfg.hub_url = Some(link.hub_url());
    cfg.account = Some(link);
    profile.save(&cfg)?;
    Ok(cfg)
}

/// Options for signing in on a device.
#[derive(Clone, Debug, Default)]
pub struct SignInOptions {
    /// Where to put the RenegadeBox folder; defaults to the one saved in the account.
    pub folder: Option<PathBuf>,
    pub device_name: Option<String>,
    /// Store secrets in a file instead of the OS keychain (tests and headless servers only).
    pub insecure_file_keystore: bool,
}

/// Sign in and set this device up from the account. On a device that is already set up with
/// the same storage, this links it to the account and keeps its folder.
pub async fn sign_in(profile: &Profile, server: &str, email: &str, password: &str, opts: SignInOptions) -> Result<Config> {
    let email = normalize_email(email)?;
    let server = server.trim().trim_end_matches('/').to_string();
    let client = Client::new(&server)?;
    let existing = profile.load().ok();
    if existing.as_ref().is_some_and(|c| c.account.is_some()) {
        bail!("this device is already signed in; sign out first");
    }

    let kdf = client.prelogin(&email).await?;
    let keys = derive_password_keys_async(password, &kdf).await?;
    let device_id = existing.as_ref().map(|c| c.device_id.clone()).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let device_name = match (&opts.device_name, &existing) {
        (Some(n), _) if !n.trim().is_empty() => n.trim().to_string(),
        (_, Some(c)) => c.device_name.clone(),
        _ => default_device_name(),
    };
    crate::config::validate_device_name(&device_name)?;

    let r: LoginResponse = client
        .call(
            reqwest::Method::POST,
            "/login",
            None,
            Some(serde_json::json!({
                "email": email,
                "auth_key": keys.auth_key.to_b64(),
                "device": DeviceInfo::for_config(&device_id, &device_name),
            })),
        )
        .await?;

    let grant = Grant {
        account_id: r.account_id.clone(),
        email: email.clone(),
        device_token: r.device_token.clone(),
        setup_blob: r.setup_blob.clone(),
        setup_version: r.setup_version,
        provider: None,
    };
    // From here on the server has issued a token; give it back if setup fails.
    let result = match unwrap_account_key(&keys.wrap_key, &r.wrapped_account_key, &r.account_id) {
        Ok(account_key) => finish_sign_in(profile, &server, &grant, account_key, existing, device_id, device_name, &opts).await,
        Err(e) => Err(e),
    };
    if result.is_err() {
        let _: Result<serde_json::Value> = client.call(reqwest::Method::POST, "/logout", Some(&r.device_token), None).await;
    }
    result
}

/// What the server hands a device that has just signed in, however it signed in.
struct Grant {
    account_id: String,
    email: String,
    device_token: String,
    setup_blob: Option<String>,
    setup_version: u64,
    provider: Option<String>,
}

#[allow(clippy::too_many_arguments)]
async fn finish_sign_in(
    profile: &Profile,
    server: &str,
    r: &Grant,
    account_key: SecretKey,
    existing: Option<Config>,
    device_id: String,
    device_name: String,
    opts: &SignInOptions,
) -> Result<Config> {
    let Some(blob) = r.setup_blob.as_deref() else {
        // A brand-new account. A Mac that is already set up saves its setup to it; a new Mac
        // has nothing to set itself up from yet.
        let Some(mut cfg) = existing else {
            bail!("your account doesn't have a saved setup yet. Sign in on the Mac where RenegadeBox is already set up first; after that, every other Mac sets itself up.");
        };
        profile.set_secret(&cfg, SECRET_DEVICE_TOKEN, &r.device_token)?;
        profile.set_secret(&cfg, SECRET_ACCOUNT_KEY, &account_key.to_b64())?;
        let link = AccountLink {
            server: server.to_string(),
            email: r.email.clone(),
            account_id: r.account_id.clone(),
            setup_version: r.setup_version,
            setup_hash: String::new(),
            provider: r.provider.clone(),
        };
        cfg.hub_url = Some(link.hub_url());
        cfg.account = Some(link);
        profile.save(&cfg)?;
        // An empty hash differs from any real setup, so this sends it.
        sync_setup(profile).await.context("could not save this Mac's setup to your account")?;
        return profile.load();
    };
    let bundle = SetupBundle::open(blob, &account_key, &r.account_id)?;
    let link = AccountLink {
        server: server.to_string(),
        email: r.email.clone(),
        account_id: r.account_id.clone(),
        setup_version: r.setup_version,
        setup_hash: bundle.content_hash()?,
        provider: r.provider.clone(),
    };

    let mut cfg = match existing {
        Some(mut cfg) => {
            if cfg.bucket != bundle.storage.bucket || cfg.endpoint != bundle.storage.endpoint {
                bail!(
                    "this Mac is already set up with different storage ({}) than your account ({}). Remove its setup first to switch.",
                    cfg.bucket,
                    bundle.storage.bucket
                );
            }
            apply_shared(profile, &mut cfg, &bundle)?;
            cfg
        }
        None => {
            let folder = match &opts.folder {
                Some(f) => f.clone(),
                None => folder_from_portable(&bundle.folder)?,
            };
            std::fs::create_dir_all(&folder).with_context(|| format!("create {}", folder.display()))?;
            let folder = folder.canonicalize()?;
            if folder.starts_with(&profile.dir) || profile.dir.starts_with(&folder) {
                bail!("the RenegadeBox folder and {} must not contain each other", profile.dir.display());
            }
            let cfg = Config {
                folder,
                bucket: bundle.storage.bucket.clone(),
                region: bundle.storage.region.clone(),
                endpoint: bundle.storage.endpoint.clone(),
                access_key_id: bundle.storage.access_key_id.clone(),
                device_id,
                device_name,
                key_store: if opts.insecure_file_keystore { KeyStoreKind::InsecureFile } else { KeyStoreKind::Keychain },
                vault_pin: bundle.vault.vault_pin.clone(),
                hub_url: None,
                ai: bundle.ai.clone(),
                account: None,
            };
            // Prove the storage keys work and the vault is the one the account describes
            // before writing anything.
            let storage = crate::engine::storage_for(&cfg, &bundle.storage.secret_access_key);
            let vault = storage
                .get_bytes(crate::journal::VAULT_KEY)
                .await
                .context("could not reach your storage with the saved keys")?
                .ok_or_else(|| anyhow!("your storage has no RenegadeBox vault; it may have been emptied"))?;
            if crypto::sha256_hex(&vault) != bundle.vault.vault_pin {
                bail!("the vault in your storage does not match your account's saved setup");
            }
            profile.set_secret(&cfg, SECRET_S3, &bundle.storage.secret_access_key)?;
            profile.set_secret(&cfg, SECRET_MASTER, &bundle.vault.master_key)?;
            for (name, value) in &bundle.secrets {
                if SHARED_SECRETS.contains(&name.as_str()) {
                    profile.set_secret(&cfg, name, value)?;
                }
            }
            // A previous setup's state would not match this folder.
            let _ = std::fs::remove_file(profile.state_path());
            cfg
        }
    };

    profile.set_secret(&cfg, SECRET_DEVICE_TOKEN, &r.device_token)?;
    profile.set_secret(&cfg, SECRET_ACCOUNT_KEY, &account_key.to_b64())?;
    cfg.hub_url = Some(link.hub_url());
    cfg.account = Some(link);
    profile.save(&cfg)?;
    Ok(cfg)
}

#[derive(Deserialize)]
struct GoogleStart {
    session_id: String,
    poll_secret: String,
    url: String,
}

#[derive(Deserialize)]
struct GooglePoll {
    status: String,
    #[serde(default)]
    account_id: String,
    #[serde(default)]
    email: String,
    #[serde(default)]
    device_token: String,
    #[serde(default)]
    account_key: String,
    #[serde(default)]
    setup_blob: Option<String>,
    #[serde(default)]
    setup_version: u64,
}

/// How long to wait for the person to finish signing in with Google in their browser.
pub const GOOGLE_TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// Sign in with Google. `open_url` shows Google's sign-in page (the browser on a Mac).
///
/// The first time, on a Mac that is already set up, this creates the account and saves the
/// setup to it. After that, signing in on any Mac sets it up from the account.
pub async fn google_sign_in(profile: &Profile, server: &str, opts: SignInOptions, open_url: impl FnOnce(&str) -> Result<()>) -> Result<Config> {
    let server = server.trim().trim_end_matches('/').to_string();
    let client = Client::new(&server)?;
    let existing = profile.load().ok();
    if existing.as_ref().is_some_and(|c| c.account.is_some()) {
        bail!("this Mac is already signed in; sign out first");
    }
    let device_id = existing.as_ref().map(|c| c.device_id.clone()).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let device_name = match (&opts.device_name, &existing) {
        (Some(n), _) if !n.trim().is_empty() => n.trim().to_string(),
        (_, Some(c)) => c.device_name.clone(),
        _ => default_device_name(),
    };
    crate::config::validate_device_name(&device_name)?;

    let start: GoogleStart = client
        .call(
            reqwest::Method::POST,
            "/auth/google/start",
            None,
            Some(serde_json::json!({ "device": DeviceInfo::for_config(&device_id, &device_name) })),
        )
        .await?;
    if !start.url.starts_with("https://accounts.google.com/") {
        bail!("the account server sent an unexpected sign-in address");
    }
    open_url(&start.url)?;

    let deadline = std::time::Instant::now() + GOOGLE_TIMEOUT;
    let r = loop {
        tokio::time::sleep(Duration::from_secs(2)).await;
        if std::time::Instant::now() > deadline {
            bail!("Google sign-in timed out. Try again.");
        }
        let poll: GooglePoll = client
            .call(
                reqwest::Method::POST,
                "/auth/google/poll",
                None,
                Some(serde_json::json!({ "session_id": start.session_id, "poll_secret": start.poll_secret })),
            )
            .await?;
        if poll.status == "ok" {
            break poll;
        }
    };

    let grant = Grant {
        account_id: r.account_id.clone(),
        email: r.email.clone(),
        device_token: r.device_token.clone(),
        setup_blob: r.setup_blob.clone(),
        setup_version: r.setup_version,
        provider: Some("google".into()),
    };
    let result = match SecretKey::from_b64(&r.account_key) {
        Ok(account_key) => finish_sign_in(profile, &server, &grant, account_key, existing, device_id, device_name, &opts).await,
        Err(e) => Err(e),
    };
    if result.is_err() {
        let _: Result<serde_json::Value> = client.call(reqwest::Method::POST, "/logout", Some(&r.device_token), None).await;
    }
    result
}

fn default_device_name() -> String {
    std::process::Command::new("hostname")
        .arg("-s")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "My Mac".into())
}

/// What `sync_setup` did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SetupSync {
    Unchanged,
    Sent,
    Received,
}

/// Keep the account's saved setup and this device in step: send local changes, or apply
/// changes another device saved. Local changes win, since they are the most recent thing
/// the person did on this device.
pub async fn sync_setup(profile: &Profile) -> Result<SetupSync> {
    let mut cfg = profile.load()?;
    let link = linked(&cfg)?.clone();
    let token = device_token(profile, &cfg)?;
    let key = account_key(profile, &cfg)?;
    let client = Client::new(&link.server)?;

    let local = bundle_from_device(profile, &cfg)?;
    let local_hash = local.content_hash()?;
    let mut base = link.setup_version;

    if local_hash == link.setup_hash {
        let r: SetupResponse = client.call(reqwest::Method::GET, "/setup", Some(&token), None).await?;
        if r.setup_version <= link.setup_version {
            return Ok(SetupSync::Unchanged);
        }
        let blob = r.setup_blob.ok_or_else(|| anyhow!("the account's saved setup is missing"))?;
        let remote = SetupBundle::open(&blob, &key, &link.account_id)?;
        apply_shared(profile, &mut cfg, &remote)?;
        let a = cfg.account.as_mut().expect("linked above");
        a.setup_version = r.setup_version;
        a.setup_hash = remote.content_hash()?;
        profile.save(&cfg)?;
        return Ok(SetupSync::Received);
    }

    let blob = local.seal(&key, &link.account_id)?;
    for _ in 0..2 {
        let res: Result<SetupPutResponse> = client
            .call(
                reqwest::Method::PUT,
                "/setup",
                Some(&token),
                Some(serde_json::json!({ "setup_blob": blob, "base_version": base })),
            )
            .await;
        match res {
            Ok(r) => {
                let a = cfg.account.as_mut().expect("linked above");
                a.setup_version = r.setup_version;
                a.setup_hash = local_hash;
                profile.save(&cfg)?;
                return Ok(SetupSync::Sent);
            }
            Err(e) => match api_error(&e) {
                Some(ae) if ae.code == "version_conflict" => {
                    base = ae.setup_version.ok_or_else(|| anyhow!("the server reported a conflict without a version"))?;
                }
                _ => return Err(e),
            },
        }
    }
    bail!("another device kept saving at the same time; will try again")
}

/// Sign this device out. Files and storage settings stay; only the account link goes.
pub async fn sign_out(profile: &Profile) -> Result<()> {
    let mut cfg = profile.load()?;
    let Some(link) = cfg.account.clone() else { return Ok(()) };
    // Best effort: if the server is unreachable the token is still forgotten here.
    if let (Ok(token), Ok(client)) = (device_token(profile, &cfg), Client::new(&link.server)) {
        let _: Result<serde_json::Value> = client.call(reqwest::Method::POST, "/logout", Some(&token), None).await;
    }
    let _ = profile.delete_secret(&cfg, SECRET_DEVICE_TOKEN);
    let _ = profile.delete_secret(&cfg, SECRET_ACCOUNT_KEY);
    if cfg.hub_url.as_deref() == Some(link.hub_url().as_str()) {
        cfg.hub_url = None;
    }
    cfg.account = None;
    profile.save(&cfg)
}

pub async fn devices(profile: &Profile) -> Result<Vec<Device>> {
    let cfg = profile.load()?;
    let link = linked(&cfg)?;
    Client::new(&link.server)?.devices(&device_token(profile, &cfg)?).await
}

pub async fn remove_device(profile: &Profile, device_id: &str) -> Result<()> {
    let cfg = profile.load()?;
    let link = linked(&cfg)?;
    if device_id == cfg.device_id {
        return sign_out(profile).await;
    }
    Client::new(&link.server)?.remove_device(&device_token(profile, &cfg)?, device_id).await
}

/// Set a new password. Works from any signed-in device without the old password, which is
/// also how a forgotten password is recovered.
pub async fn change_password(profile: &Profile, new_password: &str) -> Result<()> {
    check_password(new_password)?;
    let cfg = profile.load()?;
    let link = linked(&cfg)?;
    if link.is_google() {
        bail!("this account signs in with Google, so it has no RenegadeBox password");
    }
    let key = account_key(profile, &cfg)?;
    let kdf = new_kdf();
    let keys = derive_password_keys_async(new_password, &kdf).await?;
    let _: serde_json::Value = Client::new(&link.server)?
        .call(
            reqwest::Method::POST,
            "/password",
            Some(&device_token(profile, &cfg)?),
            Some(serde_json::json!({
                "kdf": kdf,
                "auth_key": keys.auth_key.to_b64(),
                "wrapped_account_key": wrap_account_key(&keys.wrap_key, &key, &link.account_id)?,
            })),
        )
        .await?;
    Ok(())
}

/// Delete the account and its saved setup. This device keeps syncing with its local settings.
/// Password accounts confirm with the password; Google accounts have none to give.
pub async fn delete_account(profile: &Profile, password: Option<&str>) -> Result<()> {
    let mut cfg = profile.load()?;
    let link = linked(&cfg)?.clone();
    let client = Client::new(&link.server)?;
    let body = if link.is_google() {
        serde_json::json!({ "confirm": "delete" })
    } else {
        let password = password.ok_or_else(|| anyhow!("enter your password to delete the account"))?;
        let kdf = client.prelogin(&link.email).await?;
        let keys = derive_password_keys_async(password, &kdf).await?;
        serde_json::json!({ "auth_key": keys.auth_key.to_b64() })
    };
    let _: serde_json::Value = client
        .call(reqwest::Method::DELETE, "/account", Some(&device_token(profile, &cfg)?), Some(body))
        .await?;
    let _ = profile.delete_secret(&cfg, SECRET_DEVICE_TOKEN);
    let _ = profile.delete_secret(&cfg, SECRET_ACCOUNT_KEY);
    cfg.hub_url = None;
    cfg.account = None;
    profile.save(&cfg)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fast_kdf() -> KdfParams {
        KdfParams { m_kib: 19_456, t: 2, ..new_kdf() }
    }

    #[test]
    fn password_keys_are_stable_and_distinct() {
        let kdf = fast_kdf();
        let a = derive_password_keys("correct horse battery", &kdf).unwrap();
        let b = derive_password_keys("correct horse battery", &kdf).unwrap();
        assert_eq!(a.auth_key.as_bytes(), b.auth_key.as_bytes());
        assert_ne!(a.auth_key.as_bytes(), a.wrap_key.as_bytes());
        let c = derive_password_keys("correct horse batterY", &kdf).unwrap();
        assert_ne!(a.auth_key.as_bytes(), c.auth_key.as_bytes());
    }

    #[test]
    fn unicode_passwords_normalize() {
        let kdf = fast_kdf();
        // "é" precomposed vs "e" + combining accent.
        let a = derive_password_keys("caf\u{e9} au lait 2026", &kdf).unwrap();
        let b = derive_password_keys("cafe\u{301} au lait 2026", &kdf).unwrap();
        assert_eq!(a.auth_key.as_bytes(), b.auth_key.as_bytes());
    }

    #[test]
    fn refuses_weak_server_params() {
        let kdf = KdfParams { m_kib: 8, ..fast_kdf() };
        assert!(derive_password_keys("long enough password", &kdf).is_err());
    }

    #[test]
    fn account_key_round_trips_and_binds_account() {
        let kdf = fast_kdf();
        let keys = derive_password_keys("long enough password", &kdf).unwrap();
        let ak = SecretKey::random();
        let wrapped = wrap_account_key(&keys.wrap_key, &ak, "acct-1").unwrap();
        assert_eq!(unwrap_account_key(&keys.wrap_key, &wrapped, "acct-1").unwrap().as_bytes(), ak.as_bytes());
        assert!(unwrap_account_key(&keys.wrap_key, &wrapped, "acct-2").is_err());
        let other = derive_password_keys("a different password", &kdf).unwrap();
        assert!(unwrap_account_key(&other.wrap_key, &wrapped, "acct-1").is_err());
    }

    #[test]
    fn bundle_round_trips_and_hash_ignores_metadata() {
        let key = SecretKey::random();
        let mut b = SetupBundle {
            v: 1,
            storage: StorageSetup {
                bucket: "b".into(),
                region: "auto".into(),
                endpoint: Some("https://x.r2.cloudflarestorage.com".into()),
                access_key_id: "AK".into(),
                secret_access_key: "SK".into(),
            },
            vault: VaultSetup { master_key: SecretKey::random().to_b64(), vault_pin: "pin".into() },
            folder: "~/RenegadeBox".into(),
            ai: Default::default(),
            secrets: [("openrouter-api-key".to_string(), "or".to_string())].into(),
            updated_by: "MacBook".into(),
            updated_at: "2026-10-17T00:00:00Z".into(),
        };
        let sealed = b.seal(&key, "acct").unwrap();
        let opened = SetupBundle::open(&sealed, &key, "acct").unwrap();
        assert_eq!(opened.storage, b.storage);
        assert!(SetupBundle::open(&sealed, &key, "other").is_err());
        let h = b.content_hash().unwrap();
        b.updated_by = "Studio".into();
        b.updated_at = "later".into();
        assert_eq!(b.content_hash().unwrap(), h);
        b.storage.secret_access_key = "SK2".into();
        assert_ne!(b.content_hash().unwrap(), h);
    }

    #[test]
    fn portable_folder_paths() {
        let home = home().unwrap();
        assert_eq!(folder_to_portable(&home.join("RenegadeBox")), "~/RenegadeBox");
        assert_eq!(folder_from_portable("~/RenegadeBox").unwrap(), home.join("RenegadeBox"));
        assert_eq!(folder_to_portable(Path::new("/Volumes/Data/RB")), "/Volumes/Data/RB");
    }

    #[test]
    fn hub_url_from_server() {
        assert_eq!(hub_url_for("https://app.renegadebox.com/"), "wss://app.renegadebox.com/api/v1/hub");
        assert_eq!(hub_url_for("http://localhost:8787"), "ws://localhost:8787/api/v1/hub");
    }

    #[test]
    fn rejects_plain_http_servers() {
        assert!(Client::new("http://example.com").is_err());
        assert!(Client::new("http://localhost:8787").is_ok());
    }
}
