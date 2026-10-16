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
}

pub async fn run_background_watcher(
    app: AppHandle,
    mut rx: tokio::sync::mpsc::UnboundedReceiver<SyncRequest>,
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
                eprintln!("[Watcher] Failed to open engine: {err:#}");
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
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
pub async fn list_synced_files() -> Result<Vec<FileItem>, String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    if !profile.state_path().exists() {
        return Ok(Vec::new());
    }

    let state = State::open(&profile.state_path()).map_err(|e| e.to_string())?;
    let rows = state.all().map_err(|e| e.to_string())?;

    let mut items = Vec::new();
    for r in rows {
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
        });
    }

    Ok(items)
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
