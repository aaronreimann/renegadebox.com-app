//! RenegadeBox account commands for the desktop app, and the background task that keeps
//! this Mac's settings in step with the account. The work itself is in
//! renegadebox_engine::account; see docs/ACCOUNTS.md.

use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State as TauriState};

use renegadebox_engine::account::{self, SetupSync, SignInOptions};
use renegadebox_engine::config::Profile;

use crate::commands::{SyncRequest, WatcherHandle};

/// `RENEGADEBOX_SERVER` overrides the account server, for local testing.
fn server() -> String {
    std::env::var("RENEGADEBOX_SERVER").ok().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| account::DEFAULT_SERVER.to_string())
}

fn profile() -> Result<Profile, String> {
    Profile::locate().map_err(|e| e.to_string())
}

/// Wakes the settings task after a change that should reach the account right away.
pub fn wake() -> &'static tokio::sync::Notify {
    static WAKE: std::sync::OnceLock<tokio::sync::Notify> = std::sync::OnceLock::new();
    WAKE.get_or_init(tokio::sync::Notify::new)
}

#[derive(Serialize, Clone, Debug)]
pub struct AccountStatus {
    pub signed_in: bool,
    pub email: Option<String>,
    pub server: String,
    /// Whether this Mac has storage set up (a new account is created from it).
    pub device_ready: bool,
    /// "google" or "password" when signed in.
    pub provider: Option<String>,
}

/// Reads config only, never the key store, so it is safe to poll.
#[tauri::command]
pub fn account_status() -> Result<AccountStatus, String> {
    let p = profile()?;
    let cfg = p.load().ok();
    Ok(AccountStatus {
        signed_in: cfg.as_ref().is_some_and(|c| c.account.is_some()),
        email: cfg.as_ref().and_then(|c| c.account.as_ref().map(|a| a.email.clone())),
        server: cfg.as_ref().and_then(|c| c.account.as_ref().map(|a| a.server.clone())).unwrap_or_else(server),
        device_ready: cfg.is_some(),
        provider: cfg
            .as_ref()
            .and_then(|c| c.account.as_ref())
            .map(|a| if a.is_google() { "google".to_string() } else { "password".to_string() }),
    })
}

#[derive(Deserialize, Debug)]
pub struct CreateAccountPayload {
    pub email: String,
    pub password: String,
}

#[tauri::command]
pub async fn account_create(app: AppHandle, state: TauriState<'_, WatcherHandle>, payload: CreateAccountPayload) -> Result<AccountStatus, String> {
    let p = profile()?;
    account::create_account(&p, &server(), &payload.email, &payload.password)
        .await
        .map_err(|e| account::friendly_error(&e))?;
    changed(&app, &state);
    account_status()
}

#[derive(Deserialize, Debug)]
pub struct SignInPayload {
    pub email: String,
    pub password: String,
    pub folder: Option<String>,
}

/// Sign in. On a new Mac this sets everything up; on one that is already set up with the
/// same storage it links it to the account.
#[tauri::command]
pub async fn account_sign_in(app: AppHandle, state: TauriState<'_, WatcherHandle>, payload: SignInPayload) -> Result<AccountStatus, String> {
    let p = profile()?;
    let folder = match payload.folder.as_deref().map(str::trim) {
        Some(f) if !f.is_empty() => Some(expand_home(f)?),
        _ => None,
    };
    let opts = SignInOptions { folder, ..Default::default() };
    let cfg = account::sign_in(&p, &server(), &payload.email, &payload.password, opts)
        .await
        .map_err(|e| account::friendly_error(&e))?;
    #[cfg(target_os = "macos")]
    crate::commands::set_folder_icon(&cfg.folder);
    let _ = cfg;
    changed(&app, &state);
    account_status()
}

#[derive(Deserialize, Debug, Default)]
pub struct GoogleSignInPayload {
    pub folder: Option<String>,
}

/// Sign in with Google: opens the browser and waits (up to ten minutes) for the person to
/// finish there. The first time, on a Mac that is already set up, this creates the account.
#[tauri::command]
pub async fn account_google_sign_in(
    app: AppHandle,
    state: TauriState<'_, WatcherHandle>,
    payload: Option<GoogleSignInPayload>,
) -> Result<AccountStatus, String> {
    let p = profile()?;
    let folder = match payload.and_then(|p| p.folder).as_deref().map(str::trim) {
        Some(f) if !f.is_empty() => Some(expand_home(f)?),
        _ => None,
    };
    let opts = SignInOptions { folder, ..Default::default() };
    let cfg = account::google_sign_in(&p, &server(), opts, |url| {
        std::process::Command::new("open")
            .arg(url)
            .status()
            .map_err(|e| anyhow::anyhow!("could not open your browser: {e}"))?;
        Ok(())
    })
    .await
    .map_err(|e| account::friendly_error(&e))?;
    #[cfg(target_os = "macos")]
    crate::commands::set_folder_icon(&cfg.folder);
    let _ = cfg;
    changed(&app, &state);
    account_status()
}

