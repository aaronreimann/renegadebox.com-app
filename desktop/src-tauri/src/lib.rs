pub mod commands;
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

    tauri::Builder::default()
        // Must be registered first: a second launch just brings up the popover.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            windows::show_popover(app);
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

            // First run: walk through setup. Otherwise stay quietly in the menu bar.
            let initialized = renegadebox_engine::config::Profile::locate()
                .map(|p| p.config_path().exists())
                .unwrap_or(false);
            if !initialized {
                windows::open_setup(app.handle());
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != windows::POPOVER {
                return;
            }
            match event {
                // Like a menu: the popover goes away as soon as you click elsewhere.
                WindowEvent::Focused(false) => windows::hide_popover(window.app_handle()),
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    windows::hide_popover(window.app_handle());
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_vault_status,
            commands::get_sync_overview,
            commands::list_recent_files,
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
            commands::test_ai_routing
        ])
        .run(tauri::generate_context!())
        .expect("error while running RenegadeBox");
}
