pub mod commands;

pub fn run() {
    tauri::Builder::default()
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
