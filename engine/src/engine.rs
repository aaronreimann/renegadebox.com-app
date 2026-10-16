//! The sync engine: scan local folder -> pull remote journal -> push local changes.
//!
//! Conflict rule (see docs/ARCHITECTURE.md): for each path, the entry with the highest
//! (lamport, device_id) wins on every device, regardless of arrival order. When a newer
//! remote entry would replace content that exists only here — an unsynced local edit, or
//! a version this device authored that the remote entry never saw — this device first
//! moves its copy aside as a "conflicted copy", which is then published like any new file.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, anyhow, bail};
use sha2::{Digest, Sha256};
use tracing::{debug, info, warn};
use walkdir::WalkDir;

use crate::config::{Config, Profile, SECRET_MASTER, SECRET_S3};
use crate::crypto::{self, Keys, SecretKey, Vault};
use crate::journal::{self, Action, JournalEntry};
use crate::paths;
use crate::state::{FileRow, State};
use crate::storage::{PutIfAbsentError, S3Settings, Storage};

/// Another device wrote to this device's journal slot: the profile was cloned or restored.
/// Continuing would fork the journal, so this aborts the whole sync.
#[derive(Debug, thiserror::Error)]
#[error("journal slot {0} is already taken: another device is using this device id (cloned or restored profile?). Re-run `rbox init --force` on one of them.")]
pub struct IdentityCollision(pub String);

#[derive(Default, Debug, Clone, Copy)]
pub struct SyncReport {
    pub uploaded: usize,
    pub deleted_remote: usize,
    pub renamed_remote: usize,
    pub downloaded: usize,
    pub deleted_local: usize,
    pub renamed_local: usize,
    pub conflicts: usize,
    pub skipped_stale: usize,
    /// Paths or journal entries that could not be processed this cycle (retried next cycle).
    pub failed: usize,
}

impl std::fmt::Display for SyncReport {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "pushed: {} up, {} del, {} mv | pulled: {} down, {} del, {} mv | conflicts: {} | stale skipped: {} | failed: {}",
            self.uploaded,
            self.deleted_remote,
            self.renamed_remote,
            self.downloaded,
            self.deleted_local,
            self.renamed_local,
            self.conflicts,
            self.skipped_stale,
            self.failed
        )
    }
}

pub struct Engine {
    pub cfg: Config,
    profile: Profile,
    keys: Keys,
    state: State,
    storage: Storage,
    root: PathBuf,
    report: SyncReport,
    /// Allow a scan to treat every previously synced file as deleted (see `scan`).
    pub allow_mass_delete: bool,
    pub on_appended: Option<tokio::sync::mpsc::UnboundedSender<crate::hub::AppendedEvent>>,
    /// Opened without secrets (see `open_local`): may scan, must never touch the bucket.
    local_only: bool,
}

struct LocalStat {
    size: u64,
    mtime_ns: i64,
}

fn stat(path: &Path) -> Option<LocalStat> {
    let md = std::fs::symlink_metadata(path).ok()?;
    if !md.file_type().is_file() {
        return None;
    }
    let mtime_ns = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos() as i64)
        .unwrap_or(0);
    Some(LocalStat { size: md.len(), mtime_ns })
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn decode_hash(h: &str) -> Result<[u8; 32]> {
    hex::decode(h)?.try_into().map_err(|_| anyhow!("hash must be 32 bytes"))
}

pub fn storage_for(cfg: &Config, secret: &str) -> Storage {
    Storage::new(&S3Settings {
        bucket: &cfg.bucket,
        region: &cfg.region,
        endpoint: cfg.endpoint.as_deref(),
        access_key_id: &cfg.access_key_id,
        secret_access_key: secret,
    })
}

impl Engine {
    pub async fn open(profile: Profile) -> Result<Self> {
        let cfg = profile.load()?;
        let s3_secret = profile.get_secret(&cfg, SECRET_S3)?;
        let master = SecretKey::from_b64(&profile.get_secret(&cfg, SECRET_MASTER)?)?;
        let storage = storage_for(&cfg, &s3_secret);

        match storage.get_bytes(journal::VAULT_KEY).await? {
            Some(v) if crypto::sha256_hex(&v) != cfg.vault_pin => warn!(
                "rb/vault.json changed since this device was set up. If you did not change your passphrase, someone with bucket access replaced it."
            ),
            Some(_) => {}
            None => warn!("rb/vault.json is missing from the bucket; new devices will not be able to join"),
        }

        let state = State::open(&profile.state_path())?;
        let root = cfg.folder.canonicalize().with_context(|| format!("sync folder {}", cfg.folder.display()))?;
        Ok(Self { keys: Keys::derive(&master), cfg, profile, state, storage, root, report: SyncReport::default(), allow_mass_delete: false, on_appended: None, local_only: false })
    }

