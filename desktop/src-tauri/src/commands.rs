use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
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
pub struct SyncResult {
    pub success: bool,
    pub message: String,
    pub uploaded: usize,
    pub downloaded: usize,
    pub conflicts: usize,
    pub failed: usize,
}

pub enum SyncRequest {
    Trigger,
}

/// What the watcher is doing right now; read by the popover through `get_sync_overview`.
#[derive(Default, Debug)]
pub struct SyncRuntime {
    pub syncing: bool,
    pub last_error: Option<String>,
    pub consecutive_failures: u32,
}

#[derive(Clone)]
pub struct WatcherHandle {
    pub tx: tokio::sync::mpsc::UnboundedSender<SyncRequest>,
    pub paused: Arc<AtomicBool>,
    pub runtime: Arc<Mutex<SyncRuntime>>,
}

/// Failed sync attempts in a row before we interrupt the user with a notification.
const NOTIFY_AFTER_FAILURES: u32 = 2;

/// Show an OS notification. Reserved for conflicts and persistent errors; routine syncing stays silent.
fn notify_user(title: &str, body: &str) {
    #[cfg(target_os = "macos")]
    {
        let esc = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!("display notification \"{}\" with title \"{}\"", esc(body), esc(title));
        let _ = std::process::Command::new("osascript").args(["-e", &script]).spawn();
    }
    #[cfg(not(target_os = "macos"))]
    eprintln!("[Notify] {title}: {body}");
}

#[cfg(target_os = "macos")]
fn set_folder_icon(path: &std::path::Path) {
    let icon_r = path.join("Icon\r");
    if icon_r.exists() {
        return;
    }
    let icon_path = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.join("../Resources/icon.icns")))
        .filter(|p| p.exists())
        .or_else(|| {
            let home = std::env::var("HOME").ok()?;
            let dev_icon = std::path::PathBuf::from(home)
                .join("Development/renegadebox.com-app/desktop/src-tauri/icons/icon.icns");
            if dev_icon.exists() { Some(dev_icon) } else { None }
        });

    if let Some(icns) = icon_path {
        let icns_str = icns.to_string_lossy();
        let path_str = path.to_string_lossy();
        let script = format!(
            "ObjC.import('AppKit');\n\
             var ws = $.NSWorkspace.sharedWorkspace;\n\
             var img = $.NSImage.alloc.initWithContentsOfFile('{}');\n\
             if (img) ws.setIconForFileOptions(img, '{}', 0);",
            icns_str.replace('\\', "\\\\").replace('\'', "\\'"),
            path_str.replace('\\', "\\\\").replace('\'', "\\'")
        );
        let _ = std::process::Command::new("osascript")
            .args(["-l", "JavaScript", "-e", &script])
            .spawn();
    }
}

fn record_failure(app: &AppHandle, runtime: &Mutex<SyncRuntime>, err: String) {
    let failures = {
        let mut rt = runtime.lock().unwrap();
        rt.syncing = false;
        rt.last_error = Some(err);
        rt.consecutive_failures += 1;
        rt.consecutive_failures
    };
    if failures == NOTIFY_AFTER_FAILURES {
        notify_user(
            "RenegadeBox can't sync right now",
            "Click the RenegadeBox icon in the menu bar for details.",
        );
    }
    let _ = app.emit("status-changed", ());
}

fn record_success(app: &AppHandle, runtime: &Mutex<SyncRuntime>) {
    let changed = {
        let mut rt = runtime.lock().unwrap();
        let changed = rt.syncing || rt.last_error.is_some();
        rt.syncing = false;
        rt.last_error = None;
        rt.consecutive_failures = 0;
        changed
    };
    if changed {
        let _ = app.emit("status-changed", ());
    }
}

