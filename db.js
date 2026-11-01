/* =====================================================================
   Omni-Notes — db.js
   ---------------------------------------------------------------------
   Ce fichier s'occupe UNIQUEMENT du stockage des données sur l'appareil,
   grâce à IndexedDB (une petite base de données intégrée au navigateur).

   Rien n'est jamais envoyé sur internet : tout reste dans le téléphone.

   La base contient deux « magasins » (des sortes de tiroirs) :
     - « notes »    : une fiche par note (rangée par son identifiant « id ») ;
     - « reglages » : les préférences et les informations du mot de passe
                      (rangées par leur nom, dans le champ « cle »).
   ===================================================================== */

// Nom de la base. Il commence par « omni-notes » car toutes les applications
// publiées sur ferrusdantioch.github.io partagent le même espace de stockage :
// un nom unique évite de mélanger les données avec une autre application.
const NOM_BASE = 'omni-notes';

// Numéro de version de la structure de la base. On l'augmente seulement
// si un jour on change l'organisation des tiroirs.
const VERSION_BASE = 1;

// On garde la base ouverte une fois pour toutes (on la réutilise ensuite).
let promesseBase = null;

/**
 * Ouvre la base de données (et la crée la toute première fois).
 * Renvoie une « promesse » : un résultat qui arrivera un peu plus tard.
 */
export function ouvrirBase() {
  if (promesseBase) return promesseBase;

  promesseBase = new Promise((resoudre, rejeter) => {
    if (!('indexedDB' in window)) {
      rejeter(new Error('IndexedDB indisponible'));
      return;
    }
    const demande = indexedDB.open(NOM_BASE, VERSION_BASE);

    // Appelé seulement à la création, ou si VERSION_BASE augmente.
    demande.onupgradeneeded = () => {
      const base = demande.result;
      if (!base.objectStoreNames.contains('notes')) {
        base.createObjectStore('notes', { keyPath: 'id' });
      }
      if (!base.objectStoreNames.contains('reglages')) {
        base.createObjectStore('reglages', { keyPath: 'cle' });
      }
    };

    demande.onsuccess = () => {
      const base = demande.result;
      // Si une version plus récente de l'application s'ouvre dans un autre
      // onglet, on ferme proprement celle-ci pour ne pas la bloquer.
      base.onversionchange = () => base.close();
      resoudre(base);
    };
    demande.onerror = () => {
      promesseBase = null;
      rejeter(demande.error);
    };
  });

  return promesseBase;
}

/**
 * Outil interne : lance une « transaction » (un lot d'opérations) et
 * attend qu'elle soit TERMINÉE et ÉCRITE sur l'appareil avant de répondre.
 * - magasins : le ou les tiroirs concernés ;
 * - mode     : 'readonly' (lecture) ou 'readwrite' (écriture) ;
 * - travail  : une fonction qui fait les opérations et peut renvoyer
 *              une demande dont on veut récupérer le résultat.
 */
async function executer(magasins, mode, travail) {
  const base = await ouvrirBase();
  return new Promise((resoudre, rejeter) => {
    const transaction = base.transaction(magasins, mode);
    let demande = null;
    // « complete » = tout est bien enregistré : on peut répondre.
    transaction.oncomplete = () => resoudre(demande ? demande.result : undefined);
    transaction.onerror = () => rejeter(transaction.error);
    transaction.onabort = () => rejeter(transaction.error || new Error('Opération annulée'));
    demande = travail(transaction) || null;
  });
}

/** Lit TOUTES les fiches d'un tiroir. */
export function lireTout(magasin) {
  return executer(magasin, 'readonly', (t) => t.objectStore(magasin).getAll());
}

/** Lit UNE fiche grâce à sa clé (renvoie undefined si elle n'existe pas). */
export function lire(magasin, cle) {
  return executer(magasin, 'readonly', (t) => t.objectStore(magasin).get(cle));
}

/** Écrit (ou remplace) une fiche. */
export function ecrire(magasin, valeur) {
  return executer(magasin, 'readwrite', (t) => { t.objectStore(magasin).put(valeur); });
}

/** Efface une fiche grâce à sa clé. */
export function effacer(magasin, cle) {
  return executer(magasin, 'readwrite', (t) => { t.objectStore(magasin).delete(cle); });
}

/**
 * Fait plusieurs opérations « tout ou rien » :
 * soit TOUTES réussissent, soit AUCUNE n'est appliquée.
 * C'est essentiel pour ne jamais perdre de données, par exemple quand on
 * active le mot de passe (toutes les notes sont chiffrées d'un seul coup).
 *
 * Chaque opération ressemble à :
 *   { magasin: 'notes', action: 'ecrire', valeur: {...} }
 *   { magasin: 'notes', action: 'effacer', cle: 'id-de-la-note' }
 *   { magasin: 'notes', action: 'vider' }
 */
export function groupe(operations) {
  return executer(['notes', 'reglages'], 'readwrite', (t) => {
    for (const op of operations) {
      const tiroir = t.objectStore(op.magasin);
      if (op.action === 'ecrire') tiroir.put(op.valeur);
      else if (op.action === 'effacer') tiroir.delete(op.cle);
      else if (op.action === 'vider') tiroir.clear();
    }
  });
}
