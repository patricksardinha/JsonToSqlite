use crate::commands::ImportProgress;
use crate::json::extract::{apply_mapping, extract_root_objects, get_value_by_path};
use chrono::Utc;
use rand::Rng;
use rusqlite::{params_from_iter, Connection, Result as SqliteResult, Row, Statement, Transaction};
use serde_json::{json, Map, Value as JsonValue};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use uuid::Uuid;

// Fonction utilitaire pour obtenir une colonne qui peut être NULL
fn get_optional_string(row: &Row, idx: usize) -> Option<String> {
    match row.get::<_, Option<String>>(idx) {
        Ok(value) => value,
        Err(_) => None,
    }
}

/// Génère une valeur dynamique selon le type SQLite et le nom de la colonne
fn generate_dynamic_value(data_type: &str, column_name: &str, index: usize) -> JsonValue {
    let data_type_lower = data_type.to_lowercase();
    let column_name_lower = column_name.to_lowercase();
    let mut rng = rand::thread_rng();

    if data_type_lower.contains("int") {
        JsonValue::Number((index as i64 + 1000).into())
    } else if data_type_lower.contains("text") || data_type_lower.contains("char") {
        if column_name_lower.contains("id") || column_name_lower.contains("code") {
            JsonValue::String(format!(
                "{}_{}_{}",
                column_name[0..std::cmp::min(3, column_name.len())].to_uppercase(),
                Utc::now().timestamp_millis(),
                index
            ))
        } else if column_name_lower.contains("email") {
            JsonValue::String(format!("user{}@example.com", index))
        } else if column_name_lower.contains("name") {
            JsonValue::String(format!("Name_{}", index))
        } else if column_name_lower.contains("title") {
            JsonValue::String(format!("Title {}", index))
        } else if column_name_lower.contains("description") {
            JsonValue::String(format!("Description for item {}", index))
        } else {
            JsonValue::String(format!("{}_{:x}_{}", column_name, rng.gen::<u32>(), index))
        }
    } else if data_type_lower.contains("real")
        || data_type_lower.contains("float")
        || data_type_lower.contains("double")
    {
        JsonValue::Number(serde_json::Number::from_f64(rng.gen::<f64>() * 100.0).unwrap())
    } else if data_type_lower.contains("date") || data_type_lower.contains("time") {
        // Format ISO pour les dates
        let now = Utc::now();
        JsonValue::String(now.format("%Y-%m-%d").to_string())
    } else if data_type_lower.contains("bool") {
        JsonValue::Bool(index % 2 == 0)
    } else {
        // Valeur par défaut pour les autres types
        JsonValue::String(format!("{}_{}", column_name, index))
    }
}

/// Structure pour stocker les informations sur une colonne
#[derive(Debug, Clone)]
struct ColumnMetadata {
    name: String,
    data_type: String,
    not_null: bool,
    primary_key: bool,
    default_value: Option<String>,
}

