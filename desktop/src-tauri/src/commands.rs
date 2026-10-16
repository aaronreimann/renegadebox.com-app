use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State as TauriState};

use renegadebox_engine::config::Profile;
use renegadebox_engine::engine::Engine;
use renegadebox_engine::state::State;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VaultStatus {
    pub initialized: bool,
    pub folder: Option<String>,
    pub bucket: Option<String>,
    pub region: Option<String>,
    pub endpoint: Option<String>,
    pub device_id: Option<String>,
    pub device_name: Option<String>,
    pub hub_url: Option<String>,
    pub key_store: Option<String>,
    pub total_files: usize,
    pub pending_changes: usize,
    pub total_bytes: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileItem {
    pub path: String,
    pub size: u64,
    pub status: String, // "synced", "pending_upload", "conflicted", "deleted"
    pub mtime_ns: i64,
    pub blob_id: Option<String>,
    pub hash: Option<String>,
    pub is_dir: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncResult {
    pub success: bool,
    pub message: String,
    pub uploaded: usize,
    pub downloaded: usize,
    pub conflicts: usize,
    pub failed: usize,
}

pub enum SyncRequest {
    Trigger(Option<tokio::sync::oneshot::Sender<SyncResult>>),
}

#[derive(Clone)]
pub struct WatcherHandle {
    pub tx: tokio::sync::mpsc::UnboundedSender<SyncRequest>,
    pub paused: Arc<AtomicBool>,
}

pub async fn run_background_watcher(
    app: AppHandle,
    mut rx: tokio::sync::mpsc::UnboundedReceiver<SyncRequest>,
    paused: Arc<AtomicBool>,
) {
    loop {
        let profile = match Profile::locate() {
            Ok(p) => p,
            Err(_) => {
                tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
                continue;
            }
        };

        if !profile.config_path().exists() {
            tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
            continue;
        }

        let mut engine = match Engine::open(profile.clone()).await {
            Ok(e) => e,
            Err(err) => {
                eprintln!("[Watcher] Engine authorization or initialization deferred: {err:#}");
                // Back off significantly and wait for explicit trigger instead of spamming Keychain popups
                tokio::select! {
                    _ = tokio::time::sleep(tokio::time::Duration::from_secs(60)) => {}
                    Some(_) = rx.recv() => {}
                }
                continue;
            }
        };

        let (fs_tx, mut fs_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
        let mut debouncer = match notify_debouncer_full::new_debouncer(
            std::time::Duration::from_millis(500),
            None,
            move |res: notify_debouncer_full::DebounceEventResult| {
                if res.is_ok() {
                    let _ = fs_tx.send(());
                }
            },
        ) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("[Watcher] Debouncer initialization error: {e:#}");
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                continue;
            }
        };

        if let Err(e) = debouncer.watch(engine.root(), notify::RecursiveMode::Recursive) {
            eprintln!("[Watcher] Failed to watch {}: {e:#}", engine.root().display());
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            continue;
        }

        eprintln!("[Watcher] Native FSEvents auto-sync active on {}", engine.root().display());
        let _ = app.emit("vault-changed", ());

        let mut poll_interval = tokio::time::interval(std::time::Duration::from_secs(15));
        loop {
            let mut manual_reply = None;
            tokio::select! {
                _ = poll_interval.tick() => {}
                Some(()) = fs_rx.recv() => {
                    // Drain any queued events to coalesce bursts
                    while fs_rx.try_recv().is_ok() {}
                }
                Some(req) = rx.recv() => {
                    match req {
                        SyncRequest::Trigger(reply) => {
                            manual_reply = reply;
                        }
                    }
                }
            }

            let is_paused = paused.load(Ordering::SeqCst);
            if is_paused && manual_reply.is_none() {
                // When paused, skip auto-sync on timer/FSEvents unless user explicitly clicked Sync Now
                continue;
            }

            let _ = app.emit("sync-started", ());
            match engine.sync_once().await {
                Ok(report) => {
                    let result = SyncResult {
                        success: report.failed == 0,
                        message: format!("{report}"),
                        uploaded: report.uploaded,
                        downloaded: report.downloaded,
                        conflicts: report.conflicts,
                        failed: report.failed,
                    };
                    if let Some(reply) = manual_reply {
                        let _ = reply.send(result.clone());
                    }
                    if report.uploaded > 0
                        || report.downloaded > 0
                        || report.conflicts > 0
                        || report.renamed_local > 0
                        || report.renamed_remote > 0
                    {
                        eprintln!("[Watcher] Auto-synced changes: {report}");
                        let _ = app.emit("vault-changed", ());
                        let _ = app.emit("sync-finished", result);
                    }
                }
                Err(e) => {
                    eprintln!("[Watcher] Auto-sync cycle warning: {e:#}");
                    if let Some(reply) = manual_reply {
                        let _ = reply.send(SyncResult {
                            success: false,
                            message: format!("Sync error: {e:#}"),
                            uploaded: 0,
                            downloaded: 0,
                            conflicts: 0,
                            failed: 1,
                        });
                    }
                }
            }

            // Drain any fs notifications provoked by our own downloads/writes
            while fs_rx.try_recv().is_ok() {}
        }
    }
}

#[tauri::command]
pub async fn get_vault_status() -> Result<VaultStatus, String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    if !profile.config_path().exists() {
        return Ok(VaultStatus {
            initialized: false,
            folder: None,
            bucket: None,
            region: None,
            endpoint: None,
            device_id: None,
            device_name: None,
            hub_url: None,
            key_store: None,
            total_files: 0,
            pending_changes: 0,
            total_bytes: 0,
        });
    }

    let cfg = profile.load().map_err(|e| e.to_string())?;
    let mut total_files = 0;
    let mut pending_changes = 0;
    let mut total_bytes = 0;

    if profile.state_path().exists() {
        if let Ok(state) = State::open(&profile.state_path()) {
            if let Ok(files) = state.all() {
                for f in &files {
                    if f.local_hash.is_some() {
                        total_files += 1;
                        if let Some(s) = f.local_size {
                            total_bytes += s;
                        }
                    }
                    if f.is_dirty() {
                        pending_changes += 1;
                    }
                }
            }
        }
    }

    let key_store_str = match cfg.key_store {
        renegadebox_engine::config::KeyStoreKind::Keychain => "macOS Keychain (Hardware-backed)",
        renegadebox_engine::config::KeyStoreKind::InsecureFile => "Local File",
    };

    Ok(VaultStatus {
        initialized: true,
        folder: Some(cfg.folder.to_string_lossy().to_string()),
        bucket: Some(cfg.bucket),
        region: Some(cfg.region),
        endpoint: cfg.endpoint,
        device_id: Some(cfg.device_id),
        device_name: Some(cfg.device_name),
        hub_url: cfg.hub_url,
        key_store: Some(key_store_str.to_string()),
        total_files,
        pending_changes,
        total_bytes,
    })
}

