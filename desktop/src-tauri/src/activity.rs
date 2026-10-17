//! Live sync activity for the menu bar popover: what is moving right now, plus a short
//! history of what finished. Fed by engine `FileActivity` events and by drop-folder moves.

use std::collections::VecDeque;
use std::path::PathBuf;

use renegadebox_engine::activity::{ActivityKind, ActivityPhase, FileActivity};
use serde::{Deserialize, Serialize};

/// How many finished items are kept (and persisted) for the "Sync history" list.
pub const MAX_RECENT: usize = 100;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ActivityItem {
    /// Path relative to the sync folder, or an absolute path for drop-folder moves.
    pub path: String,
    pub name: String,
    pub folder: String,
    /// "upload" | "download" | "delete_remote" | "delete_local" | "rename_remote" | "rename_local" | "moved"
    pub kind: String,
    /// "active" | "done" | "failed"
    pub status: String,
    pub size: Option<u64>,
    pub started_ms: i64,
    pub finished_ms: Option<i64>,
    /// Where a drop-folder file was moved to (absolute).
    #[serde(default)]
    pub destination: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct SyncActivity {
    pub active: Vec<ActivityItem>,
    pub recent: Vec<ActivityItem>,
}

pub fn kind_str(kind: ActivityKind) -> &'static str {
    match kind {
        ActivityKind::Upload => "upload",
        ActivityKind::Download => "download",
        ActivityKind::DeleteRemote => "delete_remote",
        ActivityKind::DeleteLocal => "delete_local",
        ActivityKind::RenameRemote => "rename_remote",
        ActivityKind::RenameLocal => "rename_local",
    }
}

fn split(path: &str) -> (String, String) {
    match path.rsplit_once('/') {
        Some((folder, name)) => (name.to_string(), folder.to_string()),
        None => (path.to_string(), String::new()),
    }
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Debug, Default)]
pub struct ActivityLog {
    active: Vec<ActivityItem>,
    recent: VecDeque<ActivityItem>,
    store: Option<PathBuf>,
}

impl ActivityLog {
    /// Load persisted history (active items never survive a restart).
    pub fn load(store: Option<PathBuf>) -> Self {
        let recent = store
            .as_ref()
            .and_then(|p| std::fs::read(p).ok())
            .and_then(|b| serde_json::from_slice::<Vec<ActivityItem>>(&b).ok())
            .unwrap_or_default();
        Self { active: Vec::new(), recent: recent.into_iter().take(MAX_RECENT).collect(), store }
    }

    /// Apply one engine event. Returns true if anything visible changed.
    pub fn apply(&mut self, ev: &FileActivity, now: i64) -> bool {
        let kind = kind_str(ev.kind);
        match ev.phase {
            ActivityPhase::Started => {
                self.active.retain(|a| a.path != ev.path);
                let (name, folder) = split(&ev.path);
                self.active.push(ActivityItem {
                    path: ev.path.clone(),
                    name,
                    folder,
                    kind: kind.to_string(),
                    status: "active".into(),
                    size: ev.size,
                    started_ms: now,
                    finished_ms: None,
                    destination: None,
                });
                true
            }
            ActivityPhase::Skipped => {
                let before = self.active.len();
                self.active.retain(|a| a.path != ev.path);
                before != self.active.len()
            }
            ActivityPhase::Finished | ActivityPhase::Failed => {
                let started = self.active.iter().find(|a| a.path == ev.path).map(|a| a.started_ms);
                self.active.retain(|a| a.path != ev.path);
                let (name, folder) = split(&ev.path);
                self.push_recent(ActivityItem {
                    path: ev.path.clone(),
                    name,
                    folder,
                    kind: kind.to_string(),
                    status: if ev.phase == ActivityPhase::Finished { "done" } else { "failed" }.into(),
                    size: ev.size,
                    started_ms: started.unwrap_or(now),
                    finished_ms: Some(now),
                    destination: None,
                });
                true
            }
        }
    }

    /// Record a file the drop folder moved somewhere (NAS or an organized subfolder).
    pub fn record_move(&mut self, source: &str, destination: &str, size: u64, now: i64) {
        let (name, _) = split(source);
        let (_, dest_folder) = split(destination);
        self.push_recent(ActivityItem {
            path: destination.to_string(),
            name,
            folder: dest_folder,
            kind: "moved".into(),
            status: "done".into(),
            size: Some(size),
            started_ms: now,
            finished_ms: Some(now),
            destination: Some(destination.to_string()),
        });
    }