    /// Open for local inspection only (`rbox status`): reads no secrets, so it never
    /// triggers a Keychain prompt and needs no network. The keys and storage client are
    /// placeholders; `pull`/`push` refuse to run on an engine opened this way.
    pub fn open_local(profile: Profile) -> Result<Self> {
        let cfg = profile.load()?;
        let storage = storage_for(&cfg, "");
        let state = State::open(&profile.state_path())?;
        let root = cfg.folder.canonicalize().with_context(|| format!("sync folder {}", cfg.folder.display()))?;
        let keys = Keys::derive(&SecretKey::random());
        Ok(Self { keys, cfg, profile, state, storage, root, report: SyncReport::default(), allow_mass_delete: false, on_appended: None, local_only: true })
    }

    pub fn set_on_appended(&mut self, tx: tokio::sync::mpsc::UnboundedSender<crate::hub::AppendedEvent>) {
        self.on_appended = Some(tx);
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn state(&self) -> &State {
        &self.state
    }

    /// One full cycle. Order matters: scan first so pull can see unsynced local edits.
    pub async fn sync_once(&mut self) -> Result<SyncReport> {
        self.report = SyncReport::default();
        self.scan()?;
        self.pull().await?;
        self.push().await?;
        self.state.gc()?;
        Ok(self.report)
    }

    // ------------------------------------------------------------------ scan

    /// Record what is on disk. Unchanged files (same size + mtime) are not re-hashed.
    ///
    /// "Not seen" becomes a deletion that propagates to every device, so this is
    /// deliberately conservative: anything under a directory that could not be read is
    /// treated as still present, and a scan that would delete every synced file (an
    /// unmounted drive, a revoked macOS folder permission) aborts unless
    /// `allow_mass_delete` is set.
    pub fn scan(&mut self) -> Result<()> {
        if !self.root.is_dir() {
            bail!("sync folder {} is missing (unmounted drive?) — refusing to sync", self.root.display());
        }
        let mut seen = std::collections::HashSet::new();
        let mut unreadable: Vec<String> = Vec::new();
        let walker = WalkDir::new(&self.root).follow_links(false).into_iter().filter_entry(|e| {
            e.depth() == 0 || !paths::is_ignored(&e.file_name().to_string_lossy())
        });
        for entry in walker {
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    let rel = e.path().and_then(|p| paths::to_rel(&self.root, p));
                    match rel {
                        Some(rel) => {
                            warn!("cannot read {rel}: {e} — its contents are left untouched");
                            unreadable.push(rel);
                        }
                        None => bail!("cannot read sync folder {}: {e}", self.root.display()),
                    }
                    self.report.failed += 1;
                    continue;
                }
            };
            if !entry.file_type().is_file() {
                continue; // directories are implicit; symlinks are never followed or synced
            }
            let Some(rel) = paths::to_rel(&self.root, entry.path()) else {
                warn!("skipping unrepresentable path {}", entry.path().display());
                continue;
            };
            // On filesystems that do not normalize Unicode (Linux), a name stored in NFD
            // cannot be reached through its NFC form; say so instead of silently dropping it.
            if paths::to_abs(&self.root, &rel).ok().and_then(|p| stat(&p)).is_none() {
                warn!("skipping {}: its name is not in Unicode NFC form; rename it to sync it", entry.path().display());
                continue;
            }
            seen.insert(rel.clone());
            let mut row = self.state.get_or_new(&rel)?;
            match self.refresh_local(&mut row) {
                Ok(true) => self.state.put(&row)?,
                Ok(false) => {}
                Err(e) => {
                    warn!("{e:#}");
                    self.report.failed += 1;
                }
            }
        }
        let protected = |path: &str| unreadable.iter().any(|u| path == u || path.starts_with(&format!("{u}/")));
        let rows = self.state.all()?;
        let synced = rows.iter().filter(|r| r.synced_hash.is_some()).count();
        let vanished: Vec<FileRow> = rows
            .into_iter()
            .filter(|r| r.local_hash.is_some() && !seen.contains(&r.path) && !protected(&r.path))
            .collect();
        let vanished_synced = vanished.iter().filter(|r| r.synced_hash.is_some()).count();
        if !self.allow_mass_delete && synced >= 10 && vanished_synced == synced {
            bail!(
                "every one of the {synced} synced files is missing from {}. Refusing to delete them on your other devices. \
                 If you really emptied the folder, run `rbox sync --allow-mass-delete`.",
                self.root.display()
            );
        }
        for mut row in vanished {
            row.local_hash = None;
            row.local_size = None;
            row.local_mtime_ns = None;
            self.state.put(&row)?;
        }
        Ok(())
    }

    /// Re-observe one path on disk; returns true if the row changed.
    /// Errors if the file exists but cannot be read: callers must not treat an unreadable
    /// file as unchanged, or a remote update could overwrite an edit we failed to see.
    fn refresh_local(&self, row: &mut FileRow) -> Result<bool> {
        let abs = paths::to_abs(&self.root, &row.path)?;
        match stat(&abs) {
            None => {
                let changed = row.local_hash.is_some();
                row.local_hash = None;
                row.local_size = None;
                row.local_mtime_ns = None;
                Ok(changed)
            }
            Some(st) => {
                if row.local_hash.is_some() && row.local_size == Some(st.size) && row.local_mtime_ns == Some(st.mtime_ns) {
                    return Ok(false);
                }
                let h = hex::encode(crypto::hash_file(&abs).with_context(|| format!("cannot read {}", row.path))?);
                row.local_hash = Some(h);
                row.local_size = Some(st.size);
                row.local_mtime_ns = Some(st.mtime_ns);
                Ok(true)
            }
        }
    }

    // ------------------------------------------------------------------ clocks

    fn next_lamport(&self) -> Result<u64> {
        let l = now_ms().max(self.state.meta_u64("max_lamport")? + 1);
        self.state.set_meta("max_lamport", &l.to_string())?;
        Ok(l)
    }

    fn observe_lamport(&self, l: u64) -> Result<()> {
        if l > self.state.meta_u64("max_lamport")? {
            self.state.set_meta("max_lamport", &l.to_string())?;
        }
        Ok(())
    }

    // ------------------------------------------------------------------ pull

    /// Fetch every new journal entry from other devices and apply them in global order.
    /// Crash recovery for `append`: a previous run may have committed a journal entry and
    /// died before recording it locally. Once committed, other devices treat that entry as
    /// authoritative, so this device must too — otherwise it can stay on the old version
    /// forever (pull never reads our own journal). If the slot holds exactly the bytes we
    /// recorded as pending, replay the entry through the normal apply path; any local
    /// content it would replace is preserved by the usual conflict rules.
    async fn recover_pending_append(&mut self) -> Result<()> {
        let Some(pending) = self.state.meta("pending_append")?.filter(|p| !p.is_empty()) else { return Ok(()) };
        let Some((pseq, digest)) = pending.split_once(':') else { return self.state.set_meta("pending_append", "") };
        let Ok(seq) = pseq.parse::<u64>() else { return self.state.set_meta("pending_append", "") };
        if seq < self.state.meta_u64("next_seq")?.max(1) {
            return self.state.set_meta("pending_append", ""); // already recorded
        }
        let key = journal::journal_key(&self.cfg.device_id, seq);
        match self.storage.get_bytes(&key).await? {
            None => {} // the PUT never landed; the change is still dirty and will be re-published
            Some(existing) if crypto::sha256_hex(&existing) == digest => {
                let entry: JournalEntry = serde_json::from_slice(&self.keys.open(&existing, &key)?)?;
                entry.validate()?;
                info!("recovering journal entry {seq} ({:?} {}) committed before an interrupted run", entry.action, entry.path);
                self.state.set_meta("next_seq", &(seq + 1).to_string())?;
                self.state.set_cursor(&self.cfg.device_id, seq)?;
                self.observe_lamport(entry.lamport)?;
                self.apply(&entry).await?;
            }
            Some(_) => return Err(IdentityCollision(key).into()),
        }
        self.state.set_meta("pending_append", "")
    }

    pub async fn pull(&mut self) -> Result<()> {
        if self.local_only {
            bail!("engine opened without secrets cannot sync");
        }
        self.recover_pending_append().await?;
        let mut batch: Vec<JournalEntry> = Vec::new();
        for prefix in self.storage.list_prefixes(journal::JOURNAL_PREFIX).await? {
            let device = prefix.trim_start_matches(journal::JOURNAL_PREFIX).trim_end_matches('/').to_string();
            if device == self.cfg.device_id {
                continue;
            }
            let cursor = self.state.cursor(&device)?;
            let start_after = (cursor > 0).then(|| journal::journal_key(&device, cursor));
            let mut expected = cursor + 1;
            for key in self.storage.list_keys(&prefix, start_after.as_deref()).await? {
                let Some((dev, seq)) = journal::parse_journal_key(&key) else { continue };
                if dev != device || seq != expected {
                    // A gap means an entry is not visible yet; stop here and retry later.
                    debug!("journal gap for {device} at {expected} (saw {seq})");
                    break;
                }
                let sealed = self.storage.get_bytes(&key).await?.ok_or_else(|| anyhow!("{key} vanished"))?;
                let plain = self.keys.open(&sealed, &key)?;
                let entry: JournalEntry = serde_json::from_slice(&plain).with_context(|| format!("parse {key}"))?;
                entry.validate().with_context(|| format!("invalid entry {key}"))?;
                if entry.device_id != device || entry.seq != seq {
                    bail!("journal entry {key} does not match its object key");
                }
                batch.push(entry);
                expected += 1;
            }
        }
        batch.sort_by(|a, b| a.order().cmp(&b.order()));
        // A failed entry blocks only the rest of *its* device's journal (cursors must stay
        // contiguous); other devices' entries still apply and push still runs. Skipping
        // ahead on other devices is safe because max-order-wins does not depend on arrival order.
        let mut blocked = std::collections::HashSet::new();
        for e in batch {
            if blocked.contains(&e.device_id) {
                continue;
            }
            if let Err(err) = self.apply(&e).await {
                warn!("could not apply {} {:?} {} (will retry): {err:#}", e.device_name, e.action, e.path);
                self.report.failed += 1;
                blocked.insert(e.device_id.clone());
                continue;
            }
            self.observe_lamport(e.lamport)?;
            self.state.set_cursor(&e.device_id, e.seq)?;
        }
        Ok(())
    }

    /// Make room for a file at `rel`: a local *file* where the remote tree has a directory
    /// (or a local directory where it has a file) is moved aside as a conflicted copy.
    fn clear_path_for_file(&mut self, rel: &str) -> Result<()> {
        let segs: Vec<&str> = rel.split('/').collect();
        for i in 1..segs.len() {
            let anc = segs[..i].join("/");
            let abs = paths::to_abs(&self.root, &anc)?;
            if std::fs::symlink_metadata(&abs).map(|m| m.is_file()).unwrap_or(false) {
                let mut row = self.state.get_or_new(&anc)?;
                self.refresh_local(&mut row)?;
                if let Some(local) = row.local_hash.clone() {
                    self.move_to_conflict_copy(&mut row, &local)?;
                    self.state.put(&row)?;
                }
            }
        }
        let abs = paths::to_abs(&self.root, rel)?;
        if std::fs::symlink_metadata(&abs).map(|m| m.is_dir()).unwrap_or(false) {
            let date = chrono::Local::now().format("%Y-%m-%d").to_string();
            let mut name = paths::conflict_name(rel, &self.cfg.device_name, &date, "folder");
            let mut n = 2;
            while paths::to_abs(&self.root, &name)?.exists() {
                name = format!("{} {n}", paths::conflict_name(rel, &self.cfg.device_name, &date, "folder"));
                n += 1;
            }
            // Files inside are rediscovered under the new name by the next scan and
            // published as renames, so nothing is re-uploaded.
            std::fs::rename(&abs, paths::to_abs(&self.root, &name)?).with_context(|| format!("move folder {rel} aside"))?;
            info!("conflict: a remote file replaced folder {rel}; kept the folder as {name}");
            self.report.conflicts += 1;
        }
        Ok(())
    }

    async fn apply(&mut self, e: &JournalEntry) -> Result<()> {
        match e.action {
            Action::Added | Action::Modified => self.apply_put(&e.path, e, e.base_hash.as_deref()).await,
            Action::Deleted => self.apply_delete(&e.path, e, e.base_hash.as_deref()),
            Action::Renamed => {
                let old = e.old_path.as_deref().ok_or_else(|| anyhow!("rename without old_path"))?;
                if self.try_local_rename(old, e)? {
                    return Ok(());
                }
                self.apply_delete(old, e, e.base_hash.as_deref())?;
                self.apply_put(&e.path, e, None).await
            }
        }
    }

    /// Decide whether `e` applies to `rel`, preserving any content that would otherwise be lost.
    /// Returns the (refreshed) row to update, or None if the entry is stale/losing.
    fn prepare(&mut self, rel: &str, e: &JournalEntry, base: Option<&str>, incoming: Option<&str>) -> Result<Option<FileRow>> {
        let mut row = self.state.get_or_new(rel)?;
        if e.order() <= row.head_order() {
            self.report.skipped_stale += 1;
            return Ok(None);
        }
        self.refresh_local(&mut row)?;
        if let Some(local) = row.local_hash.clone() {
            let same_content = incoming == Some(local.as_str());
            let unsynced_edit = row.is_dirty();
            let lost_race = row.head_device == self.cfg.device_id && base != row.synced_hash.as_deref();
            if !same_content && (unsynced_edit || lost_race) {
                self.move_to_conflict_copy(&mut row, &local)?;
            }
        }
        Ok(Some(row))
    }

    fn move_to_conflict_copy(&mut self, row: &mut FileRow, local_hash: &str) -> Result<()> {
        let date = chrono::Local::now().format("%Y-%m-%d").to_string();
        let base_name = paths::conflict_name(&row.path, &self.cfg.device_name, &date, local_hash);
        let mut name = base_name.clone();
        let mut n = 2;
        while paths::to_abs(&self.root, &name)?.exists() {
            name = base_name.replacen(" (conflicted copy", &format!(" (conflicted copy {n}"), 1);
            n += 1;
        }
        let from = paths::to_abs(&self.root, &row.path)?;
        let to = paths::to_abs(&self.root, &name)?;
        std::fs::rename(&from, &to).with_context(|| format!("preserve conflicted copy {name}"))?;
        info!("conflict: kept this device's version of {} as {}", row.path, name);
        let mut copy = FileRow::new(&name);
        copy.local_hash = Some(local_hash.to_string());
        if let Some(st) = stat(&to) {
            copy.local_size = Some(st.size);
            copy.local_mtime_ns = Some(st.mtime_ns);
        }
        self.state.put(&copy)?;
        row.local_hash = None;
        row.local_size = None;
        row.local_mtime_ns = None;
        self.report.conflicts += 1;
        Ok(())
    }

    fn set_head(row: &mut FileRow, e: &JournalEntry, hash: Option<&str>) {
        row.synced_hash = hash.map(str::to_string);
        row.blob_id = if hash.is_some() { e.blob_id.clone() } else { None };
        row.head_lamport = e.lamport;
        row.head_device = e.device_id.clone();
    }

    async fn apply_put(&mut self, rel: &str, e: &JournalEntry, base: Option<&str>) -> Result<()> {
        let hash = e.hash.as_deref().ok_or_else(|| anyhow!("put without hash"))?;
        let Some(mut row) = self.prepare(rel, e, base, Some(hash))? else { return Ok(()) };
        if row.local_hash.as_deref() == Some(hash) {
            Self::set_head(&mut row, e, Some(hash));
            return self.state.put(&row);
        }
        let blob_id = e.blob_id.as_deref().ok_or_else(|| anyhow!("put without blob_id"))?;
        let plain_hash = decode_hash(hash)?;
        if self.keys.blob_id(&plain_hash) != blob_id {
            bail!("blob id does not match content hash for {rel}");
        }
        self.clear_path_for_file(rel)?;
        let abs = paths::to_abs(&self.root, rel)?;
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent)?;
            // create_dir_all may have raced a symlink in; re-validate.
            paths::to_abs(&self.root, rel)?;
        }
        let tmp_enc = self.profile.tmp_dir().join(format!("{}.enc", uuid::Uuid::new_v4()));
        let tmp_plain = abs.with_file_name(format!("{}{}", paths::TMP_PREFIX, uuid::Uuid::new_v4()));
        let result = async {
            self.storage.get_to_file(&journal::blob_key(blob_id), &tmp_enc).await?;
            crypto::decrypt_file(&self.keys, &plain_hash, &tmp_enc, &tmp_plain)?;
            if let Some(ms) = e.mtime_ms {
                let t = UNIX_EPOCH + Duration::from_millis(ms.max(0) as u64);
                std::fs::File::options().write(true).open(&tmp_plain)?.set_modified(t)?;
            }
            anyhow::Ok(())
        }
        .await;
        let _ = std::fs::remove_file(&tmp_enc);
        if let Err(err) = result {
            let _ = std::fs::remove_file(&tmp_plain);
            return Err(err);
        }
        // Clobber check: the user may have edited the file while we were downloading.
        let recorded = row.local_hash.clone();
        self.refresh_local(&mut row)?;
        if row.local_hash.is_some() && row.local_hash != recorded {
            let local = row.local_hash.clone().expect("checked");
            if local != hash {
                self.move_to_conflict_copy(&mut row, &local)?;
            }
        }
        // Stat the temp file *before* installing it: rename preserves size and mtime, and a
        // stat taken afterwards could capture a user edit made in between and mark it synced.
        let st = stat(&tmp_plain);
        if let Err(err) = std::fs::rename(&tmp_plain, &abs) {
            let _ = std::fs::remove_file(&tmp_plain);
            return Err(err).with_context(|| format!("install {rel}"));
        }
        Self::set_head(&mut row, e, Some(hash));
        row.local_hash = Some(hash.to_string());
        row.local_size = st.as_ref().map(|s| s.size);
        row.local_mtime_ns = st.as_ref().map(|s| s.mtime_ns);
        self.state.put(&row)?;
        self.report.downloaded += 1;
        Ok(())
    }

    fn apply_delete(&mut self, rel: &str, e: &JournalEntry, base: Option<&str>) -> Result<()> {
        let Some(mut row) = self.prepare(rel, e, base, None)? else { return Ok(()) };
        if row.local_hash.is_some() {
            // Clobber check, as in apply_put: an edit made since `prepare` hashed the file
            // is kept as a conflicted copy instead of being deleted.
            let prepared = row.local_hash.clone();
            self.refresh_local(&mut row)?;
            match row.local_hash.clone() {
                Some(now) if Some(&now) != prepared.as_ref() => self.move_to_conflict_copy(&mut row, &now)?,
                Some(_) => {
                    let abs = paths::to_abs(&self.root, rel)?;
                    std::fs::remove_file(&abs).with_context(|| format!("delete {rel}"))?;
                    self.remove_empty_parents(&abs);
                    self.report.deleted_local += 1;
                }
                None => {}
            }
        }
        Self::set_head(&mut row, e, None);
        row.local_hash = None;
        row.local_size = None;
        row.local_mtime_ns = None;
        self.state.put(&row)
    }

    /// Remote rename of content we already have: move the file instead of downloading.
    fn try_local_rename(&mut self, old: &str, e: &JournalEntry) -> Result<bool> {
        let mut old_row = self.state.get_or_new(old)?;
        let mut new_row = self.state.get_or_new(&e.path)?;
        if e.order() <= old_row.head_order() || e.order() <= new_row.head_order() {
            return Ok(false);
        }
        self.refresh_local(&mut old_row)?;
        self.refresh_local(&mut new_row)?;
        let clean_match = !old_row.is_dirty() && old_row.local_hash.is_some() && old_row.local_hash == e.hash;
        if !clean_match || new_row.local_hash.is_some() || old_row.synced_hash.as_deref() != e.base_hash.as_deref() {
            return Ok(false);
        }
        self.clear_path_for_file(&e.path)?;
        let from = paths::to_abs(&self.root, old)?;
        let to = paths::to_abs(&self.root, &e.path)?;
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent)?;
            paths::to_abs(&self.root, &e.path)?;
        }
        // Use the stat from refresh_local (taken before the move), not one taken after.
        let (size, mtime) = (old_row.local_size, old_row.local_mtime_ns);
        std::fs::rename(&from, &to).with_context(|| format!("rename {old} -> {}", e.path))?;
        self.remove_empty_parents(&from);
        Self::set_head(&mut old_row, e, None);
        old_row.local_hash = None;
        old_row.local_size = None;
        old_row.local_mtime_ns = None;
        Self::set_head(&mut new_row, e, e.hash.as_deref());
        new_row.local_hash = e.hash.clone();
        new_row.local_size = size;
        new_row.local_mtime_ns = mtime;
        self.state.put(&old_row)?;
        self.state.put(&new_row)?;
        self.report.renamed_local += 1;
        Ok(true)
    }

    fn remove_empty_parents(&self, abs: &Path) {
        let mut dir = abs.parent();
        while let Some(d) = dir {
            if d == self.root || !d.starts_with(&self.root) || std::fs::remove_dir(d).is_err() {
                break;
            }
            dir = d.parent();
        }
    }

    // ------------------------------------------------------------------ push

    pub async fn push(&mut self) -> Result<()> {
        if self.local_only {
            bail!("engine opened without secrets cannot sync");
        }
        let dirty = self.state.dirty()?;
        // Rename detection: a disappeared synced file + a new file with identical content.
        let mut adds: HashMap<String, FileRow> = HashMap::new();
        for r in dirty.iter().filter(|r| r.synced_hash.is_none() && r.local_hash.is_some()) {
            adds.entry(r.local_hash.clone().expect("filtered")).or_insert_with(|| r.clone());
        }
        let mut renamed_targets = std::collections::HashSet::new();
        for del in dirty.iter().filter(|r| r.local_hash.is_none() && r.synced_hash.is_some()) {
            let h = del.synced_hash.clone().expect("filtered");
            if let Some(add) = adds.remove(&h) {
                self.publish_rename(del.clone(), add.clone()).await?;
                renamed_targets.insert(add.path.clone());
                renamed_targets.insert(del.path.clone());
            }
        }
        for row in dirty.into_iter().filter(|r| !renamed_targets.contains(&r.path)) {
            if let Err(e) = self.publish_one(row.clone()).await {
                if e.is::<IdentityCollision>() {
                    return Err(e);
                }
                warn!("could not publish {} (will retry): {e:#}", row.path);
                self.report.failed += 1;
            }
        }
        Ok(())
    }

    async fn publish_one(&mut self, mut row: FileRow) -> Result<()> {
        match row.local_hash.clone() {
            None => {
                let Some(base) = row.synced_hash.clone() else { return Ok(()) };
                let e = self.append(Action::Deleted, &row.path, None, None, Some(base), None, None, None).await?;
                Self::set_head(&mut row, &e, None);
                self.state.put(&row)?;
                self.report.deleted_remote += 1;
            }
            Some(_) => {
                let abs = paths::to_abs(&self.root, &row.path)?;
                // Stat *before* hashing: if the file changes afterwards its mtime will no
                // longer match, so the next scan re-hashes it instead of trusting a stale hash.
                let st = stat(&abs).ok_or_else(|| anyhow!("{} disappeared", row.path))?;
                let tmp_enc = self.profile.tmp_dir().join(format!("{}.enc", uuid::Uuid::new_v4()));
                let blob = crypto::encrypt_file(&self.keys, &abs, &tmp_enc);
                let blob = match blob {
                    Ok(b) => b,
                    Err(err) => {
                        let _ = std::fs::remove_file(&tmp_enc);
                        return Err(err);
                    }
                };
                let hash = hex::encode(blob.plain_hash);
                row.local_hash = Some(hash.clone());
                row.local_size = Some(st.size);
                row.local_mtime_ns = Some(st.mtime_ns);
                if row.synced_hash.as_deref() == Some(hash.as_str()) {
                    let _ = std::fs::remove_file(&tmp_enc);
                    return self.state.put(&row); // edited back to the synced content
                }
                let key = journal::blob_key(&blob.blob_id);
                let up = async {
                    if !self.storage.exists(&key).await? {
                        self.storage.put_file(&key, &tmp_enc).await?;
                    }
                    anyhow::Ok(())
                }
                .await;
                let _ = std::fs::remove_file(&tmp_enc);
                up?;
                let action = if row.synced_hash.is_none() { Action::Added } else { Action::Modified };
                let mtime_ms = st.mtime_ns / 1_000_000;
                let e = self
                    .append(action, &row.path, None, Some(hash.clone()), row.synced_hash.clone(), Some(st.size), Some(mtime_ms), Some(blob.blob_id))
                    .await?;
                Self::set_head(&mut row, &e, Some(&hash));
                self.state.put(&row)?;
                self.report.uploaded += 1;
            }
        }
        Ok(())
    }

    async fn publish_rename(&mut self, mut del: FileRow, mut add: FileRow) -> Result<()> {
        let hash = del.synced_hash.clone().expect("rename source is synced");
        let blob_id = match del.blob_id.clone() {
            Some(b) => b,
            None => self.keys.blob_id(&decode_hash(&hash)?),
        };
        let size = add.local_size;
        let mtime_ms = add.local_mtime_ns.map(|n| n / 1_000_000);
        let e = self
            .append(Action::Renamed, &add.path, Some(del.path.clone()), Some(hash.clone()), Some(hash.clone()), size, mtime_ms, Some(blob_id))
            .await?;
        Self::set_head(&mut del, &e, None);
        Self::set_head(&mut add, &e, Some(&hash));
        self.state.put(&del)?;
        self.state.put(&add)?;
        self.report.renamed_remote += 1;
        Ok(())
    }

    /// Seal and write the next journal entry. Never overwrites (If-None-Match: *).
    #[allow(clippy::too_many_arguments)]
    async fn append(
        &mut self,
        action: Action,
        path: &str,
        old_path: Option<String>,
        hash: Option<String>,
        base_hash: Option<String>,
        size: Option<u64>,
        mtime_ms: Option<i64>,
        blob_id: Option<String>,
    ) -> Result<JournalEntry> {
        let seq = self.state.meta_u64("next_seq")?.max(1);
        let entry = JournalEntry {
            v: 1,
            device_id: self.cfg.device_id.clone(),
            device_name: self.cfg.device_name.clone(),
            seq,
            lamport: self.next_lamport()?,
            action,
            path: path.to_string(),
            old_path,
            hash,
            base_hash: if action == Action::Added { None } else { base_hash },
            size,
            mtime_ms,
            blob_id,
        };
        entry.validate()?;
        let key = entry.object_key();
        let sealed = self.keys.seal(&serde_json::to_vec(&entry)?, &key)?;
        let digest = crypto::sha256_hex(&sealed);
        self.state.set_meta("pending_append", &format!("{seq}:{digest}"))?;
        let sealed_b64 = if sealed.len() <= 16384 {
            use base64::Engine;
            Some(base64::engine::general_purpose::STANDARD.encode(&sealed))
        } else {
            None
        };
        match self.storage.put_bytes_if_absent(&key, sealed).await {
            Ok(()) => {}
            Err(PutIfAbsentError::Exists) => {
                // The SDK retries a PUT whose response was lost; the retry then sees our own
                // committed object. Only a *different* object means another device holds this id.
                let existing = self.storage.get_bytes(&key).await?;
                if existing.as_deref().map(crypto::sha256_hex).as_deref() != Some(digest.as_str()) {
                    return Err(IdentityCollision(key).into());
                }
            }
            Err(PutIfAbsentError::Other(e)) => return Err(e),
        }
        // Fault injection for the crash-recovery test (scripts/e2e.ts): die after the
        // entry is committed but before any local state records it.
        if std::env::var_os("RBOX_FAULT_CRASH_AFTER_JOURNAL_PUT").is_some() {
            std::process::exit(99);
        }
        self.state.set_meta("next_seq", &(seq + 1).to_string())?;
        self.state.set_cursor(&self.cfg.device_id, seq)?;
        self.state.set_meta("pending_append", "")?;
        if let Some(tx) = &self.on_appended {
            let _ = tx.send(crate::hub::AppendedEvent {
                seq,
                object_key: key,
                sealed_entry: sealed_b64,
            });
        }
        info!("{:?} {}", action, path);
        Ok(entry)
    }
}

/// Fetch the vault (creating it if the bucket is fresh) and return the master key.
pub async fn unlock_or_create_vault(storage: &Storage, passphrase: &str, create_params: (u32, u32)) -> Result<(SecretKey, String, bool)> {
    if let Some(bytes) = storage.get_bytes(journal::VAULT_KEY).await? {
        let vault: Vault = serde_json::from_slice(&bytes).context("rb/vault.json is not a RenegadeBox vault")?;
        let master = vault.unlock(passphrase)?;
        return Ok((master, crypto::sha256_hex(&bytes), false));
    }
    let master = SecretKey::random();
    let vault = Vault::create(&master, passphrase, create_params.0, create_params.1)?;
    let bytes = serde_json::to_vec_pretty(&vault)?;
    match storage.put_bytes_if_absent(journal::VAULT_KEY, bytes.clone()).await {
        Ok(()) => Ok((master, hex::encode(Sha256::digest(&bytes)), true)),
        Err(PutIfAbsentError::Exists) => bail!("another device created the vault at the same moment; run init again"),
        Err(PutIfAbsentError::Other(e)) => Err(e),
    }
}
