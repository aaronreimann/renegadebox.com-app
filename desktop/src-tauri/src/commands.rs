use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State as TauriState};

use renegadebox_engine::config::Profile;
use renegadebox_engine::engine::Engine;
use renegadebox_engine::state::State;

use crate::activity::{ActivityLog, SyncActivity};

/// Shared live-activity log (engine transfers + drop-folder moves), loaded on first use.
pub fn activity_log() -> &'static Mutex<ActivityLog> {
    static LOG: std::sync::OnceLock<Mutex<ActivityLog>> = std::sync::OnceLock::new();
    LOG.get_or_init(|| Mutex::new(ActivityLog::load(profile_file("activity.json").ok())))
}

/// What is syncing right now plus recent history, for the menu bar popover.
#[tauri::command]
pub fn get_sync_activity() -> Result<SyncActivity, String> {
    Ok(activity_log().lock().map_err(|e| e.to_string())?.snapshot())
}

/// Sent through the activity channel after each cycle, so clearing interrupted items
/// happens only after every event the engine queued during that cycle was applied.
fn cycle_end_marker() -> renegadebox_engine::activity::FileActivity {
    renegadebox_engine::activity::FileActivity {
        path: String::new(),
        kind: renegadebox_engine::activity::ActivityKind::Upload,
        phase: renegadebox_engine::activity::ActivityPhase::Skipped,
        size: None,
    }
}

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
    /// The config changed underneath the engine (sign-in, new storage): reopen it.
    Reload,
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
pub(crate) fn set_folder_icon(path: &std::path::Path) {
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

/// Runs smart routes on their own schedule, separate from vault sync. Each route has its own
/// auto switch (the main one follows auto_route). Pausing sync pauses automatic routing too;
/// "Run now" in the UI still works because it calls the routing commands directly.
async fn run_routing_loop(app: AppHandle, paused: Arc<AtomicBool>, wake: Arc<tokio::sync::Notify>) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(15));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            _ = interval.tick() => {}
            _ = wake.notified() => {}
        }
        if paused.load(Ordering::SeqCst) {
            continue;
        }
        let loaded = run_blocking(|| {
            let profile = Profile::locate().map_err(|e| e.to_string())?;
            if !profile.config_path().exists() {
                return Ok(None);
            }
            let cfg = profile.load().map_err(|e| e.to_string())?;
            Ok(Some((profile, cfg)))
        })
        .await;
        let Ok(Some((profile, cfg))) = loaded else { continue };
        if let Ok(transfers) = process_nas_ingest_internal(&cfg, &profile).await
            && !transfers.is_empty()
        {
            let _ = app.emit("nas-transfer-occurred", ());
            let _ = app.emit("vault-changed", ());
            let _ = app.emit("sync-activity", ());
        }
    }
}

pub async fn run_background_watcher(
    app: AppHandle,
    mut rx: tokio::sync::mpsc::UnboundedReceiver<SyncRequest>,
    handle: WatcherHandle,
) {
    let paused = handle.paused.clone();
    let runtime = handle.runtime.clone();
    let routing_wake = Arc::new(tokio::sync::Notify::new());
    tauri::async_runtime::spawn(run_routing_loop(app.clone(), paused.clone(), routing_wake.clone()));
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

        // Per-file progress for the popover. The task ends when this engine is dropped.
        let (act_tx, mut act_rx) = tokio::sync::mpsc::unbounded_channel();
        let cycle_tx = act_tx.clone();
        engine.set_on_activity(act_tx);
        let act_app = app.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(ev) = act_rx.recv().await {
                let changed = activity_log()
                    .lock()
                    .map(|mut l| {
                        if ev.path.is_empty() {
                            l.clear_active()
                        } else {
                            l.apply(&ev, crate::activity::now_ms())
                        }
                    })
                    .unwrap_or(false);
                if changed {
                    let _ = act_app.emit("sync-activity", ());
                }
            }
        });

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

        // Instant sync between this account's Macs. Without it, the 15-second poll still
        // finds remote changes. The task ends when this engine is replaced.
        let (hub_trigger_tx, mut hub_trigger_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
        let hub_task = start_hub_client(&profile, &mut engine, hub_trigger_tx);

        let mut poll_interval = tokio::time::interval(std::time::Duration::from_secs(15));
        loop {
            let mut manual = false;
            tokio::select! {
                _ = poll_interval.tick() => {}
                Some(()) = fs_rx.recv() => {
                    // Drain any queued events to coalesce bursts
                    while fs_rx.try_recv().is_ok() {}
                }
                Some(()) = hub_trigger_rx.recv() => {
                    while hub_trigger_rx.try_recv().is_ok() {}
                }
                Some(req) = rx.recv() => match req {
                    SyncRequest::Trigger => manual = true,
                    SyncRequest::Reload => break,
                },
            }

            // Smart routes run in their own task; poking it never blocks, so a slow or
            // stale NAS can not hold up vault sync.
            routing_wake.notify_one();

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
                    let _ = cycle_tx.send(cycle_end_marker());
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
                    let _ = cycle_tx.send(cycle_end_marker());
                    record_failure(&app, &runtime, format!("{e:#}"));
                }
            }

            // Drain any fs notifications provoked by our own downloads/writes
            while fs_rx.try_recv().is_ok() {}
        }
        if let Some(task) = hub_task {
            task.abort();
        }
        eprintln!("[Watcher] Configuration changed; restarting sync");
    }
}

/// Connect to the account's relay when this Mac is signed in, so other Macs' changes
/// arrive within moments instead of at the next poll.
fn start_hub_client(
    profile: &Profile,
    engine: &mut Engine,
    trigger: tokio::sync::mpsc::UnboundedSender<()>,
) -> Option<tauri::async_runtime::JoinHandle<()>> {
    let hub_url = engine.cfg.hub_url.clone()?;
    let token = profile.get_secret(&engine.cfg, renegadebox_engine::config::SECRET_DEVICE_TOKEN).ok()?;
    let (appended_tx, appended_rx) = tokio::sync::mpsc::unbounded_channel();
    engine.set_on_appended(appended_tx);
    let cfg = renegadebox_engine::hub::HubClientConfig {
        hub_url,
        device_token: token,
        device_id: engine.cfg.device_id.clone(),
        device_name: engine.cfg.device_name.clone(),
        client_version: format!("desktop {}", env!("CARGO_PKG_VERSION")),
    };
    Some(tauri::async_runtime::spawn(renegadebox_engine::hub::run_hub_client(cfg, trigger, appended_rx)))
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
pub fn open_main_window(app: AppHandle) {
    crate::windows::open_main_from_popover(&app);
}

#[tauri::command]
pub fn close_window(window: tauri::WebviewWindow) {
    let _ = window.close();
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Folders the UI may point at: the sync folder and every route's source and destination.
/// `/` and the home folder (or anything above it) never count, even if a route uses them.
fn allowed_roots(cfg: &renegadebox_engine::config::Config) -> Vec<std::path::PathBuf> {
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from);
    let mut roots = vec![cfg.folder.clone()];
    for r in crate::routing::all_routes(cfg) {
        roots.push(r.source_path());
        roots.extend(r.destination_root());
    }
    roots
        .into_iter()
        .filter(|p| p.is_absolute() && p.parent().is_some())
        .filter(|p| !home.as_ref().is_some_and(|h| renegadebox_engine::routes::path_within(h, p)))
        .filter_map(|p| p.canonicalize().ok())
        .collect()
}

/// Resolve a path sent by the webview (relative to the sync folder, or absolute) and refuse
/// it unless it really is inside the sync folder or a route folder. Canonicalizing first
/// resolves `..` and symlinks, so neither can be used to step outside.
pub(crate) fn resolve_allowed_path(cfg: &renegadebox_engine::config::Config, raw: &str) -> Result<std::path::PathBuf, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("No file given.".to_string());
    }
    let p = std::path::Path::new(raw);
    let joined = if p.is_absolute() { p.to_path_buf() } else { cfg.folder.join(p) };
    let target = joined
        .canonicalize()
        .map_err(|_| format!("File does not exist on disk: {}", joined.display()))?;
    if allowed_roots(cfg).iter().any(|root| renegadebox_engine::routes::path_within(&target, root)) {
        Ok(target)
    } else {
        Err("That file is outside your RenegadeBox folder and your route folders.".to_string())
    }
}

fn load_cfg_and_resolve(path: String) -> Result<std::path::PathBuf, String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let cfg = profile.load().map_err(|e| e.to_string())?;
    resolve_allowed_path(&cfg, &path)
}