/// Fonction principale pour importer des données JSON dans SQLite
pub fn insert_json_data<F>(
    json_path: &str,
    db_path: &str,
    json_root: &str,
    table_name: &str,
    mapping: &HashMap<String, String>,
    defaults: Option<HashMap<String, JsonValue>>,
    forced: Option<HashMap<String, JsonValue>>,
    dynamic: Option<HashMap<String, String>>,
    limit: Option<u32>,
    offset: Option<u32>,
    dry_run: bool,
    progress_callback: F,
) -> Result<ImportProgress, String>
where
    F: Fn(ImportProgress) + Send + 'static,
{
    // Lecture du fichier JSON
    let json_content = std::fs::read_to_string(json_path)
        .map_err(|e| format!("Erreur de lecture du fichier JSON: {}", e))?;

    let json_data: JsonValue = serde_json::from_str(&json_content)
        .map_err(|e| format!("Erreur de parsing JSON: {}", e))?;

    // Extraction des objets à la racine spécifiée
    let mut root_objects = extract_root_objects(&json_data, json_root)?;

    // Application de offset et limit
    let offset_val = offset.unwrap_or(0) as usize;
    if offset_val > 0 && offset_val < root_objects.len() {
        root_objects = root_objects[offset_val..].to_vec();
    }

    if let Some(limit_val) = limit {
        let limit_usize = limit_val as usize;
        if limit_usize > 0 && limit_usize < root_objects.len() {
            root_objects.truncate(limit_usize);
        }
    }

    let total_objects = root_objects.len();

    // Création du progress initial
    let mut current_progress = ImportProgress {
        total: total_objects as u32,
        processed: 0,
        succeeded: 0,
        failed: 0,
        status: "Préparation...".to_string(),
    };

    // Appel du callback pour notifier le début du processus
    progress_callback(current_progress.clone());

    // En mode dry run, on ne fait rien de plus
    if dry_run {
        current_progress.status = "Simulation terminée (dry run)".to_string();
        progress_callback(current_progress.clone());
        return Ok(current_progress);
    }

    // Connexion à la base de données
    let mut conn = match Connection::open(db_path) {
        Ok(c) => c,
        Err(e) => return Err(format!("Erreur de connexion à la base de données: {}", e)),
    };

    // Récupération des métadonnées de la table
    current_progress.status = "Analyse de la structure de la table...".to_string();
    progress_callback(current_progress.clone());

    let table_columns = match get_table_columns(&conn, table_name) {
        Ok(c) => c,
        Err(e) => return Err(format!("Erreur lors de l'analyse de la table: {}", e)),
    };

    // Récupération des contraintes d'unicité
    let unique_columns = match get_unique_columns(&conn, table_name) {
        Ok(c) => c,
        Err(e) => {
            return Err(format!(
                "Erreur lors de l'analyse des contraintes d'unicité: {}",
                e
            ))
        }
    };

    // Vérification des colonnes NOT NULL
    let not_null_columns: Vec<&ColumnMetadata> = table_columns
        .iter()
        .filter(|c| c.not_null && !c.primary_key && c.default_value.is_none())
        .collect();

    // Récupération de toutes les colonnes existantes dans la table
    let all_column_names: HashSet<String> = table_columns.iter().map(|c| c.name.clone()).collect();

    // Identification des colonnes à inclure dans l'insertion
    let mut all_mapped_columns = HashSet::new();

    // Ajout des colonnes du mapping
    for col in mapping.values() {
        all_mapped_columns.insert(col.clone());
    }

    // Ajout des colonnes par défaut
    if let Some(ref def) = defaults {
        for col in def.keys() {
            all_mapped_columns.insert(col.clone());
        }
    }

    // Ajout des colonnes forcées
    if let Some(ref force) = forced {
        for col in force.keys() {
            all_mapped_columns.insert(col.clone());
        }
    }

    // Ajout des colonnes dynamiques
    if let Some(ref dyn_cols) = dynamic {
        for col in dyn_cols.keys() {
            all_mapped_columns.insert(col.clone());
        }
    }

    // Filtrer pour ne garder que les colonnes qui existent dans la table
    let columns_to_include: Vec<String> = all_mapped_columns
        .into_iter()
        .filter(|col| all_column_names.contains(col))
        .collect();

    // Vérification si toutes les colonnes NOT NULL sont couvertes
    let missing_required_columns: Vec<String> = not_null_columns
        .iter()
        .filter(|col| !columns_to_include.contains(&col.name))
        .map(|col| col.name.clone())
        .collect();

    if !missing_required_columns.is_empty() {
        return Err(format!(
            "Colonnes avec contrainte NOT NULL sans valeur par défaut ni mapping: {}",
            missing_required_columns.join(", ")
        ));
    }

    // Préparation pour l'insertion
    current_progress.status = "Préparation de l'insertion...".to_string();
    progress_callback(current_progress.clone());

    // Construction de la requête d'insertion
    let placeholders = columns_to_include
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(", ");

    let insert_query = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        table_name,
        columns_to_include.join(", "),
        placeholders
    );

    // Démarrage de la transaction
    let tx = match conn.transaction() {
        Ok(t) => t,
        Err(e) => {
            return Err(format!(
                "Erreur lors de la création de la transaction: {}",
                e
            ))
        }
    };

    // Préparation du statement
    let mut stmt = match tx.prepare(&insert_query) {
        Ok(s) => s,
        Err(e) => {
            return Err(format!(
                "Erreur lors de la préparation de la requête: {}",
                e
            ))
        }
    };

    // Traitement des objets
    current_progress.status = "Insertion des données...".to_string();
    progress_callback(current_progress.clone());

    let mut success_count = 0;
    let mut error_count = 0;

    for (index, obj) in root_objects.iter().enumerate() {
        current_progress.processed += 1;

        // Application du mapping
        let mut mapped_data = apply_mapping(obj, mapping);

        // Application des valeurs par défaut (seulement si la valeur est null/undefined)
        if let Some(ref def) = defaults {
            for (col_name, default_value) in def {
                if !mapped_data.contains_key(col_name) || mapped_data[col_name].is_none() {
                    if default_value.as_str() == Some("{{DYNAMIC}}") {
                        // Générer une valeur dynamique selon le type de la colonne
                        if let Some(col_info) = table_columns.iter().find(|c| c.name == *col_name) {
                            mapped_data.insert(
                                col_name.clone(),
                                Some(generate_dynamic_value(&col_info.data_type, col_name, index)),
                            );
                        } else {
                            mapped_data.insert(
                                col_name.clone(),
                                Some(JsonValue::String(format!("{}_{}", col_name, index))),
                            );
                        }
                    } else {
                        mapped_data.insert(col_name.clone(), Some(default_value.clone()));
                    }
                }
            }
        }

        // Application des valeurs forcées (remplacent toujours les valeurs existantes)
        if let Some(ref force) = forced {
            for (col_name, forced_value) in force {
                if forced_value.as_str() == Some("{{DYNAMIC}}") {
                    // Générer une valeur dynamique selon le type de la colonne
                    if let Some(col_info) = table_columns.iter().find(|c| c.name == *col_name) {
                        mapped_data.insert(
                            col_name.clone(),
                            Some(generate_dynamic_value(&col_info.data_type, col_name, index)),
                        );
                    } else {
                        mapped_data.insert(
                            col_name.clone(),
                            Some(JsonValue::String(format!("{}_{}", col_name, index))),
                        );
                    }
                } else {
                    mapped_data.insert(col_name.clone(), Some(forced_value.clone()));
                }
            }
        }

        // Application des templates personnalisés
        if let Some(ref dyn_templates) = dynamic {
            for (col_name, template) in dyn_templates {
                let mut value = template.clone();

                // Remplacement des placeholders
                if template.contains("{{INDEX}}") {
                    value = value.replace("{{INDEX}}", &index.to_string());
                }

                if template.contains("{{UUID}}") {
                    value = value.replace("{{UUID}}", &Uuid::new_v4().to_string());
                }

                if template.contains("{{TIMESTAMP}}") {
                    value =
                        value.replace("{{TIMESTAMP}}", &Utc::now().timestamp_millis().to_string());
                }

                mapped_data.insert(col_name.clone(), Some(JsonValue::String(value)));
            }
        }

        // Traitement spécial pour les colonnes avec contrainte UNIQUE + NOT NULL sans valeur
        for unique_col in &unique_columns {
            if let Some(col_info) = table_columns.iter().find(|c| c.name == *unique_col) {
                if col_info.not_null
                    && (!mapped_data.contains_key(unique_col) || mapped_data[unique_col].is_none())
                {
                    // Générer une valeur unique
                    mapped_data.insert(
                        unique_col.clone(),
                        Some(generate_dynamic_value(
                            &col_info.data_type,
                            unique_col,
                            index,
                        )),
                    );
                }
            }
        }

        // Préparation des valeurs à insérer
        let mut params = Vec::new();

        for col in &columns_to_include {
            let value = if let Some(Some(val)) = mapped_data.get(col) {
                match val {
                    JsonValue::Null => rusqlite::types::Value::Null,
                    JsonValue::Bool(b) => rusqlite::types::Value::Integer(*b as i64),
                    JsonValue::Number(n) => {
                        if n.is_i64() {
                            rusqlite::types::Value::Integer(n.as_i64().unwrap())
                        } else {
                            rusqlite::types::Value::Real(n.as_f64().unwrap())
                        }
                    }
                    JsonValue::String(s) => rusqlite::types::Value::Text(s.clone()),
                    JsonValue::Array(_) | JsonValue::Object(_) => {
                        rusqlite::types::Value::Text(val.to_string())
                    }
                }
            } else {
                rusqlite::types::Value::Null
            };

            params.push(value);
        }

        // Exécution de la requête
        match stmt.execute(params_from_iter(params.iter())) {
            Ok(_) => {
                success_count += 1;
                current_progress.succeeded += 1;
            }
            Err(e) => {
                error_count += 1;
                current_progress.failed += 1;
                eprintln!("Erreur lors de l'insertion de l'objet {}: {}", index, e);
            }
        }

        // Mise à jour du progrès tous les 10 éléments ou à la fin
        if current_progress.processed % 10 == 0
            || current_progress.processed == current_progress.total
        {
            current_progress.status = format!(
                "Progression: {}/{} objets traités",
                current_progress.processed, current_progress.total
            );
            progress_callback(current_progress.clone());
        }
    }
    drop(stmt); // Ceci libère l'emprunt

    // Commit de la transaction
    match tx.commit() {
        Ok(_) => {}
        Err(e) => return Err(format!("Erreur lors du commit de la transaction: {}", e)),
    }

    // Finalisation
    current_progress.status = format!(
        "Importation terminée. Succès: {}, Échecs: {}",
        success_count, error_count
    );
    progress_callback(current_progress.clone());

    Ok(current_progress)
}

