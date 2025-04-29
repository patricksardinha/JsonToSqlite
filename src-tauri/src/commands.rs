use crate::db;
use crate::json;
use rusqlite::types::Value;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value as JsonValue};
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use tauri::Emitter;

#[derive(Debug, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub not_null: bool,
    pub primary_key: bool,
    pub default_value: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TableInfo {
    pub columns: Vec<ColumnInfo>,
    pub unique_constraints: Vec<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonPathInfo {
    pub path: String,
    pub data_type: String,
    pub sample: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportConfig {
    pub json_path: String,
    pub db_path: String,
    pub json_root: String,
    pub table_name: String,
    pub mapping: HashMap<String, String>,
    pub defaults: Option<HashMap<String, JsonValue>>,
    pub forced: Option<HashMap<String, JsonValue>>,
    pub dynamic: Option<HashMap<String, String>>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    pub dry_run: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateConfig {
    pub json_path: String,
    pub db_path: String,
    pub json_root: String,
    pub table_name: String,
    pub key_column: String,
    pub update_columns: Vec<String>,
    pub mapping: HashMap<String, String>,
    pub dry_run: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImportProgress {
    pub total: u32,
    pub processed: u32,
    pub succeeded: u32,
    pub failed: u32,
    pub status: String,
}

/// Récupère la liste des tables d'une base de données SQLite
#[tauri::command]
pub async fn db_get_tables(db_path: String) -> Result<Vec<String>, String> {
    db::get_tables(&db_path).map_err(|e| e.to_string())
}

/// Analyse la structure d'une table SQLite
#[tauri::command]
pub async fn db_analyze_table(db_path: String, table_name: String) -> Result<TableInfo, String> {
    db::analyze_table(&db_path, &table_name).map_err(|e| e.to_string())
}

/// Analyse la structure d'un fichier JSON
#[tauri::command]
pub async fn json_analyze_structure(json_path: String) -> Result<Vec<JsonPathInfo>, String> {
    json::analyze_structure(&json_path).map_err(|e| e.to_string())
}

/// Récupère un échantillon d'objets depuis un chemin JSON
#[tauri::command]
pub async fn json_get_sample(
    json_path: String,
    json_root: String,
    limit: Option<u32>,
) -> Result<Vec<JsonValue>, String> {
    json::get_sample(&json_path, &json_root, limit).map_err(|e| e.to_string())
}

/// Importe des données JSON dans une table SQLite
#[tauri::command]
pub async fn import_json_to_sqlite(
    config: ImportConfig,
    window: tauri::Window,
) -> Result<ImportProgress, String> {
    // Création d'une fonction de callback pour rapporter la progression
    let progress_callback = move |progress: ImportProgress| {
        // Envoie un événement de progression au frontend
        let _ = window.emit("import-progress", &progress);
    };

    // Appel de la fonction d'importation du module db
    db::import_json_to_sqlite(config, progress_callback).map_err(|e| e.to_string())
}

/// Met à jour une table SQLite à partir de données JSON
#[tauri::command]
pub async fn update_sqlite_from_json(
    config: UpdateConfig,
    window: tauri::Window,
) -> Result<ImportProgress, String> {
    // Création d'une fonction de callback pour rapporter la progression
    let progress_callback = move |progress: ImportProgress| {
        // Envoie un événement de progression au frontend
        let _ = window.emit("update-progress", &progress);
    };

    // Appel de la fonction de mise à jour du module db
    db::update_sqlite_from_json(config, progress_callback).map_err(|e| e.to_string())
}