    /// A cycle ended (or errored): anything still marked active was interrupted and will be retried.
    pub fn clear_active(&mut self) -> bool {
        let had = !self.active.is_empty();
        self.active.clear();
        had
    }

    pub fn snapshot(&self) -> SyncActivity {
        SyncActivity { active: self.active.clone(), recent: self.recent.iter().cloned().collect() }
    }

    fn push_recent(&mut self, item: ActivityItem) {
        // Repeated saves of the same file collapse into one row.
        self.recent.retain(|r| !(r.path == item.path && r.kind == item.kind));
        self.recent.push_front(item);
        self.recent.truncate(MAX_RECENT);
        self.save();
    }

    fn save(&self) {
        if let Some(p) = &self.store {
            let list: Vec<&ActivityItem> = self.recent.iter().collect();
            if let Ok(json) = serde_json::to_vec(&list) {
                let tmp = p.with_extension("json.tmp");
                if std::fs::write(&tmp, json).is_ok() {
                    let _ = std::fs::rename(&tmp, p);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(path: &str, kind: ActivityKind, phase: ActivityPhase) -> FileActivity {
        FileActivity { path: path.into(), kind, phase, size: Some(10) }
    }

    #[test]
    fn started_then_finished_moves_item_to_history() {
        let mut log = ActivityLog::default();
        assert!(log.apply(&ev("Docs/a.pdf", ActivityKind::Upload, ActivityPhase::Started), 1));
        let s = log.snapshot();
        assert_eq!(s.active.len(), 1);
        assert_eq!(s.active[0].name, "a.pdf");
        assert_eq!(s.active[0].folder, "Docs");
        log.apply(&ev("Docs/a.pdf", ActivityKind::Upload, ActivityPhase::Finished), 5);
        let s = log.snapshot();
        assert!(s.active.is_empty());
        assert_eq!(s.recent[0].status, "done");
        assert_eq!(s.recent[0].started_ms, 1);
        assert_eq!(s.recent[0].finished_ms, Some(5));
    }

    #[test]
    fn skipped_leaves_no_history_and_failures_are_recorded() {
        let mut log = ActivityLog::default();
        log.apply(&ev("a", ActivityKind::Upload, ActivityPhase::Started), 1);
        log.apply(&ev("a", ActivityKind::Upload, ActivityPhase::Skipped), 2);
        assert_eq!(log.snapshot(), SyncActivity::default());
        log.apply(&ev("b", ActivityKind::Download, ActivityPhase::Failed), 3);
        assert_eq!(log.snapshot().recent[0].status, "failed");
    }

    #[test]
    fn repeated_saves_collapse_and_history_is_capped() {
        let mut log = ActivityLog::default();
        for i in 0..3 {
            log.apply(&ev("same.txt", ActivityKind::Upload, ActivityPhase::Finished), i);
        }
        assert_eq!(log.snapshot().recent.len(), 1);
        for i in 0..(MAX_RECENT + 20) {
            log.apply(&ev(&format!("f{i}"), ActivityKind::Upload, ActivityPhase::Finished), i as i64);
        }
        assert_eq!(log.snapshot().recent.len(), MAX_RECENT);
    }

    #[test]
    fn clear_active_drops_interrupted_work_and_history_persists() {
        let dir = std::env::temp_dir().join(format!("rb-activity-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let store = dir.join("activity.json");
        let mut log = ActivityLog::load(Some(store.clone()));
        log.apply(&ev("x", ActivityKind::Upload, ActivityPhase::Started), 1);
        log.record_move("/Users/a/To NAS/b.zip", "/Volumes/nas/Archives/b.zip", 99, 2);
        assert!(log.clear_active());
        let reloaded = ActivityLog::load(Some(store));
        let s = reloaded.snapshot();
        assert!(s.active.is_empty());
        assert_eq!(s.recent[0].kind, "moved");
        assert_eq!(s.recent[0].name, "b.zip");
        assert_eq!(s.recent[0].folder, "/Volumes/nas/Archives");
        let _ = std::fs::remove_dir_all(dir);
    }
}
