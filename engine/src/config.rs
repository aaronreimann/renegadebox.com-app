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
}

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
            KeyStoreKind::Keychain => keyring::Entry::new("renegadebox", &format!("{}:{name}", cfg.device_id))?
                .set_password(value)
                .map_err(|e| anyhow!("keychain write failed: {e}")),
            KeyStoreKind::InsecureFile => {
                let mut map = self.read_secret_file()?;
                map.insert(name.to_string(), value.to_string());
                write_private(&self.secrets_path(), serde_json::to_string_pretty(&map)?.as_bytes())
            }
        }
    }

    pub fn get_secret(&self, cfg: &Config, name: &str) -> Result<String> {
        match cfg.key_store {
            KeyStoreKind::Keychain => keyring::Entry::new("renegadebox", &format!("{}:{name}", cfg.device_id))?
                .get_password()
                .map_err(|e| anyhow!("keychain read of {name} failed: {e}")),
            KeyStoreKind::InsecureFile => self
                .read_secret_file()?
                .remove(name)
                .ok_or_else(|| anyhow!("secret {name} missing from {}", self.secrets_path().display())),
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