/// Async: resolving a path on a NAS route folder can block on a stale mount.
#[tauri::command]
pub async fn open_file(path: String) -> Result<(), String> {
    let target = run_blocking(move || load_cfg_and_resolve(path)).await?;

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
pub async fn reveal_in_finder(path: String) -> Result<(), String> {
    let target = run_blocking(move || load_cfg_and_resolve(path)).await?;

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&target)
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

/// Add the sync folder to the Finder sidebar. macOS has no supported, non-deprecated API
/// for apps to edit sidebar favorites (LSSharedFileList is deprecated and `sfltool add-item`
/// was removed), so this reports that clearly instead of pretending it worked.
#[tauri::command]
pub fn add_to_finder_favorites() -> Result<(), String> {
    Err("macOS does not let apps add Finder sidebar favorites. In Finder, select your RenegadeBox folder and choose File > Add to Sidebar (Control-Command-T), or drag it into Favorites.".to_string())
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
pub fn open_finder_extensions() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.ExtensionsPreferences")
            .spawn()
            .map_err(|e| format!("Failed to open extensions preferences: {e}"))?;
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
    reset_keychain_failure();
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
        account: None,
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
    let _ = state.tx.send(SyncRequest::Reload);

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
    pub provider: String,
    pub model: String,
    pub smb_target: Option<String>,
    pub nas_ingest_folder: Option<String>,
    pub rules: Option<String>,
    pub auto_route: bool,
    /// "move" or "organize".
    pub routing_mode: String,
    /// Where routed files end up for the current mode.
    pub routing_root: Option<String>,
    pub has_api_key: bool,
    pub has_openrouter_key: bool,
    pub has_grok_key: bool,
    pub role_rules: std::collections::BTreeMap<String, Vec<String>>,
    pub enabled_roles: Vec<String>,
    pub vault_routing_enabled: bool,
    pub vault_max_file_mb: u64,
    /// Move unsortable files into `_Needs Review` (true) or leave them in place (false).
    pub use_review_folder: bool,
    pub vault_folder: String,
    pub rules_backup_count: usize,
    /// Set when the drop folder sits inside the vault under a name that is synced to S3.
    pub ingest_warning: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SaveAiConfigPayload {
    pub enabled: bool,
    pub provider: Option<String>,
    pub model: String,
    /// None = keep the saved value, "" = clear it.
    pub smb_target: Option<String>,
    /// None = keep the saved value, "" = clear it.
    pub nas_ingest_folder: Option<String>,
    /// None = keep the saved value.
    pub rules: Option<String>,
    pub auto_route: bool,
    pub api_key: Option<String>,
    pub openrouter_api_key: Option<String>,
    pub grok_api_key: Option<String>,
    #[serde(default)]
    pub vault_routing_enabled: Option<bool>,
    #[serde(default)]
    pub vault_max_file_mb: Option<u64>,
    /// None = keep the saved value. "move" or "organize".
    #[serde(default)]
    pub routing_mode: Option<String>,
    /// None = keep the saved value.
    #[serde(default)]
    pub use_review_folder: Option<bool>,
}

/// Where routed files go: the destination folder (move mode) or the drop folder itself (organize mode).
pub fn routing_root(cfg: &renegadebox_engine::config::Config) -> Result<std::path::PathBuf, String> {
    if cfg.ai.organize_in_place() {
        return Ok(ingest_dir_for(cfg));
    }
    cfg.ai.smb_target.as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(std::path::PathBuf::from)
        .ok_or_else(|| "Destination folder is not configured. Choose one in Smart Routing.".to_string())
}

// ---------------------------------------------------------------- AI keys (keychain)

/// Set when reading the keychain failed or was denied this session. Polling paths (the
/// settings view, background routing) then stop asking, so a denied prompt is not shown
/// again every few seconds. Cleared by an explicit user action such as saving a key.
fn keychain_failure() -> &'static Mutex<Option<String>> {
    static FAILED: std::sync::OnceLock<Mutex<Option<String>>> = std::sync::OnceLock::new();
    FAILED.get_or_init(|| Mutex::new(None))
}

fn set_keychain_failure(msg: Option<String>) {
    if let Ok(mut f) = keychain_failure().lock() {
        *f = msg;
    }
}

/// Forget a failed keychain read so the next access asks the OS again.
pub(crate) fn reset_keychain_failure() {
    set_keychain_failure(None);
}

/// The AI keys this device holds. `None` = not set.
#[derive(Default, Debug, Clone)]
pub(crate) struct AiKeys {
    pub openrouter: Option<String>,
    pub grok: Option<String>,
}

/// Credentials for one AI provider: (api key, provider, model).
pub(crate) type AiCredentials = (String, String, String);

fn secret_is_missing(e: &anyhow::Error) -> bool {
    // The engine reports an absent entry as "... missing from ..."; anything else is a read failure.
    e.to_string().contains("missing from")
}

/// Load both AI keys with one key store read. The engine keeps every secret of a device in
/// one keychain item and caches it after the first successful read, so the second lookup
/// never prompts. With `retry` false, a failure earlier this session is returned as is
/// instead of asking the keychain again.
pub(crate) fn load_ai_keys(profile: &Profile, cfg: &renegadebox_engine::config::Config, retry: bool) -> Result<AiKeys, String> {
    use renegadebox_engine::config::{KeyStoreKind, SECRET_GROK, SECRET_OPENROUTER};
    let keychain = cfg.key_store == KeyStoreKind::Keychain;
    if keychain && !retry
        && let Some(msg) = keychain_failure().lock().ok().and_then(|f| f.clone()) {
            return Err(msg);
        }
    let mut keys = AiKeys::default();
    for (name, slot) in [(SECRET_OPENROUTER, &mut keys.openrouter), (SECRET_GROK, &mut keys.grok)] {
        match profile.get_secret(cfg, name) {
            Ok(k) if !k.trim().is_empty() => *slot = Some(k),
            Ok(_) => {}
            Err(e) if secret_is_missing(&e) => {}
            Err(e) => {
                let msg = format!("Could not read your API keys from the key store: {e:#}");
                if keychain {
                    set_keychain_failure(Some(msg.clone()));
                }
                return Err(msg);
            }
        }
    }
    if keychain {
        reset_keychain_failure();
    }
    Ok(keys)
}

fn effective_provider(cfg: &renegadebox_engine::config::Config) -> String {
    if cfg.ai.provider.is_empty() {
        let model = renegadebox_engine::ai::normalize_model(&cfg.ai.model);
        if model.contains("grok") && !model.contains('/') { "xai" } else { "openrouter" }.to_string()
    } else {
        cfg.ai.provider.clone()
    }
}

/// Pick the key for the configured provider out of already loaded keys.
pub(crate) fn credentials_from_keys(cfg: &renegadebox_engine::config::Config, keys: &AiKeys) -> Result<AiCredentials, String> {
    let model = renegadebox_engine::ai::normalize_model(&cfg.ai.model);
    if effective_provider(cfg).eq_ignore_ascii_case("xai") {
        keys.grok
            .clone()
            .map(|k| (k, "xai".to_string(), model))
            .ok_or_else(|| "xAI (Grok) API key is missing. Enter your key in Smart Routing settings.".to_string())
    } else {
        keys.openrouter
            .clone()
            .map(|k| (k, "openrouter".to_string(), model))
            .ok_or_else(|| "OpenRouter API key is missing. Enter your key in Smart Routing settings.".to_string())
    }
}

/// Key, provider and model for an AI call. `retry` is true only for explicit user actions.
pub fn get_effective_ai_credentials(
    profile: &Profile,
    cfg: &renegadebox_engine::config::Config,
    retry: bool,
) -> Result<AiCredentials, String> {
    credentials_from_keys(cfg, &load_ai_keys(profile, cfg, retry)?)
}

/// AI calls send file names (and sometimes contents) to a provider, so they need the
/// global AI switch turned on first.
fn require_ai_enabled(cfg: &renegadebox_engine::config::Config) -> Result<(), String> {
    if cfg.ai.enabled {
        Ok(())
    } else {
        Err("AI routing is turned off. Turn it on in Smart Routing settings to use the AI.".to_string())
    }
}

#[tauri::command]
pub async fn get_ai_config() -> Result<AiConfigView, String> {
    run_blocking(|| {
        let profile = Profile::locate().map_err(|e| e.to_string())?;
        let cfg = profile.load().map_err(|e| e.to_string())?;
        Ok(ai_config_view(&profile, cfg))
    })
    .await
}

fn ai_config_view(profile: &Profile, cfg: renegadebox_engine::config::Config) -> AiConfigView {
    // Polling path: one key store read, and no retry after a denied prompt.
    let keys = load_ai_keys(profile, &cfg, false).unwrap_or_default();
    let has_openrouter = keys.openrouter.is_some();
    let has_grok = keys.grok.is_some();
    let provider = effective_provider(&cfg);
    let has_api_key = if provider == "xai" { has_grok } else { has_openrouter };
    let ingest_path = ingest_dir_for(&cfg);
    let routing_root_str = routing_root(&cfg).ok().map(|p| p.to_string_lossy().to_string());
    let nas_ingest_folder = Some(ingest_path.to_string_lossy().to_string());
    let ingest_warning = match ingest_path.strip_prefix(&cfg.folder) {
        Ok(rel) if !rel.components().any(|c| {
            let s = c.as_os_str().to_string_lossy();
            s == "To NAS" || s == ".nas_staging"
        }) => Some("This drop folder is inside your vault, so files dropped here are uploaded to S3 before they are routed. Use the default 'To NAS' folder or a folder outside the vault.".to_string()),
        _ => None,
    };

    AiConfigView {
        enabled: cfg.ai.enabled,
        provider,
        model: renegadebox_engine::ai::normalize_model(&cfg.ai.model),
        smb_target: cfg.ai.smb_target,
        nas_ingest_folder,
        rules: cfg.ai.rules,
        auto_route: cfg.ai.auto_route,
        routing_mode: cfg.ai.routing_mode.clone(),
        routing_root: routing_root_str,
        has_api_key,
        has_openrouter_key: has_openrouter,
        has_grok_key: has_grok,
        role_rules: cfg.ai.role_rules,
        enabled_roles: cfg.ai.enabled_roles,
        vault_routing_enabled: cfg.ai.vault_routing_enabled,
        vault_max_file_mb: cfg.ai.vault_max_file_mb,
        use_review_folder: cfg.ai.use_review_folder,
        vault_folder: cfg.folder.to_string_lossy().to_string(),
        rules_backup_count: rules_backup_count(),
        ingest_warning,
    }
}

/// Async so a keychain write (which may show a macOS prompt) never blocks the main thread.
#[tauri::command]
pub async fn save_ai_config(payload: SaveAiConfigPayload) -> Result<(), String> {
    run_blocking(move || save_ai_config_blocking(payload)).await
}

fn save_ai_config_blocking(payload: SaveAiConfigPayload) -> Result<(), String> {
    // AI keys live in the key store, which config.toml's timestamp does not reflect.
    let result = save_ai_config_inner(payload);
    crate::account::wake().notify_one();
    result
}

fn save_ai_config_inner(payload: SaveAiConfigPayload) -> Result<(), String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let mut cfg = profile.load().map_err(|e| e.to_string())?;

    cfg.ai.enabled = payload.enabled;
    let provider = payload.provider.unwrap_or_else(|| {
        if payload.model.contains("grok") && !payload.model.contains('/') {
            "xai".to_string()
        } else {
            "openrouter".to_string()
        }
    });
    cfg.ai.provider = provider.clone();
    cfg.ai.model = renegadebox_engine::ai::model_for_provider(&provider, &payload.model);
    if let Some(s) = payload.smb_target {
        cfg.ai.smb_target = Some(s.trim().to_string()).filter(|s| !s.is_empty());
    }
    if let Some(s) = payload.nas_ingest_folder {
        cfg.ai.nas_ingest_folder = Some(s.trim().to_string()).filter(|s| !s.is_empty());
    }
    if let Some(s) = payload.rules {
        cfg.ai.rules = Some(s.trim().to_string()).filter(|s| !s.is_empty());
    }
    cfg.ai.auto_route = payload.auto_route;
    if let Some(v) = payload.vault_routing_enabled {
        cfg.ai.vault_routing_enabled = v;
    }
    if let Some(mb) = payload.vault_max_file_mb {
        cfg.ai.vault_max_file_mb = mb.clamp(1, 100_000);
    }
    if let Some(v) = payload.use_review_folder {
        cfg.ai.use_review_folder = v;
    }
    if let Some(mode) = payload.routing_mode {
        cfg.ai.routing_mode = if mode == renegadebox_engine::ai::ROUTING_MODE_ORGANIZE {
            renegadebox_engine::ai::ROUTING_MODE_ORGANIZE.to_string()
        } else {
            renegadebox_engine::ai::ROUTING_MODE_MOVE.to_string()
        };
    }

    // Ensure staging directory exists
    let ingest_path = ingest_dir_for(&cfg);
    let _ = std::fs::create_dir_all(&ingest_path);

    // Saving a key is an explicit action: allow the keychain to be asked again.
    let any_key = [&payload.grok_api_key, &payload.openrouter_api_key, &payload.api_key]
        .iter()
        .any(|k| k.as_deref().is_some_and(|k| !k.trim().is_empty()));
    if any_key {
        reset_keychain_failure();
    }

    if let Some(key) = payload.grok_api_key {
        let trimmed = key.trim();
        if !trimmed.is_empty() {
            profile.set_secret(&cfg, renegadebox_engine::config::SECRET_GROK, trimmed).map_err(|e| e.to_string())?;
        }
    }

    if let Some(key) = payload.openrouter_api_key {
        let trimmed = key.trim();
        if !trimmed.is_empty() {
            profile.set_secret(&cfg, renegadebox_engine::config::SECRET_OPENROUTER, trimmed).map_err(|e| e.to_string())?;
        }
    }

    if let Some(key) = payload.api_key {
        let trimmed = key.trim();
        if !trimmed.is_empty() {
            if provider == "xai" {
                profile.set_secret(&cfg, renegadebox_engine::config::SECRET_GROK, trimmed).map_err(|e| e.to_string())?;
            } else {
                profile.set_secret(&cfg, renegadebox_engine::config::SECRET_OPENROUTER, trimmed).map_err(|e| e.to_string())?;
            }
        }
    }

    profile.save(&cfg).map_err(|e| format!("Failed to save config: {e}"))?;
    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MountedVolume {
    pub name: String,
    pub path: String,
}

#[tauri::command]
pub fn list_detected_volumes() -> Result<Vec<MountedVolume>, String> {
    let mut volumes = Vec::new();
    let volumes_dir = std::path::Path::new("/Volumes");
    if let Ok(entries) = std::fs::read_dir(volumes_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name == "Recovery" || name == "Macintosh HD" {
                continue;
            }
            volumes.push(MountedVolume {
                name,
                path: path.to_string_lossy().to_string(),
            });
        }
    }
    Ok(volumes)
}

