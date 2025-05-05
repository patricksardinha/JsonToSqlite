use crate::commands::JsonPathInfo;
use serde_json::{json, Map, Value as JsonValue};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::Path;
use tauri::Window;
use tauri::Emitter;

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

/// Analyse la structure d'un fichier JSON et envoie les chemins progressivement via un événement
pub fn analyze_structure_progressive(json_path: &str, window: Window) -> Result<(), String> {
    // Lecture du fichier JSON
    let json_data = read_json_file(json_path)?;
    
    // Partager json_data entre deux threads
    let json_data = std::sync::Arc::new(json_data);
    
    // Clone pour le premier thread
    let json_data_clone1 = json_data.clone();

    // Créer un canal pour envoyer les chemins progressivement
    let (tx, rx) = std::sync::mpsc::channel();
    
    // Lancer l'extraction dans un thread dédié
    std::thread::spawn(move || {
        // Utiliser une fonction modifiée qui envoie les chemins via le canal
        let mut sent_paths = std::collections::HashSet::new();
        extract_paths_progressive("", &*json_data_clone1, tx, 0, &mut sent_paths);
    });
    
    // Clone pour le second thread
    let json_data_clone2 = json_data.clone();
    
    // Clone de la window pour le second thread
    let window_clone = window.clone();
    
    // Traiter les chemins reçus et les envoyer à l'interface
    std::thread::spawn(move || {
        let mut count = 0;
        for path in rx {
            count += 1;
            
            // Extraire un échantillon de valeur pour ce chemin
            let value = get_value_by_path(&json_data_clone2, &path);
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
            
            let truncated_sample = if sample.len() > 50 {
                let truncated = truncate_utf8_string(&sample, 47);
                format!("{}...", truncated)
            } else {
                sample
            };
            
            // Créer l'objet JsonPathInfo
            let path_info = JsonPathInfo {
                path,
                data_type: data_type.to_string(),
                sample: truncated_sample,
            };
            
            // Envoyer l'événement à l'interface
            let _ = window_clone.emit("json-path-discovered", &path_info);
            
            // Pour éviter de surcharger l'interface, on peut regrouper les envois
            if count % 10 == 0 {
                std::thread::sleep(std::time::Duration::from_millis(1));
            }
        }
        
        // Envoyer un événement de fin d'analyse
        let _ = window_clone.emit("json-path-analysis-complete", ());
    });
    
    Ok(())
}

/// Version modifiée d'extract_paths qui envoie les chemins via un canal
fn extract_paths_progressive(prefix: &str, value: &JsonValue, sender: std::sync::mpsc::Sender<String>, depth: usize, sent_paths: &mut std::collections::HashSet<String>) {
    // Limite de profondeur pour éviter les récursions infinies
    if depth > 10 {
        return;
    }

    // Ajout d'un délai artificiel pour les tests
    //std::thread::sleep(std::time::Duration::from_millis(50));

    match value {
        JsonValue::Object(map) => {
            // Ajoute le chemin actuel
            if !prefix.is_empty() && !sent_paths.contains(prefix) {
                let _ = sender.send(prefix.to_string());
                sent_paths.insert(prefix.to_string());
            }

            // Parcourt les propriétés de l'objet
            for (key, val) in map {
                let new_prefix = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{}.{}", prefix, key)
                };

                extract_paths_progressive(&new_prefix, val, sender.clone(), depth + 1, sent_paths);
            }
        }
        JsonValue::Array(arr) => {
            // Ajoute le chemin actuel avec notation tableau
            let array_path = format!("{}[]", prefix);
            if !prefix.is_empty() && !sent_paths.contains(&array_path) {
                let _ = sender.send(array_path.clone());
                sent_paths.insert(array_path.clone());
            }

            // Si l'array n'est pas vide, analyse UNIQUEMENT le premier élément
            if !arr.is_empty() {
                match &arr[0] {
                    JsonValue::Object(inner_map) => {
                        for (key, val) in inner_map {
                            let new_prefix = format!("{}.{}", array_path, key);
                            if !sent_paths.contains(&new_prefix) {
                                let _ = sender.send(new_prefix.clone());
                                sent_paths.insert(new_prefix.clone());
                            }
                        }
                    },
                    // Pour les tableaux imbriqués, on continue avec une nouvelle notation tableau
                    JsonValue::Array(_) => {
                        let nested_array_path = format!("{}[]", array_path);
                        extract_paths_progressive(&array_path, &arr[0], sender.clone(), depth + 1, sent_paths);
                    },
                    // Pour les valeurs primitives, on ne fait rien de plus car le chemin a déjà été ajouté
                    _ => {}
                }
            }
        }
        _ => {
            // Pour les valeurs simples, ajoute simplement le chemin
            if !prefix.is_empty() && !sent_paths.contains(prefix) {
                let _ = sender.send(prefix.to_string());
                sent_paths.insert(prefix.to_string());
            }
        }
    }
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
