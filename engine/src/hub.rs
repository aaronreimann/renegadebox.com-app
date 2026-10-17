//! WebSocket client for connecting the sync engine to the RenegadeBox Hub (Phase 3).
//!
//! Relays real-time notifications (`journal_appended` -> Hub, `sync_required` -> Engine)
//! so devices sync within milliseconds instead of waiting for a polling interval.

use std::time::Duration;

use anyhow::{Context, Result, bail};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tracing::{debug, error, info, warn};

#[derive(Clone, Debug)]
pub struct HubClientConfig {
    pub hub_url: String,
    pub device_token: String,
    pub device_id: String,
    pub device_name: String,
    pub client_version: String,
}

#[derive(Clone, Debug)]
pub struct AppendedEvent {
    pub seq: u64,
    pub object_key: String,
    pub sealed_entry: Option<String>,
}

#[allow(dead_code)]
#[derive(Deserialize, Debug)]
#[serde(tag = "type", content = "payload")]
enum HubIncoming {
    #[serde(rename = "auth_ok")]
    AuthOk {
        device_id: String,
        account_id: String,
        server_time: u64,
    },
    #[serde(rename = "auth_error")]
    AuthError {
        code: String,
        message: String,
    },
    #[serde(rename = "sync_required")]
    SyncRequired {
        origin_device_id: String,
        seq: u64,
        object_key: String,
        #[serde(default)]
        sealed_entry: Option<String>,
    },
    #[serde(rename = "ping")]
    Ping {
        #[serde(default)]
        nonce: Option<String>,
    },
    #[serde(rename = "pong")]
    Pong {
        #[serde(default)]
        nonce: Option<String>,
    },
}

/// The schema allows leaving `sealed_entry` out but not sending it as null.
fn journal_appended_message(event: &AppendedEvent) -> serde_json::Value {
    let mut payload = serde_json::json!({ "seq": event.seq, "object_key": event.object_key });
    if let Some(entry) = &event.sealed_entry {
        payload["sealed_entry"] = serde_json::Value::String(entry.clone());
    }
    serde_json::json!({ "type": "journal_appended", "payload": payload })
}

/// Runs the Hub WebSocket client with automatic reconnection and backoff.
pub async fn run_hub_client(
    config: HubClientConfig,
    sync_trigger_tx: mpsc::UnboundedSender<()>,
    mut appended_rx: mpsc::UnboundedReceiver<AppendedEvent>,
) {
    let mut backoff = Duration::from_secs(1);
    let max_backoff = Duration::from_secs(30);

    info!("Hub client task started for {}", config.hub_url);

    loop {
        match connect_and_run(&config, &sync_trigger_tx, &mut appended_rx).await {
            Ok(false) => {
                // Fatal error (e.g. device revoked), do not reconnect
                warn!("Hub client stopping permanently (device revoked or unrecoverable error)");
                break;
            }
            Ok(true) | Err(_) => {
                debug!("Reconnecting to Hub in {}s...", backoff.as_secs());
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(max_backoff);
            }
        }
    }
}

