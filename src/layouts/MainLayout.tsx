import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import ThemeToggle from '../components/ThemeToggle';

const MainLayout: React.FC = () => {
  const { isDarkMode } = useTheme();
  const location = useLocation();
  
  // Déterminer quelle page est active
  const isHome = location.pathname === '/';
  const isImport = location.pathname === '/import';
  const isUpdate = location.pathname === '/update';

  return (
    <div className={`flex flex-col h-screen ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-800'}`}>
      {/* Header */}
      <header className={`px-6 py-3 border-b ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} shadow-sm`}>
        <div className="container mx-auto flex justify-between items-center">
          <div className="flex items-center space-x-1">
            <Link to="/" className={`text-xl font-bold ${isDarkMode ? 'text-gray-200' : 'text-gray-600'}`}>
              JSON SQLite Manager
            </Link>
          </div>
          
          <nav className="flex items-center space-x-6">
            <Link 
              to="/" 
              className={`px-3 py-2 rounded-md transition font-semibold ${
                isHome 
                  ? (isDarkMode ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-700') 
                  : (isDarkMode ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-100')
              }`}
            >
              Accueil
            </Link>
            <Link 
              to="/import" 
              className={`px-3 py-2 rounded-md transition font-semibold ${
                isImport 
                  ? (isDarkMode ? 'bg-green-700 text-white' : 'bg-green-100 text-green-600')
                  : (isDarkMode ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-100')
              }`}
            >
              Importer
            </Link>
            <Link 
              to="/update" 
              className={`px-3 py-2 rounded-md transition font-semibold ${
                isUpdate 
                  ? (isDarkMode ? 'bg-blue-700 text-white' : 'bg-blue-100 text-blue-700')
                  : (isDarkMode ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-100')
              }`}
            >
              Mettre à jour
            </Link>
            
            <ThemeToggle />
          </nav>
        </div>
      </header>
      
      {/* Contenu principal avec Outlet pour les routes imbriquées */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
};

export default MainLayout;