#[tauri::command]
pub async fn choose_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let res = tokio::task::spawn_blocking(move || {
            let script = r#"
                try
                    set chosen to choose folder with prompt "Select a destination folder (NAS share, external drive, or any local folder):" default location (POSIX file "/Volumes")
                    return POSIX path of chosen
                on error errText number errNum
                    if errNum is equal to -128 then
                        return ""
                    else
                        try
                            set chosen to choose folder with prompt "Select a destination folder (NAS share, external drive, or any local folder):"
                            return POSIX path of chosen
                        on error
                            return ""
                        end try
                    end if
                end try
            "#;

            let output = std::process::Command::new("osascript")
                .args(["-e", script])
                .output();

            match output {
                Ok(out) if out.status.success() => {
                    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    if path.is_empty() {
                        None
                    } else {
                        Some(path.trim_end_matches('/').to_string())
                    }
                }
                _ => None,
            }
        }).await.map_err(|e| e.to_string())?;

        // Re-focus and raise main window so RenegadeBox NEVER disappears
        crate::windows::show_main_window(&app);

        Ok(res)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(None)
    }
}

#[tauri::command]
pub async fn pick_sync_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    choose_folder(app).await
}

#[tauri::command]
pub async fn scan_nas_directories(target_path: String) -> Result<Vec<String>, String> {
    scan_taxonomy_blocking(std::path::PathBuf::from(target_path.trim())).await
}

#[tauri::command]
pub async fn test_ai_routing(sample_file: String) -> Result<renegadebox_engine::ai::RouteDecision, String> {
    use renegadebox_engine::ai;
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let cfg = profile.load().map_err(|e| e.to_string())?;
    let raw = sample_file.trim().to_string();
    // A bare file name is only used as a name. A path must point inside the sync folder or
    // a configured route folder, so the test can not be used to send arbitrary files out.
    let file_path = if raw.contains('/') || raw.contains('\\') {
        let check_cfg = cfg.clone();
        let raw_path = raw.clone();
        Some(run_blocking(move || resolve_allowed_path(&check_cfg, &raw_path)).await?)
    } else {
        None
    };
    let filename = file_path
        .as_deref()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| raw.clone());

    // Rules first: a matching local rule costs nothing and makes no network call.
    let rules = rules_list(&cfg);
    if let Some((_, dest, rule)) = ai::match_rule_with_index(&filename, &rules) {
        return Ok(ai::RouteDecision {
            destination_folder: dest,
            suggested_filename: filename,
            confidence: 1.0,
            explanation: format!("Matched local rule, no AI call made: {rule}"),
            suggested_rule: None,
        });
    }

    require_ai_enabled(&cfg)?;
    // Pressing "Test" is an explicit action, so a failed keychain read may be retried.
    let (api_key, provider, model) = get_effective_ai_credentials(&profile, &cfg, true)?;
    let smb_path = routing_root(&cfg)?;
    let rules_text = cfg.ai.rules.as_deref().unwrap_or("");

    // The test drop zone usually only knows the file name, not a readable path.
    let meta = if let Some(fp) = file_path.as_ref().filter(|p| p.is_file()) {
        ai::extract_metadata(fp, 2048).map_err(|e| e.to_string())?
    } else {
        ai::FileMetadata {
            filename: filename.clone(),
            extension: std::path::Path::new(&filename).extension().map(|e| e.to_string_lossy().to_string()),
            size_bytes: 0,
            text_snippet: None,
        }
    };
    let (decision, usage) = ai::route_metadata_with_provider(&provider, &api_key, &model, &meta, &smb_path, rules_text)
        .await
        .map_err(|e| e.to_string())?;
    let label = if provider == "xai" { "Test Routing (Grok)" } else { "Test Routing" };
    record_ai_usage("file_routing", label, &model, &usage, &format!("Test: {} -> {}", filename, decision.destination_folder));
    Ok(decision)
}

/// Scan a folder tree for its subfolders. Walking a NAS can take a long time, so it runs
/// on the blocking pool instead of a tokio worker.
async fn scan_taxonomy_blocking(path: std::path::PathBuf) -> Result<Vec<String>, String> {
    run_blocking(move || renegadebox_engine::ai::scan_nas_taxonomy(&path, 3).map_err(|e| e.to_string())).await
}

/// At most this many rules come out of one folder scan.
const MAX_SCAN_RULES: usize = 8;

/// Folder-name keywords per category, and the rule text written for it.
const TAXONOMY_CATEGORIES: &[(&[&str], &str)] = &[
    (&["backup", "hosting", "spinup", "pressable"], "Website archives and database backups (*.sql.gz, *.tar.gz)"),
    (&["invoice", "finance", "tax", "receipt"], "Invoices, receipts, and financial statements"),
    (&["contract", "client", "agreement"], "Client contracts, SOWs, and agreements"),
    (&["photo", "image", "picture"], "Photos and camera media"),
    (&["video", "footage", "clip", "movie"], "Video footage and screen recordings"),
    (&["doc", "project"], "Project documents and briefs"),
];

/// Lowercased "what" part of a rule, used to spot rules that cover the same files.
fn rule_trigger_key(rule: &str) -> String {
    renegadebox_engine::ai::parse_rule(rule)
        .map(|(t, _)| t)
        .unwrap_or_else(|| rule.to_string())
        .trim()
        .to_lowercase()
}

/// Every rule the user already has: the active list plus all role lists.
fn existing_rules(cfg: &renegadebox_engine::config::Config) -> Vec<String> {
    let mut all = rules_list(cfg);
    all.extend(cfg.ai.role_rules.values().flatten().cloned());
    all
}

/// Keep suggestions that do not repeat an existing rule (same text or same trigger), drop
/// duplicates among themselves, and cap the total.
fn dedupe_suggestions(suggested: Vec<String>, existing: &[String], cap: usize) -> Vec<String> {
    let mut seen: std::collections::HashSet<String> = existing.iter().map(|r| rule_trigger_key(r)).collect();
    let mut seen_text: std::collections::HashSet<String> = existing.iter().map(|r| r.trim().to_lowercase()).collect();
    suggested
        .into_iter()
        .map(|r| r.trim().to_string())
        .filter(|r| !r.is_empty())
        .filter(|r| seen_text.insert(r.to_lowercase()) && seen.insert(rule_trigger_key(r)))
        .take(cap)
        .collect()
}

