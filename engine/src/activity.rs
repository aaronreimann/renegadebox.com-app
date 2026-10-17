//! Per-file sync activity, streamed to a UI while a sync cycle runs.
//!
//! `SyncReport` only has totals at the end of a cycle. These events let a client show
//! which file is moving right now (like the Dropbox menu bar list). They are advisory:
//! a dropped receiver never affects syncing.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityKind {
    /// Local file sent to the bucket.
    Upload,
    /// Remote change written to this Mac.
    Download,
    /// Local deletion published to other devices.
    DeleteRemote,
    /// Deletion from another device applied here.
    DeleteLocal,
    /// Local rename published (no re-upload).
    RenameRemote,
    /// Rename from another device applied here (no download).
    RenameLocal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityPhase {
    Started,
    Finished,
    Failed,
    /// Work began but turned out to be unnecessary (e.g. the file was edited back to the synced version).
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileActivity {
    /// Path relative to the sync folder, `/`-separated.
    pub path: String,
    pub kind: ActivityKind,
    pub phase: ActivityPhase,
    pub size: Option<u64>,
}

pub type ActivitySender = tokio::sync::mpsc::UnboundedSender<FileActivity>;