/// Récupère les métadonnées des colonnes d'une table
fn get_table_columns(conn: &Connection, table_name: &str) -> Result<Vec<ColumnMetadata>, String> {
    // Utilisation d'une requête SQL directe au lieu de PRAGMA pour plus de robustesse
    let query = format!(
        "SELECT * FROM pragma_table_info('{}') ORDER BY cid",
        table_name.replace("'", "''") // Échapper les apostrophes pour éviter les injections SQL
    );
    
    println!("Exécution de la requête: {}", query);
    
    let mut stmt = match conn.prepare(&query) {
        Ok(stmt) => stmt,
        Err(e) => return Err(format!("Erreur lors de la préparation de la requête: {}", e)),
    };

    let mut columns = Vec::new();
    
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
        
        columns.push(ColumnMetadata {
            name,
            data_type,
            not_null,
            primary_key,
            default_value,
        });
    }
    
    println!("Trouvé {} colonnes pour la table '{}'", columns.len(), table_name);
    
    if columns.is_empty() {
        return Err(format!("La table '{}' n'existe pas ou est vide", table_name));
    }

    Ok(columns)
}

/// Récupère les colonnes avec contrainte d'unicité
fn get_unique_columns(conn: &Connection, table_name: &str) -> Result<Vec<String>, String> {
    let mut unique_columns = Vec::new();

    // Utilisation d'une requête SQL directe pour récupérer les index
    let index_query = format!(
        "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='{}'",
        table_name.replace("'", "''")
    );
    
    let mut stmt = match conn.prepare(&index_query) {
        Ok(stmt) => stmt,
        Err(e) => return Err(format!("Erreur lors de la préparation de la requête d'index: {}", e)),
    };
    
    let indices_result = stmt.query_map([], |row| -> rusqlite::Result<(String, Option<String>)> {
        let name: String = row.get(0)?;
        let sql: Option<String> = row.get(1)?;
        Ok((name, sql))
    });
    
    let indices = match indices_result {
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
                    
                    if !index_columns.is_empty() {
                        // Tri par ordre d'index
                        index_columns.sort_by_key(|(idx, _)| *idx);
                        
                        let column_names = index_columns.into_iter().map(|(_, name)| name).collect::<Vec<_>>();
                        unique_columns.extend(column_names);
                    }
                }
            },
            Err(e) => {
                eprintln!("Erreur lors de la récupération d'un index: {}", e);
                continue;
            }
        }
    }

    // Éliminer les doublons
    unique_columns.sort();
    unique_columns.dedup();

    println!("Trouvé {} colonnes avec contrainte unique pour la table '{}'", unique_columns.len(), table_name);
    
    Ok(unique_columns)
}