/// Local rules from folder names: one rule per category, pointing at the best matching
/// folder (shallowest, then an exact name match, then the shortest path).
fn taxonomy_rules(directories: &[String], existing: &[String], cap: usize) -> Vec<String> {
    let mut out = Vec::new();
    for (keywords, what) in TAXONOMY_CATEGORIES {
        let best = directories
            .iter()
            .filter_map(|dir| {
                // Match on the folder's own name only, so "Photos/2019/Trip" does not count as a photo folder of its own.
                let name = dir.rsplit('/').next().unwrap_or(dir).to_lowercase();
                let kw = keywords.iter().find(|k| name.contains(*k))?;
                let depth = dir.split('/').count();
                let exact = name == *kw || name == format!("{kw}s");
                Some(((depth, !exact, dir.len()), dir))
            })
            .min_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(b.1)))
            .map(|(_, dir)| dir);
        if let Some(dir) = best {
            out.push(format!("{what} go to {dir}"));
        }
    }
    let mut rules = dedupe_suggestions(out, existing, cap);
    if rules.is_empty() && existing.is_empty() {
        let first_dir = directories.first().map(|s| s.as_str()).unwrap_or("Backups");
        rules.push(format!("Archives and backups go to {first_dir}"));
    }
    rules
}

#[tauri::command]
pub async fn suggest_rules_from_nas(target_path: String) -> Result<Vec<String>, String> {
    let directories = scan_taxonomy_blocking(std::path::PathBuf::from(target_path.trim())).await?;

    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let cfg = profile.load().map_err(|e| e.to_string())?;
    let existing = existing_rules(&cfg);

    // Folder names only go to the AI when the user turned AI routing on.
    if cfg.ai.enabled
        && let Ok((api_key, provider, model)) = get_effective_ai_credentials(&profile, &cfg, true)
        && let Ok((rules, usage)) =
            renegadebox_engine::ai::suggest_rules_from_taxonomy_with_provider(&provider, &api_key, &model, &directories).await
    {
        // The call was billed even if it returned nothing useful, so record it either way.
        let label = if provider == "xai" { "Folder Scan (Grok)" } else { "Folder Scan" };
        record_ai_usage("suggest_rules", label, &model, &usage, &format!("Scanned folders on {}", target_path));
        let rules = dedupe_suggestions(rules, &existing, MAX_SCAN_RULES);
        if !rules.is_empty() {
            return Ok(rules);
        }
    }

    // Local fallback: derive a few rules from discovered folder names. No AI call, nothing billed.
    Ok(taxonomy_rules(&directories, &existing, MAX_SCAN_RULES))
}

#[tauri::command]
pub async fn translate_rules(explanation: String, target_path: Option<String>) -> Result<Vec<String>, String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let cfg = profile.load().map_err(|e| e.to_string())?;

    let scan_root = target_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or_else(|| cfg.ai.smb_target.as_deref().map(str::trim).filter(|s| !s.is_empty()))
        .map(std::path::PathBuf::from);
    let dirs = match scan_root {
        Some(p) => scan_taxonomy_blocking(p).await.unwrap_or_default(),
        None => Vec::new(),
    };

    // The explanation and folder names only go to the AI when the user turned AI routing on.
    if cfg.ai.enabled
        && let Ok((key, provider, model)) = get_effective_ai_credentials(&profile, &cfg, true)
        && let Ok((rules, usage)) =
            renegadebox_engine::ai::translate_explanation_to_rules_with_provider(&provider, &key, &model, &explanation, &dirs).await
    {
        let label = if provider == "xai" { "Rule Writing (Grok)" } else { "Rule Writing" };
        record_ai_usage("rule_translation", label, &model, &usage, &format!("Rules from: {}", explanation.trim()));
        if !rules.is_empty() {
            return Ok(rules);
        }
    }

    // Local deterministic parser fallback when no API key is entered. No AI call, nothing billed.
    let mut rules = Vec::new();
    let lower_exp = explanation.to_lowercase();
    if lower_exp.contains("spinup") {
        rules.push("SpinupWP backups (*.sql.gz, *.tar.gz) go to Backups/SpinupWP".to_string());
    }
    if lower_exp.contains("pressable") {
        rules.push("Pressable backups and site exports go to Backups/Pressable".to_string());
    }
    if lower_exp.contains("wp engine") || lower_exp.contains("wpengine") {
        rules.push("WP Engine archive exports go to Backups/WPEngine".to_string());
    }
    if lower_exp.contains("cpanel") {
        rules.push("cPanel full backups go to Backups/cPanel".to_string());
    }
    if lower_exp.contains("invoice") || lower_exp.contains("receipt") {
        rules.push("Invoices and receipts go to Finance/Invoices".to_string());
    }
    if lower_exp.contains("contract") || lower_exp.contains("agreement") {
        rules.push("Client contracts and agreements go to Work/Contracts".to_string());
    }
    if rules.is_empty() {
        if lower_exp.contains("go to") {
            rules.push(explanation.trim().to_string());
        } else {
            let dest = dirs.first().cloned().unwrap_or_else(|| "Backups".to_string());
            rules.push(format!("{} go to {}", explanation.trim(), dest));
        }
    }
    Ok(rules)
}

// ---------------------------------------------------------------- AI usage ledger

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AiUsageEntry {
    pub id: String,
    pub timestamp: u64,
    pub operation: String,
    #[serde(rename = "operationLabel")]
    pub operation_label: String,
    pub model: String,
    #[serde(rename = "promptTokens")]
    pub prompt_tokens: u32,
    #[serde(rename = "completionTokens")]
    pub completion_tokens: u32,
    #[serde(rename = "totalTokens")]
    pub total_tokens: u32,
    #[serde(rename = "estimatedCostUsd")]
    pub estimated_cost_usd: f64,
    pub summary: String,
    /// "provider" = cost reported by the API itself.
    /// "estimate" = real token counts priced with our local table.
    /// "unknown"  = real token counts, model not in the price table.
    /// "legacy"   = written by older builds with placeholder numbers; excluded from totals.
    #[serde(rename = "costSource", default = "legacy_cost_source")]
    pub cost_source: String,
}

