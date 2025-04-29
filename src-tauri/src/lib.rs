mod commands;
mod db;
mod json;

use commands::{
    db_analyze_table, db_get_tables, import_json_to_sqlite, json_analyze_structure,
    json_get_sample, update_sqlite_from_json,
};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            db_get_tables,
            db_analyze_table,
            json_analyze_structure,
            json_get_sample,
            import_json_to_sqlite,
            update_sqlite_from_json,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
