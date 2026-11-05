/* =====================================================================
   Omni-Notes — sw.js (le « service worker »)
   ---------------------------------------------------------------------
   Un service worker est un petit programme que le navigateur garde de
   côté. Ici, il range une copie de tous les fichiers de l'application
   dans un « cache » (une réserve sur le téléphone). Ensuite, même sans
   internet, l'application s'ouvre normalement à partir de cette réserve.

   Il ne touche JAMAIS aux notes : elles sont dans IndexedDB, pas ici.

   À CHAQUE MISE À JOUR de l'application, il faut changer le numéro
   ci-dessous (par exemple v1.0.0 → v1.0.1). C'est ce qui indique aux
   téléphones qu'une nouvelle version est disponible.
   ===================================================================== */

const VERSION_CACHE = 'omni-notes-v1.0.1';

// La liste de tous les fichiers nécessaires pour fonctionner hors ligne.
const FICHIERS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './db.js',
  './chiffrement.js',
  './manifest.json',
  './icones/icone.svg',
  './icones/icone-180.png',
  './icones/icone-192.png',
  './icones/icone-512.png',
  './icones/icone-maskable-512.png',
];

// 1. Installation : on remplit la réserve avec tous les fichiers.
//    « cache: 'reload' » force à prendre la toute dernière version en ligne.
self.addEventListener('install', (evenement) => {
  evenement.waitUntil(
    caches.open(VERSION_CACHE)
      .then((cache) => cache.addAll(FICHIERS.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

// 2. Activation : on supprime les anciennes réserves d'Omni-Notes.
//    Attention : on ne touche qu'aux réserves dont le nom commence par
//    « omni-notes- », car les autres applications du même site ont les leurs.
self.addEventListener('activate', (evenement) => {
  evenement.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(
        noms
          .filter((nom) => nom.startsWith('omni-notes-') && nom !== VERSION_CACHE)
          .map((nom) => caches.delete(nom))
      ))
      .then(() => self.clients.claim())
  );
});

// 3. Chaque fois que l'application demande un fichier :
//    on le prend d'abord dans la réserve (rapide, marche hors ligne),
//    sinon on va le chercher sur internet.
self.addEventListener('fetch', (evenement) => {
  const demande = evenement.request;
  if (demande.method !== 'GET') return;
  if (new URL(demande.url).origin !== self.location.origin) return;

  evenement.respondWith(
    caches.match(demande, { ignoreSearch: true }).then((reponse) => {
      if (reponse) return reponse;
      return fetch(demande).catch(() => {
        // Hors ligne et fichier inconnu : pour une page, on renvoie l'application.
        if (demande.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