fn legacy_cost_source() -> String {
    "legacy".to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ApiUsageBreakdown {
    pub operation: String,
    pub label: String,
    pub requests: u32,
    #[serde(rename = "totalTokens")]
    pub total_tokens: u32,
    #[serde(rename = "estimatedCostUsd")]
    pub estimated_cost_usd: f64,
    #[serde(rename = "percentageOfTotal")]
    pub percentage_of_total: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModelUsageBreakdown {
    pub model: String,
    pub requests: u32,
    #[serde(rename = "totalTokens")]
    pub total_tokens: u32,
    #[serde(rename = "estimatedCostUsd")]
    pub estimated_cost_usd: f64,
    #[serde(rename = "percentageOfTotal")]
    pub percentage_of_total: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AiUsageSummary {
    #[serde(rename = "totalRequests")]
    pub total_requests: u32,
    #[serde(rename = "totalPromptTokens")]
    pub total_prompt_tokens: u32,
    #[serde(rename = "totalCompletionTokens")]
    pub total_completion_tokens: u32,
    #[serde(rename = "totalTokens")]
    pub total_tokens: u32,
    #[serde(rename = "totalCostUsd")]
    pub total_cost_usd: f64,
    #[serde(rename = "byOperation")]
    pub by_operation: Vec<ApiUsageBreakdown>,
    #[serde(rename = "byModel")]
    pub by_model: Vec<ModelUsageBreakdown>,
    #[serde(rename = "recentEntries")]
    pub recent_entries: Vec<AiUsageEntry>,
    #[serde(rename = "providerReportedRequests")]
    pub provider_reported_requests: u32,
    #[serde(rename = "estimatedRequests")]
    pub estimated_requests: u32,
    #[serde(rename = "legacyExcluded")]
    pub legacy_excluded: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct StoredAiUsageData {
    pub entries: Vec<AiUsageEntry>,
}

/// USD per 1M tokens (input, output). Checked against OpenRouter's /models API and
/// xAI's published model list on 2026-10-16. Only used when the provider does not report cost.
pub fn estimate_ai_cost(model: &str, prompt: u32, comp: u32) -> Option<f64> {
    let m = model.to_lowercase();
    let (prompt_rate, comp_rate) = if m.contains("gemini-2.5-flash-lite") || m.contains("gemini-2.0-flash") {
        (0.10, 0.40)
    } else if m.contains("gemini-3.1-flash-lite") {
        (0.25, 1.50)
    } else if m.contains("gemini-2.5-flash") {
        (0.30, 2.50)
    } else if m.contains("gpt-5-nano") {
        (0.05, 0.40)
    } else if m.contains("gpt-5-mini") {
        (0.25, 2.00)
    } else if m.contains("gpt-4o-mini") {
        (0.15, 0.60)
    } else if m.contains("haiku-4.5") || m.contains("haiku-4-5") {
        (1.00, 5.00)
    } else if m.contains("grok-4.20") || m.contains("grok-4.3") {
        (1.25, 2.50)
    } else if m.contains("grok-build") || m.contains("grok-code-fast") {
        (1.00, 2.00)
    } else if m.contains("grok-4.5") || m.contains("grok-4.6") || m.contains("grok-4.7") {
        (2.00, 6.00)
    } else {
        return None;
    };
    Some((prompt as f64 * prompt_rate + comp as f64 * comp_rate) / 1_000_000.0)
}

fn ai_usage_path() -> Result<std::path::PathBuf, String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    Ok(profile.dir.join("ai_usage.json"))
}

/// Record one real AI call. Token counts come from the provider's response.
pub fn record_ai_usage(
    operation: &str,
    operation_label: &str,
    model: &str,
    usage: &renegadebox_engine::ai::AiUsage,
    summary: &str,
) {
    let Ok(path) = ai_usage_path() else { return; };
    let mut data: StoredAiUsageData = read_json_or_default(&path);

    let prompt_tokens = usage.prompt_tokens.min(u32::MAX as u64) as u32;
    let completion_tokens = usage.completion_tokens.min(u32::MAX as u64) as u32;
    let (cost, cost_source) = match usage.cost_usd {
        Some(c) => (c, "provider"),
        None => match estimate_ai_cost(model, prompt_tokens, completion_tokens) {
            Some(c) => (c, "estimate"),
            None => (0.0, "unknown"),
        },
    };
    let now = unix_ms();

    let entry = AiUsageEntry {
        id: format!("req-{}-{}", now, data.entries.len() + 1),
        timestamp: now,
        operation: operation.to_string(),
        operation_label: operation_label.to_string(),
        model: model.to_string(),
        prompt_tokens,
        completion_tokens,
        total_tokens: prompt_tokens.saturating_add(completion_tokens),
        estimated_cost_usd: cost,
        summary: summary.to_string(),
        cost_source: cost_source.to_string(),
    };

    data.entries.insert(0, entry);
    if data.entries.len() > 2000 {
        data.entries.truncate(2000);
    }
    write_json(&path, &data);
}

#[tauri::command]
pub fn get_ai_usage() -> Result<AiUsageSummary, String> {
    let path = ai_usage_path()?;
    let data: StoredAiUsageData = read_json_or_default(&path);

    let legacy_excluded = data.entries.iter().filter(|e| e.cost_source == "legacy").count() as u32;
    let entries: Vec<&AiUsageEntry> = data.entries.iter().filter(|e| e.cost_source != "legacy").collect();

    let mut total_requests = 0u32;
    let mut total_prompt_tokens = 0u32;
    let mut total_completion_tokens = 0u32;
    let mut total_tokens = 0u32;
    let mut total_cost_usd = 0.0f64;
    let mut provider_reported_requests = 0u32;
    let mut estimated_requests = 0u32;

    let mut op_map: std::collections::BTreeMap<String, (String, u32, u32, f64)> = std::collections::BTreeMap::new();
    let mut model_map: std::collections::BTreeMap<String, (u32, u32, f64)> = std::collections::BTreeMap::new();

    for entry in &entries {
        total_requests += 1;
        total_prompt_tokens = total_prompt_tokens.saturating_add(entry.prompt_tokens);
        total_completion_tokens = total_completion_tokens.saturating_add(entry.completion_tokens);
        total_tokens = total_tokens.saturating_add(entry.total_tokens);
        total_cost_usd += entry.estimated_cost_usd;
        if entry.cost_source == "provider" {
            provider_reported_requests += 1;
        } else {
            estimated_requests += 1;
        }

        let op_stat = op_map.entry(entry.operation.clone()).or_insert_with(|| (entry.operation_label.clone(), 0, 0, 0.0));
        op_stat.1 += 1;
        op_stat.2 = op_stat.2.saturating_add(entry.total_tokens);
        op_stat.3 += entry.estimated_cost_usd;

        let model_stat = model_map.entry(entry.model.clone()).or_insert_with(|| (0, 0, 0.0));
        model_stat.0 += 1;
        model_stat.1 = model_stat.1.saturating_add(entry.total_tokens);
        model_stat.2 += entry.estimated_cost_usd;
    }

    let mut by_operation = Vec::new();
    for (op, (label, reqs, toks, cost)) in op_map {
        let pct = if total_tokens > 0 { (toks as f64 / total_tokens as f64) * 100.0 } else { 0.0 };
        by_operation.push(ApiUsageBreakdown {
            operation: op,
            label,
            requests: reqs,
            total_tokens: toks,
            estimated_cost_usd: cost,
            percentage_of_total: pct,
        });
    }
    by_operation.sort_by_key(|b| std::cmp::Reverse(b.total_tokens));

    let mut by_model = Vec::new();
    for (mdl, (reqs, toks, cost)) in model_map {
        let pct = if total_tokens > 0 { (toks as f64 / total_tokens as f64) * 100.0 } else { 0.0 };
        by_model.push(ModelUsageBreakdown {
            model: mdl,
            requests: reqs,
            total_tokens: toks,
            estimated_cost_usd: cost,
            percentage_of_total: pct,
        });
    }
    by_model.sort_by_key(|b| std::cmp::Reverse(b.total_tokens));

    Ok(AiUsageSummary {
        total_requests,
        total_prompt_tokens,
        total_completion_tokens,
        total_tokens,
        total_cost_usd,
        by_operation,
        by_model,
        recent_entries: entries.iter().take(50).map(|e| (*e).clone()).collect(),
        provider_reported_requests,
        estimated_requests,
        legacy_excluded,
    })
}

#[tauri::command]
pub fn clear_ai_usage() -> Result<AiUsageSummary, String> {
    let path = ai_usage_path()?;
    let data = StoredAiUsageData::default();
    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    // The UI shows the returned summary straight away.
    get_ai_usage()
}

// ---------------------------------------------------------------- shared helpers

pub(crate) fn unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub(crate) fn read_json_or_default<T: serde::de::DeserializeOwned + Default>(path: &std::path::Path) -> T {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Write through a temp file and rename, so a reader never sees a half-written file
/// (which would parse as empty and could then be saved back as empty).
pub(crate) fn write_json<T: Serialize>(path: &std::path::Path, value: &T) {
    if let Ok(json) = serde_json::to_string_pretty(value) {
        let tmp = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4().simple()));
        if std::fs::write(&tmp, json).is_ok() && std::fs::rename(&tmp, path).is_err() {
            let _ = std::fs::remove_file(&tmp);
        }
    }
}

/// One lock for the JSON stores that are read, changed and written back from several
/// places at once: nas_transfers.json, review_queue.json and route_seen.json. Hold it only
/// around load-patch-save, never across a slow file move, and re-load under it.
pub(crate) fn json_store_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::OnceLock<Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(())).lock().unwrap_or_else(|e| e.into_inner())
}

pub(crate) fn profile_file(name: &str) -> Result<std::path::PathBuf, String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    Ok(profile.dir.join(name))
}

fn rules_list(cfg: &renegadebox_engine::config::Config) -> Vec<String> {
    cfg.ai.rules.as_deref()
        .unwrap_or("")
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

fn ingest_dir_for(cfg: &renegadebox_engine::config::Config) -> std::path::PathBuf {
    cfg.ai.nas_ingest_folder.as_ref()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| cfg.folder.join("To NAS"))
}

/// Folder inside the drop folder where uncertain files wait for a human decision.
pub const REVIEW_DIR_NAME: &str = "_Needs Review";

pub(crate) fn is_partial_download(name: &str) -> bool {
    name.starts_with('.') || name.ends_with(".tmp") || name.ends_with(".part") || name.ends_with(".crdownload") || name.ends_with(".rbox-partial")
}

// ---------------------------------------------------------------- rules storage (single source of truth)

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct RulesSnapshot {
    timestamp: u64,
    label: String,
    #[serde(default)]
    role_rules: std::collections::BTreeMap<String, Vec<String>>,
    #[serde(default)]
    enabled_roles: Vec<String>,
    #[serde(default)]
    rules: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct RulesBackupFile {
    snapshots: Vec<RulesSnapshot>,
}

const MAX_RULE_SNAPSHOTS: usize = 20;

fn rules_backup_count() -> usize {
    profile_file("rules_backup.json")
        .map(|p| read_json_or_default::<RulesBackupFile>(&p).snapshots.len())
        .unwrap_or(0)
}

fn push_rules_snapshot(cfg: &renegadebox_engine::config::Config, label: &str) -> Result<(), String> {
    let path = profile_file("rules_backup.json")?;
    let mut file: RulesBackupFile = read_json_or_default(&path);
    file.snapshots.push(RulesSnapshot {
        timestamp: unix_ms(),
        label: label.to_string(),
        role_rules: cfg.ai.role_rules.clone(),
        enabled_roles: cfg.ai.enabled_roles.clone(),
        rules: cfg.ai.rules.clone(),
    });
    if file.snapshots.len() > MAX_RULE_SNAPSHOTS {
        let excess = file.snapshots.len() - MAX_RULE_SNAPSHOTS;
        // Always keep the very first snapshot: it holds the pre-cleanup rule set.
        file.snapshots.drain(1..1 + excess);
    }
    let json = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("Could not write rules backup: {e}"))
}

/// Ordered, de-duplicated rules of the enabled roles.
pub fn aggregate_rules(role_rules: &std::collections::BTreeMap<String, Vec<String>>, enabled_roles: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for role in enabled_roles {
        if let Some(list) = role_rules.get(role) {
            for r in list {
                let t = r.trim();
                if !t.is_empty() && seen.insert(t.to_lowercase()) {
                    out.push(t.to_string());
                }
            }
        }
    }
    out
}

/// Persist rules per role in config.toml and rebuild the active rule list.
/// The previous state is snapshotted first so any change can be undone.
#[tauri::command]
pub fn save_routing_rules(
    role_rules: std::collections::BTreeMap<String, Vec<String>>,
    enabled_roles: Vec<String>,
) -> Result<String, String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let mut cfg = profile.load().map_err(|e| e.to_string())?;

    let mut clean = std::collections::BTreeMap::new();
    for (role, list) in role_rules {
        let mut seen = std::collections::HashSet::new();
        let v: Vec<String> = list
            .into_iter()
            .map(|r| r.trim().to_string())
            .filter(|r| !r.is_empty() && seen.insert(r.to_lowercase()))
            .collect();
        clean.insert(role, v);
    }
    let aggregate = aggregate_rules(&clean, &enabled_roles);
    let new_rules = if aggregate.is_empty() { None } else { Some(aggregate.join("\n")) };

    if cfg.ai.role_rules == clean && cfg.ai.enabled_roles == enabled_roles && cfg.ai.rules == new_rules {
        return Ok(new_rules.unwrap_or_default());
    }

    push_rules_snapshot(&cfg, "before rules change")?;
    cfg.ai.role_rules = clean;
    cfg.ai.enabled_roles = enabled_roles;
    cfg.ai.rules = new_rules.clone();
    profile.save(&cfg).map_err(|e| format!("Failed to save rules: {e}"))?;
    Ok(new_rules.unwrap_or_default())
}

/// Restore the most recent rules snapshot.
#[tauri::command]
pub async fn undo_rules_change() -> Result<AiConfigView, String> {
    run_blocking(undo_rules_change_blocking).await
}