#[tauri::command]
pub async fn trigger_sync(state: TauriState<'_, WatcherHandle>) -> Result<SyncResult, String> {
    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
    state
        .tx
        .send(SyncRequest::Trigger(Some(reply_tx)))
        .map_err(|e| format!("Failed to send trigger to watcher: {e}"))?;

    match tokio::time::timeout(std::time::Duration::from_secs(30), reply_rx).await {
        Ok(Ok(result)) => Ok(result),
        Ok(Err(_)) => Err("Watcher channel closed without response".to_string()),
        Err(_) => Err("Sync timed out after 30 seconds".to_string()),
    }
}

#[tauri::command]
pub fn pause_sync(app: AppHandle, state: TauriState<'_, WatcherHandle>) -> Result<bool, String> {
    state.paused.store(true, Ordering::SeqCst);
    let _ = app.emit("sync-paused", ());
    Ok(true)
}

#[tauri::command]
pub fn resume_sync(app: AppHandle, state: TauriState<'_, WatcherHandle>) -> Result<bool, String> {
    state.paused.store(false, Ordering::SeqCst);
    let _ = app.emit("sync-resumed", ());
    let _ = state.tx.send(SyncRequest::Trigger(None));
    Ok(false)
}

#[tauri::command]
pub fn is_sync_paused(state: TauriState<'_, WatcherHandle>) -> Result<bool, String> {
    Ok(state.paused.load(Ordering::SeqCst))
}

