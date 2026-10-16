//! Long-running mode: react to local file events, and poll the journal for remote changes
//! until the WebSocket hub (Phase 3) replaces polling with push notifications.

use std::time::Duration;

use anyhow::Result;
use notify::RecursiveMode;
use notify_debouncer_full::{DebounceEventResult, new_debouncer};
use tracing::{error, info};

use crate::engine::Engine;

pub async fn run(engine: &mut Engine, poll: Duration) -> Result<()> {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    let mut debouncer = new_debouncer(Duration::from_millis(500), None, move |res: DebounceEventResult| {
        if res.is_ok() {
            let _ = tx.send(());
        }
    })?;
    debouncer.watch(engine.root(), RecursiveMode::Recursive)?;
    info!("watching {} (remote poll every {}s)", engine.root().display(), poll.as_secs());

    let mut ticker = tokio::time::interval(poll);
    loop {
        tokio::select! {
            _ = ticker.tick() => {}
            Some(()) = rx.recv() => {
                // Coalesce bursts: our own writes during a cycle queue one more (no-op) cycle at most.
                while rx.try_recv().is_ok() {}
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
