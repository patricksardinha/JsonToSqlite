import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface MappingEditorProps {
  jsonFilePath: string;
  jsonRootPath: string;
  dbColumns: Array<{
    name: string;
    data_type: string;
    not_null: boolean;
    primary_key: boolean;
  }>;
  mapping: Record<string, string>;
  onMappingChange: (mapping: Record<string, string>) => void;
  isDarkMode?: boolean;
}

interface JsonPathInfo {
  path: string;
  data_type: string;
  sample: string;
}

const MappingEditor: React.FC<MappingEditorProps> = ({
  jsonFilePath,
  jsonRootPath,
  dbColumns,
  mapping,
  onMappingChange,
  isDarkMode = false
}) => {
  const [jsonPaths, setJsonPaths] = useState<JsonPathInfo[]>([]);
  const [samples, setSamples] = useState<Record<string, any>>({});
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Charger les chemins JSON pour l'autocomplétion
  useEffect(() => {
    if (!jsonFilePath) return;
    
    async function loadJsonPaths() {
      setIsLoading(true);
      setError(null);
      
      try {
        const result = await invoke<JsonPathInfo[]>('json_analyze_structure', { 
          jsonPath: jsonFilePath 
        });
        
        setJsonPaths(result);
      } catch (err) {
        setError(`Erreur de chargement des chemins JSON: ${err instanceof Error ? err.message : String(err)}`);
        setJsonPaths([]);
      } finally {
        setIsLoading(false);
      }
    }
    
    loadJsonPaths();
  }, [jsonFilePath]);

  // Récupérer des exemples de valeurs
  useEffect(() => {
    if (!jsonFilePath || !jsonRootPath) return;
    
    async function loadSamples() {
      try {
        const result = await invoke<any[]>('json_get_sample', { 
          jsonPath: jsonFilePath,
          jsonRoot: jsonRootPath,
          limit: 1
        });
        
        if (result && result.length > 0) {
          setSamples(result[0]);
        }
      } catch (err) {
        console.error("Erreur lors du chargement des échantillons:", err);
      }
    }
    
    loadSamples();
  }, [jsonFilePath, jsonRootPath]);

  // Générer un mapping automatique
  const generateAutoMapping = () => {
    const newMapping: Record<string, string> = {};
    
    dbColumns.forEach(column => {
      // Ne pas utiliser les chemins JSON complets, mais uniquement les noms de propriétés
      // simples qui correspondent aux colonnes de la base de données
      const matchingProperty = column.name.toLowerCase();
      
      // Si nous avons un échantillon, utilisons-le pour vérifier si la propriété existe
      if (samples && samples[matchingProperty] !== undefined) {
        newMapping[matchingProperty] = column.name;
        return;
      }
      
      // Sinon, cherchons dans les chemins JSON connus mais sans inclure le chemin racine
      const rootPrefix = jsonRootPath.endsWith('[]') 
        ? jsonRootPath.substring(0, jsonRootPath.length - 2) + '.'
        : jsonRootPath + '.';
        
      const matchingPaths = jsonPaths.filter(jp => {
        // Supprimer le préfixe du chemin racine s'il existe
        const normalizedPath = jp.path.startsWith(rootPrefix) 
          ? jp.path.substring(rootPrefix.length) 
          : jp.path;
          
        // Trouver un chemin qui correspond exactement ou contient le nom de la colonne
        return normalizedPath === matchingProperty || 
               normalizedPath.toLowerCase().includes(matchingProperty);
      });
      
      if (matchingPaths.length > 0) {
        // Utiliser la dernière partie du chemin seulement (après le chemin racine)
        const path = matchingPaths[0].path;
        const normalizedPath = path.startsWith(rootPrefix) 
          ? path.substring(rootPrefix.length) 
          : path;
          
        newMapping[normalizedPath] = column.name;
      }
    });
    
    onMappingChange(newMapping);
  };

  // Récupérer la valeur d'exemple pour un chemin JSON
  const getSampleValue = (jsonPath: string) => {
    if (!samples) return 'N/A';
    
    try {
      // Si le chemin est simple (sans points), chercher directement dans l'échantillon
      if (!jsonPath.includes('.')) {
        const value = samples[jsonPath];
        if (value === undefined) return 'N/A';
        if (value === null) return 'null';
        
        if (typeof value === 'object') {
          return JSON.stringify(value).substring(0, 30) + '...';
        }
        
        return String(value);
      }
      
      // Sinon, parcourir le chemin normalement
      const pathParts = jsonPath.split('.');
      let current = samples;
      
      for (const part of pathParts) {
        if (!current) return 'N/A';
        current = current[part];
      }
      
      if (current === null) return 'null';
      if (current === undefined) return 'undefined';
      
      if (typeof current === 'object') {
        return JSON.stringify(current).substring(0, 30) + '...';
      }
      
      return String(current);
    } catch (e) {
      return 'N/A';
    }
  };

  // Filtrer les colonnes en fonction de la recherche
  const filteredColumns = searchTerm 
    ? dbColumns.filter(col => col.name.toLowerCase().includes(searchTerm.toLowerCase()))
    : dbColumns;

  // Suggestions pour autocomplétion
  const getSuggestions = (columnName: string) => {
    // Suggestions simples basées sur les propriétés de l'échantillon
    const directSuggestions = samples ? Object.keys(samples) : [];
    
    // Suggestions basées sur les chemins JSON
    const pathSuggestions = jsonPaths
      .filter(jp => {
        // Supprimer le préfixe du chemin racine s'il existe
        const rootPrefix = jsonRootPath.endsWith('[]') 
          ? jsonRootPath.substring(0, jsonRootPath.length - 2) + '.'
          : jsonRootPath + '.';
          
        const normalizedPath = jp.path.startsWith(rootPrefix) 
          ? jp.path.substring(rootPrefix.length) 
          : jp.path;
          
        return !Object.values(mapping).includes(columnName) || mapping[normalizedPath] === columnName;
      })
      .map(jp => {
        const rootPrefix = jsonRootPath.endsWith('[]') 
          ? jsonRootPath.substring(0, jsonRootPath.length - 2) + '.'
          : jsonRootPath + '.';
          
        const normalizedPath = jp.path.startsWith(rootPrefix) 
          ? jp.path.substring(rootPrefix.length) 
          : jp.path;
          
        return {
          path: normalizedPath,
          score: calculateMatchScore(normalizedPath, columnName)
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(item => item.path);
    
    // Combiner les suggestions
    return [...new Set([...directSuggestions, ...pathSuggestions])];
  };

  // Calculer un score de correspondance
  const calculateMatchScore = (path: string, columnName: string) => {
    const pathParts = path.split('.');
    const lastPart = pathParts[pathParts.length - 1];
    
    // Correspondance exacte
    if (lastPart === columnName) return 100;
    
    // Correspondance partielle
    if (lastPart.toLowerCase().includes(columnName.toLowerCase())) return 50;
    
    // Correspondance avec une partie du chemin
    if (path.toLowerCase().includes(columnName.toLowerCase())) return 25;
    
    return 0;
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className={`text-lg font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          Mapping des champs
        </h3>
        <button 
          className={`px-3 py-1 rounded-md transition text-white text-sm ${
            isDarkMode ? 'bg-green-700 hover:bg-green-600' : 'bg-green-600 hover:bg-green-700'
          }`}
          onClick={generateAutoMapping}
        >
          Générer le mapping automatique
        </button>
      </div>
      
      <div className="mb-3">
        <input
          type="text"
          placeholder="Rechercher une colonne..."
          className={`w-full p-2 border rounded-md ${
            isDarkMode 
              ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' 
              : 'bg-white border-gray-300 text-gray-800 placeholder-gray-500'
          }`}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className={`p-4 text-center ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          <div className={`animate-spin rounded-full h-6 w-6 border-b-2 mx-auto ${isDarkMode ? 'border-blue-400' : 'border-blue-600'}`}></div>
          <p className="mt-2">Chargement des chemins JSON...</p>
        </div>
      ) : error ? (
        <div className={`p-4 rounded-md ${isDarkMode ? 'bg-red-900 text-red-300 border border-red-800' : 'bg-red-50 text-red-600'}`}>
          {error}
        </div>
      ) : (
        <div className={`border rounded-md overflow-hidden ${isDarkMode ? 'border-gray-700' : 'border-gray-300'}`}>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className={isDarkMode ? 'bg-gray-700' : 'bg-gray-50'}>
              <tr>
                <th className={`px-4 py-2 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>
                  Colonne SQLite
                </th>
                <th className={`px-4 py-2 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>
                  Chemin JSON
                </th>
                <th className={`px-4 py-2 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>
                  Aperçu
                </th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDarkMode ? 'bg-gray-800 divide-gray-700' : 'bg-white divide-gray-200'}`}>
              {filteredColumns.map((column, index) => {
                const jsonPath = Object.entries(mapping).find(([_, colName]) => colName === column.name)?.[0] || '';
                const suggestions = getSuggestions(column.name);
                
                return (
                  <tr key={index} className={index % 2 === 0 
                    ? (isDarkMode ? 'bg-gray-800' : 'bg-white')
                    : (isDarkMode ? 'bg-gray-750' : 'bg-gray-50')
                  }>
                    <td className={`px-4 py-2 whitespace-nowrap text-sm ${
                      column.primary_key 
                        ? (isDarkMode ? 'font-bold text-white' : 'font-bold text-black')
                        : (column.not_null 
                            ? (isDarkMode ? 'text-white' : 'text-black') 
                            : (isDarkMode ? 'text-gray-400' : 'text-gray-500'))
                    }`}>
                      {column.name}
                      {column.primary_key && <span className={`ml-1 ${isDarkMode ? 'text-yellow-400' : 'text-yellow-600'}`}>(PK)</span>}
                      {column.not_null && !column.primary_key && <span className={`ml-1 ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>*</span>}
                      <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>{column.data_type}</div>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap relative">
                      <input 
                        type="text" 
                        className={`w-full p-1 border rounded-md text-sm ${
                          isDarkMode 
                            ? 'bg-gray-700 border-gray-600 text-white' 
                            : 'bg-white border-gray-300 text-gray-800'
                        }`}
                        value={jsonPath}
                        onChange={(e) => {
                          const newPath = e.target.value;
                          const newMapping = { ...mapping };
                          
                          // Supprimer l'ancien mapping pour cette colonne
                          Object.keys(newMapping).forEach(path => {
                            if (newMapping[path] === column.name) {
                              delete newMapping[path];
                            }
                          });
                          
                          // Ajouter le nouveau mapping si un chemin est spécifié
                          if (newPath.trim()) {
                            newMapping[newPath] = column.name;
                          }
                          
                          onMappingChange(newMapping);
                        }}
                        placeholder="Chemin JSON"
                        list={`suggestions-${column.name}`}
                      />
                      <datalist id={`suggestions-${column.name}`}>
                        {suggestions.map((suggestion, i) => (
                          <option key={i} value={suggestion} />
                        ))}
                      </datalist>
                    </td>
                    <td className={`px-4 py-2 whitespace-nowrap text-sm max-w-xs truncate ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>
                      {jsonPath ? getSampleValue(jsonPath) : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      
      <div className="mt-4">
        <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          <div><span className="font-bold">PK</span> - Clé primaire</div>
          <div><span className={isDarkMode ? 'text-red-400' : 'text-red-600'}>*</span> - Champ obligatoire (NOT NULL)</div>
        </div>
      </div>
    </div>
  );
};

export default MappingEditor;