use serde::{Deserialize, Serialize};

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
pub async fn trigger_sync() -> Result<SyncResult, String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    if !profile.config_path().exists() {
        return Err("Vault is not initialized. Run rbox init first.".to_string());
    }

    let mut engine = Engine::open(profile).await.map_err(|e| e.to_string())?;
    let report = engine.sync_once().await.map_err(|e| e.to_string())?;

    Ok(SyncResult {
        success: report.failed == 0,
        message: format!("{}", report),
        uploaded: report.uploaded,
        downloaded: report.downloaded,
        conflicts: report.conflicts,
        failed: report.failed,
    })
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
