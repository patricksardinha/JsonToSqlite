// json-to-sqlite.js
import fs from 'fs/promises';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Script pour transférer des données JSON vers une base de données SQLite3
 * 
 * Utilisation:
 * node json-to-sqlite.js --jsonPath=chemin/vers/fichier.json --dbPath=chemin/vers/database.sqlite 
 *                        --jsonProperty=prop.sousProp[].autreProp --table=nomTable --column=nomColonne
 *                        --limit=10 --offset=0 --dryRun=false
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
  jsonProperty: args.jsonProperty || '',
  table: args.table || '',
  column: args.column || '',
  limit: parseInt(args.limit || '0'),  // 0 = pas de limite
  offset: parseInt(args.offset || '0'),
  dryRun: args.dryRun === 'true'
};

// Vérification des paramètres obligatoires
if (!params.jsonProperty || !params.table || !params.column) {
  console.error('Erreur: Les paramètres --jsonProperty, --table et --column sont obligatoires');
  console.log(`
  Utilisation:
  node json-to-sqlite.js --jsonPath=chemin/vers/fichier.json --dbPath=chemin/vers/database.sqlite 
                         --jsonProperty=prop.sousProp[].autreProp --table=nomTable --column=nomColonne
                         --limit=10 --offset=0 --dryRun=false
                         
  Exemples de format pour jsonProperty:
  - "users"                    : Propriété simple
  - "data.users"               : Propriété imbriquée
  - "data.users[]"             : Tableau d'objets
  - "data.users[].name"        : Propriété spécifique dans chaque élément d'un tableau
  - "data.regions[].cities[]"  : Tableau imbriqué dans un autre tableau
  `);
  process.exit(1);
}

// Fonction pour extraire les données du JSON selon le chemin spécifié
function extractDataFromJson(jsonData, propertyPath) {
  // Analyse du chemin de propriété
  const pathSegments = propertyPath.split('.');
  let currentData = jsonData;
  let results = [];
  let isProcessingArray = false;
  
  // Traitement récursif pour extraire les données selon le chemin spécifié
  function processSegment(data, segments, currentIndex = 0) {
    if (currentIndex >= segments.length) {
      return [data];
    }
    
    let segment = segments[currentIndex];
    const isArray = segment.endsWith('[]');
    
    if (isArray) {
      segment = segment.slice(0, -2);
      isProcessingArray = true;
      
      if (!data[segment] || !Array.isArray(data[segment])) {
        console.error(`Erreur: ${segment} n'est pas un tableau dans les données JSON`);
        return [];
      }
      
      let allResults = [];
      data[segment].forEach((item, idx) => {
        console.log(`  Traitement de l'élément ${idx+1}/${data[segment].length} du tableau ${segment}`);
        const itemResults = processSegment(item, segments, currentIndex + 1);
        allResults = allResults.concat(itemResults);
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
  
  return {
    data: results,
    isArray: isProcessingArray
  };
}

// Fonction principale
async function main() {
  console.log('Démarrage du transfert JSON vers SQLite...');
  console.log('Paramètres:', params);
  
  try {
    // Lecture du fichier JSON
    console.log(`Lecture du fichier JSON: ${params.jsonPath}`);
    const fileData = await fs.readFile(params.jsonPath, 'utf-8');
    const jsonData = JSON.parse(fileData);
    
    // Extraction des données selon le chemin spécifié
    console.log(`Extraction des données pour le chemin: ${params.jsonProperty}`);
    const { data, isArray } = extractDataFromJson(jsonData, params.jsonProperty);
    
    console.log(`Données extraites: ${data.length} éléments`);
    
    if (data.length === 0) {
      console.error('Aucune donnée trouvée pour le chemin spécifié');
      process.exit(1);
    }
    
    // Affichage d'un échantillon si disponible
    console.log('Exemple de données:');
    console.log(JSON.stringify(data[0], null, 2));
    
    // Mode dry run (simulation)
    if (params.dryRun) {
      console.log('Mode DRY RUN activé - Aucune écriture en base de données');
      console.log(`${data.length} éléments seraient insérés dans la table ${params.table}, colonne ${params.column}`);
      return;
    }
    
    // Connexion à la base de données SQLite
    console.log(`Connexion à la base de données: ${params.dbPath}`);
    
    // Utilisation de promesse pour gérer les opérations SQLite asynchrones
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
    
    const getPromise = (query, params = []) => {
      return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
          if (err) reject(err);
          else resolve(row);
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
    
    // Vérification de l'existence de la table et de la colonne
    try {
      const tableInfo = await allPromise(`PRAGMA table_info(${params.table})`);
      
      if (!tableInfo || tableInfo.length === 0) {
        console.error(`La table ${params.table} n'existe pas dans la base de données`);
        db.close();
        process.exit(1);
      }
      
      const columnExists = tableInfo.some(col => col.name === params.column);
      if (!columnExists) {
        console.error(`La colonne ${params.column} n'existe pas dans la table ${params.table}`);
        db.close();
        process.exit(1);
      }
      
      // Insertion des données dans la base
      await runPromise('BEGIN TRANSACTION');
      
      console.log(`Insertion des données dans la table ${params.table}, colonne ${params.column}...`);
      let successCount = 0;
      let errorCount = 0;
      
      const stmt = db.prepare(`INSERT INTO ${params.table} (${params.column}) VALUES (?)`);
      
      // Conversion de l'exécution de statement en promesse
      const runStmt = (value) => {
        return new Promise((resolve, reject) => {
          stmt.run(value, function(err) {
            if (err) reject(err);
            else resolve(this);
          });
        });
      };
      
      for (const [index, item] of data.entries()) {
        try {
          // Préparation de la valeur à insérer
          let valueToInsert = item;
          
          // Si la valeur est un objet ou un tableau, on le convertit en JSON
          if (typeof valueToInsert === 'object' && valueToInsert !== null) {
            valueToInsert = JSON.stringify(valueToInsert);
          }
          
          await runStmt(valueToInsert);
          successCount++;
          
          if (successCount % 100 === 0 || successCount === data.length) {
            console.log(`Progression: ${successCount}/${data.length} éléments insérés`);
          }
        } catch (err) {
          console.error(`Erreur lors de l'insertion de l'élément ${index}:`, err.message);
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
      console.log(`Total d'éléments traités: ${data.length}`);
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