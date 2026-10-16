use std::path::PathBuf;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};
use renegadebox_engine::config::{self, Config, KeyStoreKind, Profile, SECRET_MASTER, SECRET_S3};
use renegadebox_engine::crypto::Vault;
use renegadebox_engine::engine::{self, Engine};

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
            println!("synced files: {tracked}   pending local changes: {pending}");
        }
    }
    Ok(())
}
