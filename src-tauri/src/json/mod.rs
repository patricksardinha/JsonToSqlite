use crate::commands::JsonPathInfo;
use serde_json::{json, Map, Value as JsonValue};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::Path;

pub mod extract;

use extract::extract_root_objects;

/// Analyse la structure d'un fichier JSON et retourne les chemins possibles
pub fn analyze_structure(json_path: &str) -> Result<Vec<JsonPathInfo>, String> {
    // Lecture du fichier JSON
    let json_data = read_json_file(json_path)?;

    // Extraction des chemins JSON
    let mut paths = Vec::new();
    extract_paths("", &json_data, &mut paths, 0);

    // Conversion des chemins en JsonPathInfo
    let mut result = Vec::new();
    for path in paths {
        let value = get_value_by_path(&json_data, &path);
        let sample = match value {
            Some(v) => format!("{}", v),
            None => String::from(""),
        };

        let data_type = match value {
            Some(JsonValue::Null) => "null",
            Some(JsonValue::Bool(_)) => "boolean",
            Some(JsonValue::Number(_)) => "number",
            Some(JsonValue::String(_)) => "string",
            Some(JsonValue::Array(_)) => "array",
            Some(JsonValue::Object(_)) => "object",
            None => "unknown",
        };

        result.push(JsonPathInfo {
            path,
            data_type: data_type.to_string(),
            sample: if sample.len() > 50 {
                // Tronquer la chaîne de manière sécurisée pour l'UTF-8
                let truncated_sample = truncate_utf8_string(&sample, 47);
                format!("{}...", truncated_sample)
            } else {
                sample
            },
        });
    }

    Ok(result)
}

pub fn truncate_utf8_string(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    
    // Prendre les premiers 'max_chars' caractères (pas octets)
    s.chars().take(max_chars).collect()
}

/// Récupère un échantillon d'objets depuis un chemin JSON
pub fn get_sample(
    json_path: &str,
    json_root: &str,
    limit: Option<u32>,
) -> Result<Vec<JsonValue>, String> {
    // Lecture du fichier JSON
    let json_data = read_json_file(json_path)?;

    // Extraction des objets à la racine spécifiée
    let mut objects = extract_root_objects(&json_data, json_root)?;

    // Application de la limite si spécifiée
    if let Some(limit_val) = limit {
        objects.truncate(limit_val as usize);
    }

    Ok(objects)
}

/// Lit un fichier JSON et retourne sa représentation en mémoire
fn read_json_file(file_path: &str) -> Result<JsonValue, String> {
    let path = Path::new(file_path);

    // Ouvrir le fichier
    let mut file = File::open(path)
        .map_err(|e| format!("Erreur lors de l'ouverture du fichier {}: {}", file_path, e))?;

    // Lire le contenu
    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|e| format!("Erreur lors de la lecture du fichier {}: {}", file_path, e))?;

    // Parser le JSON
    serde_json::from_str(&content).map_err(|e| format!("Erreur lors du parsing JSON: {}", e))
}

/// Extrait les chemins possibles à partir d'une valeur JSON
fn extract_paths(prefix: &str, value: &JsonValue, paths: &mut Vec<String>, depth: usize) {
    // Limite de profondeur pour éviter les récursions infinies
    if depth > 10 {
        return;
    }

    match value {
        JsonValue::Object(map) => {
            // Ajoute le chemin actuel
            if !prefix.is_empty() {
                paths.push(prefix.to_string());
            }

            // Parcourt les propriétés de l'objet
            for (key, val) in map {
                let new_prefix = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{}.{}", prefix, key)
                };

                extract_paths(&new_prefix, val, paths, depth + 1);
            }
        }
        JsonValue::Array(arr) => {
            // Ajoute le chemin actuel avec notation tableau
            if !prefix.is_empty() {
                paths.push(format!("{}[]", prefix));
            }

            // Si l'array n'est pas vide, analyse le premier élément pour trouver la structure
            if !arr.is_empty() {
                extract_paths(&format!("{}[]", prefix), &arr[0], paths, depth + 1);
            }
        }
        _ => {
            // Pour les valeurs simples, ajoute simplement le chemin
            if !prefix.is_empty() {
                paths.push(prefix.to_string());
            }
        }
    }
}

/// Récupère une valeur à partir d'un chemin dans un objet JSON
fn get_value_by_path<'a>(obj: &'a JsonValue, path: &str) -> Option<&'a JsonValue> {
    if path.is_empty() {
        return Some(obj);
    }

    let parts: Vec<&str> = path.split('.').collect();
    let mut current = obj;

    for (i, part) in parts.iter().enumerate() {
        let is_array = part.ends_with("[]");
        let part_name = if is_array {
            &part[0..part.len() - 2]
        } else {
            part
        };

        if let JsonValue::Object(map) = current {
            if let Some(val) = map.get(part_name) {
                if is_array {
                    if let JsonValue::Array(arr) = val {
                        if arr.is_empty() {
                            return None;
                        }

                        // Pour un tableau, on retourne le premier élément
                        if i == parts.len() - 1 {
                            return Some(&arr[0]);
                        } else {
                            current = &arr[0];
                        }
                    } else {
                        return None; // La partie n'est pas un tableau
                    }
                } else {
                    if i == parts.len() - 1 {
                        return Some(val);
                    } else {
                        current = val;
                    }
                }
            } else {
                return None; // La partie n'existe pas dans l'objet
            }
        } else {
            return None; // L'élément actuel n'est pas un objet
        }
    }

    Some(current)
}
