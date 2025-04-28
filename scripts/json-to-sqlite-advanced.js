// json-to-sqlite-dynamic.js
import fs from 'fs/promises';
import sqlite3 from 'sqlite3';
import path from 'path';
import crypto from 'crypto';

/**
 * Script avancé pour transférer des données JSON vers une base de données SQLite3
 * Avec support pour valeurs par défaut dynamiques (pour UNIQUE) et valeurs forcées
 * 
 * Utilisation:
 * node json-to-sqlite-dynamic.js --jsonPath=chemin/vers/fichier.json 
 *                                --dbPath=chemin/vers/database.sqlite 
 *                                --jsonRoot=data.users[] 
 *                                --table=users 
 *                                --mappingFile=chemin/vers/mapping.json
 *                                --defaultsFile=chemin/vers/defaults.json
 *                                --limit=10 --offset=0 --dryRun=false
 */

// Traitement des paramètres de ligne de commande
const args = {};
process.argv.slice(2).forEach(arg => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  args[key] = value;
});

// Paramètres avec valeurs par défaut
const params = {
  jsonPath: args.jsonPath || './data.json',
  dbPath: args.dbPath || './database.sqlite',
  jsonRoot: args.jsonRoot || '',  // Chemin racine pour trouver les objets à insérer
  table: args.table || '',
  mappingFile: args.mappingFile || './mapping.json',  // Fichier de mapping
  defaultsFile: args.defaultsFile || './defaults.json',  // Fichier de valeurs par défaut et forcées
  limit: parseInt(args.limit || '0'),  // 0 = pas de limite
  offset: parseInt(args.offset || '0'),
  dryRun: args.dryRun === 'true'
};

// Fonction pour récupérer la valeur à partir d'un chemin dans un objet
function getValueByPath(obj, path) {
  return path.split('.').reduce((o, key) => (o && o[key] !== undefined) ? o[key] : null, obj);
}

// Fonction pour extraire les objets racine du JSON selon le chemin spécifié
function extractRootObjects(jsonData, rootPath) {
  const pathSegments = rootPath.split('.');
  let currentData = jsonData;
  let results = [];
  
  // Traitement récursif pour extraire les données selon le chemin spécifié
  function processSegment(data, segments, currentIndex = 0) {
    if (currentIndex >= segments.length) {
      return [data];
    }
    
    let segment = segments[currentIndex];
    const isArray = segment.endsWith('[]');
    
    if (isArray) {
      segment = segment.slice(0, -2);
      
      if (!data[segment] || !Array.isArray(data[segment])) {
        console.error(`Erreur: ${segment} n'est pas un tableau dans les données JSON`);
        return [];
      }
      
      let allResults = [];
      data[segment].forEach((item, idx) => {
        if (currentIndex === segments.length - 1) {
          // C'est le dernier segment et c'est un tableau, on ajoute chaque élément directement
          allResults.push(item);
        } else {
          // C'est un tableau intermédiaire, on traite les éléments suivants
          const itemResults = processSegment(item, segments, currentIndex + 1);
          allResults = allResults.concat(itemResults);
        }
      });
      
      return allResults;
    } else {
      if (data[segment] === undefined) {
        console.error(`Erreur: La propriété ${segment} n'existe pas dans les données JSON`);
        return [];
      }
      
      return processSegment(data[segment], segments, currentIndex + 1);
    }
  }
  
  results = processSegment(currentData, pathSegments);
  
  // Application de offset et limit
  if (params.offset > 0 || params.limit > 0) {
    const end = params.limit > 0 ? params.offset + params.limit : undefined;
    results = results.slice(params.offset, end);
  }
  
  return results;
}

