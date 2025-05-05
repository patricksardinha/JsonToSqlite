import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { UnlistenFn } from '@tauri-apps/api/event';

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
  const [progress, setProgress] = useState<number>(0);
  // Mise à jour du type d'elapsedTime pour stocker un nombre à virgule
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const [analysisComplete, setAnalysisComplete] = useState<boolean>(false);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);
  
  const uniquePathsRef = useRef<Set<string>>(new Set());


  // Fonction pour mettre à jour le temps écoulé
  const updateElapsedTime = () => {
    if (startTimeRef.current > 0) {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      // Formater avec 3 décimales
      setElapsedTime(elapsed);
    }
  };
  
  useEffect(() => {
    let unlisten: Promise<UnlistenFn> | null = null;
    let unlisten2: Promise<UnlistenFn> | null = null;
    
    if (!jsonFilePath) return;
    
    async function setupListener() {
      // Réinitialiser le Set de chemins uniques
      uniquePathsRef.current = new Set();

      // Mettre en place un écouteur pour les chemins découverts
      unlisten = listen<JsonPathInfo>('json-path-discovered', (event) => {
        const newPath = event.payload;

        // Vérifier si le chemin est nouveau avant de le compter
        const isNewPath = !uniquePathsRef.current.has(newPath.path);

        if (isNewPath) {
          // Ajouter au Set de chemins uniques
          uniquePathsRef.current.add(newPath.path);
          
          // Mettre à jour le compteur UNIQUEMENT pour les nouveaux chemins
          setProgress(uniquePathsRef.current.size);
          
          // Ajouter à l'état des chemins
          setPaths(prevPaths => {
            // Double vérification pour éviter les doublons
            if(!prevPaths.some(p => p.path === newPath.path)) {
              return [...prevPaths, newPath];
            }
            return prevPaths;
          });
        }
      });
      
      // Écouter l'événement de fin d'analyse
      unlisten2 = listen('json-path-analysis-complete', () => {
        setIsLoading(false);
        setAnalysisComplete(true);
        
        // Arrêter le timer
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        
        // Une dernière mise à jour du temps
        updateElapsedTime();

        // Dernier comptage, juste pour être sûr
        setProgress(uniquePathsRef.current.size);
      });
    }
    
    async function startAnalysis() {
      setIsLoading(true);
      setError(null);
      setProgress(0);
      setPaths([]);
      setElapsedTime(0);
      setAnalysisComplete(false);
      
      // Enregistrer le temps de début
      startTimeRef.current = Date.now();
      
      // Démarrer le timer pour mettre à jour le temps écoulé
      timerRef.current = window.setInterval(updateElapsedTime, 1000);
      
      try {
        // Configurer d'abord les écouteurs
        await setupListener();
        
        // Puis lancer l'analyse progressive
        await invoke('json_analyze_structure_progressive', { 
          jsonPath: jsonFilePath 
        });
      } catch (err) {
        setError(`Erreur d'analyse du fichier JSON: ${err instanceof Error ? err.message : String(err)}`);
        setIsLoading(false);
        setAnalysisComplete(true);
        
        // Arrêter le timer en cas d'erreur
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }
    }
    
    startAnalysis();
    
    // Nettoyage lors du démontage du composant
    return () => {
      if (unlisten) {
        unlisten.then(fn => fn());
      }
      if (unlisten2) {
        unlisten2.then(fn => fn());
      }
      
      // Nettoyer le timer
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
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
    <div className={`border rounded-md overflow-hidden flex flex-col h-full ${
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
        
        {(isLoading || analysisComplete) && (
          <div className={`mt-2 p-2 rounded ${
            isDarkMode ? 'bg-gray-800' : 'bg-gray-100'
          }`}>
            {isLoading && (
              <div className="w-full h-2 bg-gray-300 rounded-full mb-2">
                <div 
                  className={`h-2 rounded-full ${isDarkMode ? 'bg-blue-500' : 'bg-blue-600'}`} 
                  style={{ width: `${Math.min((progress / Math.max(progress * 1.1, 100)) * 100, 100)}%` }}
                ></div>
              </div>
            )}
            
            <div className="flex justify-between items-center text-xs">
              <div>
                <span className={`font-medium ${isDarkMode ? 'text-blue-300' : 'text-blue-700'}`}>
                  {progress}
                </span>
                <span className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>
                  {' chemins trouvés'}
                </span>
              </div>
              
              <div className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>
                Temps: <span className="font-medium">{elapsedTime.toFixed(3)}s</span>
                {analysisComplete && !isLoading && (
                  <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${
                    isDarkMode ? 'bg-green-900 text-green-300' : 'bg-green-100 text-green-800'
                  }`}>
                    Terminé
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      
      <div className={`overflow-y-auto p-2 ${
        isDarkMode ? 'bg-gray-800' : 'bg-white'
      }`}>
        {isLoading && paths.length === 0 ? (
          <div className="flex flex-col justify-center items-center h-full">
            <div className={`animate-spin rounded-full h-6 w-6 border-b-2 mb-2 ${
              isDarkMode ? 'border-blue-400' : 'border-blue-600'
            }`}></div>
            <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Analyse en cours...
            </p>
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