fn undo_rules_change_blocking() -> Result<AiConfigView, String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let mut cfg = profile.load().map_err(|e| e.to_string())?;
    let path = profile_file("rules_backup.json")?;
    let mut file: RulesBackupFile = read_json_or_default(&path);
    let snap = file.snapshots.pop().ok_or_else(|| "Nothing to undo".to_string())?;

    if snap.role_rules.is_empty() {
        // Snapshot from before rules were stored per role: put them back under one role
        // so they are visible and editable in the UI.
        let role = snap.enabled_roles.first().cloned().unwrap_or_else(|| "webdev".to_string());
        let lines: Vec<String> = snap.rules.as_deref().unwrap_or("").lines()
            .map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
        let mut map = std::collections::BTreeMap::new();
        map.insert(role.clone(), lines);
        cfg.ai.role_rules = map;
        cfg.ai.enabled_roles = vec![role];
    } else {
        cfg.ai.role_rules = snap.role_rules;
        cfg.ai.enabled_roles = snap.enabled_roles;
    }
    cfg.ai.rules = snap.rules;
    profile.save(&cfg).map_err(|e| format!("Failed to restore rules: {e}"))?;
    let json = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(ai_config_view(&profile, cfg))
}

// ---------------------------------------------------------------- rule check (local, no AI)

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct RuleCheck {
    pub rule: String,
    pub parses: bool,
    pub trigger: String,
    pub destination: String,
    pub is_vault: bool,
    pub vault_enabled: bool,
    pub destination_safe: bool,
    /// None when the destination root is not configured or not mounted.
    pub destination_exists: Option<bool>,
    pub sample_file: String,
    pub sample_matches: bool,
    pub shadowed_by: Option<String>,
    pub problems: Vec<String>,
}

fn sample_filename_for_trigger(trigger: &str) -> String {
    let lower = trigger.to_lowercase();
    for part in lower.split(|c: char| c.is_whitespace() || c == ',' || c == ';' || c == '(' || c == ')') {
        if let Some(ext) = part.strip_prefix('*')
            && ext.starts_with('.') && ext.len() > 1 {
                return format!("example{ext}");
            }
    }
    let word = lower
        .split(|c: char| !c.is_alphanumeric())
        .find(|w| w.len() >= 4 && !["files", "file", "backups", "backup", "documents", "and", "the"].contains(w))
        .unwrap_or("example");
    format!("{word}_2026.pdf")
}

/// Check a rule locally: does it parse, is the destination safe and present, does it match
/// a sample filename, and is it shadowed by an earlier rule. No network call is made.
/// Async: checking whether the destination exists touches the NAS, which can hang on a
/// stale SMB mount and would freeze the window if run on the main thread.
#[tauri::command]
pub async fn check_rule(rule: String, sample_file: Option<String>) -> Result<RuleCheck, String> {
    run_blocking(move || check_rule_blocking(rule, sample_file)).await
}

fn check_rule_blocking(rule: String, sample_file: Option<String>) -> Result<RuleCheck, String> {
    use renegadebox_engine::ai;
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let cfg = profile.load().map_err(|e| e.to_string())?;
    let mut problems = Vec::new();

    let Some((trigger, destination)) = ai::parse_rule(&rule) else {
        return Ok(RuleCheck {
            rule,
            parses: false,
            trigger: String::new(),
            destination: String::new(),
            is_vault: false,
            vault_enabled: cfg.ai.vault_routing_enabled,
            destination_safe: false,
            destination_exists: None,
            sample_file: String::new(),
            sample_matches: false,
            shadowed_by: None,
            problems: vec!["Rule must look like '<what> go to <folder>'.".to_string()],
        });
    };

    let vault_sub = ai::parse_vault_destination(&destination).map(|s| s.to_string());
    let is_vault = vault_sub.is_some();
    let rel = vault_sub.clone().unwrap_or_else(|| destination.clone());
    let safe = ai::sanitize_relative_folder(&rel);
    if safe.is_none() {
        problems.push("Destination is not a safe relative folder (empty or uses '..').".to_string());
    }
    if is_vault && !cfg.ai.vault_routing_enabled {
        problems.push("Targets the encrypted vault, but vault routing is off. Matching files will go to review.".to_string());
    }

    let destination_exists = match (&safe, is_vault) {
        (Some(f), true) => Some(cfg.folder.join(f).is_dir()),
        (Some(f), false) => routing_root(&cfg).ok()
            .filter(|root| root.is_dir())
            .map(|root| root.join(f).is_dir()),
        (None, _) => None,
    };
    if destination_exists == Some(false) {
        problems.push("Destination folder does not exist yet. It will be created on first use.".to_string());
    }

    let sample = sample_file
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| sample_filename_for_trigger(&trigger));
    let sample_matches = ai::match_rule_with_index(&sample, std::slice::from_ref(&rule)).is_some();
    if !sample_matches {
        problems.push(format!("Does not match the sample file '{sample}'."));
    }

    let all = rules_list(&cfg);
    let shadowed_by = match ai::match_rule_with_index(&sample, &all) {
        Some((_, _, winner)) if sample_matches && winner.trim() != rule.trim() => Some(winner),
        _ => None,
    };

    Ok(RuleCheck {
        rule,
        parses: true,
        trigger,
        destination,
        is_vault,
        vault_enabled: cfg.ai.vault_routing_enabled,
        destination_safe: safe.is_some(),
        destination_exists,
        sample_file: sample,
        sample_matches,
        shadowed_by,
        problems,
    })
}

// ---------------------------------------------------------------- Drop folder ingest & transfer log

/// Serialized in snake_case to match the frontend types. Aliases keep logs written by
/// older builds (camelCase) readable.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct NasTransferRecord {
    pub id: String,
    pub timestamp: u64,
    pub filename: String,
    #[serde(alias = "sourcePath")]
    pub source_path: String,
    #[serde(alias = "destinationPath")]
    pub destination_path: String,
    #[serde(alias = "destinationFolder")]
    pub destination_folder: String,
    #[serde(alias = "ruleMatched")]
    pub rule_matched: String,
    #[serde(alias = "fileSizeBytes")]
    pub file_size_bytes: u64,
    pub status: String, // "completed", "relocated", "reverted"
    /// Route that moved the file. Missing in logs from older builds (the main drop folder).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct StoredNasTransfers {
    pub transfers: Vec<NasTransferRecord>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct NasStagingStatus {
    pub ingest_folder: String,
    pub pending_count: usize,
    pub pending_files: Vec<String>,
    pub nas_accessible: bool,
    pub smb_target: Option<String>,
    pub review_count: usize,
}

fn nas_transfers_path() -> Result<std::path::PathBuf, String> {
    profile_file("nas_transfers.json")
}

pub fn load_nas_transfers() -> Vec<NasTransferRecord> {
    let Ok(path) = nas_transfers_path() else { return Vec::new(); };
    let stored: StoredNasTransfers = read_json_or_default(&path);
    // Drop placeholder records written by older builds.
    stored.transfers.into_iter().filter(|t| !t.id.starts_with("tx-sample-")).collect()
}

/// Load the transfer log, change it and save it, all under the store lock.
pub(crate) fn update_nas_transfers<R>(f: impl FnOnce(&mut Vec<NasTransferRecord>) -> R) -> R {
    let _guard = json_store_lock();
    let mut list = load_nas_transfers();
    let out = f(&mut list);
    if let Ok(path) = nas_transfers_path() {
        write_json(&path, &StoredNasTransfers { transfers: list });
    }
    out
}

pub fn record_nas_transfer(rec: NasTransferRecord) {
    if let Ok(mut log) = activity_log().lock() {
        log.record_move(&rec.source_path, &rec.destination_path, rec.file_size_bytes, crate::activity::now_ms());
    }
    update_nas_transfers(|list| {
        list.insert(0, rec);
        list.truncate(2000);
    });
}

/// New id for a transfer record or review item. Time-based ids collided within one millisecond.
pub(crate) fn new_id(prefix: &str) -> String {
    format!("{prefix}-{}", uuid::Uuid::new_v4())
}

#[tauri::command]
pub fn get_nas_transfers() -> Result<Vec<NasTransferRecord>, String> {
    Ok(load_nas_transfers())
}

#[tauri::command]
pub fn clear_nas_transfers() -> Result<(), String> {
    update_nas_transfers(|list| list.clear());
    Ok(())
}

/// Run slow file work (copies to a NAS can take minutes) off the UI thread.
/// Tauri runs non-async commands on the main thread, which freezes the window.
pub(crate) async fn run_blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("Background task failed: {e}"))?
}

#[tauri::command]
pub async fn relocate_nas_transfer(transfer_id: String, new_folder: String) -> Result<NasTransferRecord, String> {
    run_blocking(move || relocate_nas_transfer_blocking(transfer_id, new_folder)).await
}

fn relocate_nas_transfer_blocking(transfer_id: String, new_folder: String) -> Result<NasTransferRecord, String> {
    use renegadebox_engine::ai;
    // Work on a copy: the move below can take minutes, and the log may change meanwhile.
    let mut record = load_nas_transfers().into_iter().find(|r| r.id == transfer_id)
        .ok_or_else(|| format!("Transfer record '{transfer_id}' not found"))?;
    if record.destination_folder.starts_with("vault:") {
        return Err("Files moved into the vault are managed from the vault folder, not from here.".to_string());
    }

    let current_path = std::path::PathBuf::from(&record.destination_path);
    if !current_path.exists() {
        return Err(format!("File does not exist at current destination: {}", current_path.display()));
    }

    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let cfg = profile.load().map_err(|e| e.to_string())?;
    let route = crate::routing::route_for(&cfg, record.route_id.as_deref())?;
    // Keep the file on the side it already lives on (destination folder or source folder).
    let source_root = route.source_path();
    let smb_root = if renegadebox_engine::routes::path_within(&current_path, &source_root) {
        source_root
    } else {
        route.destination_root().ok_or_else(|| "This route has no destination folder.".to_string())?
    };

    let clean_dest = ai::sanitize_relative_folder(&new_folder)
        .ok_or_else(|| "Folder must be a relative path inside the destination (no '..').".to_string())?;
    let target_dir = ai::create_contained_dir(&smb_root, &clean_dest).map_err(|e| e.to_string())?;
    let new_dest = ai::pick_free_path(&target_dir, &record.filename);
    ai::move_file_verified(&current_path, &new_dest).map_err(|e| format!("Move failed: {e:#}"))?;

    record.destination_folder = clean_dest;
    record.destination_path = new_dest.to_string_lossy().to_string();
    record.status = "relocated".to_string();
    patch_transfer(&record);
    Ok(record)
}