// Fonction pour générer une valeur dynamique selon le type
function generateDynamicValue(type, columnName, index) {
  // Génération basée sur le type SQLite et le nom de colonne
  if (type.toLowerCase().includes('int')) {
    // Pour les types entiers (INTEGER, INT, etc.)
    return index + 1000; // Base + index pour être unique
  } 
  else if (type.toLowerCase().includes('text') || type.toLowerCase().includes('char') || type.toLowerCase().includes('varchar')) {
    // Pour les types texte (TEXT, VARCHAR, CHAR, etc.)
    if (columnName.toLowerCase().includes('id') || columnName.toLowerCase().includes('code') || columnName.toLowerCase().includes('identifier')) {
      // Pour les identifiants (généralement de format spécifique)
      return `${columnName.substring(0, 3).toUpperCase()}_${Date.now()}_${index}`;
    }
    else if (columnName.toLowerCase().includes('email')) {
      // Pour les emails
      return `user${index}@example.com`;
    }
    else if (columnName.toLowerCase().includes('name')) {
      // Pour les noms
      return `Name_${index}`;
    }
    else if (columnName.toLowerCase().includes('title')) {
      // Pour les titres
      return `Title ${index}`;
    }
    else if (columnName.toLowerCase().includes('description')) {
      // Pour les descriptions
      return `Description for item ${index}`;
    }
    else {
      // Pour les autres champs textuels
      return `${columnName}_${crypto.randomBytes(4).toString('hex')}_${index}`;
    }
  } 
  else if (type.toLowerCase().includes('real') || type.toLowerCase().includes('float') || type.toLowerCase().includes('double')) {
    // Pour les types nombres à virgule (REAL, FLOAT, DOUBLE, etc.)
    return parseFloat((Math.random() * 100).toFixed(2));
  } 
  else if (type.toLowerCase().includes('date') || type.toLowerCase().includes('time')) {
    // Pour les types date/heure
    const date = new Date();
    date.setDate(date.getDate() + index); // Différente date pour chaque index
    return date.toISOString().split('T')[0];
  } 
  else if (type.toLowerCase().includes('bool')) {
    // Pour les types booléens
    return index % 2 === 0 ? 1 : 0;
  } 
  else {
    // Fallback pour les autres types
    return `${columnName}_${index}`;
  }
}

