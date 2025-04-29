import React from 'react';
import { open } from '@tauri-apps/plugin-dialog';

interface FileSelectorProps {
  label: string;
  accept: string[];  // Type tableau pour les extensions acceptées
  placeholder: string;
  value: { file: File | null; path: string };
  onChange: (value: { file: File | null; path: string }) => void;
  isDarkMode?: boolean;
}

const FileSelector: React.FC<FileSelectorProps> = ({ 
  label, 
  accept, 
  placeholder, 
  value, 
  onChange,
  isDarkMode = false 
}) => {
  const handleClick = async () => {
    try {
      // Ouvrir un dialogue de sélection de fichier natif
      const selected = await open({
        filters: [{
          name: 'Fichiers acceptés',
          extensions: accept.map(ext => ext.replace('.', ''))
        }],
        multiple: false
      });

      if (selected && !Array.isArray(selected)) {
        // Si un fichier est sélectionné et que ce n'est pas un tableau (single selection)
        // Vous n'avez pas accès au File objet, mais vous avez le chemin
        const filePath = selected;
        
        // Récupérer le nom du fichier à partir du chemin
        const fileName = filePath.split(/[\\/]/).pop() || '';
        
        // Vous pouvez créer un objet File pour la compatibilité, mais il ne sera pas utilisé
        // C'est surtout pour l'affichage
        onChange({
          file: new File([], fileName),
          path: filePath
        });
      }
    } catch (err) {
      console.error('Erreur lors de la sélection du fichier:', err);
    }
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange({ file: null, path: '' });
  };

  return (
    <div className="mb-4">
      <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
        {label}
      </label>
      <div 
        className={`cursor-pointer border rounded-md p-4 transition ${
          isDarkMode 
            ? 'border-gray-700 bg-gray-800 hover:bg-gray-700' 
            : 'border-gray-300 bg-gray-50 hover:bg-gray-100'
        }`}
        onClick={handleClick}
      >
        <div className="text-center">
          {!value.path ? (
            <>
              <div className={`mb-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {placeholder}
              </div>
              <div className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                Cliquez pour sélectionner
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between">
              <div className={`text-sm font-medium ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                {value.path}
              </div>
              <button 
                type="button"
                className={`${isDarkMode ? 'text-red-400 hover:text-red-300' : 'text-red-500 hover:text-red-700'}`}
                onClick={handleRemove}
              >
                Supprimer
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FileSelector;