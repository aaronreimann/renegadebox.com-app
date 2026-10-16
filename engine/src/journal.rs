//! Journal entry type (mirrors protocol/schemas/journal-entry.schema.json) and object keys.

use serde::{Deserialize, Serialize};

pub const VAULT_KEY: &str = "rb/vault.json";
pub const JOURNAL_PREFIX: &str = "rb/journal/";

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Added,
    Modified,
    Deleted,
    Renamed,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct JournalEntry {
    pub v: u32,
    pub device_id: String,
    pub device_name: String,
    pub seq: u64,
    pub lamport: u64,
    pub action: Action,
    pub path: String,
    pub old_path: Option<String>,
    pub hash: Option<String>,
    /// Hash of the version this change was based on (None for new files).
    pub base_hash: Option<String>,
    pub size: Option<u64>,
    pub mtime_ms: Option<i64>,
    pub blob_id: Option<String>,
}

impl JournalEntry {
    /// Total order used for conflict resolution: higher wins.
    pub fn order(&self) -> (u64, &str) {
        (self.lamport, self.device_id.as_str())
    }

    pub fn object_key(&self) -> String {
        journal_key(&self.device_id, self.seq)
    }

    /// Structural checks matching the schema's conditional rules.
    pub fn validate(&self) -> anyhow::Result<()> {
        use anyhow::bail;
        if self.v != 1 {
            bail!("unsupported journal entry version {}", self.v);
        }
        if self.seq == 0 {
            bail!("seq must be >= 1");
        }
        if uuid::Uuid::parse_str(&self.device_id).is_err() || self.device_id.len() != 36 {
            bail!("device_id must be a uuid");
        }
        if self.device_name.is_empty() || self.device_name.chars().count() > 128 {
            bail!("device_name must be 1-128 characters");
        }
        crate::paths::validate_rel(&self.path)?;
        let is_hex = |s: &Option<String>| s.as_deref().is_none_or(|h| h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()));
        if !is_hex(&self.hash) || !is_hex(&self.base_hash) || !is_hex(&self.blob_id) {
            bail!("bad hash field");
        }
        match self.action {
            Action::Renamed => {
                let Some(old) = &self.old_path else { bail!("renamed without old_path") };
                crate::paths::validate_rel(old)?;
            }
            _ if self.old_path.is_some() => bail!("old_path only allowed for renamed"),
            _ => {}
        }
        let content = [self.hash.is_some(), self.size.is_some(), self.mtime_ms.is_some(), self.blob_id.is_some()];
        if self.action == Action::Deleted {
            if content.iter().any(|x| *x) {
                bail!("deleted entry carries content fields");
            }
        } else if !content.iter().all(|x| *x) {
            bail!("entry missing content fields");
        }
        if self.action == Action::Added && self.base_hash.is_some() {
            bail!("added entry with base_hash");
        }
        Ok(())
    }
}

pub fn journal_key(device_id: &str, seq: u64) -> String {
    format!("{JOURNAL_PREFIX}{device_id}/{seq:020}")
}

pub fn blob_key(blob_id: &str) -> String {
    format!("rb/blobs/{}/{}", &blob_id[..2], blob_id)
}

/// Parse `rb/journal/<device>/<seq>` into (device, seq).
pub fn parse_journal_key(key: &str) -> Option<(String, u64)> {
    let rest = key.strip_prefix(JOURNAL_PREFIX)?;
    let (dev, seq) = rest.split_once('/')?;
    if seq.len() != 20 {
        return None;
    }
    Some((dev.to_string(), seq.parse().ok()?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_roundtrip() {
        let k = journal_key("3f6c1a2e-1111-4222-8333-944455556666", 42);
        assert_eq!(k, "rb/journal/3f6c1a2e-1111-4222-8333-944455556666/00000000000000000042");
        assert_eq!(parse_journal_key(&k).unwrap().1, 42);
    }

    /// Cross-language contract: every valid journal fixture from protocol/ must
    /// deserialize and validate here; every invalid one must be rejected.
    #[test]
    fn protocol_fixtures() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../protocol/fixtures");
        let mut valid = 0;
        for dir in ["valid", "invalid"] {
            let Ok(rd) = std::fs::read_dir(root.join(dir)) else { continue };
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if !name.starts_with("journal-entry") {
                    continue;
                }
                let text = std::fs::read_to_string(e.path()).unwrap();
                let parsed: Result<JournalEntry, _> = serde_json::from_str(&text);
                let ok = parsed.map(|j| j.validate().is_ok()).unwrap_or(false);
                assert_eq!(ok, dir == "valid", "fixture {dir}/{name}");
                if dir == "valid" {
                    valid += 1;
                }
            }
        }
        assert!(valid >= 4, "expected ≥4 valid journal fixtures, found {valid}");
    }
}
