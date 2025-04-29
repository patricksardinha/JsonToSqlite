import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface DbTableSelectorProps {
  dbFilePath: string;
  onTableSelect: (tableName: string) => void;
  selectedTable: string;
  isDarkMode?: boolean;
}

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

const DbTableSelector: React.FC<DbTableSelectorProps> = ({ 
  dbFilePath, 
  onTableSelect,
  selectedTable,
  isDarkMode = false
}) => {
  const [tables, setTables] = useState<string[]>([]);
  const [tableInfo, setTableInfo] = useState<TableInfo | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLoadingTableInfo, setIsLoadingTableInfo] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Charger la liste des tables
  useEffect(() => {
    if (!dbFilePath) return;
    
    async function loadTables() {
      setIsLoading(true);
      setError(null);
      
      try {
        const result = await invoke<string[]>('db_get_tables', { 
          dbPath: dbFilePath 
        });
        
        setTables(result);
      } catch (err) {
        setError(`Erreur de chargement des tables: ${err instanceof Error ? err.message : String(err)}`);
        setTables([]);
      } finally {
        setIsLoading(false);
      }
    }
    
    loadTables();
  }, [dbFilePath]);

  // Charger les informations sur la table sélectionnée
  useEffect(() => {
    if (!dbFilePath || !selectedTable) {
      setTableInfo(null);
      return;
    }
    
    async function loadTableInfo() {
      setIsLoadingTableInfo(true);
      
      try {
        const result = await invoke<TableInfo>('db_analyze_table', { 
          dbPath: dbFilePath,
          tableName: selectedTable
        });
        
        setTableInfo(result);
      } catch (err) {
        console.error("Erreur lors du chargement des informations de table:", err);
        setTableInfo(null);
      } finally {
        setIsLoadingTableInfo(false);
      }
    }
    
    loadTableInfo();
  }, [dbFilePath, selectedTable]);

  return (
    <div>
      <div className="mb-4">
        <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          Table cible dans la base de données
        </label>
        
        {isLoading ? (
          <div className={`p-2 rounded-md flex items-center ${isDarkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
            <div className={`animate-spin rounded-full h-4 w-4 border-b-2 mr-2 ${isDarkMode ? 'border-blue-400' : 'border-blue-600'}`}></div>
            <span className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>Chargement des tables...</span>
          </div>
        ) : error ? (
          <div className={`p-2 rounded-md ${isDarkMode ? 'bg-red-900 text-red-300 border border-red-800' : 'text-red-500 bg-red-50'}`}>{error}</div>
        ) : tables.length === 0 ? (
          <div className={`p-2 rounded-md ${isDarkMode ? 'bg-gray-700 text-gray-300' : 'text-gray-500 bg-gray-50'}`}>Aucune table trouvée</div>
        ) : (
          <select 
            className={`w-full p-2 border rounded-md ${
              isDarkMode 
                ? 'bg-gray-700 border-gray-600 text-gray-200' 
                : 'bg-white border-gray-300 text-gray-800'
            }`}
            value={selectedTable}
            onChange={(e) => onTableSelect(e.target.value)}
          >
            <option value="" className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Sélectionnez une table</option>
            {tables.map(table => (
              <option key={table} value={table} className={isDarkMode ? 'text-white' : 'text-black'}>
                {table}
              </option>
            ))}
          </select>
        )}
      </div>

      {selectedTable && tableInfo && (
        <div className="mb-4">
          <h3 className={`text-md font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Structure de la table</h3>
          <div className={`border rounded-md overflow-hidden ${isDarkMode ? 'border-gray-700' : 'border-gray-300'}`}>
            <table className="min-w-full divide-y divide-gray-200">
              <thead className={isDarkMode ? 'bg-gray-700' : 'bg-gray-50'}>
                <tr>
                  <th className={`px-4 py-2 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>Colonne</th>
                  <th className={`px-4 py-2 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>Type</th>
                  <th className={`px-4 py-2 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>NOT NULL</th>
                  <th className={`px-4 py-2 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>Clé primaire</th>
                  <th className={`px-4 py-2 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>Valeur par défaut</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDarkMode ? 'bg-gray-800 divide-gray-700' : 'bg-white divide-gray-200'}`}>
                {tableInfo.columns.map((column, index) => (
                  <tr key={index} className={index % 2 === 0 
                    ? (isDarkMode ? 'bg-gray-800' : 'bg-white')
                    : (isDarkMode ? 'bg-gray-750' : 'bg-gray-50')
                  }>
                    <td className={`px-4 py-2 whitespace-nowrap text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
                      {column.name}
                    </td>
                    <td className={`px-4 py-2 whitespace-nowrap text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>
                      {column.data_type}
                    </td>
                    <td className={`px-4 py-2 whitespace-nowrap text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>
                      {column.not_null ? (
                        <span className={isDarkMode ? 'text-green-400' : 'text-green-600'}>✓</span>
                      ) : ''}
                    </td>
                    <td className={`px-4 py-2 whitespace-nowrap text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>
                      {column.primary_key ? (
                        <span className={isDarkMode ? 'text-yellow-400' : 'text-yellow-600'}>✓</span>
                      ) : ''}
                    </td>
                    <td className={`px-4 py-2 whitespace-nowrap text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>
                      {column.default_value || ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {tableInfo.unique_constraints.length > 0 && (
            <div className="mt-4">
              <h4 className={`text-sm font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Contraintes d'unicité
              </h4>
              <ul className={`text-sm list-disc pl-5 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {tableInfo.unique_constraints.map((constraint, index) => (
                  <li key={index} className={isDarkMode ? 'text-blue-400' : 'text-blue-600'}>
                    {constraint.join(', ')}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {selectedTable && isLoadingTableInfo && (
        <div className={`p-2 rounded-md flex items-center mb-4 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
          <div className={`animate-spin rounded-full h-4 w-4 border-b-2 mr-2 ${isDarkMode ? 'border-blue-400' : 'border-blue-600'}`}></div>
          <span className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>Chargement des informations de la table...</span>
        </div>
      )}
    </div>
  );
};

export default DbTableSelector;