pub async fn run_background_watcher(
    app: AppHandle,
    mut rx: tokio::sync::mpsc::UnboundedReceiver<SyncRequest>,
    handle: WatcherHandle,
) {
    let paused = handle.paused.clone();
    let runtime = handle.runtime.clone();
    loop {
        let profile = match Profile::locate() {
            Ok(p) => p,
            Err(_) => {
                tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
                continue;
            }
        };

        if !profile.config_path().exists() {
            tokio::select! {
                _ = tokio::time::sleep(tokio::time::Duration::from_secs(3)) => {}
                Some(_) = rx.recv() => {}
            }
            continue;
        }

        let mut engine = match Engine::open(profile.clone()).await {
            Ok(e) => e,
            Err(err) => {
                eprintln!("[Watcher] Engine authorization or initialization deferred: {err:#}");
                record_failure(&app, &runtime, format!("{err:#}"));
                // Back off and wait for an explicit trigger instead of repeating keychain prompts.
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
            record_failure(&app, &runtime, format!("sync folder {} is missing: {e:#}", engine.root().display()));
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            continue;
        }

        eprintln!("[Watcher] Native FSEvents auto-sync active on {}", engine.root().display());
        #[cfg(target_os = "macos")]
        set_folder_icon(engine.root());
        let _ = app.emit("vault-changed", ());

        let mut poll_interval = tokio::time::interval(std::time::Duration::from_secs(15));
        loop {
            let mut manual = false;
            tokio::select! {
                _ = poll_interval.tick() => {}
                Some(()) = fs_rx.recv() => {
                    // Drain any queued events to coalesce bursts
                    while fs_rx.try_recv().is_ok() {}
                }
                Some(SyncRequest::Trigger) = rx.recv() => {
                    manual = true;
                }
            }

            if paused.load(Ordering::SeqCst) && !manual {
                continue;
            }
            if paused.load(Ordering::SeqCst) {
                // Resolving a conflict while paused only refreshes the UI; it does not sync.
                let _ = app.emit("status-changed", ());
                continue;
            }

            runtime.lock().unwrap().syncing = true;
            let _ = app.emit("sync-started", ());
            match engine.sync_once().await {
                Ok(report) => {
                    record_success(&app, &runtime);
                    if report.conflicts > 0 {
                        let body = if report.conflicts == 1 {
                            "1 file needs your attention. It was changed in two places at once.".to_string()
                        } else {
                            format!("{} files need your attention. They were changed in two places at once.", report.conflicts)
                        };
                        notify_user("RenegadeBox", &body);
                    }
                    if report.uploaded > 0
                        || report.downloaded > 0
                        || report.conflicts > 0
                        || report.renamed_local > 0
                        || report.renamed_remote > 0
                    {
                        eprintln!("[Watcher] Auto-synced changes: {report}");
                        let result = SyncResult {
                            success: report.failed == 0,
                            message: format!("{report}"),
                            uploaded: report.uploaded,
                            downloaded: report.downloaded,
                            conflicts: report.conflicts,
                            failed: report.failed,
                        };
                        let _ = app.emit("vault-changed", ());
                        let _ = app.emit("sync-finished", result);
                    }
                    let _ = app.emit("status-changed", ());
                }
                Err(e) => {
                    eprintln!("[Watcher] Auto-sync cycle warning: {e:#}");
                    record_failure(&app, &runtime, format!("{e:#}"));
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

    if profile.state_path().exists()
        && let Ok(state) = State::open(&profile.state_path())
        && let Ok(files) = state.all()
    {
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

    let key_store_str = match cfg.key_store {
        renegadebox_engine::config::KeyStoreKind::Keychain => "System keychain",
        renegadebox_engine::config::KeyStoreKind::InsecureFile => "Unprotected file (readable by any app running as you)",
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

/// Everything the popover status line needs, in one call.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct SyncOverview {
    pub initialized: bool,
    pub paused: bool,
    pub syncing: bool,
    pub pending: usize,
    pub conflicts: usize,
    pub error: Option<String>,
}

#[tauri::command]
pub fn get_sync_overview(state: TauriState<'_, WatcherHandle>) -> Result<SyncOverview, String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let initialized = profile.config_path().exists();
    let (mut pending, mut conflicts) = (0, 0);
    if initialized && profile.state_path().exists() {
        let db = State::open(&profile.state_path()).map_err(|e| e.to_string())?;
        for row in db.all().map_err(|e| e.to_string())? {
            if row.is_dirty() {
                pending += 1;
            }
            if row.local_hash.is_some() && parse_conflict_name(&row.path).is_some() {
                conflicts += 1;
            }
        }
    }
    let rt = state.runtime.lock().unwrap();
    Ok(SyncOverview {
        initialized,
        paused: state.paused.load(Ordering::SeqCst),
        syncing: rt.syncing,
        pending,
        conflicts,
        error: if initialized { rt.last_error.clone() } else { None },
    })
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RecentFile {
    pub path: String,
    pub name: String,
    pub folder: String,
    pub modified_ms: i64,
}

fn split_path(path: &str) -> (String, String) {
    match path.rsplit_once('/') {
        Some((folder, name)) => (name.to_string(), folder.to_string()),
        None => (path.to_string(), String::new()),
    }
}

/// The most recently changed files in the sync folder (newest first), from the engine's state database.
#[tauri::command]
pub fn list_recent_files(limit: Option<usize>) -> Result<Vec<RecentFile>, String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    if !profile.state_path().exists() {
        return Ok(Vec::new());
    }
    let db = State::open(&profile.state_path()).map_err(|e| e.to_string())?;
    let mut rows: Vec<_> = db
        .all()
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|r| r.local_hash.is_some() && parse_conflict_name(&r.path).is_none())
        .collect();
    rows.sort_by_key(|r| std::cmp::Reverse(r.local_mtime_ns.unwrap_or(0)));
    Ok(rows
        .into_iter()
        .take(limit.unwrap_or(10).min(50))
        .map(|r| {
            let (name, folder) = split_path(&r.path);
            RecentFile {
                modified_ms: r.local_mtime_ns.unwrap_or(0) / 1_000_000,
                path: r.path,
                name,
                folder,
            }
        })
        .collect())
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ConflictItem {
    /// Path of the conflicted copy (what `resolve_conflict` takes).
    pub path: String,
    pub original_name: String,
    pub folder: String,
    pub device: Option<String>,
    pub modified_ms: i64,
}

/// Parse an engine conflict copy name, e.g.
/// `dir/report (conflicted copy from Laptop 2026-10-15 a1b2c3d4).pdf` -> (`report.pdf`, `Some("Laptop")`).
pub fn parse_conflict_name(path: &str) -> Option<(String, Option<String>)> {
    let (name, _) = split_path(path);
    let start = name.find(" (conflicted copy")?;
    let after = &name[start + " (conflicted copy".len()..];
    let close = after.rfind(')')?;
    let inner = &after[..close];
    let ext = &after[close + 1..];
    let device = inner.find("from ").and_then(|i| {
        let mut words: Vec<&str> = inner[i + "from ".len()..].split_whitespace().collect();
        // trailing "<date> <short id>"
        if words.len() >= 3 {
            words.truncate(words.len() - 2);
            Some(words.join(" "))
        } else {
            None
        }
    });
    Some((format!("{}{ext}", &name[..start]), device))
}

#[tauri::command]
pub fn list_conflicts() -> Result<Vec<ConflictItem>, String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    if !profile.state_path().exists() {
        return Ok(Vec::new());
    }
    let db = State::open(&profile.state_path()).map_err(|e| e.to_string())?;
    let mut out: Vec<ConflictItem> = db
        .all()
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|r| r.local_hash.is_some())
        .filter_map(|r| {
            let (original_name, device) = parse_conflict_name(&r.path)?;
            let (_, folder) = split_path(&r.path);
            Some(ConflictItem {
                modified_ms: r.local_mtime_ns.unwrap_or(0) / 1_000_000,
                path: r.path,
                original_name,
                folder,
                device,
            })
        })
        .collect();
    out.sort_by_key(|c| std::cmp::Reverse(c.modified_ms));
    Ok(out)
}

/// Pause or resume automatic syncing. Shared by the popover and the tray menu.
pub fn set_paused(app: &AppHandle, handle: &WatcherHandle, paused: bool) {
    handle.paused.store(paused, Ordering::SeqCst);
    if paused {
        let _ = app.emit("sync-paused", ());
    } else {
        let _ = app.emit("sync-resumed", ());
        let _ = handle.tx.send(SyncRequest::Trigger);
    }
    let _ = app.emit("status-changed", ());
}

#[tauri::command]
pub fn pause_sync(app: AppHandle, state: TauriState<'_, WatcherHandle>) -> Result<bool, String> {
    set_paused(&app, &state, true);
    Ok(true)
}

#[tauri::command]
pub fn resume_sync(app: AppHandle, state: TauriState<'_, WatcherHandle>) -> Result<bool, String> {
    set_paused(&app, &state, false);
    Ok(false)
}

#[tauri::command]
pub fn is_sync_paused(state: TauriState<'_, WatcherHandle>) -> Result<bool, String> {
    Ok(state.paused.load(Ordering::SeqCst))
}

#[tauri::command]
pub fn open_settings(app: AppHandle) {
    crate::windows::open_settings(&app);
}

#[tauri::command]
pub fn open_setup(app: AppHandle) {
    crate::windows::open_setup(&app);
}

#[tauri::command]
pub fn hide_popover(app: AppHandle) {
    crate::windows::hide_popover(&app);
}

#[tauri::command]
pub fn close_window(window: tauri::WebviewWindow) {
    let _ = window.close();
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
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

/// `report.pdf` + `" (Laptop version)"` -> `report (Laptop version).pdf`, numbered if that name is taken.
fn free_name(dir: &std::path::Path, original: &str, suffix: &str) -> std::path::PathBuf {
    let (stem, ext) = match original.rfind('.') {
        Some(i) if i > 0 => (&original[..i], &original[i..]),
        _ => (original, ""),
    };
    let mut candidate = dir.join(format!("{stem}{suffix}{ext}"));
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem}{suffix} {n}{ext}"));
        n += 1;
    }
    candidate
}

/// Settle a conflicted copy:
/// - `keep_both`: keep it next to the original, renamed to e.g. `report (Laptop version).pdf`
/// - `keep_conflicted`: its contents replace the original
/// - `keep_local`: it is removed and the original stays as is
#[tauri::command]
pub fn resolve_conflict(
    app: AppHandle,
    state: TauriState<'_, WatcherHandle>,
    path: String,
    resolution: String,
) -> Result<(), String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let cfg = profile.load().map_err(|e| e.to_string())?;
    let conflicted_target = cfg.folder.join(path.trim_start_matches('/'));

    if !conflicted_target.is_file() {
        return Err("That file is no longer there. It may already have been sorted out.".to_string());
    }
    let (original_name, device) =
        parse_conflict_name(&path).ok_or_else(|| "That file isn't a conflicted copy.".to_string())?;
    let parent = conflicted_target.parent().unwrap_or(&cfg.folder).to_path_buf();

    match resolution.as_str() {
        "keep_local" => {
            std::fs::remove_file(&conflicted_target).map_err(|e| format!("Couldn't remove the other version: {e}"))?;
        }
        "keep_conflicted" => {
            std::fs::copy(&conflicted_target, parent.join(&original_name))
                .map_err(|e| format!("Couldn't replace {original_name}: {e}"))?;
            std::fs::remove_file(&conflicted_target).map_err(|e| format!("Couldn't tidy up the other version: {e}"))?;
        }
        "keep_both" => {
            let suffix = match device {
                Some(d) => format!(" ({d} version)"),
                None => " (other version)".to_string(),
            };
            let new_target = free_name(&parent, &original_name, &suffix);
            std::fs::rename(&conflicted_target, &new_target).map_err(|e| format!("Couldn't keep both versions: {e}"))?;
        }
        other => return Err(format!("Unknown resolution: {other}")),
    }

    let _ = app.emit("vault-changed", ());
    let _ = state.tx.send(SyncRequest::Trigger);
    Ok(())
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

    if let Some(dn) = payload.device_name
        && !dn.trim().is_empty()
    {
        renegadebox_engine::config::validate_device_name(dn.trim()).map_err(|e| e.to_string())?;
        cfg.device_name = dn.trim().to_string();
    }
    if let Some(b) = payload.bucket
        && !b.trim().is_empty()
    {
        cfg.bucket = b.trim().to_string();
    }
    if let Some(r) = payload.region
        && !r.trim().is_empty()
    {
        cfg.region = r.trim().to_string();
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

/// Move this device's secrets between the system keychain and the (unprotected) file store.
#[tauri::command]
pub fn set_key_store(use_keychain: bool) -> Result<String, String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let mut cfg = profile.load().map_err(|e| e.to_string())?;
    let to = if use_keychain {
        renegadebox_engine::config::KeyStoreKind::Keychain
    } else {
        renegadebox_engine::config::KeyStoreKind::InsecureFile
    };
    profile.move_secrets(&mut cfg, to).map_err(|e| format!("{e:#}"))?;
    Ok(if use_keychain { "System keychain".into() } else { "Unprotected file".into() })
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SetupVaultPayload {
    pub folder: String,
    pub bucket: String,
    pub region: String,
    pub endpoint: Option<String>,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub passphrase: String,
    pub device_name: Option<String>,
    pub hub_url: Option<String>,
}

fn default_device_name() -> String {
    std::process::Command::new("hostname")
        .arg("-s")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "My Mac".into())
}

#[tauri::command]
pub async fn setup_vault(
    app: AppHandle,
    state: TauriState<'_, WatcherHandle>,
    payload: SetupVaultPayload,
) -> Result<VaultStatus, String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;

    let folder_str = payload.folder.trim();
    if folder_str.is_empty() {
        return Err("Sync folder path cannot be empty".to_string());
    }
    let expanded_folder = if let Some(rest) = folder_str.strip_prefix("~/") {
        let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
        std::path::PathBuf::from(home).join(rest)
    } else {
        std::path::PathBuf::from(folder_str)
    };

    std::fs::create_dir_all(&expanded_folder)
        .map_err(|e| format!("Failed to create folder {}: {e}", expanded_folder.display()))?;
    let canonical_folder = expanded_folder
        .canonicalize()
        .map_err(|e| format!("Failed to resolve folder path: {e}"))?;
    #[cfg(target_os = "macos")]
    set_folder_icon(&canonical_folder);

    if canonical_folder.starts_with(&profile.dir) || profile.dir.starts_with(&canonical_folder) {
        return Err(format!(
            "Sync folder ({}) and profile dir ({}) must not contain each other",
            canonical_folder.display(),
            profile.dir.display()
        ));
    }

    let bucket = payload.bucket.trim().to_string();
    if bucket.is_empty() {
        return Err("Bucket name cannot be empty".to_string());
    }
    let region = payload.region.trim().to_string();
    if region.is_empty() {
        return Err("Region cannot be empty".to_string());
    }
    let access_key_id = payload.access_key_id.trim().to_string();
    if access_key_id.is_empty() {
        return Err("Access Key ID cannot be empty".to_string());
    }
    let secret = payload.secret_access_key.trim().to_string();
    if secret.is_empty() {
        return Err("Secret Access Key cannot be empty".to_string());
    }
    let passphrase = payload.passphrase;
    if passphrase.chars().count() < 12 {
        return Err("Passphrase must be at least 12 characters — it is the only thing protecting your files".to_string());
    }

    let device_name = match payload.device_name {
        Some(d) if !d.trim().is_empty() => d.trim().to_string(),
        _ => default_device_name(),
    };
    renegadebox_engine::config::validate_device_name(&device_name).map_err(|e| e.to_string())?;

    let endpoint = payload.endpoint.and_then(|e| {
        let trimmed = e.trim().to_string();
        if trimmed.is_empty() { None } else { Some(trimmed) }
    });

    let hub_url = payload.hub_url.and_then(|h| {
        let trimmed = h.trim().to_string();
        if trimmed.is_empty() { None } else { Some(trimmed) }
    });

    // Secrets belong in the OS keychain. Repeated macOS prompts mean the app is not signed
    // with a stable identity (see scripts/setup-signing.ts), not that the keychain is wrong.
    let mut cfg = renegadebox_engine::config::Config {
        folder: canonical_folder.clone(),
        bucket: bucket.clone(),
        region: region.clone(),
        endpoint: endpoint.clone(),
        access_key_id: access_key_id.clone(),
        device_id: uuid::Uuid::new_v4().to_string(),
        device_name: device_name.clone(),
        key_store: renegadebox_engine::config::KeyStoreKind::Keychain,
        vault_pin: String::new(),
        hub_url: hub_url.clone(),
        ai: Default::default(),
    };

    let storage = renegadebox_engine::engine::storage_for(&cfg, &secret);
    let (master, pin, _created) = renegadebox_engine::engine::unlock_or_create_vault(
        &storage,
        &passphrase,
        (
            renegadebox_engine::crypto::Vault::DEFAULT_M_KIB,
            renegadebox_engine::crypto::Vault::DEFAULT_T,
        ),
    )
    .await
    .map_err(|e| format!("Could not connect to S3 or unlock vault: {e:#}"))?;

    cfg.vault_pin = pin;

    profile
        .set_secret(&cfg, renegadebox_engine::config::SECRET_S3, &secret)
        .map_err(|e| e.to_string())?;
    profile
        .set_secret(&cfg, renegadebox_engine::config::SECRET_MASTER, &master.to_b64())
        .map_err(|e| e.to_string())?;
    profile.save(&cfg).map_err(|e| format!("Failed to save config: {e}"))?;

    let _ = std::fs::remove_file(profile.state_path());

    // Signal UI and watcher
    let _ = app.emit("vault-changed", ());
    let _ = state.tx.send(SyncRequest::Trigger);

    Ok(VaultStatus {
        initialized: true,
        folder: Some(canonical_folder.to_string_lossy().to_string()),
        bucket: Some(bucket),
        region: Some(region),
        endpoint,
        device_id: Some(cfg.device_id),
        device_name: Some(device_name),
        hub_url,
        key_store: Some("System keychain".to_string()),
        total_files: 0,
        pending_changes: 0,
        total_bytes: 0,
    })
}

#[tauri::command]
pub fn is_autostart_enabled() -> Result<bool, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let plist_path = std::path::PathBuf::from(home)
        .join("Library/LaunchAgents/com.renegadebox.desktop.plist");
    Ok(plist_path.exists())
}

#[tauri::command]
pub fn set_autostart_enabled(enabled: bool) -> Result<bool, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let agents_dir = std::path::PathBuf::from(home).join("Library/LaunchAgents");
    let plist_path = agents_dir.join("com.renegadebox.desktop.plist");

    if enabled {
        std::fs::create_dir_all(&agents_dir)
            .map_err(|e| format!("Failed to create LaunchAgents directory: {e}"))?;
        let current_exe = std::env::current_exe()
            .map_err(|e| format!("Failed to determine binary path: {e}"))?;
        let exe_str = current_exe.to_string_lossy();

        let plist_content = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.renegadebox.desktop</string>
    <key>ProgramArguments</key>
    <array>
        <string>{}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>ProcessType</key>
    <string>Interactive</string>
</dict>
</plist>
"#,
            exe_str
        );

        std::fs::write(&plist_path, plist_content)
            .map_err(|e| format!("Failed to write LaunchAgent plist: {e}"))?;
        Ok(true)
    } else {
        if plist_path.exists() {
            let _ = std::fs::remove_file(&plist_path);
        }
        Ok(false)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AiConfigView {
    pub enabled: bool,
    pub model: String,
    pub smb_target: Option<String>,
    pub rules: Option<String>,
    pub auto_route: bool,
    pub has_api_key: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SaveAiConfigPayload {
    pub enabled: bool,
    pub model: String,
    pub smb_target: Option<String>,
    pub rules: Option<String>,
    pub auto_route: bool,
    pub api_key: Option<String>,
}

#[tauri::command]
pub fn get_ai_config() -> Result<AiConfigView, String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let cfg = profile.load().map_err(|e| e.to_string())?;
    let has_api_key = profile.get_secret(&cfg, renegadebox_engine::config::SECRET_OPENROUTER).is_ok();
    Ok(AiConfigView {
        enabled: cfg.ai.enabled,
        model: cfg.ai.model,
        smb_target: cfg.ai.smb_target,
        rules: cfg.ai.rules,
        auto_route: cfg.ai.auto_route,
        has_api_key,
    })
}

#[tauri::command]
pub fn save_ai_config(payload: SaveAiConfigPayload) -> Result<(), String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let mut cfg = profile.load().map_err(|e| e.to_string())?;

    cfg.ai.enabled = payload.enabled;
    cfg.ai.model = if payload.model.trim().is_empty() {
        renegadebox_engine::ai::DEFAULT_AI_MODEL.to_string()
    } else {
        payload.model.trim().to_string()
    };
    cfg.ai.smb_target = payload.smb_target.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    cfg.ai.rules = payload.rules.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    cfg.ai.auto_route = payload.auto_route;

    if let Some(key) = payload.api_key {
        let trimmed = key.trim();
        if !trimmed.is_empty() {
            profile.set_secret(&cfg, renegadebox_engine::config::SECRET_OPENROUTER, trimmed).map_err(|e| e.to_string())?;
        }
    }

    profile.save(&cfg).map_err(|e| format!("Failed to save config: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn scan_nas_directories(target_path: String) -> Result<Vec<String>, String> {
    let p = std::path::PathBuf::from(target_path.trim());
    renegadebox_engine::ai::scan_nas_taxonomy(&p, 3).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_ai_routing(sample_file: String) -> Result<renegadebox_engine::ai::RouteDecision, String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let cfg = profile.load().map_err(|e| e.to_string())?;
    let api_key = profile.get_secret(&cfg, renegadebox_engine::config::SECRET_OPENROUTER)
        .map_err(|_| "OpenRouter API key is missing. Enter your key in Settings.".to_string())?;

    let smb_target = cfg.ai.smb_target.as_ref()
        .ok_or_else(|| "Synology/SMB target folder is not configured. Set the path in Settings.".to_string())?;

    let file_path = std::path::PathBuf::from(sample_file.trim());
    let smb_path = std::path::PathBuf::from(smb_target.trim());
    let rules = cfg.ai.rules.as_deref().unwrap_or("");

    renegadebox_engine::ai::route_file(&api_key, &cfg.ai.model, &file_path, &smb_path, rules).await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_conflict_copy_names() {
        assert_eq!(
            parse_conflict_name("dir/report (conflicted copy from Laptop 2026-10-15 a1b2c3d4).pdf"),
            Some(("report.pdf".to_string(), Some("Laptop".to_string())))
        );
        assert_eq!(
            parse_conflict_name("Makefile (conflicted copy 2 from My MBP.local 2026-10-15 ff00ff00)"),
            Some(("Makefile".to_string(), Some("My MBP.local".to_string())))
        );
        assert_eq!(
            parse_conflict_name("Notes (conflicted copy My-MBP 2026-10-15).txt"),
            Some(("Notes.txt".to_string(), None))
        );
        assert_eq!(parse_conflict_name("dir/plain.txt"), None);
    }

    #[test]
    fn keep_both_picks_a_free_name() {
        let dir = std::env::temp_dir().join(format!("rbox-free-name-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(free_name(&dir, "report.pdf", " (Laptop version)"), dir.join("report (Laptop version).pdf"));
        std::fs::write(dir.join("report (Laptop version).pdf"), b"x").unwrap();
        assert_eq!(free_name(&dir, "report.pdf", " (Laptop version)"), dir.join("report (Laptop version) 2.pdf"));
        assert_eq!(free_name(&dir, ".env", " (other version)"), dir.join(".env (other version)"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
