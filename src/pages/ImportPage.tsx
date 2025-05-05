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

const ImportPage: React.FC = () => {
  const { isDarkMode } = useTheme();
  // État des étapes du processus
  const [step, setStep] = useState<number>(1);
  
  // Étape 1: Sélection des fichiers
  const [jsonFile, setJsonFile] = useState<FileWithPath>({ file: null, path: '' });
  const [dbFile, setDbFile] = useState<FileWithPath>({ file: null, path: '' });
  
  // Étape 2: Structure JSON
  const [jsonContent, setJsonContent] = useState<string>('');
  const [jsonRoot, setJsonRoot] = useState<string>('');
  
  // Étape 3: Sélection de table
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [tableInfo, setTableInfo] = useState<TableInfo | null>(null);
  
  // Étape 4: Mapping des champs
  const [mapping, setMapping] = useState<Record<string, string>>({});
  
  // Étape 5: Configuration avancée
  const [defaultValues, setDefaultValues] = useState<string>('{}');
  const [forcedValues, setForcedValues] = useState<string>('{}');
  const [dynamicValues, setDynamicValues] = useState<string>('{}');
  const [dryRun, setDryRun] = useState<boolean>(false);
  const [limit, setLimit] = useState<number | undefined>(undefined);
  const [offset, setOffset] = useState<number | undefined>(undefined);
  
  // État du processus d'importation
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
  
    // API Tauri pour lire le contenu du fichier
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
    const unlisten = listen<ImportProgress>('import-progress', async (event) => {
      setProgress(event.payload);
      setLogs(prev => [...prev, event.payload.status]);
      
      // Vérifier si le processus est terminé
      if (event.payload.processed === event.payload.total) {
        if (event.payload.failed === 0) {
          showToast('success', `Importation terminée avec succès! ${event.payload.succeeded} enregistrements importés.`);
        } else {
          showToast('info', `Importation terminée. ${event.payload.succeeded} succès, ${event.payload.failed} échecs.`);
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

  // Réinitialiser l'état pour un nouveau import
  const resetImport = () => {
    // Réinitialiser les états liés à l'importation tout en conservant les sélections de fichiers
    setStep(1);
    setJsonRoot('');
    setSelectedTable('');
    setTableInfo(null);
    setMapping({});
    setDefaultValues('{}');
    setForcedValues('{}');
    setDynamicValues('{}');
    setDryRun(false);
    setLimit(undefined);
    setOffset(undefined);
    setProgress(null);
    setLogs([]);
  };

  // Lancement du processus d'importation
  const startImport = async () => {
    if (!jsonFile.path || !dbFile.path || !jsonRoot || !selectedTable || Object.keys(mapping).length === 0) {
      showToast('error', 'Veuillez compléter toutes les étapes requises avant de lancer l\'importation.');
      return;
    }

    setIsProcessing(true);
    setProgress(null);
    setLogs([]);

    try {
      // Vérifier les mappings pour les colonnes NOT NULL
      if (tableInfo) {
        const requiredColumns = tableInfo.columns
          .filter(col => col.not_null && !col.primary_key && col.default_value === null)
          .map(col => col.name);
        
        const mappedColumns = Object.values(mapping);
        const missingRequiredColumns = requiredColumns.filter(col => !mappedColumns.includes(col));
        
        if (missingRequiredColumns.length > 0) {
          showToast('error', `Colonnes obligatoires non mappées: ${missingRequiredColumns.join(', ')}`);
          setIsProcessing(false);
          return;
        }
      }

      // Préparation de la configuration
      const config = {
        json_path: jsonFile.path,
        db_path: dbFile.path,
        json_root: jsonRoot,
        table_name: selectedTable,
        mapping,
        defaults: JSON.parse(defaultValues),
        forced: JSON.parse(forcedValues),
        dynamic: JSON.parse(dynamicValues),
        limit,
        offset,
        dry_run: dryRun
      };

      // Appel de la fonction d'importation
      showToast('info', 'Importation en cours... Redirection vers la page de résultats...');
      
      // Redirection vers l'onglet des résultats
      setTimeout(() => {
        setStep(6);
      }, 1500);

      await invoke('import_json_to_sqlite', { config });
    } catch (err) {
      console.error("Erreur dans startImport :", err);
      showToast('error', `Erreur lors de l'importation: ${err instanceof Error ? err.message : String(err)}`);
      setLogs(prev => [...prev, `Erreur: ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setTimeout(() => {
        setIsProcessing(false);
      }, 1500);
    }
  };

  return (
    <div className={`flex flex-col h-screen ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-800'}`}>
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      
      <main className={`flex flex-1 overflow-hidden ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
        <div className={`w-64 p-4 border-r ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'}`}>
          <div className={`text-lg font-semibold mb-4 ${isDarkMode ? 'text-blue-400' : 'text-blue-700'}`}>
            Import JSON → SQLite
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
                3. Sélection de table
              </button>
            </li>
            <li className={`p-2 rounded ${step === 4 ? (isDarkMode ? 'bg-gray-700 text-blue-300' : 'bg-blue-100 text-blue-700') : ''} ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}>
              <button 
                className={`w-full text-left ${!selectedTable ? (isDarkMode ? 'text-gray-500' : 'text-gray-400') : ''}`}
                onClick={() => setStep(4)} 
                disabled={!selectedTable}
              >
                4. Mapping des champs
              </button>
            </li>
            <li className={`p-2 rounded ${step === 5 ? (isDarkMode ? 'bg-gray-700 text-blue-300' : 'bg-blue-100 text-blue-700') : ''} ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}>
              <button 
                className={`w-full text-left ${Object.keys(mapping).length === 0 ? (isDarkMode ? 'text-gray-500' : 'text-gray-400') : ''}`}
                onClick={() => setStep(5)} 
                disabled={Object.keys(mapping).length === 0}
              >
                5. Configuration avancée
              </button>
            </li>
            <li className={`p-2 rounded ${step === 6 ? (isDarkMode ? 'bg-gray-700 text-blue-300' : 'bg-blue-100 text-blue-700') : ''} ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}>
              <button 
                className={`w-full text-left ${!isProcessing && !progress ? (isDarkMode ? 'text-gray-500' : 'text-gray-400') : ''}`}
                onClick={() => setStep(6)} 
                disabled={!isProcessing && !progress}
              >
                6. Résultats d'importation
              </button>
            </li>
          </ul>
          
          <div className={`mt-6 pt-4 border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-300'}`}>
            <button
              className={`w-full p-2 text-sm rounded-md transition ${
                isDarkMode 
                  ? 'bg-gray-700 text-white hover:bg-gray-600' 
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              } ${isProcessing ? (isDarkMode ? 'opacity-50 cursor-not-allowed' : 'opacity-50 cursor-not-allowed') : ''}`}
              onClick={resetImport}
              disabled={isProcessing}
            >
              Nouvelle importation
            </button>
          </div>
        </div>

        <div className="flex-1 mr-2 pl-4 overflow-auto">
          {step === 1 && (
            <div>
              <h2 className={`text-xl font-semibold mb-4 ${isDarkMode ? 'text-blue-400' : 'text-gray-800'}`}>
                Sélection des fichiers
              </h2>
              
              <FileSelector 
                label="Fichier JSON source"
                accept={[".json"]}
                placeholder="Cliquez pour sélectionner un fichier JSON"
                value={jsonFile}
                onChange={setJsonFile}
                isDarkMode={isDarkMode}
              />

              <FileSelector 
                label="Base de données SQLite cible"
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
                      : 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer'
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
            <div className="flex flex-col h-full max-h-full">
              <h2 className={`text-xl font-semibold mb-4 ${isDarkMode ? 'text-blue-400' : 'text-gray-800'}`}>
                Structure JSON
              </h2>
              
              <div className="grid grid-cols-2 gap-6 flex-1 overflow-hidden" style={{ maxHeight: 'calc(100vh - 220px)' }}>
                <div className="flex flex-col h-full overflow-hidden">
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Aperçu JSON
                  </label>
                  <div className="flex-1 min-h-0">
                    <JsonPreview 
                      jsonContent={jsonContent}
                      className="h-full"
                      isDarkMode={isDarkMode}
                    />
                  </div>
                </div>
                
                <div className="flex flex-col h-full overflow-hidden">
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Chemin racine JSON
                  </label>
                  <p className={`text-sm mb-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Spécifiez le chemin pour accéder aux données à importer (ex: data.users[])
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
                  
                  <div className="flex-1 min-h-0 flex flex-col"> 
                    <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Structure détectée
                    </label>
                    <div className="flex-1 min-h-0"> 
                      <JsonPathExplorer 
                        jsonFilePath={jsonFile.path}
                        onPathSelect={setJsonRoot}
                        selectedPath={jsonRoot}
                        isDarkMode={isDarkMode}
                      />
                    </div>
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
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition"
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
                Sélection de table
              </h2>
              
              <div className={`border rounded-lg ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'} p-4 shadow-sm`}>
                <DbTableSelector 
                  dbFilePath={dbFile.path}
                  onTableSelect={setSelectedTable}
                  selectedTable={selectedTable}
                  isDarkMode={isDarkMode}
                />
              </div>

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
                    !selectedTable 
                      ? (isDarkMode ? 'bg-blue-800 text-blue-300 opacity-50 cursor-not-allowed' : 'bg-blue-300 text-blue-700 opacity-50 cursor-not-allowed')
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                  onClick={() => setStep(4)}
                  disabled={!selectedTable}
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
              
              <MappingEditor 
                jsonFilePath={jsonFile.path}
                jsonRootPath={jsonRoot}
                dbColumns={tableInfo.columns}
                mapping={mapping}
                onMappingChange={setMapping}
                isDarkMode={isDarkMode}
              />

              <div className="flex justify-between mt-6">
                <button
                  className={`px-4 py-2 rounded-md transition ${
                    isDarkMode 
                      ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' 
                      : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
                  }`}
                  onClick={() => setStep(3)}
                >
                  Retour
                </button>
                <button
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition"
                  onClick={() => setStep(5)}
                  disabled={Object.keys(mapping).length === 0}
                >
                  Continuer
                </button>
              </div>
            </div>
          )}

          {step === 5 && (
            <div>
              <h2 className={`text-xl font-semibold mb-4 ${isDarkMode ? 'text-blue-400' : 'text-gray-800'}`}>
                Configuration avancée
              </h2>
              
              <div className="grid grid-cols-2 gap-6 mb-6">
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Valeurs par défaut
                  </label>
                  <p className={`text-sm mb-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Définissez des valeurs qui seront utilisées lorsque des données sont nulles ou manquantes dans le JSON.
                    Utile pour les colonnes obligatoires qui pourraient ne pas être présentes dans toutes les entrées.
                  </p>
                  <div className={`border rounded-md p-4 h-60 overflow-auto ${
                    isDarkMode 
                      ? 'bg-gray-800 border-gray-600' 
                      : 'bg-gray-50 border-gray-300'
                  }`}>
                    <textarea
                      className={`w-full h-full font-mono text-sm ${
                        isDarkMode 
                          ? 'bg-gray-800 text-gray-200' 
                          : 'bg-gray-50 text-gray-800'
                      }`}
                      placeholder='{"name": "Sans nom", "email": "{{DYNAMIC}}"}'
                      value={defaultValues}
                      onChange={(e) => setDefaultValues(e.target.value)}
                    ></textarea>
                  </div>
                </div>
                
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Valeurs forcées
                  </label>
                  <p className={`text-sm mb-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Ces valeurs remplaceront systématiquement les données du JSON, même si elles existent.
                    Ceci permet d'uniformiser des données ou ajouter des champs supplémentaires comme par exemple "date_import" ou "source".

                  </p>
                  <div className={`border rounded-md p-4 h-60 overflow-auto ${
                    isDarkMode 
                      ? 'bg-gray-800 border-gray-600' 
                      : 'bg-gray-50 border-gray-300'
                  }`}>
                    <textarea
                      className={`w-full h-full font-mono text-sm ${
                        isDarkMode 
                          ? 'bg-gray-800 text-gray-200' 
                          : 'bg-gray-50 text-gray-800'
                      }`}
                      placeholder='{"created_at": "{{TIMESTAMP}}", "updated_by": "import-tool"}'
                      value={forcedValues}
                      onChange={(e) => setForcedValues(e.target.value)}
                    ></textarea>
                  </div>
                </div>
              </div>

              <div className="mb-6">
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Templates dynamiques
                </label>
                <p className={`text-sm mb-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Créez des valeurs personnalisées avec des placeholders pour générer des données uniques.
                  <br />
                  <span className="font-semibold">{`{{INDEX}}`}</span> - Indice numérique de chaque entrée
                  <br />
                  <span className="font-semibold">{`{{UUID}}`}</span> - Identifiant unique universel
                  <br />
                  <span className="font-semibold">{`{{TIMESTAMP}}`}</span> - Horodatage actuel
                </p>
                <div className={`border rounded-md p-4 h-24 overflow-auto ${
                  isDarkMode 
                    ? 'bg-gray-800 border-gray-600' 
                    : 'bg-gray-50 border-gray-300'
                }`}>
                  <textarea
                    className={`w-full h-full font-mono text-sm ${
                      isDarkMode 
                        ? 'bg-gray-800 text-gray-200' 
                        : 'bg-gray-50 text-gray-800'
                    }`}
                    placeholder='{"code": "PROD_{{INDEX}}", "uuid": "{{UUID}}"}'
                    value={dynamicValues}
                    onChange={(e) => setDynamicValues(e.target.value)}
                  ></textarea>
                </div>
              </div>

              <div className="mb-6">
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
                
                <div className="flex items-center">
                  <label className={`text-sm font-medium mr-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Limite:
                  </label>
                  <input 
                    type="number" 
                    className={`w-24 p-1 border rounded-md text-sm ${
                      isDarkMode 
                        ? 'bg-gray-800 border-gray-600 text-white' 
                        : 'bg-white border-gray-300 text-gray-800'
                    }`}
                    min="0" 
                    placeholder="0" 
                    value={limit || ''}
                    onChange={(e) => setLimit(e.target.value ? parseInt(e.target.value) : undefined)}
                  />
                  <span className={`mx-2 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Nombre max d'entrées à importer
                  </span>
                  
                  <label className={`text-sm font-medium mx-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Offset:
                  </label>
                  <input 
                    type="number"
                    className={`w-24 p-1 border rounded-md text-sm ${
                      isDarkMode 
                        ? 'bg-gray-800 border-gray-600 text-white' 
                        : 'bg-white border-gray-300 text-gray-800'
                    }`}
                    min="0" 
                    placeholder="0" 
                    value={offset || ''}
                    onChange={(e) => setOffset(e.target.value ? parseInt(e.target.value) : undefined)}
                  />
                  <span className={`ml-2 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Ignorer les N premières entrées
                  </span>
                </div>
              </div>

              <div className="flex justify-between mt-6">
                <button
                  className={`px-4 py-2 rounded-md transition ${
                    isDarkMode 
                      ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' 
                      : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
                  }`}
                  onClick={() => setStep(4)}
                  disabled={isProcessing}
                >
                  Retour
                </button>
                <button
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition"
                  onClick={startImport}
                  disabled={isProcessing}
                >
                  {isProcessing ? "Traitement en cours..." : "Lancer l'importation"}
                </button>
              </div>

              {isProcessing && (
                <div className={`mt-6 p-3 border rounded-md ${
                  isDarkMode 
                    ? 'bg-blue-900 border-blue-800 text-blue-200' 
                    : 'bg-blue-50 border-blue-200 text-blue-700'
                }`}>
                  <p className="flex items-center">
                    <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2"></span>
                    Traitement en cours. Vous serez redirigé vers l'onglet de résultats...
                  </p>
                </div>
              )}
            </div>
          )}

          {step === 6 && (
            <div className="flex flex-col h-full">
              <h2 className={`text-xl font-semibold mb-4 ${isDarkMode ? 'text-blue-400' : 'text-gray-800'}`}>
                Résultats d'importation
              </h2>
              
              {/* Conteneur principal avec hauteur max pour permettre aux boutons d'être visibles */}
              <div className="flex flex-col space-y-4 overflow-auto mb-4" style={{ maxHeight: 'calc(100vh - 220px)' }}>
                <div className={`p-4 border rounded-md ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'}`}>
                  <h3 className={`font-medium mb-3 ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>Progression</h3>
                  
                  <div className="w-full bg-gray-200 rounded-full h-2.5 mb-2">
                    <div 
                      className="bg-blue-600 h-2.5 rounded-full" 
                      style={{ width: `${progress ? Math.round((progress.processed / progress.total) * 100) : 0}%` }}
                    ></div>
                  </div>
                  
                  <div className={`flex flex-wrap justify-between text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    <span className="mb-1">
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
                </div>
                
                <div className={`p-4 border rounded-md ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'}`}>
                  <h3 className={`font-medium mb-3 ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>Logs d'importation</h3>
                  
                  <div className={`border rounded-md overflow-auto scrollbar-styled ${
                    isDarkMode 
                      ? 'bg-gray-900 border-gray-700' 
                      : 'bg-gray-50 border-gray-300'
                  }`} style={{ maxHeight: '300px' }}>
                    <div className="font-mono text-xs p-4 space-y-1">
                      {logs.length === 0 
                        ? <div className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>
                            Les logs d'importation apparaîtront ici...
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
                
                {!isProcessing && progress && progress.processed === progress.total && (
                  <div className={`p-4 border rounded-md ${
                    isDarkMode 
                      ? 'bg-green-900 border-green-800' 
                      : 'bg-green-50 border-green-200'
                  }`}>
                    <h3 className={`font-medium mb-2 ${
                      isDarkMode ? 'text-green-300' : 'text-green-700'
                    }`}>Importation terminée</h3>
                    <p className={isDarkMode ? 'text-green-200' : 'text-green-600'}>
                      {progress.succeeded} enregistrements importés avec succès.
                      {progress.failed > 0 && ` ${progress.failed} enregistrements ont échoué.`}
                    </p>
                  </div>
                )}
              </div>
              
              {/* Zone de boutons avec position fixe en bas de la section */}
              <div className="flex justify-between mt-2 py-2 sticky bottom-0 bg-inherit">
                <button
                  className={`px-4 py-2 rounded-md transition ${
                    isDarkMode 
                      ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' 
                      : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
                  }`}
                  onClick={() => setStep(5)}
                  disabled={isProcessing}
                >
                  Retour à la configuration
                </button>
                <button
                  onClick={resetImport}
                  className={`px-4 py-2 rounded-md transition ${
                    isDarkMode 
                      ? 'bg-blue-600 text-white hover:bg-blue-700' 
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                  disabled={isProcessing}
                >
                  Nouvelle importation
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default ImportPage;