/// Connects, authenticates, and handles messages until connection drops.
/// Returns Ok(true) to reconnect, Ok(false) on permanent error.
async fn connect_and_run(
    config: &HubClientConfig,
    sync_trigger_tx: &mpsc::UnboundedSender<()>,
    appended_rx: &mut mpsc::UnboundedReceiver<AppendedEvent>,
) -> Result<bool> {
    debug!("Connecting to Hub at {}...", config.hub_url);
    // The account server authenticates the upgrade itself, then the socket repeats it in auth_init.
    let mut request = config.hub_url.as_str().into_client_request().context("invalid Hub URL")?;
    request.headers_mut().insert(
        "authorization",
        format!("Bearer {}", config.device_token).parse().context("device token is not a valid header value")?,
    );
    let (mut ws, _) = connect_async(request)
        .await
        .with_context(|| format!("cannot connect to Hub at {}", config.hub_url))?;

    // 1. Send auth_init
    let auth_init = serde_json::json!({
        "type": "auth_init",
        "payload": {
            "device_token": &config.device_token,
            "device_id": &config.device_id,
            "device_name": &config.device_name,
            "client_version": &config.client_version,
        }
    });

    ws.send(Message::Text(auth_init.to_string()))
        .await
        .context("failed to send auth_init to Hub")?;

    // 2. Await auth_ok or auth_error (with 5s timeout)
    let auth_res = tokio::time::timeout(Duration::from_secs(5), ws.next()).await;
    let auth_msg = match auth_res {
        Ok(Some(Ok(Message::Text(txt)))) => txt,
        Ok(Some(Ok(_))) => bail!("unexpected non-text auth response from Hub"),
        Ok(Some(Err(e))) => return Err(e.into()),
        Ok(None) => bail!("Hub closed connection before auth response"),
        Err(_) => bail!("timeout waiting for auth response from Hub"),
    };

    let incoming: HubIncoming =
        serde_json::from_str(&auth_msg).with_context(|| format!("invalid response from Hub: {auth_msg}"))?;

    match incoming {
        HubIncoming::AuthOk { account_id, .. } => {
            info!("Authenticated with Hub (account: {})", account_id);
            // On successful connection, trigger a sync to catch up on any missed events while offline
            let _ = sync_trigger_tx.send(());
        }
        HubIncoming::AuthError { code, message } => {
            if code == "revoked" {
                error!("This device has been REVOKED by the account owner: {message}");
                return Ok(false);
            }
            warn!("Hub authentication failed ({code}): {message}");
            return Ok(true);
        }
        other => {
            bail!("expected auth_ok or auth_error, got {other:?}");
        }
    }

    // 3. Message loop
    loop {
        tokio::select! {
            incoming_opt = ws.next() => {
                let Some(msg_res) = incoming_opt else {
                    info!("Hub closed WebSocket connection");
                    return Ok(true);
                };
                let msg = msg_res?;
                match msg {
                    Message::Text(txt) => {
                        let parsed: Result<HubIncoming, _> = serde_json::from_str(&txt);
                        match parsed {
                            Ok(HubIncoming::SyncRequired { origin_device_id, seq, object_key, .. }) => {
                                debug!("Received sync_required from device {origin_device_id} (seq {seq}, key {object_key})");
                                let _ = sync_trigger_tx.send(());
                            }
                            Ok(HubIncoming::Ping { nonce }) => {
                                let pong = serde_json::json!({
                                    "type": "pong",
                                    "payload": { "nonce": nonce }
                                });
                                let _ = ws.send(Message::Text(pong.to_string())).await;
                            }
                            Ok(HubIncoming::AuthError { code, message }) => {
                                if code == "revoked" {
                                    error!("Device revoked during active connection: {message}");
                                    return Ok(false);
                                }
                            }
                            Ok(_) => {}
                            Err(e) => {
                                warn!("Failed to parse message from Hub: {e:#}");
                            }
                        }
                    }
                    Message::Ping(data) => {
                        let _ = ws.send(Message::Pong(data)).await;
                    }
                    Message::Close(_) => {
                        info!("Hub closed socket with Close frame");
                        return Ok(true);
                    }
                    _ => {}
                }
            }
            Some(appended) = appended_rx.recv() => {
                let msg = journal_appended_message(&appended);
                if let Err(e) = ws.send(Message::Text(msg.to_string())).await {
                    warn!("Failed to send journal_appended to Hub: {e:#}");
                    return Ok(true);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_incoming_auth_ok() {
        let json = r#"{"type":"auth_ok","payload":{"device_id":"d1","account_id":"acc1","server_time":1700000000}}"#;
        let parsed: HubIncoming = serde_json::from_str(json).expect("valid auth_ok");
        match parsed {
            HubIncoming::AuthOk { account_id, .. } => {
                assert_eq!(account_id, "acc1");
            }
            _ => panic!("expected AuthOk"),
        }
    }

    #[test]
    fn test_incoming_auth_error_revoked() {
        let json = r#"{"type":"auth_error","payload":{"code":"revoked","message":"Device revoked"}}"#;
        let parsed: HubIncoming = serde_json::from_str(json).expect("valid auth_error");
        match parsed {
            HubIncoming::AuthError { code, message } => {
                assert_eq!(code, "revoked");
                assert_eq!(message, "Device revoked");
            }
            _ => panic!("expected AuthError"),
        }
    }

    #[test]
    fn test_incoming_sync_required() {
        let json = r#"{"type":"sync_required","payload":{"origin_device_id":"dev-1","seq":42,"object_key":"rb/journal/dev-1/00000000000000000042","sealed_entry":"YWJj"}}"#;
        let parsed: HubIncoming = serde_json::from_str(json).expect("valid sync_required");
        match parsed {
            HubIncoming::SyncRequired { origin_device_id, seq, object_key, sealed_entry } => {
                assert_eq!(origin_device_id, "dev-1");
                assert_eq!(seq, 42);
                assert_eq!(object_key, "rb/journal/dev-1/00000000000000000042");
                assert_eq!(sealed_entry, Some("YWJj".into()));
            }
            _ => panic!("expected SyncRequired"),
        }
    }

    #[test]
    fn test_incoming_ping_pong() {
        let ping_json = r#"{"type":"ping","payload":{"nonce":"xyz123"}}"#;
        let ping_parsed: HubIncoming = serde_json::from_str(ping_json).expect("valid ping");
        match ping_parsed {
            HubIncoming::Ping { nonce } => assert_eq!(nonce, Some("xyz123".into())),
            _ => panic!("expected Ping"),
        }

        let pong_json = r#"{"type":"pong","payload":{"nonce":"xyz123"}}"#;
        let pong_parsed: HubIncoming = serde_json::from_str(pong_json).expect("valid pong");
        match pong_parsed {
            HubIncoming::Pong { nonce } => assert_eq!(nonce, Some("xyz123".into())),
            _ => panic!("expected Pong"),
        }
    }

    #[test]
    fn test_outgoing_journal_appended_privacy_and_structure() {
        let event = AppendedEvent {
            seq: 5,
            object_key: "rb/journal/dev-id/00000000000000000005".into(),
            sealed_entry: Some("base64ciphertext".into()),
        };
        let msg = journal_appended_message(&event);
        let msg_str = msg.to_string();
        let without = journal_appended_message(&AppendedEvent { sealed_entry: None, ..event.clone() });
        assert!(without["payload"].get("sealed_entry").is_none(), "absent entry must be omitted, not null");

        // ISC-100 verification: payload contains only seq, object_key, sealed_entry
        // Must never leak filenames, paths, or hashes
        let disallowed = ["path", "filename", "file_name", "content", "base_hash", "passphrase", "master_key", "secret"];
        for d in &disallowed {
            assert!(!msg_str.contains(d), "journal_appended leaked forbidden term: {d}");
        }

        let payload = msg.get("payload").expect("payload present");
        let obj = payload.as_object().expect("payload is object");
        let mut keys: Vec<_> = obj.keys().map(|k| k.as_str()).collect();
        keys.sort();
        assert_eq!(keys, vec!["object_key", "sealed_entry", "seq"]);
    }

    #[test]
    fn test_outgoing_auth_init_structure() {
        let config = HubClientConfig {
            hub_url: "ws://localhost:8787/ws".into(),
            device_token: "test-token-value".into(),
            device_id: "00000000-0000-0000-0000-000000000000".into(),
            device_name: "MacBook Pro".into(),
            client_version: "rbox 0.1.0".into(),
        };
        let auth_init = serde_json::json!({
            "type": "auth_init",
            "payload": {
                "device_token": &config.device_token,
                "device_id": &config.device_id,
                "device_name": &config.device_name,
                "client_version": &config.client_version,
            }
        });
        let payload = auth_init.get("payload").expect("payload present");
        let obj = payload.as_object().expect("is object");
        let mut keys: Vec<_> = obj.keys().map(|k| k.as_str()).collect();
        keys.sort();
        assert_eq!(keys, vec!["client_version", "device_id", "device_name", "device_token"]);
    }
}

