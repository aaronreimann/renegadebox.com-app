//! Profile directory, non-secret config, and secret storage.
//!
//! Secrets (S3 secret key, master key) go to the OS credential manager by default.
//! The `file` store exists for headless servers and tests, and is clearly marked insecure.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow, bail};
use serde::{Deserialize, Serialize};

pub const SECRET_S3: &str = "s3-secret-access-key";
pub const SECRET_MASTER: &str = "master-key";
pub const SECRET_DEVICE_TOKEN: &str = "device-token";

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum KeyStoreKind {
    Keychain,
    InsecureFile,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Config {
    pub folder: PathBuf,
    pub bucket: String,
    pub region: String,
    pub endpoint: Option<String>,
    pub access_key_id: String,
    pub device_id: String,
    pub device_name: String,
    pub key_store: KeyStoreKind,
    /// sha256 of rb/vault.json at first unlock; a change means someone replaced the vault.
    pub vault_pin: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hub_url: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Profile {
    pub dir: PathBuf,
}

impl Profile {
    /// `$RBOX_HOME`, else `~/.renegadebox`.
    pub fn locate() -> Result<Self> {
        let dir = match std::env::var_os("RBOX_HOME") {
            Some(d) => PathBuf::from(d),
            None => PathBuf::from(std::env::var_os("HOME").ok_or_else(|| anyhow!("HOME not set"))?).join(".renegadebox"),
        };
        std::fs::create_dir_all(&dir).with_context(|| format!("create profile dir {}", dir.display()))?;
        std::fs::create_dir_all(dir.join("tmp"))?;
        // Canonicalize so containment checks against the sync folder see through
        // relative paths and symlinks.
        let dir = dir.canonicalize().with_context(|| format!("resolve profile dir {}", dir.display()))?;
        Ok(Self { dir })
    }
    pub fn config_path(&self) -> PathBuf {
        self.dir.join("config.toml")
    }
    pub fn state_path(&self) -> PathBuf {
        self.dir.join("state.db")
    }
    pub fn tmp_dir(&self) -> PathBuf {
        self.dir.join("tmp")
    }
    fn secrets_path(&self) -> PathBuf {
        self.dir.join("secrets.insecure.json")
    }

    pub fn load(&self) -> Result<Config> {
        let text = std::fs::read_to_string(self.config_path())
            .with_context(|| format!("no config at {} — run `rbox init` first", self.config_path().display()))?;
        Ok(toml::from_str(&text)?)
    }

    pub fn save(&self, cfg: &Config) -> Result<()> {
        write_private(&self.config_path(), toml::to_string_pretty(cfg)?.as_bytes())
    }

    pub fn set_secret(&self, cfg: &Config, name: &str, value: &str) -> Result<()> {
        match cfg.key_store {
            KeyStoreKind::Keychain => {
                let mut map = keychain::load(&cfg.device_id)?;
                map.insert(name.to_string(), value.to_string());
                keychain::store(&cfg.device_id, &map)
            }
            KeyStoreKind::InsecureFile => {
                let mut map = self.read_secret_file()?;
                map.insert(name.to_string(), value.to_string());
                write_private(&self.secrets_path(), serde_json::to_string_pretty(&map)?.as_bytes())
            }
        }
    }

    pub fn get_secret(&self, cfg: &Config, name: &str) -> Result<String> {
        match cfg.key_store {
            KeyStoreKind::Keychain => keychain::load(&cfg.device_id)?
                .remove(name)
                .ok_or_else(|| anyhow!("{name} is missing from the keychain")),
            KeyStoreKind::InsecureFile => self
                .read_secret_file()?
                .remove(name)
                .ok_or_else(|| anyhow!("secret {name} missing from {}", self.secrets_path().display())),
        }
    }

    /// Move every secret this device holds into `to`, verify the copies read back, switch
    /// the config over, and only then erase the old copies. Safe to re-run after a failure:
    /// until the config is saved, the old store stays authoritative and untouched.
    pub fn move_secrets(&self, cfg: &mut Config, to: KeyStoreKind) -> Result<()> {
        if cfg.key_store == to {
            return Ok(());
        }
        let mut values = Vec::new();
        for name in [SECRET_S3, SECRET_MASTER] {
            values.push((name, self.get_secret(cfg, name)?));
        }
        if let Ok(token) = self.get_secret(cfg, SECRET_DEVICE_TOKEN) {
            values.push((SECRET_DEVICE_TOKEN, token));
        }
        let mut target = cfg.clone();
        target.key_store = to;
        for (name, value) in &values {
            self.set_secret(&target, name, value)?;
            if &self.get_secret(&target, name)? != value {
                bail!("{name} did not read back correctly from the new key store; nothing was changed");
            }
        }
        let from = cfg.clone();
        self.save(&target)?;
        *cfg = target;
        for (name, _) in &values {
            if let Err(e) = self.delete_secret(&from, name) {
                tracing::warn!("could not remove old copy of {name}: {e:#}");
            }
        }
        Ok(())
    }

    fn delete_secret(&self, cfg: &Config, name: &str) -> Result<()> {
        match cfg.key_store {
            KeyStoreKind::Keychain => {
                let mut map = keychain::load(&cfg.device_id)?;
                map.remove(name);
                keychain::store(&cfg.device_id, &map)
            }
            KeyStoreKind::InsecureFile => {
                let mut map = self.read_secret_file()?;
                map.remove(name);
                if map.is_empty() {
                    match std::fs::remove_file(self.secrets_path()) {
                        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
                        _ => Ok(()),
                    }
                } else {
                    write_private(&self.secrets_path(), serde_json::to_string_pretty(&map)?.as_bytes())
                }
            }
        }
    }

    fn read_secret_file(&self) -> Result<BTreeMap<String, String>> {
        match std::fs::read_to_string(self.secrets_path()) {
            Ok(t) => Ok(serde_json::from_str(&t)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
            Err(e) => Err(e.into()),
        }
    }
}

/// Write a file readable only by the owner.
fn write_private(path: &Path, data: &[u8]) -> Result<()> {
    use std::io::Write;
    #[cfg(unix)]
    use std::os::unix::fs::OpenOptionsExt;
    let tmp = path.with_extension("tmp");
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    opts.mode(0o600);
    let mut f = opts.open(&tmp)?;
    f.write_all(data)?;
    f.sync_all()?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

pub fn validate_device_name(name: &str) -> Result<()> {
    if name.is_empty() || name.chars().count() > 128 || name.contains(['/', '\\', '\0']) {
        bail!("device name must be 1-128 characters without slashes");
    }
    Ok(())
}

/// All of a device's secrets live in ONE keychain item (service "renegadebox", account
/// = device id, password = JSON map). macOS approves keychain access per item, so one item
/// means one approval prompt per app build instead of one per secret.
mod keychain {
    use std::collections::{BTreeMap, HashMap};
    use std::sync::Mutex;

    use anyhow::{Result, anyhow};

    use super::{SECRET_DEVICE_TOKEN, SECRET_MASTER, SECRET_S3};

    const SERVICE: &str = "renegadebox";

    /// Per-process cache: each secret is read from the keychain at most once per run.
    static CACHE: Mutex<Option<HashMap<String, BTreeMap<String, String>>>> = Mutex::new(None);

    fn entry(account: &str) -> Result<keyring::Entry> {
        keyring::Entry::new(SERVICE, account).map_err(|e| anyhow!("keychain: {e}"))
    }

    pub fn load(device_id: &str) -> Result<BTreeMap<String, String>> {
        if let Some(map) = CACHE.lock().map_err(|_| anyhow!("keychain cache poisoned"))?.as_ref().and_then(|c| c.get(device_id)) {
            return Ok(map.clone());
        }
        let map = match entry(device_id)?.get_password() {
            Ok(json) => serde_json::from_str(&json).map_err(|e| anyhow!("keychain item is not valid: {e}"))?,
            Err(keyring::Error::NoEntry) => migrate_legacy(device_id)?,
            Err(e) => return Err(anyhow!("keychain read failed: {e}")),
        };
        remember(device_id, &map)?;
        Ok(map)
    }

    pub fn store(device_id: &str, map: &BTreeMap<String, String>) -> Result<()> {
        let e = entry(device_id)?;
        if map.is_empty() {
            match e.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(err) => return Err(anyhow!("keychain delete failed: {err}")),
            }
        } else {
            e.set_password(&serde_json::to_string(map)?).map_err(|err| anyhow!("keychain write failed: {err}"))?;
        }
        remember(device_id, map)
    }

    fn remember(device_id: &str, map: &BTreeMap<String, String>) -> Result<()> {
        CACHE
            .lock()
            .map_err(|_| anyhow!("keychain cache poisoned"))?
            .get_or_insert_with(HashMap::new)
            .insert(device_id.to_string(), map.clone());
        Ok(())
    }

    /// Earlier versions stored one keychain item per secret ("<device>:<name>"). Fold them
    /// into the single item, then remove the old ones (best effort).
    fn migrate_legacy(device_id: &str) -> Result<BTreeMap<String, String>> {
        let mut map = BTreeMap::new();
        let mut found = Vec::new();
        for name in [SECRET_S3, SECRET_MASTER, SECRET_DEVICE_TOKEN] {
            let legacy = entry(&format!("{device_id}:{name}"))?;
            match legacy.get_password() {
                Ok(v) => {
                    map.insert(name.to_string(), v);
                    found.push(legacy);
                }
                Err(keyring::Error::NoEntry) => {}
                Err(e) => return Err(anyhow!("keychain read of {name} failed: {e}")),
            }
        }
        if !found.is_empty() {
            entry(device_id)?.set_password(&serde_json::to_string(&map)?).map_err(|e| anyhow!("keychain write failed: {e}"))?;
            for legacy in found {
                if let Err(e) = legacy.delete_credential() {
                    tracing::warn!("could not remove an old keychain item: {e}");
                }
            }
            tracing::info!("combined this device's keychain items into one");
        }
        Ok(map)
    }
}
