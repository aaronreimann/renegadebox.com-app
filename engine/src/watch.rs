//! Long-running mode: react to local file events, and listen for Hub push notifications
//! with slow journal polling as a safety net.

use std::time::Duration;

use anyhow::Result;
use notify::RecursiveMode;
use notify_debouncer_full::{DebounceEventResult, new_debouncer};
use tracing::{error, info, warn};

use crate::config::{Profile, SECRET_DEVICE_TOKEN};
use crate::engine::Engine;
use crate::hub::{self, HubClientConfig};

pub async fn run(engine: &mut Engine, profile: &Profile, poll: Duration) -> Result<()> {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    let mut debouncer = new_debouncer(Duration::from_millis(500), None, move |res: DebounceEventResult| {
        if res.is_ok() {
            let _ = tx.send(());
        }
    })?;
    debouncer.watch(engine.root(), RecursiveMode::Recursive)?;

    let (sync_trigger_tx, mut sync_trigger_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    let (appended_tx, appended_rx) = tokio::sync::mpsc::unbounded_channel::<hub::AppendedEvent>();
    engine.set_on_appended(appended_tx);

    // If hub_url is configured and device_token is stored in keystore, launch the Hub client task
    if let Some(hub_url) = &engine.cfg.hub_url {
        match profile.get_secret(&engine.cfg, SECRET_DEVICE_TOKEN) {
            Ok(token) => {
                let hub_cfg = HubClientConfig {
                    hub_url: hub_url.clone(),
                    device_token: token,
                    device_id: engine.cfg.device_id.clone(),
                    device_name: engine.cfg.device_name.clone(),
                    client_version: format!("rbox {}", env!("CARGO_PKG_VERSION")),
                };
                tokio::spawn(hub::run_hub_client(hub_cfg, sync_trigger_tx, appended_rx));
                info!(
                    "watching {} (real-time via Hub at {}, remote fallback poll every {}s)",
                    engine.root().display(),
                    hub_url,
                    poll.as_secs()
                );
            }
            Err(e) => {
                warn!("Hub URL configured ({hub_url}) but no device token in keystore ({e:#}); falling back to polling");
                info!("watching {} (remote poll every {}s)", engine.root().display(), poll.as_secs());
            }
        }
    } else {
        info!("watching {} (remote poll every {}s)", engine.root().display(), poll.as_secs());
    }

    let mut ticker = tokio::time::interval(poll);
    loop {
        tokio::select! {
            _ = ticker.tick() => {}
            Some(()) = rx.recv() => {
                // Coalesce bursts: our own writes during a cycle queue one more (no-op) cycle at most.
                while rx.try_recv().is_ok() {}
            }
            Some(()) = sync_trigger_rx.recv() => {
                info!("received real-time sync notification from Hub");
                while sync_trigger_rx.try_recv().is_ok() {}
            }
            _ = tokio::signal::ctrl_c() => {
                info!("stopping");
                return Ok(());
            }
        }
        match engine.sync_once().await {
            Ok(r) => info!("{r}"),
            Err(e) => error!("sync failed: {e:#}"),
        }
    }
}
