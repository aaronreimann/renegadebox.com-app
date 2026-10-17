use std::path::PathBuf;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};
use renegadebox_engine::config::{self, Config, KeyStoreKind, Profile, SECRET_MASTER, SECRET_S3};
use renegadebox_engine::crypto::Vault;
use renegadebox_engine::engine::{self, Engine};
use renegadebox_engine::account;

/// RenegadeBox — end-to-end-encrypted sync into your own S3 bucket.
#[derive(Parser)]
#[command(name = "rbox", version)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[allow(clippy::large_enum_variant)]
#[derive(Subcommand)]
enum Cmd {
    /// Connect this device to a bucket (creates the encrypted vault on first use).
    Init {
        #[arg(long)]
        folder: PathBuf,
        #[arg(long)]
        bucket: String,
        #[arg(long, default_value = "us-east-1")]
        region: String,
        /// Custom endpoint for S3-compatible storage (R2, B2, MinIO).
        #[arg(long)]
        endpoint: Option<String>,
        #[arg(long)]
        access_key_id: String,
        /// Read from RBOX_S3_SECRET, or prompted.
        #[arg(long, env = "RBOX_S3_SECRET", hide_env_values = true)]
        secret_access_key: Option<String>,
        #[arg(long)]
        device_name: Option<String>,
        /// Hub WebSocket URL for real-time notifications (ws://... or wss://...)
        #[arg(long, env = "RBOX_HUB_URL")]
        hub_url: Option<String>,
        /// Device token issued by the RenegadeBox dashboard.
        #[arg(long, env = "RBOX_DEVICE_TOKEN", hide_env_values = true)]
        device_token: Option<String>,
        /// Store secrets in a 0600 file instead of the OS keychain (headless servers, tests).
        #[arg(long)]
        insecure_file_keystore: bool,
        /// Argon2id memory cost for a newly created vault.
        #[arg(long, default_value_t = Vault::DEFAULT_M_KIB, hide = true)]
        kdf_memory_kib: u32,
        #[arg(long)]
        force: bool,
    },
    /// Run one sync cycle and exit.
    Sync {
        /// Allow publishing deletions when every synced file has disappeared locally.
        #[arg(long)]
        allow_mass_delete: bool,
    },
    /// Keep syncing: react to local changes and poll for remote ones.
    Watch {
        #[arg(long, default_value_t = 15)]
        poll_secs: u64,
    },
    /// Show configuration and pending changes.
    Status,
    /// Move this device's secrets to another key store (keychain is recommended).
    Keystore {
        #[arg(value_enum)]
        to: KeyStoreArg,
    },
    /// Your RenegadeBox account: sign in on any device and it is set up for you.
    Account {
        /// Account server.
        #[arg(long, env = "RBOX_SERVER", default_value = account::DEFAULT_SERVER, global = true)]
        server: String,
        #[command(subcommand)]
        cmd: AccountCmd,
    },
}

#[derive(Subcommand)]
enum AccountCmd {
    /// Create an account from this device's setup.
    Create {
        #[arg(long)]
        email: String,
    },
    /// Sign in and set this device up from your account.
    Login {
        #[arg(long)]
        email: String,
        /// Where to put the RenegadeBox folder (default: the same place as on your other devices).
        #[arg(long)]
        folder: Option<PathBuf>,
        #[arg(long)]
        device_name: Option<String>,
        /// Store secrets in a 0600 file instead of the OS keychain (headless servers, tests).
        #[arg(long)]
        insecure_file_keystore: bool,
    },
    /// Sign in with Google in your browser and set this device up from your account.
    Google {
        /// Where to put the RenegadeBox folder (default: the same place as on your other devices).
        #[arg(long)]
        folder: Option<PathBuf>,
        #[arg(long)]
        device_name: Option<String>,
        /// Store secrets in a 0600 file instead of the OS keychain (headless servers, tests).
        #[arg(long)]
        insecure_file_keystore: bool,
    },
    /// Sign this device out. Files and storage settings stay.
    Logout,
    /// Show which account this device is signed in to.
    Status,
    /// List the devices signed in to your account.
    Devices,
    /// Sign another device out of your account.
    Remove { device_id: String },
    /// Set a new account password (works without the old one from any signed-in device).
    Password,
    /// Send or receive setup changes now.
    Sync,
}

/// `RBOX_ACCOUNT_PASSWORD`, else prompted.
fn account_password(confirm: bool) -> Result<String> {
    if let Ok(p) = std::env::var("RBOX_ACCOUNT_PASSWORD") {
        return Ok(p);
    }
    let p = rpassword::prompt_password("Account password: ")?;
    if confirm {
        if p.chars().count() < account::MIN_PASSWORD {
            bail!("your password needs at least {} characters", account::MIN_PASSWORD);
        }
        if rpassword::prompt_password("Confirm password: ")? != p {
            bail!("passwords do not match");
        }
    }
    Ok(p)
}