// Fonction principale
async function main() {
  console.log('Démarrage du transfert JSON vers SQLite (avec valeurs dynamiques)...');
  console.log('Paramètres:', params);
  
  try {
    // Vérification des paramètres obligatoires
    if (!params.jsonRoot || !params.table || !params.mappingFile) {
      console.error('Erreur: Les paramètres --jsonRoot, --table et --mappingFile sont obligatoires');
      console.log(`
      Utilisation:
      node json-to-sqlite-dynamic.js --jsonPath=chemin/vers/fichier.json 
                                     --dbPath=chemin/vers/database.sqlite 
                                     --jsonRoot=data.users[] 
                                     --table=users 
                                     --mappingFile=chemin/vers/mapping.json
                                     --defaultsFile=chemin/vers/defaults.json
                                     --limit=10 --offset=0 --dryRun=false
                                     
      Format pour jsonRoot:
      - "users"                    : Collection d'objets dans une propriété simple
      - "data.users"               : Collection d'objets dans une propriété imbriquée
      - "data.users[]"             : Tableau d'objets
      - "data.regions[].cities[]"  : Tableau imbriqué dans un autre tableau
      
      Format pour le fichier defaults.json:
      {
        "defaults": {
          "colonne1": "valeur par défaut 1",
          "colonne2": 0,
          "colonne3": null,
          "colonne4": "{{DYNAMIC}}"  // Valeur dynamique générée automatiquement
        },
        "forced": {
          "colonne5": "valeur forcée 1",
          "colonne6": 42,
          "colonne7": "{{DYNAMIC}}"  // Valeur dynamique forcée
        },
        "dynamic": {
          "colonne8": "custom_prefix_{{INDEX}}",  // Template personnalisé avec index
          "colonne9": "{{UUID}}",  // UUID généré
          "colonne10": "{{TIMESTAMP}}"  // Timestamp actuel
        }
      }
      
      Les valeurs par défaut sont utilisées seulement si la valeur correspondante
      dans le JSON est null ou undefined. Les valeurs forcées remplacent toujours
      les valeurs du JSON, même si elles existent.
      
      Les valeurs dynamiques peuvent utiliser les placeholders suivants:
      - {{DYNAMIC}} : Génère une valeur selon le type de la colonne
      - {{INDEX}} : Inclut l'index de l'élément
      - {{UUID}} : Génère un UUID v4
      - {{TIMESTAMP}} : Génère un timestamp actuel
      `);
      process.exit(1);
    }
    
    // Lecture du fichier de mapping
    console.log(`Lecture du fichier de mapping: ${params.mappingFile}`);
    const mappingData = await fs.readFile(params.mappingFile, 'utf-8');
    const mapping = JSON.parse(mappingData);
    
    console.log('Mapping chargé:', mapping);
    
    // Lecture du fichier de valeurs par défaut et forcées
    let defaults = { defaults: {}, forced: {}, dynamic: {} };
    try {
      console.log(`Lecture du fichier de valeurs par défaut et forcées: ${params.defaultsFile}`);
      const defaultsData = await fs.readFile(params.defaultsFile, 'utf-8');
      defaults = JSON.parse(defaultsData);
    } catch (error) {
      console.log('Aucun fichier de valeurs par défaut trouvé ou erreur de lecture, utilisation des valeurs vides par défaut');
    }
    
    console.log('Valeurs par défaut chargées:', defaults.defaults);
    console.log('Valeurs forcées chargées:', defaults.forced);
    console.log('Templates dynamiques chargés:', defaults.dynamic || {});
    
    // Lecture du fichier JSON
    console.log(`Lecture du fichier JSON: ${params.jsonPath}`);
    const fileData = await fs.readFile(params.jsonPath, 'utf-8');
    const jsonData = JSON.parse(fileData);
    
    // Extraction des objets racine selon le chemin spécifié
    console.log(`Extraction des objets pour le chemin racine: ${params.jsonRoot}`);
    const rootObjects = extractRootObjects(jsonData, params.jsonRoot);
    
    console.log(`Objets extraits: ${rootObjects.length}`);
    
    if (rootObjects.length === 0) {
      console.error('Aucun objet trouvé pour le chemin racine spécifié');
      process.exit(1);
    }
    
    // Connexion à la base de données SQLite pour obtenir les informations sur la table
    console.log(`Connexion à la base de données: ${params.dbPath}`);
    const db = new sqlite3.Database(params.dbPath);
    
    // Conversion des méthodes SQLite en promesses
    const runPromise = (query, params = []) => {
      return new Promise((resolve, reject) => {
        db.run(query, params, function(err) {
          if (err) reject(err);
          else resolve(this);
        });
      });
    };
    
    const allPromise = (query, params = []) => {
      return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
    };
    
    // Vérification de l'existence de la table et des colonnes
    let tableInfo;
    try {
      tableInfo = await allPromise(`PRAGMA table_info(${params.table})`);
      
      if (!tableInfo || tableInfo.length === 0) {
        console.error(`La table ${params.table} n'existe pas dans la base de données`);
        db.close();
        process.exit(1);
      }
    } catch (err) {
      console.error(`Erreur lors de la vérification de la table: ${err.message}`);
      db.close();
      process.exit(1);
    }
    
    // Extraction des informations sur les colonnes de la table
    const tableColumns = tableInfo.map(col => ({
      name: col.name,
      type: col.type,
      notNull: col.notnull === 1,
      primaryKey: col.pk === 1,
      defaultValue: col.dflt_value
    }));
    
    console.log('Structure de la table:', tableColumns);
    
    // Vérification des index uniques pour identifier les contraintes UNIQUE
    let uniqueColumns = [];
    try {
      const indexInfo = await allPromise(`PRAGMA index_list(${params.table})`);
      
      for (const index of indexInfo) {
        if (index.unique === 1) {
          const indexDetails = await allPromise(`PRAGMA index_info(${index.name})`);
          const columns = indexDetails.map(idx => {
            const colInfo = tableColumns.find(col => col.name === idx.name);
            return {
              name: idx.name,
              type: colInfo ? colInfo.type : 'TEXT'
            };
          });
          
          uniqueColumns = uniqueColumns.concat(columns);
        }
      }
      
      // Éliminer les doublons
      uniqueColumns = Array.from(new Set(uniqueColumns.map(col => col.name)))
        .map(name => {
          const col = uniqueColumns.find(c => c.name === name);
          return { name, type: col.type };
        });
      
      console.log('Colonnes avec contrainte UNIQUE:', uniqueColumns.map(col => col.name));
    } catch (err) {
      console.error(`Erreur lors de la vérification des contraintes UNIQUE: ${err.message}`);
    }
    
    // Préparation des données à insérer avec le mapping et les valeurs par défaut/forcées/dynamiques
    const dataToInsert = rootObjects.map((obj, index) => {
      const mappedData = {};
      
      // Application du mapping
      Object.entries(mapping).forEach(([jsonPath, columnName]) => {
        mappedData[columnName] = getValueByPath(obj, jsonPath);
      });
      
      // Application des valeurs par défaut (seulement si la valeur est null/undefined)
      Object.entries(defaults.defaults || {}).forEach(([columnName, defaultValue]) => {
        if (mappedData[columnName] === null || mappedData[columnName] === undefined) {
          // Vérifier si c'est une valeur dynamique
          if (defaultValue === '{{DYNAMIC}}') {
            const colInfo = tableColumns.find(col => col.name === columnName);
            
            if (colInfo) {
              mappedData[columnName] = generateDynamicValue(colInfo.type, columnName, index);
            } else {
              mappedData[columnName] = `${columnName}_${index}`;
            }
          } else {
            mappedData[columnName] = defaultValue;
          }
        }
      });
      
      // Application des valeurs forcées (remplacent toujours les valeurs existantes)
      Object.entries(defaults.forced || {}).forEach(([columnName, forcedValue]) => {
        // Vérifier si c'est une valeur dynamique
        if (forcedValue === '{{DYNAMIC}}') {
          const colInfo = tableColumns.find(col => col.name === columnName);
          
          if (colInfo) {
            mappedData[columnName] = generateDynamicValue(colInfo.type, columnName, index);
          } else {
            mappedData[columnName] = `${columnName}_${index}`;
          }
        } else {
          mappedData[columnName] = forcedValue;
        }
      });
      
      // Application des templates personnalisés
      Object.entries(defaults.dynamic || {}).forEach(([columnName, template]) => {
        let value = template;
        
        // Remplacement des placeholders
        if (template.includes('{{INDEX}}')) {
          value = value.replace(/{{INDEX}}/g, index.toString());
        }
        
        if (template.includes('{{UUID}}')) {
          value = value.replace(/{{UUID}}/g, crypto.randomUUID());
        }
        
        if (template.includes('{{TIMESTAMP}}')) {
          value = value.replace(/{{TIMESTAMP}}/g, Date.now().toString());
        }
        
        mappedData[columnName] = value;
      });
      
      // Traitement spécial pour les colonnes avec contrainte UNIQUE + NOT NULL sans valeur
      uniqueColumns.forEach(uniqueCol => {
        const colName = uniqueCol.name;
        const colType = uniqueCol.type;
        
        // Vérifier si la colonne a une contrainte NOT NULL et n'a pas déjà une valeur
        const colInfo = tableColumns.find(col => col.name === colName);
        
        if (colInfo && colInfo.notNull && (mappedData[colName] === null || mappedData[colName] === undefined)) {
          // Générer une valeur unique
          mappedData[colName] = generateDynamicValue(colType, colName, index);
        }
      });
      
      return mappedData;
    });
    
    // Affichage d'un échantillon si disponible
    console.log('Exemple de données mappées avec valeurs dynamiques:');
    console.log(JSON.stringify(dataToInsert[0], null, 2));
    
    // Mode dry run (simulation)
    if (params.dryRun) {
      console.log('Mode DRY RUN activé - Aucune écriture en base de données');
      console.log(`${dataToInsert.length} objets seraient insérés dans la table ${params.table}`);
      console.log(`Colonnes: ${Object.keys(dataToInsert[0]).join(', ')}`);
      db.close();
      return;
    }
    
    try {
      // Vérification des contraintes NOT NULL
      const notNullColumns = tableColumns.filter(col => col.notNull && !col.primaryKey);
      const notNullColumnNames = notNullColumns.map(col => col.name);
      
      // Récupération de toutes les colonnes existantes dans la table
      const allTableColumnNames = tableColumns.map(col => col.name);
      
      // Identification des colonnes à inclure dans l'insertion
      const allMappedColumns = new Set([
        ...Object.values(mapping),
        ...Object.keys(defaults.defaults || {}),
        ...Object.keys(defaults.forced || {}),
        ...Object.keys(defaults.dynamic || {})
      ]);
      
      const columnsToInclude = Array.from(allMappedColumns).filter(col => allTableColumnNames.includes(col));
      
      // Vérification si toutes les colonnes NOT NULL sont couvertes
      const missingRequiredColumns = notNullColumnNames.filter(col => 
        !columnsToInclude.includes(col) && 
        tableColumns.find(tc => tc.name === col)?.defaultValue === null
      );
      
      if (missingRequiredColumns.length > 0) {
        console.error(`Colonnes avec contrainte NOT NULL sans valeur par défaut ni mapping: ${missingRequiredColumns.join(', ')}`);
        console.error(`Ajoutez ces colonnes à votre mapping ou définissez des valeurs par défaut pour elles.`);
        db.close();
        process.exit(1);
      }
      
      // Préparation des données à insérer en fonction des colonnes à inclure
      const finalDataToInsert = dataToInsert.map(item => {
        const result = {};
        columnsToInclude.forEach(col => {
          result[col] = item[col];
        });
        return result;
      });
      
      // Construction de la requête d'insertion
      const columns = columnsToInclude;
      const placeholders = columns.map(() => '?').join(', ');
      
      const insertQuery = `INSERT INTO ${params.table} (${columns.join(', ')}) VALUES (${placeholders})`;
      console.log(`Requête préparée: ${insertQuery}`);
      
      // Insertion des données dans la base
      await runPromise('BEGIN TRANSACTION');
      
      console.log(`Insertion des données dans la table ${params.table}...`);
      let successCount = 0;
      let errorCount = 0;
      
      const stmt = db.prepare(insertQuery);
      
      // Conversion de l'exécution de statement en promesse
      const runStmt = (values) => {
        return new Promise((resolve, reject) => {
          stmt.run(values, function(err) {
            if (err) reject(err);
            else resolve(this);
          });
        });
      };
      
      for (const [index, item] of finalDataToInsert.entries()) {
        try {
          // Préparation des valeurs à insérer
          const values = columns.map(col => {
            let val = item[col];
            
            // Si la valeur est un objet ou un tableau, on le convertit en JSON
            if (typeof val === 'object' && val !== null) {
              val = JSON.stringify(val);
            }
            
            return val;
          });
          
          await runStmt(values);
          successCount++;
          
          if (successCount % 100 === 0 || successCount === finalDataToInsert.length) {
            console.log(`Progression: ${successCount}/${finalDataToInsert.length} objets insérés`);
          }
        } catch (err) {
          console.error(`Erreur lors de l'insertion de l'objet ${index}:`, err.message);
          errorCount++;
        }
      }
      
      // Finalisation du statement
      await new Promise((resolve, reject) => {
        stmt.finalize(err => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      // Commit de la transaction
      await runPromise('COMMIT');
      
      console.log('\nRésumé:');
      console.log(`Total d'objets traités: ${finalDataToInsert.length}`);
      console.log(`Insertions réussies: ${successCount}`);
      console.log(`Erreurs: ${errorCount}`);
      
    } catch (err) {
      console.error('Erreur lors de l\'opération SQLite:', err.message);
      await runPromise('ROLLBACK').catch(() => {});
    }
    
    // Fermeture de la connexion
    db.close();
    console.log('Connexion à la base de données fermée');
    
  } catch (error) {
    console.error('Erreur:', error.message);
    process.exit(1);
  }
}

// Exécution du script
main();