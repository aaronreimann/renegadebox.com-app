//! Local SQLite state. Lives in the profile dir, never inside the sync folder.
//!
//! Per path we track two versions:
//! * `synced_*` / `head_*` — the version this device agrees is current, and its
//!   (lamport, device) order. `synced_hash = NULL` is a tombstone.
//! * `local_*` — what was last observed on disk. `local_hash = NULL` means absent.
//!
//! A path has a pending local change exactly when `local_hash IS NOT synced_hash`.

use std::path::Path;

use anyhow::Result;
use rusqlite::{Connection, OptionalExtension, params};

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct FileRow {
    pub path: String,
    pub synced_hash: Option<String>,
    pub blob_id: Option<String>,
    pub head_lamport: u64,
    pub head_device: String,
    pub local_hash: Option<String>,
    pub local_size: Option<u64>,
    pub local_mtime_ns: Option<i64>,
}

impl FileRow {
    pub fn new(path: &str) -> Self {
        Self { path: path.to_string(), ..Default::default() }
    }
    pub fn is_dirty(&self) -> bool {
        self.local_hash != self.synced_hash
    }
    pub fn head_order(&self) -> (u64, &str) {
        (self.head_lamport, self.head_device.as_str())
    }
}

pub struct State {
    conn: Connection,
}

impl State {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             CREATE TABLE IF NOT EXISTS files (
               path TEXT PRIMARY KEY,
               synced_hash TEXT,
               blob_id TEXT,
               head_lamport INTEGER NOT NULL DEFAULT 0,
               head_device TEXT NOT NULL DEFAULT '',
               local_hash TEXT,
               local_size INTEGER,
               local_mtime_ns INTEGER
             );
             CREATE TABLE IF NOT EXISTS cursors (
               device_id TEXT PRIMARY KEY,
               last_seq INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS meta (
               key TEXT PRIMARY KEY,
               value TEXT NOT NULL
             );",
        )?;
        Ok(Self { conn })
    }

    pub fn get(&self, path: &str) -> Result<Option<FileRow>> {
        Ok(self
            .conn
            .query_row(
                "SELECT path, synced_hash, blob_id, head_lamport, head_device, local_hash, local_size, local_mtime_ns
                 FROM files WHERE path = ?1",
                [path],
                row_to_file,
            )
            .optional()?)
    }

    pub fn get_or_new(&self, path: &str) -> Result<FileRow> {
        Ok(self.get(path)?.unwrap_or_else(|| FileRow::new(path)))
    }

    pub fn put(&self, r: &FileRow) -> Result<()> {
        self.conn.execute(
            "INSERT INTO files (path, synced_hash, blob_id, head_lamport, head_device, local_hash, local_size, local_mtime_ns)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(path) DO UPDATE SET synced_hash=?2, blob_id=?3, head_lamport=?4, head_device=?5,
               local_hash=?6, local_size=?7, local_mtime_ns=?8",
            params![
                r.path,
                r.synced_hash,
                r.blob_id,
                r.head_lamport as i64,
                r.head_device,
                r.local_hash,
                r.local_size.map(|s| s as i64),
                r.local_mtime_ns
            ],
        )?;
        Ok(())
    }

    pub fn all(&self) -> Result<Vec<FileRow>> {
        let mut st = self.conn.prepare(
            "SELECT path, synced_hash, blob_id, head_lamport, head_device, local_hash, local_size, local_mtime_ns
             FROM files ORDER BY path",
        )?;
        let rows = st.query_map([], row_to_file)?.collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn dirty(&self) -> Result<Vec<FileRow>> {
        Ok(self.all()?.into_iter().filter(|r| r.is_dirty()).collect())
    }

    pub fn cursor(&self, device_id: &str) -> Result<u64> {
        Ok(self
            .conn
            .query_row("SELECT last_seq FROM cursors WHERE device_id = ?1", [device_id], |r| r.get::<_, i64>(0))
            .optional()?
            .unwrap_or(0) as u64)
    }

    pub fn set_cursor(&self, device_id: &str, seq: u64) -> Result<()> {
        self.conn.execute(
            "INSERT INTO cursors (device_id, last_seq) VALUES (?1, ?2)
             ON CONFLICT(device_id) DO UPDATE SET last_seq = ?2",
            params![device_id, seq as i64],
        )?;
        Ok(())
    }

    pub fn meta(&self, key: &str) -> Result<Option<String>> {
        Ok(self.conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0)).optional()?)
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn meta_u64(&self, key: &str) -> Result<u64> {
        Ok(self.meta(key)?.and_then(|v| v.parse().ok()).unwrap_or(0))
    }

    /// Remove rows that carry no information (tombstoned, absent locally, never seen remotely).
    pub fn gc(&self) -> Result<()> {
        self.conn.execute(
            "DELETE FROM files WHERE synced_hash IS NULL AND local_hash IS NULL AND head_lamport = 0",
            [],
        )?;
        Ok(())
    }
}

fn row_to_file(r: &rusqlite::Row<'_>) -> rusqlite::Result<FileRow> {
    Ok(FileRow {
        path: r.get(0)?,
        synced_hash: r.get(1)?,
        blob_id: r.get(2)?,
        head_lamport: r.get::<_, i64>(3)? as u64,
        head_device: r.get(4)?,
        local_hash: r.get(5)?,
        local_size: r.get::<_, Option<i64>>(6)?.map(|s| s as u64),
        local_mtime_ns: r.get(7)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_dirty() {
        let dir = tempfile::tempdir().unwrap();
        let s = State::open(&dir.path().join("state.db")).unwrap();
        let mut r = FileRow::new("a/b.txt");
        r.local_hash = Some("aa".into());
        s.put(&r).unwrap();
        assert!(s.get("a/b.txt").unwrap().unwrap().is_dirty());
        r.synced_hash = Some("aa".into());
        r.head_lamport = 5;
        s.put(&r).unwrap();
        assert!(s.dirty().unwrap().is_empty());
        s.set_cursor("dev", 7).unwrap();
        assert_eq!(s.cursor("dev").unwrap(), 7);
        assert_eq!(s.cursor("other").unwrap(), 0);
    }
}
