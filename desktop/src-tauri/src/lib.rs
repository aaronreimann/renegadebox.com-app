pub mod commands;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Listener, Manager,
};

pub fn run() {
    let (watcher_tx, watcher_rx) = tokio::sync::mpsc::unbounded_channel();
    let paused = Arc::new(AtomicBool::new(false));
    let watcher_handle = commands::WatcherHandle {
        tx: watcher_tx,
        paused: paused.clone(),
    };

    tauri::Builder::default()
        .manage(watcher_handle)
        .setup(move |app| {
            let watcher_app = app.handle().clone();
            let watcher_paused = paused.clone();
            tauri::async_runtime::spawn(async move {
                commands::run_background_watcher(watcher_app, watcher_rx, watcher_paused).await;
            });

            // Build macOS Menu Bar Tray Menu (Pirate Theme)
            let open_i = MenuItem::with_id(app, "open", "🏴‍☠️ Open RenegadeBox", true, None::<&str>)?;
            let folder_i = MenuItem::with_id(app, "folder", "📂 Open Sync Folder (Booty)", true, None::<&str>)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let status_i = MenuItem::with_id(app, "status", "⚓ Status: Up to date (Shipshape)", false, None::<&str>)?;
            let sync_i = MenuItem::with_id(app, "sync", "⚡ Sync Now (Hoist Booty)", true, None::<&str>)?;
            let pause_i = MenuItem::with_id(app, "pause", "⏸ Pause Sync", true, None::<&str>)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let dashboard_i = MenuItem::with_id(app, "dashboard", "🧭 Web Dashboard...", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit RenegadeBox (Abandon Ship)", true, None::<&str>)?;

            let status_item = status_i.clone();
            let status_item_start = status_i.clone();
            let status_item_pause = status_i.clone();
            let status_item_resume = status_i.clone();
            let pause_item_pause = pause_i.clone();
            let pause_item_resume = pause_i.clone();

            app.listen("sync-started", move |_| {
                let _ = status_item_start.set_text("⚔️ Status: Hoisting booty to S3...");
            });

            app.listen("sync-finished", move |event| {
                if let Ok(res) = serde_json::from_str::<commands::SyncResult>(event.payload()) {
                    let msg = if res.failed > 0 {
                        format!("⚠️ Status: Storm warning ({} failed)", res.failed)
                    } else if res.uploaded > 0 || res.downloaded > 0 {
                        format!("🏴‍☠️ Status: Booty stashed (↑{} / ↓{})", res.uploaded, res.downloaded)
                    } else {
                        "⚓ Status: Up to date (Shipshape)".to_string()
                    };
                    let _ = status_item.set_text(msg);
                }
            });

            app.listen("sync-paused", move |_| {
                let _ = pause_item_pause.set_text("▶ Resume Sync");
                let _ = status_item_pause.set_text("⏸ Status: Sync Paused");
            });

            app.listen("sync-resumed", move |_| {
                let _ = pause_item_resume.set_text("⏸ Pause Sync");
                let _ = status_item_resume.set_text("⚓ Status: Up to date (Shipshape)");
            });

            let menu = Menu::with_items(
                app,
                &[
                    &open_i,
                    &folder_i,
                    &sep1,
                    &status_i,
                    &sync_i,
                    &pause_i,
                    &sep2,
                    &dashboard_i,
                    &quit_i,
                ],
            )?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("RenegadeBox — Zero-Knowledge Pirate Vault")
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "open" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "folder" => {
                            let _ = commands::open_sync_folder();
                        }
                        "sync" => {
                            if let Some(handle) = app.try_state::<commands::WatcherHandle>() {
                                let _ = handle.tx.send(commands::SyncRequest::Trigger(None));
                            }
                        }
                        "pause" => {
                            if let Some(handle) = app.try_state::<commands::WatcherHandle>() {
                                let was_paused = handle.paused.load(Ordering::SeqCst);
                                handle.paused.store(!was_paused, Ordering::SeqCst);
                                if !was_paused {
                                    let _ = app.emit("sync-paused", ());
                                } else {
                                    let _ = app.emit("sync-resumed", ());
                                    let _ = handle.tx.send(commands::SyncRequest::Trigger(None));
                                }
                            }
                        }
                        "dashboard" => {
                            let _ = commands::open_dashboard();
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone()).icon_as_template(true);
            }

            tray_builder.build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_vault_status,
            commands::trigger_sync,
            commands::pause_sync,
            commands::resume_sync,
            commands::is_sync_paused,
            commands::list_synced_files,
            commands::open_sync_folder,
            commands::open_dashboard,
            commands::open_file,
            commands::reveal_in_finder,
            commands::delete_file,
            commands::rename_file,
            commands::create_folder,
            commands::pick_and_import_files,
            commands::resolve_conflict,
            commands::get_file_history,
            commands::update_vault_config,
            commands::get_ignored_patterns,
            commands::save_ignored_patterns,
            commands::export_file_copy,
            commands::setup_vault,
            commands::migrate_to_silent_keystore,
            commands::is_autostart_enabled,
            commands::set_autostart_enabled,
            commands::add_to_finder_favorites
        ])
        .run(tauri::generate_context!())
        .expect("error while running renegadebox desktop application");
}