#[tauri::command]
pub async fn account_sign_out(app: AppHandle, state: TauriState<'_, WatcherHandle>) -> Result<AccountStatus, String> {
    let p = profile()?;
    account::sign_out(&p).await.map_err(|e| account::friendly_error(&e))?;
    changed(&app, &state);
    account_status()
}

#[tauri::command]
pub async fn account_devices() -> Result<Vec<account::Device>, String> {
    account::devices(&profile()?).await.map_err(|e| account::friendly_error(&e))
}

#[tauri::command]
pub async fn account_remove_device(app: AppHandle, state: TauriState<'_, WatcherHandle>, device_id: String) -> Result<(), String> {
    let p = profile()?;
    let this_device = p.load().map(|c| c.device_id == device_id).unwrap_or(false);
    account::remove_device(&p, &device_id).await.map_err(|e| account::friendly_error(&e))?;
    if this_device {
        changed(&app, &state);
    }
    Ok(())
}

#[tauri::command]
pub async fn account_change_password(password: String) -> Result<(), String> {
    account::change_password(&profile()?, &password).await.map_err(|e| account::friendly_error(&e))
}

fn expand_home(path: &str) -> Result<std::path::PathBuf, String> {
    match path.strip_prefix("~/") {
        Some(rest) => Ok(std::path::PathBuf::from(std::env::var("HOME").map_err(|_| "HOME not set".to_string())?).join(rest)),
        None => Ok(std::path::PathBuf::from(path)),
    }
}

/// The account link or storage changed: restart the sync engine with the new config and
/// refresh every window.
fn changed(app: &AppHandle, state: &WatcherHandle) {
    let _ = state.tx.send(SyncRequest::Reload);
    let _ = app.emit("vault-changed", ());
    let _ = app.emit("account-changed", ());
}

fn config_mtime(p: &Profile) -> Option<SystemTime> {
    std::fs::metadata(p.config_path()).and_then(|m| m.modified()).ok()
}

/// Keeps the account's saved setup and this Mac in step. Sends local changes soon after
/// they happen (config.toml changing, or an explicit wake), and checks for changes from
/// other Macs every few minutes. Silent unless something needs the person.
pub async fn run_setup_sync_loop(app: AppHandle, tx: tokio::sync::mpsc::UnboundedSender<SyncRequest>) {
    const CHECK: Duration = Duration::from_secs(30);
    const PULL_EVERY: Duration = Duration::from_secs(5 * 60);
    let mut seen_mtime: Option<SystemTime> = None;
    let mut last_pull = std::time::Instant::now() - PULL_EVERY;
    let mut backoff = Duration::ZERO;

    loop {
        tokio::select! {
            _ = tokio::time::sleep(CHECK + backoff) => {}
            _ = wake().notified() => {}
        }
        let Ok(p) = Profile::locate() else { continue };
        let Ok(cfg) = p.load() else { continue };
        if cfg.account.is_none() {
            seen_mtime = None;
            continue;
        }
        let mtime = config_mtime(&p);
        let local_change = seen_mtime.is_some() && mtime != seen_mtime;
        if seen_mtime.is_some() && !local_change && last_pull.elapsed() < PULL_EVERY {
            continue;
        }

        match account::sync_setup(&p).await {
            Ok(result) => {
                backoff = Duration::ZERO;
                last_pull = std::time::Instant::now();
                if result == SetupSync::Received {
                    eprintln!("[Account] Applied setup changes from another device");
                    // Storage keys may have changed: restart the engine with them.
                    let _ = tx.send(SyncRequest::Reload);
                    let _ = app.emit("vault-changed", ());
                    let _ = app.emit("account-changed", ());
                }
            }
            Err(e) => {
                if account::api_error(&e).is_some_and(|a| a.code == "unauthorized") {
                    // Signed out from another device: drop the link quietly and tell the UI.
                    eprintln!("[Account] This device was signed out of the account");
                    let _ = account::sign_out(&p).await;
                    let _ = tx.send(SyncRequest::Reload);
                    let _ = app.emit("account-changed", ());
                } else {
                    eprintln!("[Account] Setup sync deferred: {e:#}");
                    backoff = (backoff * 2).clamp(Duration::from_secs(30), Duration::from_secs(30 * 60));
                }
            }
        }
        // Our own save (setup version bump) must not look like a local change next time.
        seen_mtime = config_mtime(&p);
    }
}
