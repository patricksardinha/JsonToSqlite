import React, { useState, useEffect } from 'react';

interface JsonPreviewProps {
  jsonContent: string;
  className?: string;
  maxHeight?: string;
  isDarkMode?: boolean;
}

const JsonPreview: React.FC<JsonPreviewProps> = ({ 
  jsonContent, 
  className = '',
  maxHeight = '400px',
  isDarkMode = false
}) => {
  const [formattedJson, setFormattedJson] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jsonContent) {
      setFormattedJson('');
      setError(null);
      return;
    }

    try {
      // Essayer de parser le JSON pour vérifier sa validité
      const parsedJson = JSON.parse(jsonContent);
      
      // Formater le JSON avec une indentation de 2 espaces
      const formatted = JSON.stringify(parsedJson, null, 2);
      setFormattedJson(formatted);
      setError(null);
    } catch (err) {
      setError(`Erreur de parsing JSON: ${err instanceof Error ? err.message : String(err)}`);
      setFormattedJson(jsonContent);
    }
  }, [jsonContent]);

  const formatSyntax = (json: string): JSX.Element => {
    // Coloration syntaxique adaptée au mode sombre ou clair
    const keyColor = isDarkMode ? 'text-purple-400' : 'text-purple-600';
    const stringColor = isDarkMode ? 'text-green-400' : 'text-green-600';
    const numberColor = isDarkMode ? 'text-blue-400' : 'text-blue-600';
    const boolColor = isDarkMode ? 'text-red-400' : 'text-red-600';
    const nullColor = isDarkMode ? 'text-gray-400' : 'text-gray-500';
    
    const coloredJson = json
      .replace(/"([^"]+)":/g, `<span class="${keyColor}">"$1"</span>:`)  // Clés
      .replace(/: "([^"]+)"/g, `: <span class="${stringColor}">"$1"</span>`) // Valeurs string
      .replace(/: (\d+)/g, `: <span class="${numberColor}">$1</span>`)        // Valeurs numériques
      .replace(/: (true|false)/g, `: <span class="${boolColor}">$1</span>`)  // Valeurs booléennes
      .replace(/: (null)/g, `: <span class="${nullColor}">$1</span>`);      // Valeurs null

    return <div dangerouslySetInnerHTML={{ __html: coloredJson }} />;
  };

  return (
    <div className={className}>
      {error ? (
        <div className={`p-3 rounded-md mb-2 ${isDarkMode 
          ? 'bg-red-900 text-red-300 border border-red-800' 
          : 'bg-red-100 text-red-700'}`}
        >
          {error}
        </div>
      ) : null}
      <div 
        className={`font-mono text-xs p-4 rounded-md border overflow-auto whitespace-pre ${
          isDarkMode 
            ? 'bg-gray-800 border-gray-700' 
            : 'bg-gray-50 border-gray-300'
        }`}
        style={{ maxHeight }}
      >
        {formatSyntax(formattedJson)}
      </div>
    </div>
  );
};

export default JsonPreview;