#[derive(Clone, Copy, clap::ValueEnum)]
enum KeyStoreArg {
    /// The OS credential manager (macOS Keychain, Windows Credential Manager, Secret Service).
    Keychain,
    /// A 0600 file in the profile directory. Readable by any program running as you.
    InsecureFile,
}

fn passphrase(confirm: bool) -> Result<String> {
    if let Ok(p) = std::env::var("RBOX_PASSPHRASE") {
        return Ok(p);
    }
    if confirm {
        eprintln!(
            "\nChoose an encryption passphrase (12+ characters). Your files are encrypted with it before they\n\
             leave this computer. Every new device needs it to join, and it cannot be recovered if lost."
        );
    } else {
        eprintln!("\nThis bucket already has RenegadeBox files. Enter the encryption passphrase you chose on your first device.");
    }
    let p = rpassword::prompt_password("Encryption passphrase: ")?;
    if confirm {
        if p.chars().count() < 12 {
            bail!("passphrase must be at least 12 characters — it is the only thing protecting your files");
        }
        if rpassword::prompt_password("Confirm passphrase: ")? != p {
            bail!("passphrases do not match");
        }
    }
    Ok(p)
}

fn default_device_name() -> String {
    std::process::Command::new("hostname")
        .arg("-s")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "My Device".into())
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_env("RBOX_LOG").unwrap_or_else(|_| "info,aws=warn".into()))
        .with_target(false)
        .with_writer(std::io::stderr)
        .init();
    let cli = Cli::parse();
    let profile = Profile::locate()?;

    match cli.cmd {
        Cmd::Init {
            folder,
            bucket,
            region,
            endpoint,
            access_key_id,
            secret_access_key,
            device_name,
            hub_url,
            device_token,
            insecure_file_keystore,
            kdf_memory_kib,
            force,
        } => {
            if profile.config_path().exists() && !force {
                bail!("{} already exists (use --force to re-initialize this device)", profile.config_path().display());
            }
            std::fs::create_dir_all(&folder)?;
            let folder = folder.canonicalize()?;
            if folder.starts_with(&profile.dir) || profile.dir.starts_with(&folder) {
                bail!("the sync folder and the profile dir ({}) must not contain each other", profile.dir.display());
            }
            let device_name = device_name.unwrap_or_else(default_device_name);
            config::validate_device_name(&device_name)?;
            let secret = match secret_access_key {
                Some(s) => s,
                None => {
                    eprintln!(
                        "Your storage provider (AWS, Cloudflare R2, Backblaze B2...) gives you two keys: an access key ID\n\
                         (passed as --access-key-id) and a secret access key that goes with it. Paste the secret below;\n\
                         it is stored in your OS keychain and never sent anywhere else.\n\
                         (Local test server from docker compose: any value works, e.g. \"dev\".)"
                    );
                    rpassword::prompt_password("Secret access key: ")?
                }
            };
            let mut cfg = Config {
                folder,
                bucket,
                region,
                endpoint,
                access_key_id,
                device_id: uuid::Uuid::new_v4().to_string(),
                device_name,
                key_store: if insecure_file_keystore { KeyStoreKind::InsecureFile } else { KeyStoreKind::Keychain },
                vault_pin: String::new(),
                hub_url,
                ai: Default::default(),
                account: None,
            };
            let storage = engine::storage_for(&cfg, &secret);
            let exists = storage
                .exists(renegadebox_engine::journal::VAULT_KEY)
                .await
                .context("could not reach the bucket — check endpoint, bucket name and credentials")?;
            let pass = passphrase(!exists)?;
            let (master, pin, created) = engine::unlock_or_create_vault(&storage, &pass, (kdf_memory_kib, Vault::DEFAULT_T)).await?;
            cfg.vault_pin = pin;
            profile.set_secret(&cfg, SECRET_S3, &secret)?;
            profile.set_secret(&cfg, SECRET_MASTER, &master.to_b64())?;
            if let Some(ref token) = device_token {
                profile.set_secret(&cfg, config::SECRET_DEVICE_TOKEN, token)?;
            }
            profile.save(&cfg)?;
            let _ = std::fs::remove_file(profile.state_path());
            println!(
                "{} vault. Device \"{}\" ({}) syncing {} <-> s3://{}",
                if created { "Created a new encrypted" } else { "Unlocked the existing" },
                cfg.device_name,
                cfg.device_id,
                cfg.folder.display(),
                cfg.bucket
            );
            if created {
                println!("Keep your passphrase safe: without it, no new device can read your files.");
            }
        }
        Cmd::Sync { allow_mass_delete } => {
            let mut e = Engine::open(profile).await?;
            e.allow_mass_delete = allow_mass_delete;
            let r = e.sync_once().await?;
            println!("{r}");
            if r.failed > 0 {
                eprintln!("{} item(s) could not be synced and will be retried; see warnings above", r.failed);
                std::process::exit(2);
            }
        }
        Cmd::Watch { poll_secs } => {
            let prof = profile.clone();
            let mut e = Engine::open(profile).await?;
            renegadebox_engine::watch::run(&mut e, &prof, Duration::from_secs(poll_secs.max(1))).await?;
        }
        Cmd::Keystore { to } => {
            let mut cfg = profile.load()?;
            let target = match to {
                KeyStoreArg::Keychain => KeyStoreKind::Keychain,
                KeyStoreArg::InsecureFile => KeyStoreKind::InsecureFile,
            };
            if cfg.key_store == target {
                println!("Secrets are already stored in {target:?}.");
            } else {
                profile.move_secrets(&mut cfg, target)?;
                println!("Moved this device's secrets to {target:?} and removed the old copies.");
            }
        }
        Cmd::Account { server, cmd } => {
            let res = run_account(&profile, &server, cmd).await;
            if let Err(e) = res {
                bail!("{}", account::friendly_error(&e));
            }
        }
        Cmd::Status => {
            let mut e = Engine::open_local(profile)?;
            e.scan()?;
            let cfg = e.cfg.clone();
            let all = e.state().all()?;
            let pending = all.iter().filter(|r| r.is_dirty()).count();
            let tracked = all.iter().filter(|r| r.synced_hash.is_some()).count();
            println!("folder:   {}", cfg.folder.display());
            println!("bucket:   s3://{}{}", cfg.bucket, cfg.endpoint.as_deref().map(|e| format!(" via {e}")).unwrap_or_default());
            println!("device:   {} ({})", cfg.device_name, cfg.device_id);
            println!("keystore: {:?}", cfg.key_store);
            if let Some(a) = &cfg.account {
                println!("account:  {} ({})", a.email, a.server);
            }
            println!("synced files: {tracked}   pending local changes: {pending}");
        }
    }
    Ok(())
}