/// Write one changed record back by id, on top of the current log.
fn patch_transfer(record: &NasTransferRecord) {
    update_nas_transfers(|list| {
        if let Some(r) = list.iter_mut().find(|r| r.id == record.id) {
            *r = record.clone();
        }
    });
}

/// Move a routed file back into the review folder (not the drop folder itself, which
/// would just route it again with the same rule).
#[tauri::command]
pub async fn revert_nas_transfer_to_staging(transfer_id: String) -> Result<NasTransferRecord, String> {
    run_blocking(move || revert_nas_transfer_to_staging_blocking(transfer_id)).await
}

fn revert_nas_transfer_to_staging_blocking(transfer_id: String) -> Result<NasTransferRecord, String> {
    use renegadebox_engine::ai;
    let mut record = load_nas_transfers().into_iter().find(|r| r.id == transfer_id)
        .ok_or_else(|| format!("Transfer record '{transfer_id}' not found"))?;

    let current_path = std::path::PathBuf::from(&record.destination_path);
    if !current_path.exists() {
        return Err(format!("File does not exist at destination: {}", current_path.display()));
    }

    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let cfg = profile.load().map_err(|e| e.to_string())?;
    let route = crate::routing::route_for(&cfg, record.route_id.as_deref())?;
    if route.copy_mode() {
        return Err("This route copies files, so the original is still in the source folder. Move or delete this copy instead.".to_string());
    }
    let review_dir = route.source_path().join(REVIEW_DIR_NAME);
    std::fs::create_dir_all(&review_dir).map_err(|e| format!("Could not create review folder: {e}"))?;

    let staging_dest = ai::pick_free_path(&review_dir, &record.filename);
    ai::move_file_verified(&current_path, &staging_dest).map_err(|e| format!("Move failed: {e:#}"))?;

    add_review_item(ReviewItem {
        id: new_id("rv"),
        timestamp: unix_ms(),
        filename: record.filename.clone(),
        path: staging_dest.to_string_lossy().to_string(),
        suggested_folder: Some(record.destination_folder.clone()),
        confidence: None,
        reason: "Moved back by you".to_string(),
        explanation: Some(format!("Was in {}", record.destination_folder)),
        file_size_bytes: record.file_size_bytes,
        route_id: record.route_id.clone(),
    });

    record.status = "reverted".to_string();
    patch_transfer(&record);
    Ok(record)
}

// ---------------------------------------------------------------- review queue

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ReviewItem {
    pub id: String,
    pub timestamp: u64,
    pub filename: String,
    /// Current location inside the review folder.
    pub path: String,
    pub suggested_folder: Option<String>,
    pub confidence: Option<f32>,
    pub reason: String,
    pub explanation: Option<String>,
    pub file_size_bytes: u64,
    /// Route the file came from. Missing for items from older builds (the main drop folder).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct StoredReviewQueue {
    items: Vec<ReviewItem>,
}

pub(crate) fn load_review_items() -> Vec<ReviewItem> {
    profile_file("review_queue.json")
        .map(|p| read_json_or_default::<StoredReviewQueue>(&p).items)
        .unwrap_or_default()
}

/// Load the review queue, change it and save it, all under the store lock.
pub(crate) fn update_review_items<R>(f: impl FnOnce(&mut Vec<ReviewItem>) -> R) -> R {
    let _guard = json_store_lock();
    let mut items = load_review_items();
    let out = f(&mut items);
    if let Ok(p) = profile_file("review_queue.json") {
        write_json(&p, &StoredReviewQueue { items });
    }
    out
}

pub(crate) fn add_review_item(item: ReviewItem) {
    update_review_items(|items| items.insert(0, item));
}

/// Record a file for review and say why. With `use_folder` it is moved into the review
/// folder; otherwise it stays where it is and is only listed.
#[allow(clippy::too_many_arguments)]
pub(crate) fn send_to_review(
    ingest_dir: &std::path::Path,
    path: &std::path::Path,
    filename: &str,
    size: u64,
    reason: String,
    suggested_folder: Option<String>,
    confidence: Option<f32>,
    explanation: Option<String>,
    use_folder: bool,
    route_id: Option<String>,
) -> Option<ReviewItem> {
    let dest = if use_folder {
        let review_dir = ingest_dir.join(REVIEW_DIR_NAME);
        if let Err(e) = std::fs::create_dir_all(&review_dir) {
            eprintln!("[Drop folder] Could not create review folder: {e}");
            return None;
        }
        let dest = renegadebox_engine::ai::pick_free_path(&review_dir, filename);
        if let Err(e) = renegadebox_engine::ai::move_file_verified(path, &dest) {
            eprintln!("[Drop folder] Could not move {filename} to review: {e:#}");
            return None;
        }
        dest
    } else {
        path.to_path_buf()
    };
    let item = ReviewItem {
        id: new_id("rv"),
        timestamp: unix_ms(),
        filename: filename.to_string(),
        path: dest.to_string_lossy().to_string(),
        suggested_folder,
        confidence,
        reason,
        explanation,
        file_size_bytes: size,
        route_id,
    };
    add_review_item(item.clone());
    Some(item)
}

/// List files waiting for review. Entries whose file was moved away manually are dropped.
/// Async: review files may sit on a NAS route folder, and checking them can block.
#[tauri::command]
pub async fn get_review_queue() -> Result<Vec<ReviewItem>, String> {
    run_blocking(|| {
        // Check the files without holding the store lock, then drop the missing ones by id.
        let items = load_review_items();
        let gone: std::collections::HashSet<String> = items
            .iter()
            .filter(|i| !std::path::Path::new(&i.path).exists())
            .map(|i| i.id.clone())
            .collect();
        if gone.is_empty() {
            return Ok(items);
        }
        Ok(update_review_items(|items| {
            items.retain(|i| !gone.contains(&i.id));
            items.clone()
        }))
    })
    .await
}

/// Approve a review item: move it to the suggested folder or one the user typed.
#[tauri::command]
pub async fn approve_review_item(item_id: String, folder: Option<String>) -> Result<NasTransferRecord, String> {
    run_blocking(move || approve_review_item_blocking(item_id, folder)).await
}

fn approve_review_item_blocking(item_id: String, folder: Option<String>) -> Result<NasTransferRecord, String> {
    use renegadebox_engine::ai;
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let cfg = profile.load().map_err(|e| e.to_string())?;
    let item = load_review_items()
        .into_iter()
        .find(|i| i.id == item_id)
        .ok_or_else(|| "Review item not found".to_string())?;
    let src = std::path::PathBuf::from(&item.path);
    if !src.exists() {
        update_review_items(|items| items.retain(|i| i.id != item_id));
        return Err("The file is no longer in the review folder.".to_string());
    }

    let chosen = folder
        .map(|f| f.trim().to_string())
        .filter(|f| !f.is_empty())
        .or(item.suggested_folder.clone())
        .ok_or_else(|| "Type a destination folder first.".to_string())?;

    let route = crate::routing::route_for(&cfg, item.route_id.as_deref())?;
    let (root, rel, label) = if let Some(sub) = ai::parse_vault_destination(&chosen) {
        if !route.vault {
            return Err("Vault routing is off. Turn it on in Smart Routing settings first.".to_string());
        }
        let rel = ai::sanitize_relative_folder(sub).ok_or_else(|| "Unsafe vault folder.".to_string())?;
        (cfg.folder.clone(), rel.clone(), format!("vault:{rel}"))
    } else {
        let root = route.destination_root().ok_or_else(|| "This route has no destination folder.".to_string())?;
        if !root.is_dir() {
            return Err(format!("Destination {} is not reachable.", root.display()));
        }
        let rel = ai::sanitize_relative_folder(&chosen)
            .ok_or_else(|| "Folder must be a relative path inside the destination (no '..').".to_string())?;
        (root, rel.clone(), rel)
    };

    let target_dir = ai::create_contained_dir(&root, &rel).map_err(|e| e.to_string())?;
    let dest = ai::pick_free_path(&target_dir, &item.filename);
    if route.copy_mode() {
        // Copy routes never move originals; remember this one so it is not copied again.
        let key = renegadebox_engine::routes::seen_key(&src);
        ai::copy_file_verified(&src, &dest).map_err(|e| format!("Copy failed: {e:#}"))?;
        if let Some(k) = key {
            crate::routing::mark_seen(&route.id, &[k]);
        }
    } else {
        ai::move_file_verified(&src, &dest).map_err(|e| format!("Move failed: {e:#}"))?;
    }

    // Re-read under the lock: the copy may have taken minutes and the list may have changed meanwhile.
    update_review_items(|items| items.retain(|i| i.id != item_id));

    let rec = NasTransferRecord {
        id: new_id("tx"),
        timestamp: unix_ms(),
        filename: item.filename.clone(),
        source_path: item.path.clone(),
        destination_path: dest.to_string_lossy().to_string(),
        destination_folder: label,
        rule_matched: "Approved by you from review".to_string(),
        file_size_bytes: item.file_size_bytes,
        status: "completed".to_string(),
        route_id: item.route_id.clone(),
    };
    record_nas_transfer(rec.clone());
    Ok(rec)
}

/// Remove an item from the list. The file stays in the review folder for manual handling.
#[tauri::command]
pub async fn dismiss_review_item(item_id: String) -> Result<(), String> {
    run_blocking(move || dismiss_review_item_blocking(item_id)).await
}

