pub mod commands;

pub fn run() {
    let (watcher_tx, watcher_rx) = tokio::sync::mpsc::unbounded_channel();
    let watcher_handle = commands::WatcherHandle { tx: watcher_tx };

    tauri::Builder::default()
        .manage(watcher_handle)
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                commands::run_background_watcher(handle, watcher_rx).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_vault_status,
            commands::trigger_sync,
            commands::list_synced_files,
            commands::open_sync_folder,
            commands::open_dashboard
        ])
        .run(tauri::generate_context!())
        .expect("error while running renegadebox desktop application");
}