async fn run_account(profile: &Profile, server: &str, cmd: AccountCmd) -> Result<()> {
    match cmd {
        AccountCmd::Create { email } => {
            let pass = account_password(true)?;
            let cfg = account::create_account(profile, server, &email, &pass).await?;
            println!("Created your RenegadeBox account and saved this device's setup to it.");
            println!("On another device, run `rbox account login --email {}` (or sign in from the app).", cfg.account.map(|a| a.email).unwrap_or(email));
        }
        AccountCmd::Login { email, folder, device_name, insecure_file_keystore } => {
            let pass = account_password(false)?;
            let opts = account::SignInOptions { folder, device_name, insecure_file_keystore };
            let cfg = account::sign_in(profile, server, &email, &pass, opts).await?;
            println!("Signed in. \"{}\" syncs {} <-> s3://{}", cfg.device_name, cfg.folder.display(), cfg.bucket);
        }
        AccountCmd::Google { folder, device_name, insecure_file_keystore } => {
            let opts = account::SignInOptions { folder, device_name, insecure_file_keystore };
            let cfg = account::google_sign_in(profile, server, opts, |url| {
                println!("Opening Google sign-in in your browser. If it doesn't open, visit:\n{url}\n");
                if std::env::var_os("RBOX_NO_BROWSER").is_none() {
                    let _ = std::process::Command::new("open").arg(url).status();
                }
                Ok(())
            })
            .await?;
            println!("Signed in. \"{}\" syncs {} <-> s3://{}", cfg.device_name, cfg.folder.display(), cfg.bucket);
        }
        AccountCmd::Logout => {
            account::sign_out(profile).await?;
            println!("Signed out. This device keeps syncing with its current settings.");
        }
        AccountCmd::Status => match profile.load().ok().and_then(|c| c.account) {
            Some(a) => println!(
                "Signed in as {}{} on {} (setup version {}).",
                a.email,
                if a.is_google() { " with Google" } else { "" },
                a.server,
                a.setup_version
            ),
            None => println!("Not signed in."),
        },
        AccountCmd::Devices => {
            for d in account::devices(profile).await? {
                println!(
                    "{}{}  {}  last seen {}",
                    d.name,
                    if d.current { " (this device)" } else { "" },
                    d.id,
                    d.last_seen_at.as_deref().unwrap_or("never")
                );
            }
        }
        AccountCmd::Remove { device_id } => {
            account::remove_device(profile, &device_id).await?;
            println!("Signed that device out.");
        }
        AccountCmd::Password => {
            let pass = account_password(true)?;
            account::change_password(profile, &pass).await?;
            println!("Password changed. Your other devices stay signed in.");
        }
        AccountCmd::Sync => {
            let r = account::sync_setup(profile).await?;
            println!("{}", match r {
                account::SetupSync::Unchanged => "Setup is already up to date.",
                account::SetupSync::Sent => "Sent this device's setup changes to your account.",
                account::SetupSync::Received => "Applied setup changes from your account.",
            });
        }
    }
    Ok(())
}
