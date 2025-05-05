use crate::commands::{ColumnInfo, ImportConfig, ImportProgress, TableInfo, UpdateConfig};
use chrono::Utc;
use rusqlite::{Connection, Result as SqliteResult, Row};
use serde_json::{json, Map, Value as JsonValue};
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use uuid::Uuid;

pub mod insert;
pub mod update;

use insert::insert_json_data;
use update::update_sqlite_from_json_data;

/// Récupère la liste des tables d'une base de données SQLite
pub fn get_tables(db_path: &str) -> Result<Vec<String>, rusqlite::Error> {
    let conn = Connection::open(db_path)?;

    let mut stmt = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )?;
    let table_names = stmt
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<String>, _>>()?;

    Ok(table_names)
}

/// Analyse la structure d'une table SQLite de manière robuste
pub fn analyze_table(db_path: &str, table_name: &str) -> Result<TableInfo, String> {
    let conn = match Connection::open(db_path) {
        Ok(conn) => conn,
        Err(e) => return Err(format!("Erreur à l'ouverture de la base de données: {}", e)),
    };

    // Récupération des informations sur les colonnes avec une requête SQL directe au lieu de PRAGMA
    let query = format!(
        "SELECT * FROM pragma_table_info('{}') ORDER BY cid",
        table_name.replace("'", "''") // Échapper les apostrophes 
    );

    let mut columns = Vec::new();
    
    // Utilisation d'un bloc pour limiter la portée de stmt et rows
    {
        let mut stmt = match conn.prepare(&query) {
            Ok(stmt) => stmt,
            Err(e) => return Err(format!("Erreur lors de la préparation de la requête: {}", e)),
        };

        let mut rows = match stmt.query([]) {
            Ok(rows) => rows,
            Err(e) => return Err(format!("Erreur lors de l'exécution de la requête: {}", e)),
        };

        while let Ok(Some(row)) = rows.next() {
            // Lecture de chaque colonne avec gestion explicite des erreurs
            let name = match row.get::<_, String>(1) {
                Ok(value) => value,
                Err(e) => return Err(format!("Erreur lors de la lecture du nom de colonne: {}", e)),
            };
            
            let data_type = match row.get::<_, String>(2) {
                Ok(value) => value,
                Err(e) => return Err(format!("Erreur lors de la lecture du type de données: {}", e)),
            };
            
            let not_null = match row.get::<_, i32>(3) {
                Ok(value) => value == 1,
                Err(e) => return Err(format!("Erreur lors de la lecture de la contrainte NOT NULL: {}", e)),
            };
            
            let primary_key = match row.get::<_, i32>(5) {
                Ok(value) => value == 1,
                Err(e) => return Err(format!("Erreur lors de la lecture de la clé primaire: {}", e)),
            };
            
            let default_value = match row.get_ref(4) {
                Ok(cell) if cell.data_type() == rusqlite::types::Type::Null => None,
                Ok(cell) => {
                    match cell.as_str() {
                        Ok(s) => Some(s.to_string()),
                        Err(_) => None,
                    }
                },
                Err(_) => None,
            };
            
            columns.push(ColumnInfo {
                name,
                data_type,
                not_null,
                primary_key,
                default_value,
            });
        }
    }
    
    if columns.is_empty() {
        return Err(format!("La table '{}' n'existe pas ou est vide", table_name));
    }

    // Récupération des contraintes d'unicité
    let mut unique_constraints = Vec::new();
    
    let index_query = format!(
        "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='{}'",
        table_name.replace("'", "''")
    );
    
    let mut stmt = match conn.prepare(&index_query) {
        Ok(stmt) => stmt,
        Err(e) => return Err(format!("Erreur lors de la préparation de la requête d'index: {}", e)),
    };
    
    let indices = match stmt.query_map([], |row| -> rusqlite::Result<(String, Option<String>)> {
        let name: String = row.get(0)?;
        let sql: Option<String> = row.get(1)?;
        Ok((name, sql))
    }) {
        Ok(indices) => indices,
        Err(e) => return Err(format!("Erreur lors de la récupération des index: {}", e)),
    };
    
    for index_result in indices {
        match index_result {
            Ok((index_name, sql_opt)) => {
                // Vérifie si l'index est UNIQUE en analysant le SQL
                let is_unique = sql_opt.map_or(false, |sql| sql.to_uppercase().contains("UNIQUE"));
                
                if is_unique {
                    let index_info_query = format!(
                        "SELECT * FROM pragma_index_info('{}')",
                        index_name.replace("'", "''")
                    );
                    
                    let mut index_stmt = match conn.prepare(&index_info_query) {
                        Ok(stmt) => stmt,
                        Err(e) => {
                            eprintln!("Erreur lors de la préparation de la requête d'info d'index: {}", e);
                            continue;
                        }
                    };
                    
                    let mut index_columns = Vec::new();
                    
                    {
                        let mut rows = match index_stmt.query([]) {
                            Ok(rows) => rows,
                            Err(e) => {
                                eprintln!("Erreur lors de l'exécution de la requête d'info d'index: {}", e);
                                continue;
                            }
                        };
                        
                        while let Ok(Some(row)) = rows.next() {
                            match (row.get::<_, i32>(1), row.get::<_, String>(2)) {
                                (Ok(column_idx), Ok(column_name)) => {
                                    index_columns.push((column_idx, column_name));
                                },
                                _ => {
                                    eprintln!("Erreur lors de la lecture des informations de colonne d'index");
                                    continue;
                                }
                            }
                        }
                    }
                    
                    // Tri par ordre d'index
                    index_columns.sort_by_key(|(idx, _)| *idx);
                    
                    unique_constraints.push(
                        index_columns
                            .into_iter()
                            .map(|(_, name)| name)
                            .collect::<Vec<_>>(),
                    );
                }
            },
            Err(e) => {
                eprintln!("Erreur lors de la récupération d'un index: {}", e);
                continue;
            }
        }
    }

    Ok(TableInfo {
        columns,
        unique_constraints,
    })
}

/// Fonction principale pour importer des données JSON dans SQLite
pub fn import_json_to_sqlite<F>(
    config: ImportConfig,
    progress_callback: F,
) -> Result<ImportProgress, String>
where
    F: Fn(ImportProgress) + Send + 'static,
{
    // Conversion du type ImportConfig en paramètres pour la fonction insert_json_data
    insert_json_data(
        &config.json_path,
        &config.db_path,
        &config.json_root,
        &config.table_name,
        &config.mapping,
        config.defaults,
        config.forced,
        config.dynamic,
        config.limit,
        config.offset,
        config.dry_run,
        progress_callback,
    )
}

/// Fonction principale pour mettre à jour des données SQLite à partir de JSON
pub fn update_sqlite_from_json<F>(
    config: UpdateConfig,
    progress_callback: F,
) -> Result<ImportProgress, String>
where
    F: Fn(ImportProgress) + Send + 'static,
{
    // Conversion du type UpdateConfig en paramètres pour la fonction update_sqlite_from_json_data
    update_sqlite_from_json_data(
        &config.json_path,
        &config.db_path,
        &config.json_root,
        &config.table_name,
        &config.key_column,
        &config.update_columns,
        &config.mapping,
        config.dry_run,
        progress_callback,
    )
}