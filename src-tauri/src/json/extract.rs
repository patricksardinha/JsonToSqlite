use serde_json::Value as JsonValue;
use std::collections::HashMap;

/// Extrait les objets à la racine spécifiée dans un fichier JSON
pub fn extract_root_objects(
    json_data: &JsonValue,
    root_path: &str,
) -> Result<Vec<JsonValue>, String> {
    if root_path.is_empty() {
        // Si le chemin est vide, on considère que les données sont directement à la racine
        match json_data {
            JsonValue::Array(arr) => Ok(arr.clone()),
            JsonValue::Object(_) => Ok(vec![json_data.clone()]),
            _ => Err("La racine JSON n'est ni un objet ni un tableau".to_string()),
        }
    } else {
        // Parse le chemin pour extraire les segments
        let path_segments: Vec<&str> = root_path.split('.').collect();

        // Appel récursif pour extraire les objets
        process_segment(json_data, &path_segments, 0)
    }
}

/// Traitement récursif pour extraire les données selon le chemin spécifié
fn process_segment(
    data: &JsonValue,
    segments: &[&str],
    current_index: usize,
) -> Result<Vec<JsonValue>, String> {
    if current_index >= segments.len() {
        return Ok(vec![data.clone()]);
    }

    let mut segment = segments[current_index];
    let is_array = segment.ends_with("[]");

    if is_array {
        // Si le segment est un tableau, on supprime les crochets de la fin
        segment = &segment[0..segment.len() - 2];

        match data {
            JsonValue::Object(obj) => {
                if let Some(array_value) = obj.get(segment) {
                    match array_value {
                        JsonValue::Array(arr) => {
                            let mut all_results = Vec::new();

                            for item in arr {
                                if current_index == segments.len() - 1 {
                                    // C'est le dernier segment et c'est un tableau, on ajoute chaque élément directement
                                    all_results.push(item.clone());
                                } else {
                                    // C'est un tableau intermédiaire, on traite les éléments suivants
                                    let item_results =
                                        process_segment(item, segments, current_index + 1)?;
                                    all_results.extend(item_results);
                                }
                            }

                            Ok(all_results)
                        }
                        _ => Err(format!("La propriété '{}' n'est pas un tableau", segment)),
                    }
                } else {
                    Err(format!(
                        "La propriété '{}' n'existe pas dans les données JSON",
                        segment
                    ))
                }
            }
            _ => Err(format!(
                "Impossible de naviguer dans les données JSON: attendu un objet, trouvé {:?}",
                data
            )),
        }
    } else {
        match data {
            JsonValue::Object(obj) => {
                if let Some(value) = obj.get(segment) {
                    process_segment(value, segments, current_index + 1)
                } else {
                    Err(format!(
                        "La propriété '{}' n'existe pas dans les données JSON",
                        segment
                    ))
                }
            }
            _ => Err(format!(
                "Impossible de naviguer dans les données JSON: attendu un objet, trouvé {:?}",
                data
            )),
        }
    }
}

/// Récupère la valeur à partir d'un chemin dans un objet
pub fn get_value_by_path(obj: &JsonValue, path: &str) -> Option<JsonValue> {
    if path.is_empty() {
        return Some(obj.clone());
    }

    let parts: Vec<&str> = path.split('.').collect();
    let mut current = obj;

    for part in parts {
        match current {
            JsonValue::Object(map) => {
                if let Some(val) = map.get(part) {
                    current = val;
                } else {
                    return None; // Le champ n'existe pas
                }
            }
            _ => return None, // Ce n'est pas un objet, impossible de naviguer plus loin
        }
    }

    Some(current.clone())
}

/// Applique un mapping à un objet JSON pour créer un dictionnaire de colonnes/valeurs
pub fn apply_mapping(
    obj: &JsonValue,
    mapping: &HashMap<String, String>,
) -> HashMap<String, Option<JsonValue>> {
    let mut result = HashMap::new();

    for (json_path, column_name) in mapping {
        let value = get_value_by_path(obj, json_path);
        result.insert(column_name.clone(), value);
    }

    result
}