#[tauri::command]
pub async fn list_synced_files() -> Result<Vec<FileItem>, String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    if !profile.state_path().exists() {
        return Ok(Vec::new());
    }

    let state = State::open(&profile.state_path()).map_err(|e| e.to_string())?;
    let rows = state.all().map_err(|e| e.to_string())?;
    let folder = profile.load().map(|c| c.folder).unwrap_or_default();

    let mut items = Vec::new();
    for r in rows {
        // Skip tombstone files where neither local nor remote exists
        if r.local_hash.is_none() && r.synced_hash.is_none() {
            continue;
        }

        let full_path = folder.join(&r.path);
        let is_dir = full_path.is_dir();

        let status = if r.path.contains("conflicted copy") {
            "conflicted".to_string()
        } else if r.is_dirty() {
            "pending_upload".to_string()
        } else if r.local_hash.is_none() {
            "deleted".to_string()
        } else {
            "synced".to_string()
        };

        items.push(FileItem {
            path: r.path,
            size: r.local_size.unwrap_or(0),
            status,
            mtime_ns: r.local_mtime_ns.unwrap_or(0),
            blob_id: r.blob_id,
            hash: r.local_hash.or(r.synced_hash),
            is_dir,
        });
    }

    Ok(items)
}

#[tauri::command]
pub fn open_file(path: String) -> Result<(), String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let cfg = profile.load().map_err(|e| e.to_string())?;
    let target = cfg.folder.join(&path);

    if !target.exists() {
        return Err(format!("File does not exist on disk: {}", target.display()));
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&target)
            .spawn()
            .map_err(|e| format!("Failed to open file: {e}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&target)
            .spawn()
            .map_err(|e| format!("Failed to open file: {e}"))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &target.to_string_lossy()])
            .spawn()
            .map_err(|e| format!("Failed to open file: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let cfg = profile.load().map_err(|e| e.to_string())?;
    let target = cfg.folder.join(&path);

    if !target.exists() {
        return Err(format!("File does not exist: {}", target.display()));
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &target.to_string_lossy()])
            .spawn()
            .map_err(|e| format!("Failed to reveal file: {e}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = target.parent() {
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| format!("Failed to reveal file: {e}"))?;
        }
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &target.to_string_lossy()])
            .spawn()
            .map_err(|e| format!("Failed to reveal file: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let cfg = profile.load().map_err(|e| e.to_string())?;
    let target = cfg.folder.join(&path);

    if !target.exists() {
        return Err(format!("File does not exist: {}", target.display()));
    }

    // Try moving to Trash on macOS via AppleScript
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "tell application \"Finder\" to delete POSIX file \"{}\"",
            target.to_string_lossy().replace('"', "\\\"")
        );
        let status = std::process::Command::new("osascript")
            .args(["-e", &script])
            .status();

        if let Ok(s) = status {
            if s.success() {
                return Ok(());
            }
        }
    }

    // Fallback: direct removal
    if target.is_dir() {
        std::fs::remove_dir_all(&target).map_err(|e| format!("Failed to remove folder: {e}"))?;
    } else {
        std::fs::remove_file(&target).map_err(|e| format!("Failed to remove file: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
pub fn create_folder(relative_path: String) -> Result<(), String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let cfg = profile.load().map_err(|e| e.to_string())?;
    let clean_path = relative_path.trim_start_matches('/');
    let target = cfg.folder.join(clean_path);

    std::fs::create_dir_all(&target)
        .map_err(|e| format!("Failed to create folder {}: {e}", target.display()))?;

    Ok(())
}

#[tauri::command]
pub fn pick_and_import_files() -> Result<Vec<String>, String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let cfg = profile.load().map_err(|e| e.to_string())?;
    let dest_dir = cfg.folder;

    #[cfg(target_os = "macos")]
    {
        let script = "set chosen to choose file with prompt \"Select files to add to RenegadeBox vault\" with multiple selections allowed\n\
                      set outList to \"\"\n\
                      repeat with aFile in chosen\n\
                          set outList to outList & POSIX path of aFile & \"\\n\"\n\
                      end repeat\n\
                      return outList";

        let output = std::process::Command::new("osascript")
            .args(["-e", script])
            .output()
            .map_err(|e| format!("Failed to invoke file picker: {e}"))?;

        if !output.status.success() {
            // User cancelled picker
            return Ok(Vec::new());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut imported = Vec::new();

        for line in stdout.lines() {
            let path_str = line.trim();
            if path_str.is_empty() {
                continue;
            }
            let src = std::path::Path::new(path_str);
            if src.exists() {
                if let Some(file_name) = src.file_name() {
                    let dest = dest_dir.join(file_name);
                    if let Err(e) = std::fs::copy(src, &dest) {
                        eprintln!("[Import] Failed to copy {}: {e}", src.display());
                    } else {
                        imported.push(file_name.to_string_lossy().to_string());
                    }
                }
            }
        }

        return Ok(imported);
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Native file picker is currently available on macOS".to_string())
    }
}

#[tauri::command]
pub fn open_sync_folder() -> Result<(), String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let cfg = profile.load().map_err(|e| e.to_string())?;
    let folder = cfg.folder;

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&folder)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&folder)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&folder)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn open_dashboard() -> Result<(), String> {
    let url = "http://localhost:3000";

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("Failed to open dashboard: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("Failed to open dashboard: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", url])
            .spawn()
            .map_err(|e| format!("Failed to open dashboard: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let cfg = profile.load().map_err(|e| e.to_string())?;
    let src = cfg.folder.join(old_path.trim_start_matches('/'));
    let dst = cfg.folder.join(new_path.trim_start_matches('/'));

    if !src.exists() {
        return Err(format!("Source file does not exist: {}", src.display()));
    }
    if dst.exists() {
        return Err(format!("A file or folder named '{}' already exists", new_path));
    }
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {e}"))?;
    }
    std::fs::rename(&src, &dst).map_err(|e| format!("Failed to rename file: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn resolve_conflict(path: String, resolution: String) -> Result<(), String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let cfg = profile.load().map_err(|e| e.to_string())?;
    let conflicted_target = cfg.folder.join(path.trim_start_matches('/'));

    if !conflicted_target.exists() {
        return Err(format!("Conflicted file does not exist: {}", conflicted_target.display()));
    }

    match resolution.as_str() {
        "keep_local" => {
            // Delete the conflicted copy
            if conflicted_target.is_dir() {
                std::fs::remove_dir_all(&conflicted_target).map_err(|e| format!("Failed to delete conflicted folder: {e}"))?;
            } else {
                std::fs::remove_file(&conflicted_target).map_err(|e| format!("Failed to delete conflicted file: {e}"))?;
            }
        }
        "keep_conflicted" => {
            // Identify original base file name and overwrite
            let file_name = conflicted_target.file_name().unwrap_or_default().to_string_lossy().to_string();
            let parent = conflicted_target.parent().unwrap_or(&cfg.folder);
            
            let base_name = if let Some(idx) = file_name.find(" (conflicted copy") {
                let ext = std::path::Path::new(&file_name).extension().and_then(|e| e.to_str()).map(|e| format!(".{e}")).unwrap_or_default();
                format!("{}{ext}", &file_name[..idx])
            } else {
                file_name.replace("conflicted", "resolved")
            };
            let base_target = parent.join(&base_name);
            
            std::fs::copy(&conflicted_target, &base_target).map_err(|e| format!("Failed to copy conflicted version over base: {e}"))?;
            let _ = std::fs::remove_file(&conflicted_target);
        }
        "keep_both" => {
            // Rename conflicted file to a clean archive name
            let file_name = conflicted_target.file_name().unwrap_or_default().to_string_lossy().to_string();
            let parent = conflicted_target.parent().unwrap_or(&cfg.folder);
            let ext = std::path::Path::new(&file_name).extension().and_then(|e| e.to_str()).map(|e| format!(".{e}")).unwrap_or_default();
            let clean_name = if let Some(idx) = file_name.find(" (conflicted copy") {
                format!("{} (archived copy){ext}", &file_name[..idx])
            } else {
                format!("{} (copy){ext}", file_name.trim_end_matches(&ext))
            };
            let new_target = parent.join(&clean_name);
            std::fs::rename(&conflicted_target, &new_target).map_err(|e| format!("Failed to archive conflicted file: {e}"))?;
        }
        other => return Err(format!("Unknown resolution strategy: {other}")),
    }

    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileRevision {
    pub timestamp_ms: i64,
    pub date_str: String,
    pub device_name: String,
    pub lamport: u64,
    pub size: u64,
    pub hash: String,
    pub blob_id: Option<String>,
    pub action: String,
    pub is_current: bool,
}

#[tauri::command]
pub async fn get_file_history(path: String) -> Result<Vec<FileRevision>, String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let mut revisions = Vec::new();

    if profile.state_path().exists() {
        if let Ok(state) = State::open(&profile.state_path()) {
            if let Ok(Some(row)) = state.get(&path) {
                let mtime_ms = row.local_mtime_ns.unwrap_or(0) / 1_000_000;
                let date_str = if mtime_ms > 0 {
                    chrono::DateTime::from_timestamp_millis(mtime_ms)
                        .map(|dt| dt.format("%b %d, %Y %H:%M:%S UTC").to_string())
                        .unwrap_or_else(|| "Recent".to_string())
                } else {
                    "Current version".to_string()
                };

                let hash = row.local_hash.or(row.synced_hash).unwrap_or_default();
                revisions.push(FileRevision {
                    timestamp_ms: mtime_ms,
                    date_str,
                    device_name: if row.head_device.is_empty() { "Current Device".to_string() } else { row.head_device },
                    lamport: row.head_lamport,
                    size: row.local_size.unwrap_or(0),
                    hash,
                    blob_id: row.blob_id,
                    action: "Current Head".to_string(),
                    is_current: true,
                });
            }
        }
    }

    Ok(revisions)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UpdateConfigPayload {
    pub device_name: Option<String>,
    pub bucket: Option<String>,
    pub region: Option<String>,
    pub endpoint: Option<String>,
    pub hub_url: Option<String>,
}

#[tauri::command]
pub fn update_vault_config(payload: UpdateConfigPayload) -> Result<(), String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let mut cfg = profile.load().map_err(|e| e.to_string())?;

    if let Some(dn) = payload.device_name {
        if !dn.trim().is_empty() {
            renegadebox_engine::config::validate_device_name(&dn).map_err(|e| e.to_string())?;
            cfg.device_name = dn.trim().to_string();
        }
    }
    if let Some(b) = payload.bucket {
        if !b.trim().is_empty() {
            cfg.bucket = b.trim().to_string();
        }
    }
    if let Some(r) = payload.region {
        if !r.trim().is_empty() {
            cfg.region = r.trim().to_string();
        }
    }
    if let Some(ep) = payload.endpoint {
        cfg.endpoint = if ep.trim().is_empty() { None } else { Some(ep.trim().to_string()) };
    }
    if let Some(h) = payload.hub_url {
        cfg.hub_url = if h.trim().is_empty() { None } else { Some(h.trim().to_string()) };
    }

    profile.save(&cfg).map_err(|e| format!("Failed to save config: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_ignored_patterns() -> Result<Vec<String>, String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let cfg = profile.load().map_err(|e| e.to_string())?;
    let ignore_file = cfg.folder.join(".rboxignore");

    if !ignore_file.exists() {
        return Ok(vec![
            ".DS_Store".to_string(),
            "Thumbs.db".to_string(),
            "*.tmp".to_string(),
            ".git/".to_string(),
            "node_modules/".to_string(),
        ]);
    }

    let content = std::fs::read_to_string(&ignore_file).map_err(|e| e.to_string())?;
    let patterns = content
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .collect();

    Ok(patterns)
}

#[tauri::command]
pub fn save_ignored_patterns(patterns: Vec<String>) -> Result<(), String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let cfg = profile.load().map_err(|e| e.to_string())?;
    let ignore_file = cfg.folder.join(".rboxignore");

    let content = patterns.join("\n") + "\n";
    std::fs::write(&ignore_file, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn export_file_copy(path: String) -> Result<String, String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let cfg = profile.load().map_err(|e| e.to_string())?;
    let src = cfg.folder.join(path.trim_start_matches('/'));

    if !src.exists() {
        return Err(format!("File does not exist: {}", src.display()));
    }

    let file_name = src.file_name().ok_or_else(|| "Invalid file name".to_string())?;
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let downloads_dir = std::path::PathBuf::from(home).join("Downloads");
    let dst = downloads_dir.join(file_name);

    std::fs::copy(&src, &dst).map_err(|e| format!("Failed to export copy: {e}"))?;
    Ok(dst.to_string_lossy().to_string())
}
