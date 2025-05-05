import React from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';

const Home: React.FC = () => {
  const { isDarkMode } = useTheme();

  return (
    <div className={`flex flex-col h-screen ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-800'}`}>
      <div className="flex-1 overflow-auto">
        <div className="container mx-auto px-4 py-8 flex flex-col h-full">
          <div className="max-w-4xl mx-auto w-full">
            {/* En-tête */}
            <div className={`mb-8 p-8 rounded-lg ${isDarkMode ? 'bg-gray-800' : 'bg-white shadow-sm'}`}>
              <h1 className={`text-4xl font-bold mb-4 text-center ${isDarkMode ? 'text-gray-200' : 'text-gray-600'}`}>
                JSON SQLite Manager
              </h1>
            </div>
            
            {/* Fonctionnalités principales */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div className={`rounded-lg overflow-hidden border transition-transform transform hover:scale-105 ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white shadow-sm'}`}>
                <div className="bg-green-600 text-white p-4">
                  <h2 className="text-xl font-semibold">Importer des données</h2>
                </div>
                <div className="p-6">
                  <p className={`mb-6 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    Transférez des données depuis un fichier JSON vers une table SQLite.
                    Définissez des mappages, des valeurs par défaut et des transformations.
                    Vérifiez vos importations avec des "dry run".
                  </p>
                  <div className="flex justify-center">
                    <Link 
                      to="/import" 
                      className="px-5 py-3 bg-green-600 hover:bg-green-700 text-white rounded-md transition text-center font-medium"
                    >
                      Importer des données
                    </Link>
                  </div>
                </div>
              </div>
              
              <div className={`rounded-lg overflow-hidden border transition-transform transform hover:scale-105 ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white shadow-sm'}`}>
                <div className="bg-blue-600 text-white p-4">
                  <h2 className="text-xl font-semibold">Mettre à jour des données</h2>
                </div>
                <div className="p-6">
                  <p className={`mb-6 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                    Mettez à jour des enregistrements existants dans une base de données SQLite
                    à partir de données JSON, en utilisant une colonne de référence pour les faire correspondre.
                  </p>
                  <div className="flex justify-center">
                    <Link 
                      to="/update" 
                      className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition text-center font-medium"
                    >
                      Mettre à jour des données
                    </Link>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Fonctionnement */}
            <div className={`p-6 rounded-lg ${isDarkMode ? 'bg-gray-800' : 'bg-white shadow-sm'}`}>
              <h2 className={`text-2xl font-semibold mb-6 ${isDarkMode ? 'text-gray-200' : 'text-gray-600'}`}>
                Comment ça marche
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Étape 1 */}
                <div className={`p-6 rounded-lg ${isDarkMode ? 'bg-gray-700' : 'bg-blue-50'}`}>
                  <div className={`flex items-center justify-center w-12 h-12 mb-4 rounded-full ${isDarkMode ? 'bg-blue-600' : 'bg-blue-100'}`}>
                    <span className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-blue-800'}`}>1</span>
                  </div>
                  <h3 className={`text-lg font-medium mb-2 ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                    Sélection des fichiers
                  </h3>
                  <p className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>
                    Choisissez votre fichier JSON source et votre base de données SQLite cible.
                  </p>
                </div>
                
                {/* Étape 2 */}
                <div className={`p-6 rounded-lg ${isDarkMode ? 'bg-gray-700' : 'bg-blue-50'}`}>
                  <div className={`flex items-center justify-center w-12 h-12 mb-4 rounded-full ${isDarkMode ? 'bg-blue-600' : 'bg-blue-100'}`}>
                    <span className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-blue-800'}`}>2</span>
                  </div>
                  <h3 className={`text-lg font-medium mb-2 ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                    Configuration
                  </h3>
                  <p className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>
                    Définissez le mapping des champs et configurez les options d'importation.
                  </p>
                </div>
                
                {/* Étape 3 */}
                <div className={`p-6 rounded-lg ${isDarkMode ? 'bg-gray-700' : 'bg-blue-50'}`}>
                  <div className={`flex items-center justify-center w-12 h-12 mb-4 rounded-full ${isDarkMode ? 'bg-blue-600' : 'bg-blue-100'}`}>
                    <span className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-blue-800'}`}>3</span>
                  </div>
                  <h3 className={`text-lg font-medium mb-2 ${isDarkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                    Exécution
                  </h3>
                  <p className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>
                    Lancez l'importation ou la mise à jour et suivez la progression en temps réel.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;