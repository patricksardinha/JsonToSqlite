use crate::commands::ImportProgress;
use crate::json::extract::{apply_mapping, extract_root_objects, get_value_by_path};
use rusqlite::{params_from_iter, Connection, Result as SqliteResult};
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;

/// Fonction principale pour mettre à jour des données SQLite à partir de JSON
pub fn update_sqlite_from_json_data<F>(
    json_path: &str,
    db_path: &str,
    json_root: &str,
    table_name: &str,
    key_column: &str,
    update_columns: &[String],
    mapping: &HashMap<String, String>,
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
    let root_objects = extract_root_objects(&json_data, json_root)?;

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

    // Vérification si la colonne clé est dans le mapping
    let mut key_found = false;
    for (_, col_name) in mapping {
        if col_name == key_column {
            key_found = true;
            break;
        }
    }

    if !key_found {
        return Err(format!(
            "La colonne clé {} n'a pas été trouvée dans le mapping",
            key_column
        ));
    }

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

    // Vérification de l'existence de la table et des colonnes
    let table_info = match conn.prepare(&format!("PRAGMA table_info({})", table_name)) {
        Ok(mut stmt) => {
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(1)?, // name
                        row.get::<_, String>(2)?, // type
                    ))
                })
                .map_err(|e| e.to_string())?;

            let result = rows.collect::<Result<Vec<_>, _>>();
            match result {
                Ok(info) => info,
                Err(e) => {
                    return Err(format!(
                        "Erreur lors de la lecture des informations de table: {}",
                        e
                    ))
                }
            }
        }
        Err(e) => return Err(format!("Erreur lors de la vérification de la table: {}", e)),
    };

    if table_info.is_empty() {
        return Err(format!(
            "La table {} n'existe pas dans la base de données",
            table_name
        ));
    }

    // Vérifier si la colonne clé existe
    let key_exists = table_info.iter().any(|(name, _)| name == key_column);
    if !key_exists {
        return Err(format!(
            "La colonne clé {} n'existe pas dans la table {}",
            key_column, table_name
        ));
    }

    // Vérifier si les colonnes à mettre à jour existent
    let table_columns: Vec<String> = table_info.iter().map(|(name, _)| name.clone()).collect();

    let missing_columns: Vec<&String> = update_columns
        .iter()
        .filter(|col| !table_columns.contains(col))
        .collect();

    if !missing_columns.is_empty() {
        return Err(format!(
            "Les colonnes suivantes n'existent pas dans la table: {}",
            missing_columns
                .iter()
                .map(|s| s.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }

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

    // Traitement des objets
    current_progress.status = "Mise à jour des données...".to_string();
    progress_callback(current_progress.clone());

    let mut success_count = 0;
    let mut error_count = 0;
    let mut not_found_count = 0;

    for (index, obj) in root_objects.iter().enumerate() {
        current_progress.processed += 1;

        // Application du mapping
        let mapped_data = apply_mapping(obj, mapping);

        // Récupération de la valeur de clé
        let key_value = match mapped_data.get(key_column) {
            Some(Some(val)) => val.clone(),
            _ => {
                error_count += 1;
                current_progress.failed += 1;
                eprintln!("Erreur: Valeur de clé manquante pour l'objet {}", index);
                continue;
            }
        };

        // Vérifier si la ligne existe
        let check_query = format!(
            "SELECT COUNT(*) FROM {} WHERE {} = ?",
            table_name, key_column
        );

        // Pour une valeur JSON String
        let key_value_string = match &key_value {
            JsonValue::String(s) => s.clone(),
            _ => key_value.to_string(),
        };

        let count: i64 = match tx.query_row(&check_query, [&key_value_string], |row| row.get(0)) {
            Ok(c) => c,
            Err(e) => {
                error_count += 1;
                current_progress.failed += 1;
                eprintln!(
                    "Erreur lors de la vérification de l'existence de la ligne: {}",
                    e
                );
                continue;
            }
        };

        if count == 0 {
            not_found_count += 1;
            current_progress.failed += 1;
            eprintln!("Ligne non trouvée: {} = {:?}", key_column, key_value);
            continue;
        }

        // Construction de la requête UPDATE
        let mut set_clauses = Vec::new();
        let mut update_values = Vec::new();

        for column in update_columns {
            if let Some(Some(value)) = mapped_data.get(column) {
                set_clauses.push(format!("{} = ?", column));
                update_values.push(value.clone());
            }
        }

        // Si on n'a aucune colonne à mettre à jour, on passe à l'item suivant
        if set_clauses.is_empty() {
            not_found_count += 1;
            current_progress.failed += 1;
            eprintln!(
                "Aucune colonne à mettre à jour pour {} = {:?}",
                key_column, key_value
            );
            continue;
        }

        // Ajout de la valeur de clé pour la clause WHERE
        update_values.push(key_value.clone());

        let update_query = format!(
            "UPDATE {} SET {} WHERE {} = ?",
            table_name,
            set_clauses.join(", "),
            key_column
        );

        // Conversion des valeurs JsonValue en rusqlite::types::Value
        let params: Vec<_> = update_values
            .iter()
            .map(|val| match val {
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
            })
            .collect();

        // Exécution de la requête UPDATE
        match tx.execute(&update_query, params_from_iter(params.iter())) {
            Ok(updated) => {
                if updated > 0 {
                    success_count += 1;
                    current_progress.succeeded += 1;
                } else {
                    error_count += 1;
                    current_progress.failed += 1;
                    eprintln!(
                        "Aucune ligne mise à jour pour {} = {:?}",
                        key_column, key_value
                    );
                }
            }
            Err(e) => {
                error_count += 1;
                current_progress.failed += 1;
                eprintln!("Erreur lors de la mise à jour: {}", e);
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

    // Commit de la transaction
    match tx.commit() {
        Ok(_) => {}
        Err(e) => return Err(format!("Erreur lors du commit de la transaction: {}", e)),
    }

    // Finalisation
    current_progress.status = format!(
        "Mise à jour terminée. Succès: {}, Échecs: {}, Non trouvés: {}",
        success_count, error_count, not_found_count
    );
    progress_callback(current_progress.clone());

    Ok(current_progress)
}
