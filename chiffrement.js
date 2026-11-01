/* =====================================================================
   Omni-Notes — chiffrement.js
   ---------------------------------------------------------------------
   Ce fichier rend les notes illisibles sans le mot de passe.
   Il utilise la « Web Crypto API », l'outil de chiffrement intégré au
   navigateur (le même type de protection que les banques en ligne).

   Comment ça marche, en deux temps :
   1. PBKDF2 transforme le mot de passe en une « clé » secrète.
      On mélange le mot de passe avec un « sel » (des octets au hasard,
      propres à chaque appareil) et on répète le calcul 600 000 fois.
      Ce calcul volontairement lent rend très difficile de deviner le
      mot de passe en essayant des millions de possibilités.
   2. AES-GCM utilise cette clé pour chiffrer chaque note.
      AES-GCM vérifie aussi l'intégrité : avec une mauvaise clé, ou si le
      contenu a été abîmé, le déchiffrement échoue au lieu de donner
      n'importe quoi.

   IMPORTANT : le mot de passe n'est JAMAIS enregistré. Sans lui, il est
   impossible de retrouver les notes. C'est voulu : c'est ce qui les protège.
   ===================================================================== */

// Nombre de répétitions du calcul PBKDF2 (valeur recommandée en 2026).
export const ITERATIONS = 600000;

/** Crée un nouveau « sel » : 16 octets tirés au hasard. */
export function nouveauSel() {
  return crypto.getRandomValues(new Uint8Array(16));
}

/**
 * Transforme le mot de passe en clé de chiffrement AES-GCM (256 bits).
 * La clé est « non extractible » : même le code de l'application ne
 * peut pas la lire ni la recopier, il peut seulement s'en servir.
 */
export async function deriverCle(motDePasse, sel, iterations = ITERATIONS) {
  const cleBrute = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(motDePasse),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: sel, iterations, hash: 'SHA-256' },
    cleBrute,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Chiffre n'importe quelle donnée (une note, une liste de notes…).
 * Renvoie { iv, donnees } sous forme de texte (base64) facile à stocker.
 * « iv » est un nombre tiré au hasard à chaque fois : deux notes
 * identiques donnent ainsi deux résultats chiffrés différents.
 */
export async function chiffrer(cle, objet) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  // On transforme d'abord l'objet en texte (JSON), puis en octets.
  const octets = new TextEncoder().encode(JSON.stringify(objet));
  const resultat = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cle, octets);
  return { iv: versBase64(iv), donnees: versBase64(new Uint8Array(resultat)) };
}

/**
 * Déchiffre un paquet { iv, donnees } et renvoie l'objet d'origine.
 * Provoque une erreur si la clé n'est pas la bonne.
 */
export async function dechiffrer(cle, paquet) {
  const resultat = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: depuisBase64(paquet.iv) },
    cle,
    depuisBase64(paquet.donnees)
  );
  return JSON.parse(new TextDecoder().decode(resultat));
}

/** Convertit des octets en texte base64 (lettres, chiffres, + et /). */
export function versBase64(octets) {
  let texte = '';
  // On avance par morceaux pour ne pas saturer la mémoire avec de longues notes.
  const morceau = 0x8000;
  for (let i = 0; i < octets.length; i += morceau) {
    texte += String.fromCharCode.apply(null, octets.subarray(i, i + morceau));
  }
  return btoa(texte);
}

/** Convertit un texte base64 en octets. */
export function depuisBase64(texte) {
  const binaire = atob(texte);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return octets;
}
