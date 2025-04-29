import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface JsonPathInfo {
  path: string;
  data_type: string;
  sample: string;
}

interface JsonPathExplorerProps {
  jsonFilePath: string;
  onPathSelect: (path: string) => void;
  selectedPath: string;
  isDarkMode?: boolean;
}

const JsonPathExplorer: React.FC<JsonPathExplorerProps> = ({ 
  jsonFilePath, 
  onPathSelect,
  selectedPath,
  isDarkMode = false
}) => {
  const [paths, setPaths] = useState<JsonPathInfo[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');

  useEffect(() => {
    if (!jsonFilePath) return;
    
    async function analyzePath() {
      setIsLoading(true);
      setError(null);
      
      try {
        const result = await invoke<JsonPathInfo[]>('json_analyze_structure', { 
          jsonPath: jsonFilePath 
        });
        
        setPaths(result);
      } catch (err) {
        setError(`Erreur d'analyse du fichier JSON: ${err instanceof Error ? err.message : String(err)}`);
        setPaths([]);
      } finally {
        setIsLoading(false);
      }
    }
    
    analyzePath();
  }, [jsonFilePath]);

  const filteredPaths = searchTerm
    ? paths.filter(p => p.path.toLowerCase().includes(searchTerm.toLowerCase()))
    : paths;

  // Trier les chemins par profondeur (nombre de points)
  const sortedPaths = [...filteredPaths].sort((a, b) => {
    const depthA = a.path.split('.').length;
    const depthB = b.path.split('.').length;
    return depthA - depthB;
  });

  // Calculer l'indentation pour l'affichage hiérarchique
  const getIndentation = (path: string) => {
    const depth = path.split('.').length - 1;
    return depth * 16; // 16px par niveau d'indentation
  };

  // Déterminer si un chemin est un tableau
  const isArrayPath = (path: string) => path.endsWith('[]');

  return (
    <div className={`border rounded-md overflow-hidden ${
      isDarkMode ? 'border-gray-700' : 'border-gray-300'
    }`}>
      <div className={`p-2 border-b ${
        isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-gray-50 border-gray-300'
      }`}>
        <input
          type="text"
          placeholder="Rechercher un chemin..."
          className={`w-full p-2 border rounded-md ${
            isDarkMode 
              ? 'bg-gray-800 border-gray-600 text-white placeholder-gray-400' 
              : 'bg-white border-gray-300 text-gray-800 placeholder-gray-500'
          }`}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>
      
      <div className={`h-64 overflow-y-auto p-2 ${
        isDarkMode ? 'bg-gray-800' : 'bg-white'
      }`}>
        {isLoading ? (
          <div className="flex justify-center items-center h-full">
            <div className={`animate-spin rounded-full h-6 w-6 border-b-2 ${
              isDarkMode ? 'border-blue-400' : 'border-blue-600'
            }`}></div>
          </div>
        ) : error ? (
          <div className={`p-2 ${isDarkMode ? 'text-red-400' : 'text-red-500'}`}>{error}</div>
        ) : sortedPaths.length === 0 ? (
          <div className={`p-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Aucun chemin trouvé</div>
        ) : (
          <ul className="space-y-1">
            {sortedPaths.map((pathInfo, index) => (
              <li 
                key={index} 
                className={`p-1 rounded cursor-pointer ${
                  selectedPath === pathInfo.path 
                    ? (isDarkMode ? 'bg-blue-900 text-blue-200' : 'bg-blue-100') 
                    : (isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100')
                }`}
                style={{ paddingLeft: getIndentation(pathInfo.path) + 8 }}
                onClick={() => onPathSelect(pathInfo.path)}
                title={`Type: ${pathInfo.data_type}, Exemple: ${pathInfo.sample}`}
              >
                <div className="flex items-center">
                  <span className={`mr-2 ${
                    isArrayPath(pathInfo.path) 
                      ? (isDarkMode ? 'text-green-400' : 'text-green-600') 
                      : (isDarkMode ? 'text-blue-400' : 'text-blue-600')
                  }`}>
                    {isArrayPath(pathInfo.path) ? '[ ]' : '{ }'}
                  </span>
                  <span className={`font-mono text-sm ${
                    isDarkMode ? 'text-gray-200' : 'text-gray-800'
                  }`}>
                    {pathInfo.path}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default JsonPathExplorer;