fn dismiss_review_item_blocking(item_id: String) -> Result<(), String> {
    if let Some(item) = load_review_items().into_iter().find(|i| i.id == item_id) {
        // A dismissed file left in place (copy routes, or no review folder) would be
        // picked up again on the next pass and cost another AI call. Remember it.
        let route_id = item.route_id.as_deref().unwrap_or(renegadebox_engine::routes::MAIN_ROUTE_ID);
        crate::routing::mark_dismissed(route_id, std::path::Path::new(&item.path));
    }
    update_review_items(|items| items.retain(|i| i.id != item_id));
    Ok(())
}

// ---------------------------------------------------------------- learned rule suggestions

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct RuleSuggestion {
    pub id: String,
    pub timestamp: u64,
    pub rule: String,
    pub example_file: String,
    pub destination: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct StoredRuleSuggestions {
    items: Vec<RuleSuggestion>,
}

fn load_rule_suggestions() -> Vec<RuleSuggestion> {
    profile_file("rule_suggestions.json")
        .map(|p| read_json_or_default::<StoredRuleSuggestions>(&p).items)
        .unwrap_or_default()
}

fn save_rule_suggestions(items: &[RuleSuggestion]) {
    if let Ok(p) = profile_file("rule_suggestions.json") {
        write_json(&p, &StoredRuleSuggestions { items: items.to_vec() });
    }
}

pub(crate) fn add_rule_suggestion(rule: &str, example_file: &str, existing_rules: &[String]) {
    let Some(dest) = renegadebox_engine::ai::validate_suggested_rule(rule, example_file) else { return; };
    let lower = rule.trim().to_lowercase();
    if existing_rules.iter().any(|r| r.trim().to_lowercase() == lower) {
        return;
    }
    let mut items = load_rule_suggestions();
    if items.iter().any(|s| s.rule.trim().to_lowercase() == lower) {
        return;
    }
    let now = unix_ms();
    items.insert(0, RuleSuggestion {
        id: format!("rs-{now}-{}", items.len() + 1),
        timestamp: now,
        rule: rule.trim().to_string(),
        example_file: example_file.to_string(),
        destination: dest,
    });
    items.truncate(50);
    save_rule_suggestions(&items);
}

#[tauri::command]
pub fn get_rule_suggestions() -> Result<Vec<RuleSuggestion>, String> {
    Ok(load_rule_suggestions())
}

/// Remove a suggestion. Accepting is done by the UI adding the rule, then calling this.
#[tauri::command]
pub fn dismiss_rule_suggestion(suggestion_id: String) -> Result<(), String> {
    let mut items = load_rule_suggestions();
    items.retain(|s| s.id != suggestion_id);
    save_rule_suggestions(&items);
    Ok(())
}

// ---------------------------------------------------------------- ingest loop

#[tauri::command]
pub async fn get_nas_staging_status() -> Result<NasStagingStatus, String> {
    tokio::task::spawn_blocking(|| {
        let profile = Profile::locate().map_err(|e| e.to_string())?;
        let cfg = profile.load().map_err(|e| e.to_string())?;
        let ingest_dir = ingest_dir_for(&cfg);

        let _ = std::fs::create_dir_all(&ingest_dir);

        let mut pending_files = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&ingest_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if entry.path().is_file() && !is_partial_download(&name) {
                    pending_files.push(name);
                }
            }
        }

        let nas_accessible = cfg.ai.smb_target.as_ref()
            .map(|p| std::path::Path::new(p).exists())
            .unwrap_or(false);

        Ok(NasStagingStatus {
            ingest_folder: ingest_dir.to_string_lossy().to_string(),
            pending_count: pending_files.len(),
            pending_files,
            nas_accessible,
            smb_target: cfg.ai.smb_target.clone(),
            review_count: load_review_items().len(),
        })
    }).await.map_err(|e| e.to_string())?
}

pub(crate) enum IngestPlan {
    Move { root: std::path::PathBuf, folder: String, label: String, vault: bool },
    Review { reason: String, suggested: Option<String>, confidence: Option<f32>, explanation: Option<String> },
}

pub(crate) fn review_plan(reason: impl Into<String>) -> IngestPlan {
    IngestPlan::Review { reason: reason.into(), suggested: None, confidence: None, explanation: None }
}

/// Run every enabled route that processes automatically (the main drop folder and any extra routes).
pub async fn process_nas_ingest_internal(cfg: &renegadebox_engine::config::Config, profile: &Profile) -> Result<Vec<NasTransferRecord>, String> {
    crate::routing::process_routes(cfg, profile, None, false).await
}

#[tauri::command]
pub async fn process_nas_ingest() -> Result<Vec<NasTransferRecord>, String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let cfg = profile.load().map_err(|e| e.to_string())?;
    crate::routing::process_routes(&cfg, &profile, Some(renegadebox_engine::routes::MAIN_ROUTE_ID), true).await
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

    #[test]
    fn aggregates_enabled_roles_without_duplicates() {
        let mut map = std::collections::BTreeMap::new();
        map.insert("webdev".to_string(), vec!["*.sql go to DB".to_string(), "Invoices go to Finance".to_string()]);
        map.insert("photo".to_string(), vec!["invoices go to Finance".to_string(), "*.cr3 go to Photos/RAW".to_string()]);
        map.insert("unused".to_string(), vec!["*.zip go to Zips".to_string()]);
        let agg = aggregate_rules(&map, &["webdev".to_string(), "photo".to_string()]);
        assert_eq!(agg, vec!["*.sql go to DB", "Invoices go to Finance", "*.cr3 go to Photos/RAW"]);
    }

    #[test]
    fn derives_sample_files_from_triggers() {
        assert_eq!(sample_filename_for_trigger("*.stl, *.obj"), "example.stl");
        assert_eq!(sample_filename_for_trigger("Raw photos (*.cr3)"), "example.cr3");
        assert_eq!(sample_filename_for_trigger("Invoices and receipts"), "invoices_2026.pdf");
    }

    #[test]
    fn estimates_only_known_models() {
        let c = estimate_ai_cost("google/gemini-2.5-flash-lite", 1_000_000, 0).unwrap();
        assert!((c - 0.10).abs() < 1e-9);
        let g = estimate_ai_cost("grok-4.20-non-reasoning", 0, 1_000_000).unwrap();
        assert!((g - 2.50).abs() < 1e-9);
        assert!(estimate_ai_cost("some/unknown-model", 100, 100).is_none());
    }

    #[test]
    fn folder_scan_emits_one_rule_per_category() {
        let dirs: Vec<String> = [
            "Archive",
            "Archive/Photos",
            "Media",
            "Media/Photos",
            "Media/Photos/2019",
            "Media/Photos/2019 Trip photos",
            "Media/Photos/2020 photo dump",
            "Photos",
            "Photos/Old photos",
            "Finance",
            "Finance/Tax 2024",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let rules = taxonomy_rules(&dirs, &[], MAX_SCAN_RULES);
        let photos: Vec<&String> = rules.iter().filter(|r| r.starts_with("Photos and camera media")).collect();
        assert_eq!(photos, vec!["Photos and camera media go to Photos"]);
        assert!(rules.contains(&"Invoices, receipts, and financial statements go to Finance".to_string()));
        assert!(rules.len() <= MAX_SCAN_RULES);

        // Categories the user already has a rule for are not suggested again.
        let existing = vec!["Photos and camera media go to Media/Photos".to_string()];
        let again = taxonomy_rules(&dirs, &existing, MAX_SCAN_RULES);
        assert!(!again.iter().any(|r| r.starts_with("Photos and camera media")), "{again:?}");

        // AI output is deduped and capped too.
        let many: Vec<String> = (0..50).map(|i| format!("Photos and camera media go to P{i}")).collect();
        assert_eq!(dedupe_suggestions(many, &[], MAX_SCAN_RULES).len(), 1);
        let distinct: Vec<String> = (0..50).map(|i| format!("Kind {i} go to K{i}")).collect();
        assert_eq!(dedupe_suggestions(distinct, &[], MAX_SCAN_RULES).len(), MAX_SCAN_RULES);
    }

    #[test]
    fn webview_paths_must_stay_inside_allowed_folders() {
        let root = std::env::temp_dir().join(format!("rbox-paths-{}", uuid::Uuid::new_v4()));
        let vault = root.join("RenegadeBox");
        std::fs::create_dir_all(vault.join("docs")).unwrap();
        std::fs::write(vault.join("docs/a.txt"), b"a").unwrap();
        std::fs::write(root.join("secret.txt"), b"s").unwrap();
        let cfg = renegadebox_engine::config::Config {
            folder: vault.clone(),
            bucket: String::new(),
            region: String::new(),
            endpoint: None,
            access_key_id: String::new(),
            device_id: String::new(),
            device_name: String::new(),
            key_store: renegadebox_engine::config::KeyStoreKind::InsecureFile,
            vault_pin: String::new(),
            hub_url: None,
            ai: Default::default(),
            account: None,
        };
        assert!(resolve_allowed_path(&cfg, "docs/a.txt").is_ok());
        assert!(resolve_allowed_path(&cfg, &vault.join("docs/a.txt").to_string_lossy()).is_ok());
        assert!(resolve_allowed_path(&cfg, "../secret.txt").is_err());
        assert!(resolve_allowed_path(&cfg, "docs/../../secret.txt").is_err());
        assert!(resolve_allowed_path(&cfg, &root.join("secret.txt").to_string_lossy()).is_err());
        assert!(resolve_allowed_path(&cfg, "/etc/hosts").is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn old_usage_entries_are_marked_legacy() {
        let raw = r#"{"entries":[{"id":"a","timestamp":1,"operation":"x","operationLabel":"X","model":"m","promptTokens":290,"completionTokens":85,"totalTokens":375,"estimatedCostUsd":0.0001,"summary":"s"}]}"#;
        let data: StoredAiUsageData = serde_json::from_str(raw).unwrap();
        assert_eq!(data.entries[0].cost_source, "legacy");
    }
}
