import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { readTextFile } from '@tauri-apps/plugin-fs';
import FileSelector from '../components/FileSelector';
import JsonPathExplorer from '../components/JsonPathExplorer';
import DbTableSelector from '../components/DbTableSelector';
import MappingEditor from '../components/MappingEditor';
import JsonPreview from '../components/JsonPreview';
import Toast from '../components/Toast';
import { useTheme } from '../context/ThemeContext';

interface ColumnInfo {
  name: string;
  data_type: string;
  not_null: boolean;
  primary_key: boolean;
  default_value: string | null;
}

interface TableInfo {
  columns: ColumnInfo[];
  unique_constraints: string[][];
}

interface ImportProgress {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  status: string;
}

interface FileWithPath {
  file: File | null;
  path: string;
}

interface ToastMessage {
  type: 'success' | 'error' | 'info';
  message: string;
}

const UpdatePage: React.FC = () => {
  const { isDarkMode } = useTheme();
  
  // État des étapes du processus
  const [step, setStep] = useState<number>(1);
  
  // Étape 1: Sélection des fichiers
  const [jsonFile, setJsonFile] = useState<FileWithPath>({ file: null, path: '' });
  const [dbFile, setDbFile] = useState<FileWithPath>({ file: null, path: '' });
  
  // Étape 2: Structure JSON
  const [jsonContent, setJsonContent] = useState<string>('');
  const [jsonRoot, setJsonRoot] = useState<string>('');
  
  // Étape 3: Configuration de la table et colonnes
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [tableInfo, setTableInfo] = useState<TableInfo | null>(null);
  const [keyColumn, setKeyColumn] = useState<string>('');
  const [updateColumns, setUpdateColumns] = useState<string[]>([]);
  
  // Étape 4: Mapping des champs
  const [mapping, setMapping] = useState<Record<string, string>>({});
  
  // Options de mise à jour
  const [dryRun, setDryRun] = useState<boolean>(false);
  
  // État du processus de mise à jour
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  
  // Notifications toast
  const [toast, setToast] = useState<ToastMessage | null>(null);

  // Chargement du contenu JSON pour aperçu
  useEffect(() => {
    if (!jsonFile.path) {
      setJsonContent('');
      return;
    }

    // Utiliser l'API Tauri pour lire le contenu du fichier
    const readFile = async () => {
      try {
        const content = await readTextFile(jsonFile.path);
        setJsonContent(content);
      } catch (error) {
        console.error('Erreur lors de la lecture du fichier:', error);
        showToast('error', `Erreur lors de la lecture du fichier: ${error}`);
      }
    };

    readFile();
  }, [jsonFile]);

  // Récupération des informations de la table sélectionnée
  useEffect(() => {
    if (!dbFile.path || !selectedTable) {
      setTableInfo(null);
      return;
    }

    async function fetchTableInfo() {
      try {
        const info = await invoke<TableInfo>('db_analyze_table', {
          dbPath: dbFile.path,
          tableName: selectedTable
        });
        setTableInfo(info);
        
        // Si aucune colonne clé n'est sélectionnée, prendre la clé primaire par défaut
        if (!keyColumn && info.columns.length > 0) {
          const primaryKey = info.columns.find(col => col.primary_key);
          if (primaryKey) {
            setKeyColumn(primaryKey.name);
          }
        }
      } catch (err) {
        console.error("Erreur lors de la récupération des informations de table:", err);
        showToast('error', `Erreur lors de la récupération des informations de table: ${err}`);
        setTableInfo(null);
      }
    }

    fetchTableInfo();
  }, [dbFile.path, selectedTable]);

  // Configuration de l'écouteur d'événements pour la progression
  useEffect(() => {
    const unlisten = listen<ImportProgress>('update-progress', async (event) => {
      setProgress(event.payload);
      setLogs(prev => [...prev, event.payload.status]);
      
      // Vérifier si le processus est terminé
      if (event.payload.processed === event.payload.total) {
        if (event.payload.failed === 0) {
          showToast('success', `Mise à jour terminée avec succès! ${event.payload.succeeded} enregistrements mis à jour.`);
        } else {
          showToast('info', `Mise à jour terminée. ${event.payload.succeeded} succès, ${event.payload.failed} échecs.`);
        }
      }
    });

    return () => {
      unlisten.then(unlistenFn => unlistenFn());
    };
  }, []);

  // Afficher une notification toast
  const showToast = (type: 'success' | 'error' | 'info', message: string) => {
    setToast({ type, message });
    // Masquer automatiquement après 5 secondes
    setTimeout(() => setToast(null), 5000);
  };

  // Réinitialiser l'état pour une nouvelle mise à jour
  const resetUpdate = () => {
    // Réinitialiser les états liés à la mise à jour tout en conservant les sélections de fichiers
    setStep(1);
    setJsonRoot('');
    setSelectedTable('');
    setTableInfo(null);
    setKeyColumn('');
    setUpdateColumns([]);
    setMapping({});
    setDryRun(false);
    setProgress(null);
    setLogs([]);
  };

  // Lancement du processus de mise à jour
  const startUpdate = async () => {
    if (!jsonFile.path || !dbFile.path || !jsonRoot || !selectedTable || !keyColumn || 
        updateColumns.length === 0 || Object.keys(mapping).length === 0) {
      showToast('error', 'Veuillez compléter toutes les étapes requises avant de lancer la mise à jour.');
      return;
    }

    setIsProcessing(true);
    setProgress(null);
    setLogs([]);

    try {
      // Vérifier si la colonne clé est dans le mapping
      const keyInMapping = Object.values(mapping).includes(keyColumn);
      if (!keyInMapping) {
        showToast('error', `La colonne clé "${keyColumn}" doit être présente dans le mapping.`);
        setIsProcessing(false);
        return;
      }

      // Préparation de la configuration
      const config = {
        json_path: jsonFile.path,
        db_path: dbFile.path,
        json_root: jsonRoot,
        table_name: selectedTable,
        key_column: keyColumn,
        update_columns: updateColumns,
        mapping,
        dry_run: dryRun
      };

      // Appel de la fonction de mise à jour
      showToast('info', 'Mise à jour en cours...');
      await invoke('update_sqlite_from_json', { config });
    } catch (err) {
      console.error("Erreur dans startUpdate :", err);
      showToast('error', `Erreur lors de la mise à jour: ${err instanceof Error ? err.message : String(err)}`);
      setLogs(prev => [...prev, `Erreur: ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleColumnToggle = (columnName: string) => {
    setUpdateColumns(prev => {
      if (prev.includes(columnName)) {
        return prev.filter(col => col !== columnName);
      } else {
        return [...prev, columnName];
      }
    });
  };

  return (
    <div className={`flex flex-col h-screen ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-800'}`}>
      {/* Notifications Toast */}
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      
      {/* Main content */}
      <main className={`flex flex-1 overflow-hidden ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
        {/* Left sidebar - Steps */}
        <div className={`w-64 p-4 border-r ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'}`}>
          <div className={`text-lg font-semibold mb-4 ${isDarkMode ? 'text-blue-400' : 'text-blue-700'}`}>
            Mise à jour SQLite
          </div>
          <ul>
            <li className={`p-2 rounded ${step === 1 ? (isDarkMode ? 'bg-gray-700 text-blue-300' : 'bg-blue-100 text-blue-700') : ''} ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}>
              <button className="w-full text-left" onClick={() => setStep(1)}>
                1. Sélection des fichiers
              </button>
            </li>
            <li className={`p-2 rounded ${step === 2 ? (isDarkMode ? 'bg-gray-700 text-blue-300' : 'bg-blue-100 text-blue-700') : ''} ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}>
              <button 
                className={`w-full text-left ${(!jsonFile.file || !dbFile.file) ? (isDarkMode ? 'text-gray-500' : 'text-gray-400') : ''}`}
                onClick={() => setStep(2)} 
                disabled={!jsonFile.file || !dbFile.file}
              >
                2. Structure JSON
              </button>
            </li>
            <li className={`p-2 rounded ${step === 3 ? (isDarkMode ? 'bg-gray-700 text-blue-300' : 'bg-blue-100 text-blue-700') : ''} ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}>
              <button 
                className={`w-full text-left ${!jsonRoot ? (isDarkMode ? 'text-gray-500' : 'text-gray-400') : ''}`}
                onClick={() => setStep(3)} 
                disabled={!jsonRoot}
              >
                3. Configuration table
              </button>
            </li>
            <li className={`p-2 rounded ${step === 4 ? (isDarkMode ? 'bg-gray-700 text-blue-300' : 'bg-blue-100 text-blue-700') : ''} ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}>
              <button 
                className={`w-full text-left ${(!selectedTable || !keyColumn || updateColumns.length === 0) ? (isDarkMode ? 'text-gray-500' : 'text-gray-400') : ''}`}
                onClick={() => setStep(4)} 
                disabled={!selectedTable || !keyColumn || updateColumns.length === 0}
              >
                4. Mapping des champs
              </button>
            </li>
          </ul>
          
          {/* Bouton de réinitialisation */}
          <div className={`mt-6 pt-4 border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-300'}`}>
            <button
              className={`w-full p-2 text-sm rounded-md transition ${
                isDarkMode 
                  ? 'bg-gray-700 text-white hover:bg-gray-600' 
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              } ${isProcessing ? (isDarkMode ? 'opacity-50 cursor-not-allowed' : 'opacity-50 cursor-not-allowed') : ''}`}
              onClick={resetUpdate}
              disabled={isProcessing}
            >
              Nouvelle mise à jour
            </button>
          </div>
        </div>

        {/* Main content area */}
        <div className="flex-1 p-6 overflow-auto">
          {step === 1 && (
            <div>
              <h2 className={`text-xl font-semibold mb-4 ${isDarkMode ? 'text-blue-400' : 'text-gray-800'}`}>
                Sélection des fichiers
              </h2>
              
              <FileSelector 
                label="Fichier JSON source (avec les mises à jour)"
                accept={[".json"]}
                placeholder="Cliquez pour sélectionner un fichier JSON"
                value={jsonFile}
                onChange={setJsonFile}
                isDarkMode={isDarkMode}
              />

              <FileSelector 
                label="Base de données SQLite à mettre à jour"
                accept={[".sqlite", ".db"]}
                placeholder="Cliquez pour sélectionner une base de données SQLite"
                value={dbFile}
                onChange={setDbFile}
                isDarkMode={isDarkMode}
              />

              <div className="flex justify-end mt-6">
                <button
                  className={`px-4 py-2 rounded-md transition ${
                    !jsonFile.file || !dbFile.file 
                      ? (isDarkMode ? 'bg-blue-800 text-blue-300 opacity-50 cursor-not-allowed' : 'bg-blue-300 text-blue-700 opacity-50 cursor-not-allowed')
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                  onClick={() => setStep(2)}
                  disabled={!jsonFile.file || !dbFile.file}
                >
                  Continuer
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className={`text-xl font-semibold mb-4 ${isDarkMode ? 'text-blue-400' : 'text-gray-800'}`}>
                Structure JSON
              </h2>
              
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Aperçu JSON
                  </label>
                  <JsonPreview 
                    jsonContent={jsonContent}
                    className="mb-4"
                    isDarkMode={isDarkMode}
                  />
                </div>
                
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Chemin racine JSON
                  </label>
                  <p className={`text-sm mb-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Spécifiez le chemin pour accéder aux données de mise à jour
                  </p>
                  <div className="flex mb-4">
                    <input
                      type="text"
                      className={`flex-1 p-2 border rounded-md ${
                        isDarkMode 
                          ? 'bg-gray-800 border-gray-600 text-white' 
                          : 'bg-white border-gray-300 text-gray-800'
                      }`}
                      placeholder="Ex: data.users[]"
                      value={jsonRoot}
                      onChange={(e) => setJsonRoot(e.target.value)}
                    />
                  </div>
                  
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Structure détectée
                    </label>
                    <JsonPathExplorer 
                      jsonFilePath={jsonFile.path}
                      onPathSelect={setJsonRoot}
                      selectedPath={jsonRoot}
                      isDarkMode={isDarkMode}
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-between mt-6">
                <button
                  className={`px-4 py-2 rounded-md transition ${
                    isDarkMode 
                      ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' 
                      : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
                  }`}
                  onClick={() => setStep(1)}
                >
                  Retour
                </button>
                <button
                  className={`px-4 py-2 rounded-md transition ${
                    !jsonRoot 
                      ? (isDarkMode ? 'bg-blue-800 text-blue-300 opacity-50 cursor-not-allowed' : 'bg-blue-300 text-blue-700 opacity-50 cursor-not-allowed')
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                  onClick={() => setStep(3)}
                  disabled={!jsonRoot}
                >
                  Continuer
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 className={`text-xl font-semibold mb-4 ${isDarkMode ? 'text-blue-400' : 'text-gray-800'}`}>
                Configuration de la table
              </h2>
              
              <div className={`border rounded-lg ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'} p-4 shadow-sm mb-6`}>
                <DbTableSelector 
                  dbFilePath={dbFile.path}
                  onTableSelect={setSelectedTable}
                  selectedTable={selectedTable}
                  isDarkMode={isDarkMode}
                />
              </div>

              {tableInfo && (
                <div className="mt-6">
                  <div className={`p-4 border rounded-lg ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'} shadow-sm`}>
                    <div className="mb-4">
                      <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Colonne clé (pour identifier les enregistrements à mettre à jour)
                      </label>
                      <select
                        className={`w-full p-2 border rounded-md ${
                          isDarkMode 
                            ? 'bg-gray-700 border-gray-600 text-white' 
                            : 'bg-white border-gray-300 text-gray-800'
                        }`}
                        value={keyColumn}
                        onChange={(e) => setKeyColumn(e.target.value)}
                      >
                        <option value="">Sélectionnez une colonne clé</option>
                        {tableInfo.columns.map(col => (
                          <option key={col.name} value={col.name}>
                            {col.name} {col.primary_key ? '(Clé primaire)' : ''} {col.not_null ? '(NOT NULL)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="mb-4">
                      <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Colonnes à mettre à jour
                      </label>
                      <div className={`border rounded-md p-4 max-h-60 overflow-auto ${isDarkMode ? 'border-gray-600 bg-gray-700' : 'border-gray-300 bg-white'}`}>
                        {tableInfo.columns.map((col, index) => (
                          <div key={index} className="flex items-center mb-1 last:mb-0">
                            <input
                              type="checkbox"
                              id={`col-${col.name}`}
                              checked={updateColumns.includes(col.name)}
                              onChange={() => handleColumnToggle(col.name)}
                              disabled={col.name === keyColumn}
                              className="h-4 w-4 text-blue-600"
                            />
                            <label htmlFor={`col-${col.name}`} className={`ml-2 text-sm ${col.name === keyColumn ? (isDarkMode ? 'text-gray-500' : 'text-gray-400') : ''}`}>
                              {col.name} 
                              <span className={`text-xs ml-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>({col.data_type})</span>
                              {col.primary_key && <span className="ml-1 text-xs text-yellow-600">(PK)</span>}
                            </label>
                          </div>
                        ))}
                      </div>
                      <div className={`mt-2 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        {updateColumns.length} colonnes sélectionnées pour la mise à jour
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-between mt-6">
                <button
                  className={`px-4 py-2 rounded-md transition ${
                    isDarkMode 
                      ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' 
                      : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
                  }`}
                  onClick={() => setStep(2)}
                >
                  Retour
                </button>
                <button
                  className={`px-4 py-2 rounded-md transition ${
                    !selectedTable || !keyColumn || updateColumns.length === 0 
                      ? (isDarkMode ? 'bg-blue-800 text-blue-300 opacity-50 cursor-not-allowed' : 'bg-blue-300 text-blue-700 opacity-50 cursor-not-allowed')
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                  onClick={() => setStep(4)}
                  disabled={!selectedTable || !keyColumn || updateColumns.length === 0}
                >
                  Continuer
                </button>
              </div>
            </div>
          )}

          {step === 4 && tableInfo && (
            <div>
              <h2 className={`text-xl font-semibold mb-4 ${isDarkMode ? 'text-blue-400' : 'text-gray-800'}`}>
                Mapping des champs
              </h2>
              
              <div className={`mb-6 p-4 rounded-md ${isDarkMode ? 'bg-blue-900 border border-blue-800' : 'bg-blue-50'}`}>
                <div className={`font-medium mb-2 ${isDarkMode ? 'text-blue-300' : 'text-blue-800'}`}>Configuration de la mise à jour</div>
                <div className={`text-sm ${isDarkMode ? 'text-blue-200' : 'text-blue-700'}`}>
                  <div><span className="font-medium">Table:</span> {selectedTable}</div>
                  <div><span className="font-medium">Colonne clé:</span> {keyColumn}</div>
                  <div><span className="font-medium">Colonnes à mettre à jour:</span> {updateColumns.join(', ')}</div>
                </div>
              </div>
              
              <div className={`border rounded-lg ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'} p-4 shadow-sm mb-6`}>
                <MappingEditor 
                  jsonFilePath={jsonFile.path}
                  jsonRootPath={jsonRoot}
                  dbColumns={tableInfo.columns.filter(col => 
                    col.name === keyColumn || updateColumns.includes(col.name)
                  )}
                  mapping={mapping}
                  onMappingChange={setMapping}
                  isDarkMode={isDarkMode}
                />
              </div>

              <div className="mt-6 mb-6">
                <div className="flex items-center mb-3">
                  <input 
                    type="checkbox" 
                    id="dryRun" 
                    className="h-4 w-4 text-blue-600" 
                    checked={dryRun}
                    onChange={(e) => setDryRun(e.target.checked)}
                  />
                  <label htmlFor="dryRun" className={`ml-2 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Mode simulation (Dry Run) - Ne pas modifier la base de données
                  </label>
                </div>
              </div>

              <div className="flex justify-between mt-6">
                <button
                  className={`px-4 py-2 rounded-md transition ${
                    isDarkMode 
                      ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' 
                      : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
                  } ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
                  onClick={() => setStep(3)}
                  disabled={isProcessing}
                >
                  Retour
                </button>
                <button
                  className={`px-4 py-2 rounded-md transition ${
                    isProcessing || Object.keys(mapping).length === 0 
                      ? (isDarkMode ? 'bg-blue-800 text-blue-300 opacity-50 cursor-not-allowed' : 'bg-blue-300 text-blue-700 opacity-50 cursor-not-allowed')
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                  onClick={startUpdate}
                  disabled={isProcessing || Object.keys(mapping).length === 0}
                >
                  {isProcessing ? "Traitement en cours..." : "Lancer la mise à jour"}
                </button>
              </div>

              {/* Section de progression et logs */}
              {(isProcessing || progress) && (
                <div className="mt-6">
                  <div className="w-full bg-gray-200 rounded-full h-2.5">
                    <div 
                      className="bg-blue-600 h-2.5 rounded-full" 
                      style={{ width: `${progress ? Math.round((progress.processed / progress.total) * 100) : 0}%` }}
                    ></div>
                  </div>
                  <div className={`flex justify-between mt-2 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    <span>
                      {progress 
                        ? `${Math.round((progress.processed / progress.total) * 100)}% - ${progress.processed}/${progress.total} objets traités`
                        : "En attente..."
                      }
                    </span>
                    <span>
                      {progress 
                        ? `Succès: ${progress.succeeded}, Échecs: ${progress.failed}`
                        : ""
                      }
                    </span>
                  </div>
                  <div className={`mt-4 p-4 border rounded-md h-40 overflow-auto ${
                    isDarkMode 
                      ? 'bg-gray-800 border-gray-700' 
                      : 'bg-gray-50 border-gray-300'
                  }`}>
                    <div className="font-mono text-xs space-y-1">
                      {logs.length === 0 
                        ? <div className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>
                            Les logs de mise à jour apparaîtront ici...
                          </div>
                        : logs.map((log, index) => (
                            <div key={index} className={
                              log.includes("Erreur") 
                                ? (isDarkMode ? "text-red-400" : "text-red-600") 
                                : log.includes("terminée") 
                                ? (isDarkMode ? "text-green-400 font-medium" : "text-green-600 font-medium")
                                : (isDarkMode ? "text-gray-200" : "text-gray-800")
                            }>
                              [INFO] {log}
                            </div>
                          ))
                      }
                    </div>
                  </div>
                </div>
              )}

              {/* Section des résultats après mise à jour réussie */}
              {!isProcessing && progress && progress.processed === progress.total && (
                <div className={`mt-6 p-4 border rounded-md mb-8 ${
                  isDarkMode 
                    ? 'bg-green-900 border-green-800' 
                    : 'bg-green-50 border-green-200'
                }`}>
                  <h3 className={`font-medium mb-2 ${
                    isDarkMode ? 'text-green-300' : 'text-green-700'
                  }`}>Mise à jour terminée</h3>
                  <p className={isDarkMode ? 'text-green-200' : 'text-green-600'}>
                    {progress.succeeded} enregistrements mis à jour avec succès.
                    {progress.failed > 0 && ` ${progress.failed} enregistrements ont échoué.`}
                  </p>
                  
                  <div className="mt-4 flex space-x-4">
                    <button
                      onClick={resetUpdate}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition"
                    >
                      Nouvelle mise à jour
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default UpdatePage;