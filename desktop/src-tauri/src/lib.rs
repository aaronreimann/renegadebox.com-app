mod account;
mod activity;
pub mod commands;
mod routing;
mod windows;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Listener, Manager, WindowEvent,
};

const TRAY_ICON: &[u8] = include_bytes!("../icons/tray-icon@2x.png");

pub fn run() {
    let (watcher_tx, watcher_rx) = tokio::sync::mpsc::unbounded_channel();
    let watcher_handle = commands::WatcherHandle {
        tx: watcher_tx,
        paused: Arc::new(AtomicBool::new(false)),
        runtime: Arc::new(Mutex::new(commands::SyncRuntime::default())),
    };
    let watcher_for_setup = watcher_handle.clone();
    let setup_sync_tx = watcher_handle.tx.clone();

    tauri::Builder::default()
        // Must be registered first: a second launch just brings up the main window.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            windows::show_main_window(app);
        }))
        .manage(watcher_handle)
        .manage(windows::PopoverState::default())
        .setup(move |app| {
            // Menu-bar app: no Dock icon, no app menu.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let watcher_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                commands::run_background_watcher(watcher_app, watcher_rx, watcher_for_setup).await;
            });
            let account_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                account::run_setup_sync_loop(account_app, setup_sync_tx).await;
            });

            let folder_i = MenuItem::with_id(app, "folder", "Open RenegadeBox folder", true, None::<&str>)?;
            let pause_i = MenuItem::with_id(app, "pause", "Pause syncing", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let settings_i = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit RenegadeBox", true, None::<&str>)?;

            let pause_on_pause = pause_i.clone();
            app.listen("sync-paused", move |_| {
                let _ = pause_on_pause.set_text("Resume syncing");
            });
            let pause_on_resume = pause_i.clone();
            app.listen("sync-resumed", move |_| {
                let _ = pause_on_resume.set_text("Pause syncing");
            });

            let menu = Menu::with_items(app, &[&folder_i, &pause_i, &sep, &settings_i, &quit_i])?;

            TrayIconBuilder::with_id("main")
                .icon(Image::from_bytes(TRAY_ICON)?)
                .icon_as_template(true)
                .tooltip("RenegadeBox")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "folder" => {
                        if commands::open_sync_folder().is_err() {
                            windows::open_setup(app);
                        }
                    }
                    "pause" => {
                        let handle = app.state::<commands::WatcherHandle>();
                        let paused = handle.paused.load(Ordering::SeqCst);
                        commands::set_paused(app, &handle, !paused);
                    }
                    "settings" => windows::open_settings(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        position,
                        rect,
                        ..
                    } = event
                    {
                        windows::toggle_popover(tray.app_handle(), position, rect);
                    }
                })
                .build(app)?;

            // First run: walk through setup. Otherwise show the main window.
            let initialized = renegadebox_engine::config::Profile::locate()
                .map(|p| p.config_path().exists())
                .unwrap_or(false);
            if !initialized {
                windows::open_setup(app.handle());
            } else {
                windows::show_main_window(app.handle());
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == windows::MAIN {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            } else if window.label() == windows::POPOVER {
                match event {
                    // Like a menu: the popover goes away as soon as you click elsewhere.
                    WindowEvent::Focused(false) => windows::hide_popover(window.app_handle()),
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        windows::hide_popover(window.app_handle());
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_vault_status,
            commands::get_sync_overview,
            commands::list_recent_files,
            commands::get_sync_activity,
            commands::list_conflicts,
            commands::resolve_conflict,
            commands::pause_sync,
            commands::resume_sync,
            commands::is_sync_paused,
            commands::open_sync_folder,
            commands::open_file,
            commands::reveal_in_finder,
            commands::open_settings,
            commands::open_setup,
            commands::hide_popover,
            commands::open_main_window,
            commands::close_window,
            commands::quit_app,
            commands::update_vault_config,
            commands::get_ignored_patterns,
            commands::save_ignored_patterns,
            commands::setup_vault,
            commands::set_key_store,
            commands::is_autostart_enabled,
            commands::set_autostart_enabled,
            commands::get_ai_config,
            commands::save_ai_config,
            commands::scan_nas_directories,
            commands::test_ai_routing,
            commands::suggest_rules_from_nas,
            commands::translate_rules,
            commands::choose_folder,
            commands::pick_sync_folder,
            commands::list_detected_volumes,
            commands::open_finder_extensions,
            commands::add_to_finder_favorites,
            commands::get_ai_usage,
            commands::clear_ai_usage,
            commands::get_nas_transfers,
            commands::clear_nas_transfers,
            commands::relocate_nas_transfer,
            commands::revert_nas_transfer_to_staging,
            commands::get_nas_staging_status,
            commands::process_nas_ingest,
            routing::get_routes,
            routing::save_route,
            routing::delete_route,
            routing::run_route_now,
            commands::get_review_queue,
            commands::approve_review_item,
            commands::dismiss_review_item,
            commands::get_rule_suggestions,
            commands::dismiss_rule_suggestion,
            commands::check_rule,
            commands::save_routing_rules,
            commands::undo_rules_change,
            account::account_status,
            account::account_create,
            account::account_sign_in,
            account::account_google_sign_in,
            account::account_sign_out,
            account::account_devices,
            account::account_remove_device,
            account::account_change_password
        ])
        .run(tauri::generate_context!())
        .expect("error while running RenegadeBox");
}
