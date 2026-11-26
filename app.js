/* =====================================================================
   Omni-Notes — app.js
   ---------------------------------------------------------------------
   Le « cerveau » de l'application. Il s'occupe :
     1. du démarrage et du déverrouillage ;
     2. de la navigation entre les écrans (et du bouton « retour » du téléphone) ;
     3. des notes : création, modification, enregistrement automatique ;
     4. de la liste : recherche, épinglage, couleurs, étiquettes ;
     5. de la corbeille (30 jours) ;
     6. de la sauvegarde : export, import, rappel ;
     7. du mot de passe optionnel (chiffrement) ;
     8. des réglages (thème, taille du texte).

   Règle de sécurité : le texte des notes est toujours affiché avec
   « textContent » (jamais « innerHTML »). Ainsi, même un fichier importé
   piégé ne peut pas exécuter de code dans l'application.
   © 2026 Ferrus Dantioch — Licence CC BY-NC-ND 4.0
   ===================================================================== */

import * as db from './db.js';
import * as chiffrement from './chiffrement.js';

/* =====================================================================
   0. Constantes et état de l'application
   ===================================================================== */

const VERSION = '1.1.0';
const JOUR = 24 * 60 * 60 * 1000;            // un jour, en millisecondes
const DUREE_CORBEILLE = 30 * JOUR;            // durée de conservation dans la corbeille
const DELAI_RAPPEL = 14 * JOUR;               // rappel de sauvegarde après 14 jours
const DELAI_REPORT_RAPPEL = 3 * JOUR;         // « Plus tard » = on redemande dans 3 jours
const DELAI_VERROU_AUTO = 5 * 60 * 1000;      // reverrouillage après 5 min en arrière-plan
const DELAI_ENREGISTREMENT = 500;             // on enregistre 0,5 s après la dernière frappe
const LONGUEUR_MIN_MDP = 6;
const TEXTE_VERIFICATION = 'omni-notes';      // sert à vérifier que le mot de passe est bon
const CLE_APPARENCE = 'omni-notes-apparence'; // copie du thème pour l'afficher sans attendre
const TRIS_VALIDES = ['modification', 'creation', 'titre', 'couleur'];
const DELAIS_INACTIVITE = [0, 5, 15, 30];

const COULEURS = [
  { id: 'aucune', nom: 'sans couleur' },
  { id: 'rouge', nom: 'rouge' },
  { id: 'orange', nom: 'orange' },
  { id: 'jaune', nom: 'jaune' },
  { id: 'vert', nom: 'vert' },
  { id: 'bleu', nom: 'bleu' },
  { id: 'violet', nom: 'violet' },
];

const MODELES_INTEGRES = [
  {
    id: 'modele-reunion',
    nom: 'Réunion',
    type: 'texte',
    titre: 'Réunion',
    contenu: 'Date :\nParticipants :\n\nOrdre du jour :\n- \n\nDécisions :\n- \n\nActions à suivre :\n- ',
    couleur: 'bleu',
    etiquettes: [],
  },
  {
    id: 'modele-suivi-medical',
    nom: 'Suivi médical',
    type: 'texte',
    titre: 'Suivi médical',
    contenu: 'Date :\nProfessionnel :\n\nMotif / observations :\n\nTraitement / consignes :\n\nProchain rendez-vous :',
    couleur: 'vert',
    etiquettes: [],
  },
  {
    id: 'modele-valise',
    nom: 'Liste de valise',
    type: 'liste',
    titre: 'Liste de valise',
    elements: [
      { texte: 'Papiers et billets', coche: false },
      { texte: 'Téléphone et chargeur', coche: false },
      { texte: 'Vêtements', coche: false },
      { texte: 'Trousse de toilette', coche: false },
      { texte: 'Médicaments', coche: false },
    ],
    couleur: 'orange',
    etiquettes: [],
  },
  {
    id: 'modele-courses',
    nom: 'Liste de courses',
    type: 'liste',
    titre: 'Liste de courses',
    elements: [
      { texte: 'Pain', coche: false },
      { texte: 'Lait', coche: false },
      { texte: 'Fruits et légumes', coche: false },
    ],
    couleur: 'jaune',
    etiquettes: ['Courses'],
  },
];

// Préférences par défaut (enregistrées dans le tiroir « reglages »).
const PREFERENCES_DEFAUT = {
  cle: 'preferences',
  theme: 'auto',                  // 'auto' | 'clair' | 'sombre'
  taille: 'normale',              // 'normale' | 'grande' | 'tres-grande'
  tri: 'modification',            // 'modification' | 'creation' | 'titre' | 'couleur'
  verrouInactiviteMinutes: 0,    // 0 | 5 | 15 | 30
  derniereSauvegarde: null,       // date du dernier export
  premiereUtilisation: null,      // date du tout premier lancement
  rappelReporteJusqua: null,      // date jusqu'à laquelle le rappel est mis en pause
};

// « etat » regroupe tout ce que l'application a en mémoire.
const etat = {
  prefs: { ...PREFERENCES_DEFAUT },
  securite: null,        // informations du mot de passe (sel, vérification…) ou null
  cle: null,             // clé de chiffrement en mémoire, quand c'est déverrouillé
  verrouille: false,
  notes: [],             // toutes les notes, déchiffrées, en mémoire
  modeles: [],           // modèles personnalisés, déchiffrés, en mémoire
  notesIllisibles: 0,    // notes abîmées qu'on n'a pas pu lire
  noteOuverteId: null,   // identifiant de la note en cours d'édition
  masquerCoches: false,  // masquer temporairement les lignes cochées dans la note ouverte
  ecran: 'chargement',
  recherche: '',
  filtreEtiquette: null,
  cacheeDepuis: null,    // moment où l'application est passée en arrière-plan
};

/* =====================================================================
   Petits outils
   ===================================================================== */

const $ = (selecteur) => document.querySelector(selecteur);

/** Crée un élément HTML. Exemple : creer('p', { classe: 'info', texte: 'Bonjour' }) */
function creer(balise, options = {}, enfants = []) {
  const element = document.createElement(balise);
  for (const [nom, valeur] of Object.entries(options)) {
    if (valeur === undefined || valeur === null || valeur === false) continue;
    if (nom === 'classe') element.className = valeur;
    else if (nom === 'texte') element.textContent = valeur;
    else if (nom.startsWith('on')) element.addEventListener(nom.slice(2), valeur);
    else element.setAttribute(nom, valeur === true ? '' : valeur);
  }
  for (const enfant of enfants) if (enfant) element.append(enfant);
  return element;
}

/** Crée une icône à partir de la bibliothèque d'icônes de index.html. */
function icone(nom) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'icone');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', '#i-' + nom);
  svg.append(use);
  return svg;
}

/** Fabrique un identifiant unique pour chaque note ou ligne. */
function nouvelId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/** Met en minuscules et enlève les accents : « Été » devient « ete ». Pratique pour la recherche. */
function simplifier(texte) {
  return texte.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const formatJour = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const formatHeure = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Transforme une date en texte lisible : « aujourd'hui à 14:05 », « le 3 novembre 2026 »… */
function dateLisible(ms) {
  const date = new Date(ms);
  const aujourdhui = new Date();
  const hier = new Date();
  hier.setDate(aujourdhui.getDate() - 1);
  if (date.toDateString() === aujourdhui.toDateString()) return `aujourd'hui à ${formatHeure.format(date)}`;
  if (date.toDateString() === hier.toDateString()) return `hier à ${formatHeure.format(date)}`;
  return `le ${formatJour.format(date)}`;
}

/** Accorde un mot au pluriel : pluriel(3, 'note') → « 3 notes ». */
function pluriel(nombre, mot, motPluriel = mot + 's') {
  return `${nombre} ${nombre > 1 ? motPluriel : mot}`;
}

/* =====================================================================
   Messages et fenêtres de dialogue
   ===================================================================== */

let minuterieMessage = null;

/**
 * Affiche un petit message en bas de l'écran pendant quelques secondes.
 * On peut ajouter un bouton d'action (par exemple « Annuler »).
 */
function afficherMessage(texte, { action = null, siAction = null, duree = 6000 } = {}) {
  const boite = $('#message');
  const bouton = $('#message-action');
  $('#message-texte').textContent = texte;
  bouton.hidden = !action;
  bouton.textContent = action || '';
  bouton.onclick = () => {
    boite.hidden = true;
    if (siAction) siAction();
  };
  boite.hidden = false;
  clearTimeout(minuterieMessage);
  minuterieMessage = setTimeout(() => { boite.hidden = true; }, action ? Math.max(duree, 8000) : duree);
}

/**
 * Ouvre une fenêtre de dialogue et attend la réponse de l'utilisateur.
 *  - titre, message (texte ou liste de paragraphes) ;
 *  - boutons : [{ texte, valeur, style: 'principal' | 'danger' }] ;
 *  - champ (facultatif) : { label, type } pour demander un texte.
 * Renvoie { valeur, saisie } (valeur = null si on ferme sans choisir).
 */
function demander({ titre, message = [], boutons, champ = null }) {
  const dialogue = $('#dialogue');
  if (dialogue.open) return Promise.resolve({ valeur: null, saisie: '' });
  return new Promise((resoudre) => {
    $('#dialogue-titre').textContent = titre;

    const zoneMessage = $('#dialogue-message');
    zoneMessage.replaceChildren(...[].concat(message).map((texte) => creer('p', { texte })));

    const zoneChamp = $('#dialogue-zone-champ');
    const saisie = $('#dialogue-champ');
    zoneChamp.hidden = !champ;
    saisie.value = '';
    if (champ) {
      $('#dialogue-label').textContent = champ.label;
      saisie.type = champ.type || 'text';
    }

    const zoneBoutons = $('#dialogue-boutons');
    zoneBoutons.replaceChildren(...boutons.map((b, index) =>
      creer('button', { type: 'submit', value: String(index), classe: 'bouton ' + (b.style || ''), texte: b.texte })
    ));

    dialogue.returnValue = '';
    dialogue.addEventListener('close', () => {
      const choisi = boutons[Number(dialogue.returnValue)];
      const texteSaisi = saisie.value;
      saisie.value = ''; // on ne garde pas un mot de passe affiché dans la page
      resoudre({ valeur: choisi && dialogue.returnValue !== '' ? choisi.valeur : null, saisie: texteSaisi });
    }, { once: true });

    dialogue.showModal();
    if (champ) saisie.focus();
  });
}

/** Raccourci pour une simple question « Oui / Non ». Renvoie true ou false. */
async function confirmer(titre, message, texteOui, danger = true) {
  const reponse = await demander({
    titre,
    message,
    boutons: [
      { texte: texteOui, valeur: true, style: danger ? 'danger' : 'principal' },
      { texte: 'Annuler', valeur: false },
    ],
  });
  return reponse.valeur === true;
}

/* =====================================================================
   1. Démarrage
   ===================================================================== */

async function demarrer() {
  enregistrerServiceWorker();
  brancherEvenements();
  $('#numero-version').textContent = VERSION;

  try {
    await db.ouvrirBase();
    const prefs = await db.lire('reglages', 'preferences');
    etat.prefs = { ...PREFERENCES_DEFAUT, ...(prefs || {}) };
    if (!TRIS_VALIDES.includes(etat.prefs.tri)) etat.prefs.tri = PREFERENCES_DEFAUT.tri;
    if (!DELAIS_INACTIVITE.includes(Number(etat.prefs.verrouInactiviteMinutes))) {
      etat.prefs.verrouInactiviteMinutes = PREFERENCES_DEFAUT.verrouInactiviteMinutes;
    } else {
      etat.prefs.verrouInactiviteMinutes = Number(etat.prefs.verrouInactiviteMinutes);
    }
    if (!etat.prefs.premiereUtilisation) {
      etat.prefs.premiereUtilisation = Date.now();
      await sauverPreferences();
    }
    appliquerApparence();
    demanderStockagePersistant();

    etat.securite = (await db.lire('reglages', 'securite')) || null;
    history.replaceState({ ecran: 'liste' }, '');

    if (motDePasseActif()) {
      afficherVerrou();
    } else {
      await chargerNotes();
      ouvrirApplication();
    }
  } catch (erreur) {
    console.error(erreur);
    $('#ecran-chargement').replaceChildren(
      creer('div', { classe: 'verrou-boite' }, [
        creer('h1', { texte: 'Omni-Notes' }),
        creer('p', { texte: "Impossible d'ouvrir le stockage des notes sur cet appareil." }),
        creer('p', { texte: 'Vérifiez que vous n\'êtes pas en navigation privée, puis rechargez la page.' }),
      ])
    );
  }
}

/** Le « service worker » permet à l'application de fonctionner hors ligne. */
let inscriptionSw = null;
let miseAJourDemandee = false;

function enregistrerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (miseAJourDemandee) location.reload();
    });
    navigator.serviceWorker.register('./sw.js')
      .then(surveillerMisesAJour)
      .catch((erreur) => console.warn('Service worker non installé', erreur));
  }
}

function surveillerMisesAJour(inscription) {
  inscriptionSw = inscription;
  montrerMiseAJour();
  inscription.addEventListener('updatefound', () => {
    const nouveau = inscription.installing;
    if (!nouveau) return;
    nouveau.addEventListener('statechange', () => {
      if (nouveau.state === 'installed') montrerMiseAJour();
    });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') inscription.update().catch(() => {});
  });
}

function montrerMiseAJour() {
  const bandeau = $('#bandeau-mise-a-jour');
  if (!bandeau) return;
  const prete = !!(inscriptionSw && inscriptionSw.waiting && navigator.serviceWorker.controller);
  bandeau.hidden = !prete;
}

/**
 * Demande au navigateur de ne jamais effacer nos données de lui-même
 * (par exemple quand le téléphone manque de place). Le navigateur peut
 * accepter ou refuser sans rien demander : c'est sans conséquence.
 */
function demanderStockagePersistant() {
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted()
      .then((deja) => deja || navigator.storage.persist())
      .catch(() => {});
  }
}

function motDePasseActif() {
  return Boolean(etat.securite && etat.securite.actif);
}

/** Lit toutes les notes et modèles du stockage (et les déchiffre si besoin). */
async function chargerNotes() {
  const enregistrements = await db.lireTout('notes');
  const notes = [];
  let illisibles = 0;
  for (const enregistrement of enregistrements) {
    try {
      const brut = enregistrement.chiffre
        ? await chiffrement.dechiffrer(etat.cle, enregistrement)
        : enregistrement;
      const note = normaliserNote(brut);
      if (note) notes.push(note);
    } catch (erreur) {
      // Une note abîmée ne doit pas empêcher d'ouvrir les autres.
      // On la laisse intacte dans le stockage, sans l'effacer.
      illisibles++;
    }
  }
  etat.notes = notes;
  etat.notesIllisibles = illisibles;
  await chargerModeles();
  await purgerCorbeille();
}

async function chargerModeles() {
  try {
    const reg = await db.lire('reglages', 'modeles');
    if (!reg) { etat.modeles = []; return; }
    const brut = reg.chiffre
      ? await chiffrement.dechiffrer(etat.cle, reg)
      : reg.liste;
    etat.modeles = Array.isArray(brut) ? brut.map(normaliserModele).filter(Boolean) : [];
  } catch {
    etat.modeles = [];
  }
}

/** Affiche l'application une fois les notes chargées. */
function ouvrirApplication() {
  etat.verrouille = false;
  reinitialiserMinuterieInactivite(true);
  afficherEcran('liste');
  if (etat.notesIllisibles > 0) {
    afficherMessage(`${pluriel(etat.notesIllisibles, 'note n\'a pas pu être lue', 'notes n\'ont pas pu être lues')}. Elles restent conservées sur l'appareil.`, { duree: 10000 });
  }
}

/**
 * Vérifie et complète une note (utile pour les anciennes notes et
 * surtout pour les fichiers importés, qui pourraient être incomplets).
 */
function normaliserNote(source) {
  if (!source || typeof source !== 'object') return null;
  const maintenant = Date.now();
  const texte = (valeur) => (typeof valeur === 'string' ? valeur : '');
  const date = (valeur, defaut) => (Number.isFinite(valeur) ? valeur : defaut);

  const etiquettes = Array.isArray(source.etiquettes) ? source.etiquettes : [];
  const elements = Array.isArray(source.elements) ? source.elements : [];

  return {
    id: typeof source.id === 'string' && source.id ? source.id.slice(0, 100) : nouvelId(),
    type: source.type === 'liste' ? 'liste' : 'texte',
    titre: texte(source.titre),
    contenu: texte(source.contenu),
    elements: elements
      .filter((e) => e && typeof e === 'object')
      .map((e) => ({
        id: typeof e.id === 'string' && e.id ? e.id : nouvelId(),
        texte: texte(e.texte),
        coche: e.coche === true,
      })),
    epinglee: source.epinglee === true,
    archivee: source.archivee === true,
    lectureSeule: source.lectureSeule === true,
    couleur: COULEURS.some((c) => c.id === source.couleur) ? source.couleur : 'aucune',
    etiquettes: dedoublonner(etiquettes.filter((t) => typeof t === 'string').map(nettoyerEtiquette).filter(Boolean)),
    creeLe: date(source.creeLe, maintenant),
    modifieLe: date(source.modifieLe, maintenant),
    supprimeeLe: Number.isFinite(source.supprimeeLe) ? source.supprimeeLe : null,
  };
}

function normaliserModele(source) {
  if (!source || typeof source !== 'object') return null;
  const texte = (valeur) => (typeof valeur === 'string' ? valeur : '');
  const nom = texte(source.nom).trim().slice(0, 80);
  if (!nom) return null;
  const etiquettes = Array.isArray(source.etiquettes) ? source.etiquettes : [];
  const elements = Array.isArray(source.elements) ? source.elements : [];
  return {
    id: typeof source.id === 'string' && source.id ? source.id.slice(0, 100) : nouvelId(),
    nom,
    type: source.type === 'liste' ? 'liste' : 'texte',
    titre: texte(source.titre),
    contenu: texte(source.contenu),
    elements: elements
      .filter((e) => e && typeof e === 'object')
      .map((e) => ({ texte: texte(e.texte), coche: false })),
    couleur: COULEURS.some((c) => c.id === source.couleur) ? source.couleur : 'aucune',
    etiquettes: dedoublonner(etiquettes.filter((t) => typeof t === 'string').map(nettoyerEtiquette).filter(Boolean)),
  };
}

function nettoyerEtiquette(texte) {
  return texte.replace(/\s+/g, ' ').trim().slice(0, 30);
}

/** Enlève les doublons sans tenir compte des majuscules ni des accents. */
function dedoublonner(liste) {
  const vues = new Set();
  return liste.filter((element) => {
    const cle = simplifier(element);
    if (vues.has(cle)) return false;
    vues.add(cle);
    return true;
  });
}

/* =====================================================================
   Enregistrement des notes dans le stockage
   ---------------------------------------------------------------------
   Toutes les écritures passent par une « file d'attente » : elles se font
   l'une après l'autre, dans l'ordre. Ainsi, une ancienne version d'une
   note ne peut jamais écraser une version plus récente.
   ===================================================================== */

let fileEcritures = Promise.resolve();

function enFile(travail) {
  const promesse = fileEcritures.then(travail);
  fileEcritures = promesse.catch(() => {}); // une erreur ne bloque pas la suite de la file
  return promesse;
}

/** Prépare une note pour le stockage : chiffrée si le mot de passe est actif. */
async function versStockage(note, cle = etat.cle, { autoriserClair = false } = {}) {
  if (motDePasseActif() && !cle && !autoriserClair) {
    throw new Error("Impossible d'enregistrer : application verrouillée.");
  }
  if (cle) {
    const paquet = await chiffrement.chiffrer(cle, note);
    return { id: note.id, chiffre: true, iv: paquet.iv, donnees: paquet.donnees };
  }
  return JSON.parse(JSON.stringify(note)); // simple copie
}

function stockerNote(note) {
  const cle = etat.cle;
  return enFile(async () => db.ecrire('notes', await versStockage(note, cle)));
}

function effacerNoteDuStockage(id) {
  return enFile(() => db.effacer('notes', id));
}

function sauverPreferences() {
  return db.ecrire('reglages', { ...etat.prefs });
}

async function versStockageModeles(modeles = etat.modeles, cle = etat.cle, { autoriserClair = false } = {}) {
  if (motDePasseActif() && !cle && !autoriserClair) {
    throw new Error("Impossible d'enregistrer les modèles : application verrouillée.");
  }
  if (cle) {
    const paquet = await chiffrement.chiffrer(cle, modeles);
    return { cle: 'modeles', chiffre: true, iv: paquet.iv, donnees: paquet.donnees };
  }
  return { cle: 'modeles', chiffre: false, liste: JSON.parse(JSON.stringify(modeles)) };
}

function sauverModeles() {
  const cle = etat.cle;
  return enFile(async () => db.ecrire('reglages', await versStockageModeles(etat.modeles, cle)));
}

/* =====================================================================
   2. Navigation entre les écrans
   ---------------------------------------------------------------------
   Chaque changement d'écran est ajouté à l'historique du navigateur.
   Ainsi, le bouton « retour » du téléphone ramène à l'écran précédent,
   exactement comme notre bouton « Retour ».
   ===================================================================== */

const ECRANS = ['chargement', 'verrou', 'liste', 'edition', 'corbeille', 'archives', 'reglages', 'apropos'];

function montrerEcran(nom) {
  for (const ecran of ECRANS) {
    document.getElementById('ecran-' + ecran).hidden = ecran !== nom;
  }
  etat.ecran = nom;
  window.scrollTo(0, 0);
}

function afficherEcran(nom) {
  if (nom === 'liste') rendreListe();
  if (nom === 'corbeille') rendreCorbeille();
  if (nom === 'archives') rendreArchives();
  if (nom === 'reglages') rendreReglages();
  montrerEcran(nom);
  if (nom === 'edition') ajusterHauteur($('#champ-contenu'));
}

/** Va vers un nouvel écran (en l'ajoutant à l'historique). */
function allerA(nom, donnees = {}) {
  history.pushState({ ecran: nom, ...donnees }, '');
  afficherEcran(nom);
}

/** Revient à l'écran précédent. */
function retour() {
  history.back();
}

// Appelé quand on revient en arrière (bouton « Retour » ou bouton du téléphone).
window.addEventListener('popstate', async (evenement) => {
  if (etat.verrouille || etat.ecran === 'chargement') return;
  if (!mdpEnCours) document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  if (etat.ecran === 'edition') await quitterEditeur();

  const cible = evenement.state || { ecran: 'liste' };
  if (cible.ecran === 'edition') {
    const note = trouverNote(cible.id);
    if (!note || note.supprimeeLe) { afficherEcran('liste'); return; }
    etat.noteOuverteId = note.id;
    etat.masquerCoches = false;
    remplirEditeur();
  }
  afficherEcran(ECRANS.includes(cible.ecran) && cible.ecran !== 'verrou' ? cible.ecran : 'liste');
});

/* =====================================================================
   3. Les notes : création et édition
   ===================================================================== */

function trouverNote(id) {
  return etat.notes.find((n) => n.id === id) || null;
}

function noteOuverte() {
  return trouverNote(etat.noteOuverteId);
}

/** Une note est « vide » si elle n'a ni titre, ni texte, ni ligne remplie, ni étiquette. */
function noteEstVide(note) {
  return !note.titre.trim()
    && !note.contenu.trim()
    && note.elements.every((e) => !e.texte.trim())
    && note.etiquettes.length === 0;
}

async function choisirTypeNouvelleNote() {
  const reponse = await demander({
    titre: 'Nouvelle note',
    message: 'Que voulez-vous créer ?',
    boutons: [
      { texte: 'Une note texte', valeur: 'texte', style: 'principal' },
      { texte: 'Une liste à cocher', valeur: 'liste', style: 'principal' },
      { texte: 'À partir d’un modèle…', valeur: 'modele' },
      { texte: 'Annuler', valeur: null },
    ],
  });
  if (reponse.valeur === 'modele') await choisirModele();
  else if (reponse.valeur) creerNote(reponse.valeur);
}

function choisirModele() {
  const dialogue = $('#dialogue');
  if (dialogue.open) return Promise.resolve();
  return new Promise((resoudre) => {
    $('#dialogue-titre').textContent = 'Choisir un modèle';
    $('#dialogue-zone-champ').hidden = true;
    $('#dialogue-champ').value = '';

    const zoneMessage = $('#dialogue-message');
    const liste = creer('div', { classe: 'liste-modeles' });

    const fermerAvec = (action) => {
      dialogue.close();
      Promise.resolve().then(action).finally(resoudre);
    };

    const ajouterGroupe = (titreGroupe, modeles, personnalise) => {
      if (modeles.length === 0) return;
      liste.append(creer('p', { classe: 'titre-section', texte: titreGroupe }));
      for (const modele of modeles) {
        const bouton = creer('button', {
          type: 'button',
          classe: 'bouton bouton-modele',
          texte: modele.nom,
          onclick: () => fermerAvec(() => creerNoteDepuisModele(modele)),
        });
        if (personnalise) {
          const btnSupprimer = creer('button', {
            type: 'button',
            classe: 'bouton danger bouton-supprimer-modele',
            'aria-label': `Supprimer le modèle ${modele.nom}`,
            onclick: () => fermerAvec(async () => {
              const ok = await confirmer(
                'Supprimer ce modèle ?',
                `Le modèle « ${modele.nom} » sera supprimé. Vos notes existantes restent intactes.`,
                'Supprimer'
              );
              if (ok) {
                etat.modeles = etat.modeles.filter((m) => m.id !== modele.id);
                await sauverModeles();
                afficherMessage('Modèle supprimé.', { duree: 3000 });
              }
              await choisirModele();
            }),
          }, [icone('corbeille')]);
          liste.append(creer('div', { classe: 'ligne-modele' }, [bouton, btnSupprimer]));
        } else {
          liste.append(creer('div', { classe: 'ligne-modele' }, [bouton]));
        }
      }
    };

    ajouterGroupe('Modèles intégrés', MODELES_INTEGRES, false);
    ajouterGroupe('Mes modèles', etat.modeles, true);
    zoneMessage.replaceChildren(liste);

    $('#dialogue-boutons').replaceChildren(
      creer('button', { type: 'submit', value: 'annuler', classe: 'bouton', texte: 'Annuler' })
    );

    dialogue.returnValue = '';
    dialogue.addEventListener('close', () => {
      if (dialogue.returnValue === 'annuler' || dialogue.returnValue === '') resoudre();
    }, { once: true });
    dialogue.showModal();
  });
}

function creerNote(type) {
  const maintenant = Date.now();
  const note = normaliserNote({ id: nouvelId(), type, creeLe: maintenant, modifieLe: maintenant });
  if (type === 'liste') note.elements = [{ id: nouvelId(), texte: '', coche: false }];
  // La note n'est enregistrée qu'à la première frappe : une note
  // créée par erreur puis laissée vide ne laisse aucune trace.
  etat.notes.push(note);
  ouvrirNote(note.id);
  $('#champ-titre').focus();
}

function creerNoteDepuisModele(modele) {
  const maintenant = Date.now();
  const note = normaliserNote({
    id: nouvelId(),
    type: modele.type,
    titre: modele.titre || modele.nom,
    contenu: modele.contenu || '',
    elements: Array.isArray(modele.elements)
      ? modele.elements.map((e) => ({ id: nouvelId(), texte: e.texte || '', coche: false }))
      : [],
    couleur: modele.couleur || 'aucune',
    etiquettes: Array.isArray(modele.etiquettes) ? [...modele.etiquettes] : [],
    creeLe: maintenant,
    modifieLe: maintenant,
  });
  if (note.type === 'liste' && note.elements.length === 0) {
    note.elements = [{ id: nouvelId(), texte: '', coche: false }];
  }
  etat.notes.push(note);
  ouvrirNote(note.id);
  signalerModification();
  $('#champ-titre').focus();
}

async function enregistrerCommeModele() {
  const note = noteOuverte();
  if (!note) return;
  const reponse = await demander({
    titre: 'Enregistrer comme modèle',
    message: 'Donnez un nom à ce modèle pour le réutiliser lors de la création d’une note.',
    champ: { label: 'Nom du modèle', type: 'text' },
    boutons: [
      { texte: 'Enregistrer', valeur: 'ok', style: 'principal' },
      { texte: 'Annuler', valeur: null },
    ],
  });
  if (reponse.valeur !== 'ok') return;
  const nom = reponse.saisie.trim().slice(0, 80);
  if (!nom) {
    afficherMessage('Entrez un nom pour enregistrer le modèle.', { duree: 4000 });
    return;
  }
  const modele = normaliserModele({
    id: nouvelId(),
    nom,
    type: note.type,
    titre: note.titre,
    contenu: note.contenu,
    elements: note.elements.map((e) => ({ texte: e.texte, coche: false })),
    couleur: note.couleur,
    etiquettes: [...note.etiquettes],
  });
  etat.modeles.push(modele);
  await sauverModeles();
  afficherMessage(`Modèle « ${nom} » enregistré.`, { duree: 4000 });
}

function ouvrirNote(id) {
  etat.noteOuverteId = id;
  etat.masquerCoches = false;
  remplirEditeur();
  allerA('edition', { id });
}

/** Remplit l'écran d'édition avec la note ouverte. */
function remplirEditeur() {
  const note = noteOuverte();
  if (!note) return;
  const ro = note.lectureSeule === true;
  $('#champ-titre').value = note.titre;
  $('#champ-titre').readOnly = ro;
  $('#champ-contenu').value = note.contenu;
  $('#bandeau-lecture-seule').hidden = !ro;

  if (note.type === 'texte') {
    $('#champ-contenu').hidden = ro;
    $('#vue-lecture').hidden = !ro;
    $('#zone-liste').hidden = true;
    if (ro) rendreVueLecture(note.contenu);
    else $('#vue-lecture').replaceChildren();
  } else {
    $('#champ-contenu').hidden = true;
    $('#vue-lecture').hidden = true;
    $('#vue-lecture').replaceChildren();
    $('#zone-liste').hidden = false;
    $('#btn-ajouter-ligne').hidden = ro;
  }

  $('#options-note').open = false;
  $('#statut-sauvegarde').textContent = '';
  $('#champ-etiquette').disabled = ro;
  $('#form-etiquette button[type="submit"]').disabled = ro;
  $('#btn-changer-type').disabled = ro;
  $('#btn-partager-note span').textContent = typeof navigator.share === 'function' ? 'Partager' : 'Copier le texte';

  rendreElements();
  rendreActionsListe();
  rendreEpingle();
  rendreCouleurs();
  rendreEtiquettesNote();
  rendreBoutonType();
  rendreBoutonLectureSeule();
  rendreBoutonArchiver();
  rendreDates();
}

/* ----- Enregistrement automatique pendant la frappe ----- */

let minuterieEnregistrement = null;
let noteEnAttente = null;

/** À appeler à chaque modification : on enregistre peu après la dernière frappe. */
function signalerModification() {
  const note = noteOuverte();
  if (!note) return;
  note.modifieLe = Date.now();
  noteEnAttente = note;
  $('#statut-sauvegarde').textContent = 'Enregistrement…';
  clearTimeout(minuterieEnregistrement);
  minuterieEnregistrement = setTimeout(enregistrerMaintenant, DELAI_ENREGISTREMENT);
}

/** Enregistre tout de suite la note en attente (s'il y en a une). */
async function enregistrerMaintenant() {
  clearTimeout(minuterieEnregistrement);
  minuterieEnregistrement = null;
  const note = noteEnAttente;
  noteEnAttente = null;
  if (!note) return;
  try {
    await stockerNote(note);
    if (etat.noteOuverteId === note.id) {
      $('#statut-sauvegarde').textContent = 'Enregistré';
      rendreDates();
    }
  } catch (erreur) {
    console.error(erreur);
    $('#statut-sauvegarde').textContent = 'Non enregistré !';
    afficherMessage("Attention : la note n'a pas pu être enregistrée. L'espace de stockage est peut-être plein.", { duree: 12000 });
  }
}

/** Appelé quand on quitte l'écran d'édition. */
async function quitterEditeur() {
  const note = noteOuverte();
  etat.noteOuverteId = null;
  if (!note) return;
  if (noteEstVide(note)) {
    // Note vide : on l'oublie simplement (elle ne va pas dans la corbeille).
    if (noteEnAttente === note) { clearTimeout(minuterieEnregistrement); noteEnAttente = null; }
    etat.notes = etat.notes.filter((n) => n !== note);
    await effacerNoteDuStockage(note.id);
    return;
  }
  await enregistrerMaintenant();
}

/** La zone de texte grandit avec son contenu (plus besoin de défiler dedans). */
function ajusterHauteur(zone) {
  if (zone.hidden) return;
  const defilement = window.scrollY;
  zone.style.height = 'auto';
  zone.style.height = zone.scrollHeight + 'px';
  window.scrollTo(0, defilement);
}

/* ----- Mode lecture seule (rendu 100 % DOM sans innerHTML) ----- */

function nettoyerUrl(brut) {
  let url = brut;
  let suffixe = '';
  while (url.length > 0 && /[.,;:!?}\]]$/.test(url)) {
    suffixe = url.slice(-1) + suffixe;
    url = url.slice(0, -1);
  }
  while (url.endsWith(')')) {
    const ouvrantes = (url.match(/\(/g) || []).length;
    const fermantes = (url.match(/\)/g) || []).length;
    if (fermantes > ouvrantes) {
      suffixe = ')' + suffixe;
      url = url.slice(0, -1);
    } else {
      break;
    }
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return { href: parsed.href, texte: url, suffixe };
    }
  } catch { /* URL invalide */ }
  return null;
}

function ajouterContenuInline(parent, texte, profondeur = 0) {
  let reste = texte;
  while (reste.length > 0) {
    const candidats = [];
    const mUrl = reste.match(/https?:\/\/[^\s<>"]+/);
    if (mUrl) candidats.push({ type: 'url', index: mUrl.index, match: mUrl, priorite: 0 });
    const mEmail = reste.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (mEmail) candidats.push({ type: 'email', index: mEmail.index, match: mEmail, priorite: 1 });
    if (profondeur < 2) {
      const mGras = reste.match(/\*\*([^\n*]+(?:\*(?!\*)[^\n*]*)*)\*\*/);
      if (mGras) candidats.push({ type: 'gras', index: mGras.index, match: mGras, priorite: 2 });
    }
    const mTel = reste.match(/(?<![\w@])(?:\+\d{1,3}[\s.-]?\d(?:[\s.-]?\d{2}){3,5}|0[1-9](?:[\s.-]?\d{2}){4})(?!\d)/);
    if (mTel) candidats.push({ type: 'tel', index: mTel.index, match: mTel, priorite: 3 });

    if (candidats.length === 0) {
      parent.append(document.createTextNode(reste));
      return;
    }
    candidats.sort((a, b) => a.index - b.index || a.priorite - b.priorite);
    const choisi = candidats[0];
    if (choisi.index > 0) {
      parent.append(document.createTextNode(reste.slice(0, choisi.index)));
    }
    const brute = choisi.match[0];
    let consomme = brute.length;

    if (choisi.type === 'url') {
      const propre = nettoyerUrl(brute);
      if (propre) {
        parent.append(creer('a', {
          href: propre.href,
          target: '_blank',
          rel: 'noopener noreferrer',
          texte: propre.texte,
        }));
        consomme = propre.texte.length;
      } else {
        parent.append(document.createTextNode(brute));
      }
    } else if (choisi.type === 'email') {
      parent.append(creer('a', { href: 'mailto:' + brute, texte: brute }));
    } else if (choisi.type === 'tel') {
      parent.append(creer('a', { href: 'tel:' + brute.replace(/[\s.-]/g, ''), texte: brute }));
    } else if (choisi.type === 'gras') {
      const fort = document.createElement('strong');
      ajouterContenuInline(fort, choisi.match[1], profondeur + 1);
      parent.append(fort);
    }

    reste = reste.slice(choisi.index + consomme);
  }
}

function rendreVueLecture(texte) {
  const conteneur = $('#vue-lecture');
  conteneur.replaceChildren();
  const lignes = (texte || '').replace(/\r\n?/g, '\n').split('\n');
  let listeCourante = null;
  let lignesParagraphe = [];

  const viderParagraphe = () => {
    if (lignesParagraphe.length === 0) return;
    const p = document.createElement('p');
    lignesParagraphe.forEach((l, idx) => {
      if (idx > 0) p.append(document.createElement('br'));
      ajouterContenuInline(p, l);
    });
    conteneur.append(p);
    lignesParagraphe = [];
  };

  for (const ligne of lignes) {
    const h2 = ligne.match(/^## (.+)$/);
    const h1 = !h2 && ligne.match(/^# (.+)$/);
    const puce = ligne.match(/^[-*] (.+)$/);

    if (!ligne.trim()) {
      viderParagraphe();
      listeCourante = null;
    } else if (h2) {
      viderParagraphe();
      listeCourante = null;
      const titre = document.createElement('h4');
      ajouterContenuInline(titre, h2[1]);
      conteneur.append(titre);
    } else if (h1) {
      viderParagraphe();
      listeCourante = null;
      const titre = document.createElement('h3');
      ajouterContenuInline(titre, h1[1]);
      conteneur.append(titre);
    } else if (puce) {
      viderParagraphe();
      if (!listeCourante) {
        listeCourante = document.createElement('ul');
        conteneur.append(listeCourante);
      }
      const li = document.createElement('li');
      ajouterContenuInline(li, puce[1]);
      listeCourante.append(li);
    } else {
      listeCourante = null;
      lignesParagraphe.push(ligne);
    }
  }
  viderParagraphe();

  if (conteneur.childNodes.length === 0) {
    conteneur.append(creer('p', { classe: 'info', texte: 'Note vide.' }));
  }
}

/* ----- Listes à cocher ----- */

function rendreElements(idAFocaliser = null) {
  const note = noteOuverte();
  const liste = $('#elements-liste');
  liste.replaceChildren();
  if (!note || note.type !== 'liste') return;
  const ro = note.lectureSeule === true;

  note.elements.forEach((element, index) => {
    const numero = index + 1;
    const ligne = creer('li', { classe: 'element' + (element.coche ? ' coche' : '') });
    ligne.hidden = etat.masquerCoches && element.coche;

    const caseACocher = creer('input', { type: 'checkbox', 'aria-label': `Cocher la ligne ${numero}` });
    caseACocher.checked = element.coche;
    caseACocher.disabled = ro;
    caseACocher.addEventListener('change', () => {
      if (note.lectureSeule) return;
      element.coche = caseACocher.checked;
      ligne.classList.toggle('coche', element.coche);
      ligne.hidden = etat.masquerCoches && element.coche;
      rendreActionsListe();
      signalerModification();
    });

    const champ = creer('input', {
      type: 'text',
      classe: 'element-texte',
      placeholder: 'Élément',
      'aria-label': `Texte de la ligne ${numero}`,
      enterkeyhint: 'next',
      maxlength: '500',
    });
    champ.value = element.texte;
    champ.dataset.id = element.id;
    champ.disabled = ro;
    champ.addEventListener('input', () => {
      if (note.lectureSeule) return;
      element.texte = champ.value;
      signalerModification();
    });
    // Touche « Entrée » : on crée une nouvelle ligne juste en dessous.
    champ.addEventListener('keydown', (e) => {
      if (note.lectureSeule) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        ajouterLigne(index + 1);
      }
    });

    const boutonMonter = creer('button', {
      type: 'button',
      classe: 'bouton-ligne bouton-monter',
      'aria-label': `Monter la ligne ${numero}`,
      disabled: ro || index === 0,
      hidden: ro,
      texte: '↑',
      onclick: () => deplacerLigne(index, -1),
    });

    const boutonDescendre = creer('button', {
      type: 'button',
      classe: 'bouton-ligne bouton-descendre',
      'aria-label': `Descendre la ligne ${numero}`,
      disabled: ro || index === note.elements.length - 1,
      hidden: ro,
      texte: '↓',
      onclick: () => deplacerLigne(index, 1),
    });

    const boutonSupprimer = creer('button', {
      type: 'button',
      classe: 'bouton-ligne bouton-supprimer-ligne',
      'aria-label': `Supprimer la ligne ${numero}`,
      disabled: ro,
      hidden: ro,
      onclick: () => supprimerLigne(element.id),
    }, [icone('fermer')]);

    ligne.append(
      creer('label', { classe: 'zone-case' }, [caseACocher]),
      champ,
      boutonMonter,
      boutonDescendre,
      boutonSupprimer
    );
    liste.append(ligne);
  });

  if (idAFocaliser) {
    const champ = liste.querySelector(`[data-id="${CSS.escape(idAFocaliser)}"]`);
    if (champ) champ.focus();
  }
}

function deplacerLigne(index, delta) {
  const note = noteOuverte();
  if (!note || note.lectureSeule) return;
  const cible = index + delta;
  if (cible < 0 || cible >= note.elements.length) return;
  [note.elements[index], note.elements[cible]] = [note.elements[cible], note.elements[index]];
  rendreElements(note.elements[cible].id);
  signalerModification();
}

function rendreActionsListe() {
  const note = noteOuverte();
  if (!note || note.type !== 'liste') return;
  const ro = note.lectureSeule === true;
  const nbCoches = note.elements.filter((e) => e.coche).length;

  const btnMasquer = $('#btn-masquer-coches');
  btnMasquer.setAttribute('aria-pressed', String(etat.masquerCoches));
  btnMasquer.textContent = etat.masquerCoches ? `Afficher les cochés (${nbCoches})` : 'Masquer les cochés';

  $('#btn-tout-decocher').hidden = ro || nbCoches === 0;
  $('#btn-supprimer-coches').hidden = ro || nbCoches === 0;
}

function basculerMasquerCoches() {
  const note = noteOuverte();
  if (!note || note.type !== 'liste') return;
  etat.masquerCoches = !etat.masquerCoches;
  rendreElements();
  rendreActionsListe();
}

function toutDecocher() {
  const note = noteOuverte();
  if (!note || note.type !== 'liste' || note.lectureSeule) return;
  for (const e of note.elements) e.coche = false;
  rendreElements();
  rendreActionsListe();
  signalerModification();
}

async function supprimerCoches() {
  const note = noteOuverte();
  if (!note || note.type !== 'liste' || note.lectureSeule) return;
  const nbCoches = note.elements.filter((e) => e.coche).length;
  if (nbCoches === 0) return;
  const ok = await confirmer(
    'Retirer les éléments cochés ?',
    `${pluriel(nbCoches, 'élément coché sera retiré', 'éléments cochés seront retirés')} de la liste.`,
    'Retirer'
  );
  if (!ok || noteOuverte() !== note) return;
  note.elements = note.elements.filter((e) => !e.coche);
  rendreElements();
  rendreActionsListe();
  signalerModification();
}

function ajouterLigne(position) {
  const note = noteOuverte();
  if (!note || note.lectureSeule) return;
  const element = { id: nouvelId(), texte: '', coche: false };
  note.elements.splice(position ?? note.elements.length, 0, element);
  rendreElements(element.id);
  rendreActionsListe();
  signalerModification();
}

function supprimerLigne(id) {
  const note = noteOuverte();
  if (!note || note.lectureSeule) return;
  const index = note.elements.findIndex((e) => e.id === id);
  if (index === -1) return;
  note.elements.splice(index, 1);
  const voisine = note.elements[Math.max(0, index - 1)];
  rendreElements(voisine ? voisine.id : null);
  rendreActionsListe();
  if (!voisine) $('#btn-ajouter-ligne').focus();
  signalerModification();
}

/* ----- Épingle, couleur, étiquettes, type ----- */

function rendreEpingle() {
  const note = noteOuverte();
  if (!note) return;
  const bouton = $('#btn-epingler');
  bouton.setAttribute('aria-pressed', String(note.epinglee));
  bouton.querySelector('span').textContent = note.epinglee ? 'Épinglée' : 'Épingler';
}

function basculerEpingle() {
  const note = noteOuverte();
  if (!note) return;
  note.epinglee = !note.epinglee;
  rendreEpingle();
  signalerModification();
  afficherMessage(note.epinglee ? 'Note épinglée en haut de la liste.' : 'Note désépinglée.', { duree: 3000 });
}

function rendreCouleurs() {
  const note = noteOuverte();
  if (!note) return;
  const ro = note.lectureSeule === true;
  const groupe = $('#choix-couleur');
  groupe.querySelectorAll('.pastille').forEach((p) => p.remove());
  for (const couleur of COULEURS) {
    const bouton = creer('input', { type: 'radio', name: 'couleur-note', value: couleur.id, 'aria-label': couleur.nom, disabled: ro });
    bouton.checked = note.couleur === couleur.id;
    bouton.addEventListener('change', () => {
      if (note.lectureSeule) return;
      note.couleur = couleur.id;
      appliquerCouleurEditeur();
      signalerModification();
    });
    groupe.append(creer('label', { classe: 'pastille', 'data-couleur': couleur.id, title: couleur.nom }, [bouton, creer('span')]));
  }
  appliquerCouleurEditeur();
}

function appliquerCouleurEditeur() {
  const note = noteOuverte();
  if (!note) return;
  $('#ecran-edition').dataset.couleur = note.couleur;
  $('#nom-couleur').textContent = COULEURS.find((c) => c.id === note.couleur).nom;
}

function rendreEtiquettesNote() {
  const note = noteOuverte();
  if (!note) return;
  const ro = note.lectureSeule === true;
  const zone = $('#etiquettes-note');
  zone.replaceChildren(...note.etiquettes.map((etiquette) =>
    creer('span', { classe: 'puce etiquette-retirable' }, [
      creer('span', { texte: etiquette }),
      creer('button', {
        type: 'button',
        'aria-label': `Retirer l'étiquette ${etiquette}`,
        disabled: ro,
        hidden: ro,
        onclick: () => {
          if (note.lectureSeule) return;
          note.etiquettes = note.etiquettes.filter((t) => t !== etiquette);
          rendreEtiquettesNote();
          signalerModification();
        },
      }, [icone('fermer')]),
    ])
  ));
  if (note.etiquettes.length === 0) zone.append(creer('span', { classe: 'info', texte: 'Aucune étiquette.' }));

  // Suggestions : les étiquettes déjà utilisées dans les autres notes.
  $('#liste-etiquettes').replaceChildren(...toutesLesEtiquettes().map((t) => creer('option', { value: t })));
}

function ajouterEtiquette(evenement) {
  evenement.preventDefault();
  const note = noteOuverte();
  if (!note || note.lectureSeule) return;
  const champ = $('#champ-etiquette');
  const texte = nettoyerEtiquette(champ.value);
  champ.value = '';
  if (!texte) return;
  // Si une étiquette identique existe déjà ailleurs (ex. « Courses »), on garde son orthographe.
  const existante = toutesLesEtiquettes().find((t) => simplifier(t) === simplifier(texte));
  note.etiquettes = dedoublonner([...note.etiquettes, existante || texte]);
  rendreEtiquettesNote();
  signalerModification();
}

function rendreBoutonType() {
  const note = noteOuverte();
  if (!note) return;
  const bouton = $('#btn-changer-type');
  bouton.replaceChildren(
    icone(note.type === 'texte' ? 'liste' : 'texte'),
    document.createTextNode(note.type === 'texte' ? 'Transformer en liste à cocher' : 'Transformer en note texte')
  );
}

async function changerType() {
  const note = noteOuverte();
  if (!note || note.lectureSeule) return;
  if (note.type === 'texte') {
    // Chaque ligne du texte devient une ligne à cocher.
    const lignes = note.contenu.split('\n').map((l) => l.trim()).filter(Boolean);
    note.elements = (lignes.length ? lignes : ['']).map((texte) => ({ id: nouvelId(), texte, coche: false }));
    note.contenu = '';
    note.type = 'liste';
  } else {
    if (note.elements.some((e) => e.coche)) {
      const ok = await confirmer(
        'Transformer en note texte ?',
        'Le texte de chaque ligne est conservé, mais les coches seront retirées.',
        'Transformer',
        false
      );
      if (!ok || noteOuverte() !== note) return;
    }
    note.contenu = note.elements.map((e) => e.texte).filter((t) => t.trim()).join('\n');
    note.elements = [];
    note.type = 'texte';
  }
  remplirEditeur();
  $('#options-note').open = true;
  ajusterHauteur($('#champ-contenu'));
  signalerModification();
}

function rendreBoutonLectureSeule() {
  const note = noteOuverte();
  if (!note) return;
  const ro = note.lectureSeule === true;
  const bouton = $('#btn-lecture-seule');
  bouton.setAttribute('aria-pressed', String(ro));
  bouton.replaceChildren(
    icone('lecture'),
    document.createTextNode(ro ? 'Passer en mode édition' : 'Activer le mode lecture seule')
  );
}

function basculerLectureSeule() {
  const note = noteOuverte();
  if (!note) return;
  note.lectureSeule = !note.lectureSeule;
  const optionOuverte = $('#options-note').open;
  remplirEditeur();
  $('#options-note').open = optionOuverte;
  if (!note.lectureSeule && note.type === 'texte') ajusterHauteur($('#champ-contenu'));
  signalerModification();
}

function rendreBoutonArchiver() {
  const note = noteOuverte();
  if (!note) return;
  const bouton = $('#btn-archiver-note');
  bouton.replaceChildren(
    icone('archiver'),
    document.createTextNode(note.archivee ? 'Désarchiver la note' : 'Archiver la note')
  );
}

async function basculerArchivage() {
  const note = noteOuverte();
  if (!note) return;
  if (noteEstVide(note)) { retour(); return; }
  if (noteEnAttente === note) { clearTimeout(minuterieEnregistrement); noteEnAttente = null; }
  const etaitArchivee = note.archivee === true;
  note.archivee = !etaitArchivee;
  note.modifieLe = Date.now();
  etat.noteOuverteId = null;
  await stockerNote(note);
  retour();
  afficherMessage(note.archivee ? 'Note archivée.' : 'Note désarchivée.', {
    action: 'Annuler',
    siAction: async () => {
      note.archivee = etaitArchivee;
      note.modifieLe = Date.now();
      await stockerNote(note);
      if (etat.ecran === 'liste') rendreListe();
      if (etat.ecran === 'archives') rendreArchives();
    },
  });
}

/* ----- Export unitaire (.txt, .md) et partage ----- */

function nomFichierNote(note, extension) {
  const base = simplifier(note.titre.trim() || 'note')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'note';
  return `${base}.${extension}`;
}

function noteEnTexte(note) {
  const corps = note.type === 'liste'
    ? note.elements.map((e) => (e.coche ? '[x] ' : '[ ] ') + e.texte).join('\n')
    : note.contenu;
  const titre = note.titre.trim();
  return titre ? `${titre}\n\n${corps}` : corps;
}

function noteEnMarkdown(note) {
  const parties = [`# ${note.titre.trim() || 'Sans titre'}`];
  if (note.etiquettes.length > 0) {
    parties.push(`Étiquettes : ${note.etiquettes.join(', ')}`);
  }
  const corps = note.type === 'liste'
    ? note.elements.map((e) => (e.coche ? '- [x] ' : '- [ ] ') + e.texte).join('\n')
    : note.contenu;
  if (corps.trim()) parties.push(corps);
  return parties.join('\n\n');
}

function telechargerTexte(nomFichier, contenu, typeMime = 'text/plain;charset=utf-8') {
  const fichier = new Blob([contenu], { type: typeMime });
  const adresse = URL.createObjectURL(fichier);
  const lien = creer('a', { href: adresse, download: nomFichier });
  document.body.append(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(adresse), 30000);
}

function exporterNoteTexte() {
  const note = noteOuverte();
  if (!note) return;
  const nom = nomFichierNote(note, 'txt');
  telechargerTexte(nom, noteEnTexte(note), 'text/plain;charset=utf-8');
  afficherMessage(`Note exportée (${nom}).`, { duree: 4000 });
}

function exporterNoteMarkdown() {
  const note = noteOuverte();
  if (!note) return;
  const nom = nomFichierNote(note, 'md');
  telechargerTexte(nom, noteEnMarkdown(note), 'text/markdown;charset=utf-8');
  afficherMessage(`Note exportée (${nom}).`, { duree: 4000 });
}

async function partagerNote() {
  const note = noteOuverte();
  if (!note) return;
  const titre = note.titre.trim() || 'Omni-Notes';
  const texte = noteEnTexte(note);
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: titre, text: texte });
      return;
    } catch (erreur) {
      if (erreur && erreur.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(texte);
    afficherMessage('Texte copié dans le presse-papiers.', { duree: 3000 });
  } catch {
    afficherMessage('Impossible de copier automatiquement le texte.', { duree: 5000 });
  }
}

function rendreDates() {
  const note = noteOuverte();
  if (!note) return;
  $('#dates-note').textContent = `Créée ${dateLisible(note.creeLe)} · modifiée ${dateLisible(note.modifieLe)}`;
}

/* ----- Suppression (mise à la corbeille) ----- */

async function supprimerNoteOuverte() {
  const note = noteOuverte();
  if (!note) return;
  if (noteEstVide(note)) { retour(); return; } // rien à garder
  if (noteEnAttente === note) { clearTimeout(minuterieEnregistrement); noteEnAttente = null; }
  note.supprimeeLe = Date.now();
  etat.noteOuverteId = null; // évite un enregistrement en quittant l'écran
  await stockerNote(note);
  retour();
  afficherMessage('Note placée dans la corbeille.', {
    action: 'Annuler',
    siAction: () => restaurerNote(note),
  });
}

/* =====================================================================
   4. La liste des notes (recherche, épinglage, étiquettes)
   ===================================================================== */

function notesActives() {
  return etat.notes.filter((n) => !n.supprimeeLe && !n.archivee);
}

function notesArchivees() {
  return etat.notes.filter((n) => !n.supprimeeLe && n.archivee);
}

function comparerNotes(a, b, tri = etat.prefs.tri) {
  if (tri === 'creation') {
    return (b.creeLe || 0) - (a.creeLe || 0);
  }
  if (tri === 'titre') {
    const ta = a.titre.trim();
    const tb = b.titre.trim();
    if (!ta && tb) return 1;
    if (ta && !tb) return -1;
    const cmp = ta.localeCompare(tb, 'fr', { sensitivity: 'base' });
    if (cmp !== 0) return cmp;
    return (b.modifieLe || 0) - (a.modifieLe || 0);
  }
  if (tri === 'couleur') {
    const rang = (c) => {
      const i = COULEURS.findIndex((x) => x.id === c);
      return i <= 0 ? COULEURS.length : i;
    };
    const cmp = rang(a.couleur) - rang(b.couleur);
    if (cmp !== 0) return cmp;
    return (b.modifieLe || 0) - (a.modifieLe || 0);
  }
  return (b.modifieLe || 0) - (a.modifieLe || 0);
}

function toutesLesEtiquettes() {
  const toutes = dedoublonner(notesActives().flatMap((n) => n.etiquettes));
  return toutes.sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
}

/** Le texte dans lequel on cherche : titre, contenu, lignes et étiquettes. */
function texteDeRecherche(note) {
  return simplifier([note.titre, note.contenu, ...note.elements.map((e) => e.texte), ...note.etiquettes].join('\n'));
}

function rendreListe() {
  $('#btn-verrouiller-rapide').hidden = !motDePasseActif();
  const selectTri = $('#select-tri');
  selectTri.value = TRIS_VALIDES.includes(etat.prefs.tri) ? etat.prefs.tri : 'modification';

  const archivees = notesArchivees();
  const btnArchives = $('#btn-ouvrir-archives');
  btnArchives.hidden = archivees.length === 0;
  btnArchives.textContent = `Archives (${archivees.length})`;

  const actives = notesActives();
  const etiquettes = toutesLesEtiquettes();
  const filtreSimplifie = etat.filtreEtiquette ? simplifier(etat.filtreEtiquette) : null;
  if (filtreSimplifie && !etiquettes.some((t) => simplifier(t) === filtreSimplifie)) {
    etat.filtreEtiquette = null;
  }
  rendreFiltres(etiquettes);

  const recherche = simplifier(etat.recherche.trim());
  const filtreActif = etat.filtreEtiquette ? simplifier(etat.filtreEtiquette) : null;
  const visibles = actives
    .filter((n) => !filtreActif || n.etiquettes.some((t) => simplifier(t) === filtreActif))
    .filter((n) => !recherche || texteDeRecherche(n).includes(recherche))
    .sort((a, b) => comparerNotes(a, b, etat.prefs.tri));

  const epinglees = visibles.filter((n) => n.epinglee);
  const autres = visibles.filter((n) => !n.epinglee);

  const conteneur = $('#liste-notes');
  conteneur.replaceChildren();
  if (epinglees.length) {
    conteneur.append(creer('h2', { classe: 'titre-section', texte: 'Épinglées' }));
    conteneur.append(creer('ul', { classe: 'grille' }, epinglees.map(carteNote)));
  }
  if (autres.length) {
    if (epinglees.length) conteneur.append(creer('h2', { classe: 'titre-section', texte: 'Autres notes' }));
    conteneur.append(creer('ul', { classe: 'grille' }, autres.map(carteNote)));
  }

  const vide = $('#liste-vide');
  vide.hidden = visibles.length > 0;
  vide.textContent = actives.length === 0
    ? 'Aucune note pour l\'instant. Touchez le bouton « + » en bas à droite pour en créer une.'
    : 'Aucune note ne correspond à votre recherche.';

  rendreRappel();
}

function rendreFiltres(etiquettes) {
  const zone = $('#filtres-etiquettes');
  zone.hidden = etiquettes.length === 0;
  const filtreActif = etat.filtreEtiquette ? simplifier(etat.filtreEtiquette) : null;
  const filtre = (texte, valeur) => creer('button', {
    type: 'button',
    classe: 'filtre',
    'aria-pressed': String(valeur === null ? filtreActif === null : filtreActif === simplifier(valeur)),
    texte,
    onclick: () => { etat.filtreEtiquette = valeur; rendreListe(); },
  });
  zone.replaceChildren(filtre('Toutes', null), ...etiquettes.map((t) => filtre(t, t)));
}

/** Un court aperçu du contenu d'une note. */
function apercu(note) {
  if (note.type === 'liste') {
    const remplies = note.elements.filter((e) => e.texte.trim());
    const lignes = remplies.slice(0, 5).map((e) => (e.coche ? '☑ ' : '☐ ') + e.texte);
    if (remplies.length > 5) lignes.push(`… et ${remplies.length - 5} de plus`);
    return lignes.join('\n');
  }
  return note.contenu.slice(0, 400);
}

/** Le bloc qui contient le titre, l'aperçu, les étiquettes et la date. */
function interieurCarte(note, textePied) {
  const titre = creer('span', { classe: 'carte-titre' + (note.titre.trim() ? '' : ' sans-titre') });
  if (note.epinglee && !note.supprimeeLe) titre.append(icone('epingle'));
  titre.append(document.createTextNode(note.titre.trim() || 'Sans titre'));
  const texteApercu = apercu(note);

  let puceCocher = null;
  if (note.type === 'liste') {
    const remplies = note.elements.filter((e) => e.texte.trim());
    if (remplies.length > 0) {
      const coches = remplies.filter((e) => e.coche).length;
      puceCocher = creer('span', { classe: 'puce', texte: `${coches} / ${remplies.length} cochés` });
    }
  }

  return [
    titre,
    texteApercu ? creer('span', { classe: 'carte-extrait', texte: texteApercu }) : null,
    creer('span', { classe: 'carte-pied' }, [
      puceCocher,
      ...note.etiquettes.map((t) => creer('span', { classe: 'puce', texte: t })),
      creer('span', { texte: textePied }),
    ]),
  ];
}

function carteNote(note) {
  const carte = creer('button', {
    type: 'button',
    classe: 'carte',
    'data-couleur': note.couleur,
    onclick: () => ouvrirNote(note.id),
  }, interieurCarte(note, `Modifiée ${dateLisible(note.modifieLe)}`));
  return creer('li', {}, [carte]);
}

/* =====================================================================
   5. La corbeille
   ===================================================================== */

/** Efface définitivement les notes restées plus de 30 jours dans la corbeille. */
async function purgerCorbeille() {
  const limite = Date.now() - DUREE_CORBEILLE;
  const perimees = etat.notes.filter((n) => n.supprimeeLe && n.supprimeeLe < limite);
  if (perimees.length === 0) return;
  await enFile(() => db.groupe(perimees.map((n) => ({ magasin: 'notes', action: 'effacer', cle: n.id }))));
  etat.notes = etat.notes.filter((n) => !perimees.includes(n));
}

function joursRestants(note) {
  return Math.max(1, Math.ceil((note.supprimeeLe + DUREE_CORBEILLE - Date.now()) / JOUR));
}

function rendreCorbeille() {
  const supprimees = etat.notes
    .filter((n) => n.supprimeeLe)
    .sort((a, b) => b.supprimeeLe - a.supprimeeLe);

  const liste = $('#liste-corbeille');
  liste.replaceChildren(...supprimees.map((note) => {
    const restants = joursRestants(note);
    const pied = `Supprimée ${dateLisible(note.supprimeeLe)}. Effacement définitif dans ${pluriel(restants, 'jour')}.`;
    return creer('li', {}, [
      creer('div', { classe: 'carte', 'data-couleur': note.couleur }, [
        ...interieurCarte(note, pied),
        creer('div', { classe: 'carte-actions' }, [
          creer('button', { type: 'button', classe: 'bouton principal', onclick: () => restaurerNote(note) },
            [icone('restaurer'), document.createTextNode('Restaurer')]),
          creer('button', { type: 'button', classe: 'bouton danger', onclick: () => effacerDefinitivement(note) },
            [icone('corbeille'), document.createTextNode('Effacer')]),
        ]),
      ]),
    ]);
  }));

  $('#corbeille-vide').hidden = supprimees.length > 0;
  $('#btn-vider-corbeille').hidden = supprimees.length === 0;
}

async function restaurerNote(note) {
  if (!etat.notes.includes(note)) return;
  note.supprimeeLe = null;
  note.modifieLe = Date.now();
  await stockerNote(note);
  if (etat.ecran === 'corbeille') rendreCorbeille();
  if (etat.ecran === 'archives') rendreArchives();
  if (etat.ecran === 'liste') rendreListe();
  afficherMessage('Note restaurée.', { duree: 3000 });
}

/* =====================================================================
   5b. Les archives
   ===================================================================== */

function rendreArchives() {
  const archivees = notesArchivees().sort((a, b) => b.modifieLe - a.modifieLe);
  const liste = $('#liste-archives');
  liste.replaceChildren(...archivees.map((note) =>
    creer('li', {}, [
      creer('div', { classe: 'carte', 'data-couleur': note.couleur }, [
        creer('button', {
          type: 'button',
          classe: 'carte-apercu',
          onclick: () => ouvrirNote(note.id),
        }, interieurCarte(note, `Modifiée ${dateLisible(note.modifieLe)}`)),
        creer('div', { classe: 'carte-actions' }, [
          creer('button', {
            type: 'button',
            classe: 'bouton principal',
            onclick: () => desarchiverNote(note),
          }, [icone('restaurer'), document.createTextNode('Désarchiver')]),
          creer('button', {
            type: 'button',
            classe: 'bouton',
            onclick: () => mettreEnCorbeilleDepuisArchives(note),
          }, [icone('corbeille'), document.createTextNode('Corbeille')]),
        ]),
      ]),
    ])
  ));
  $('#archives-vide').hidden = archivees.length > 0;
}

async function desarchiverNote(note) {
  if (!etat.notes.includes(note)) return;
  note.archivee = false;
  note.modifieLe = Date.now();
  await stockerNote(note);
  rendreArchives();
  afficherMessage('Note désarchivée.', { duree: 3000 });
}

async function mettreEnCorbeilleDepuisArchives(note) {
  if (!etat.notes.includes(note)) return;
  note.supprimeeLe = Date.now();
  await stockerNote(note);
  rendreArchives();
  afficherMessage('Note placée dans la corbeille.', {
    action: 'Annuler',
    siAction: () => restaurerNote(note),
  });
}

async function effacerDefinitivement(note) {
  const ok = await confirmer(
    'Effacer définitivement ?',
    `La note « ${note.titre.trim() || 'Sans titre'} » sera effacée pour toujours. Cette action est irréversible.`,
    'Effacer définitivement'
  );
  if (!ok) return;
  await effacerNoteDuStockage(note.id);
  etat.notes = etat.notes.filter((n) => n !== note);
  rendreCorbeille();
  afficherMessage('Note effacée définitivement.', { duree: 3000 });
}

async function viderCorbeille() {
  const supprimees = etat.notes.filter((n) => n.supprimeeLe);
  if (supprimees.length === 0) return;
  const ok = await confirmer(
    'Vider la corbeille ?',
    `${pluriel(supprimees.length, 'note sera effacée', 'notes seront effacées')} pour toujours. Cette action est irréversible.`,
    'Vider la corbeille'
  );
  if (!ok) return;
  await enFile(() => db.groupe(supprimees.map((n) => ({ magasin: 'notes', action: 'effacer', cle: n.id }))));
  etat.notes = etat.notes.filter((n) => !n.supprimeeLe);
  rendreCorbeille();
  afficherMessage('La corbeille a été vidée.', { duree: 3000 });
}

/* =====================================================================
   6. Sauvegarde : export, import, rappel
   ===================================================================== */

function rendreRappel() {
  const p = etat.prefs;
  const maintenant = Date.now();
  const reference = p.derniereSauvegarde || p.premiereUtilisation || maintenant;
  const afficher = notesActives().length > 0
    && maintenant - reference > DELAI_RAPPEL
    && (!p.rappelReporteJusqua || maintenant > p.rappelReporteJusqua);
  $('#rappel-sauvegarde').hidden = !afficher;
  if (afficher) {
    $('#rappel-texte').textContent = p.derniereSauvegarde
      ? `Pensez à sauvegarder vos notes : votre dernière sauvegarde date du ${formatJour.format(new Date(p.derniereSauvegarde))}.`
      : 'Pensez à sauvegarder vos notes : vous n\'avez encore jamais fait de sauvegarde.';
  }
}

async function reporterRappel() {
  etat.prefs.rappelReporteJusqua = Date.now() + DELAI_REPORT_RAPPEL;
  rendreRappel(); // on cache le rappel tout de suite…
  await sauverPreferences(); // …puis on mémorise le choix
}

function horodatageNote(note) {
  return Math.max(note.modifieLe || 0, note.supprimeeLe || 0);
}

/** Crée un fichier contenant TOUTES les notes (corbeille comprise) et le télécharge. */
async function exporter() {
  try {
    await enregistrerMaintenant();
    const notes = etat.notes;
    const entete = {
      application: 'omni-notes',
      format: 1,
      version: VERSION,
      exporteLe: new Date().toISOString(),
      nombreDeNotes: notes.length,
    };

    let contenu;
    if (etat.cle) {
      // Mot de passe actif : la sauvegarde est chiffrée elle aussi.
      const paquet = await chiffrement.chiffrer(etat.cle, notes);
      contenu = { ...entete, chiffre: true, sel: etat.securite.sel, iterations: etat.securite.iterations, iv: paquet.iv, donnees: paquet.donnees };
      if (etat.modeles.length > 0) {
        contenu.modelesChiffres = await chiffrement.chiffrer(etat.cle, etat.modeles);
      }
    } else {
      contenu = { ...entete, chiffre: false, notes, modeles: etat.modeles };
    }

    const aujourdhui = new Date();
    const deux = (n) => String(n).padStart(2, '0');
    const nomFichier = `omni-notes-sauvegarde-${aujourdhui.getFullYear()}-${deux(aujourdhui.getMonth() + 1)}-${deux(aujourdhui.getDate())}.json`;

    const fichier = new Blob([JSON.stringify(contenu, null, 2)], { type: 'application/json' });
    const adresse = URL.createObjectURL(fichier);
    const lien = creer('a', { href: adresse, download: nomFichier });
    document.body.append(lien);
    lien.click();
    lien.remove();
    setTimeout(() => URL.revokeObjectURL(adresse), 30000);

    etat.prefs.derniereSauvegarde = Date.now();
    etat.prefs.rappelReporteJusqua = null;
    rendreRappel();
    if (etat.ecran === 'reglages') rendreReglages();
    await sauverPreferences();
    afficherMessage(
      etat.cle
        ? `Sauvegarde chiffrée téléchargée (${nomFichier}). Il faudra votre mot de passe actuel pour l'importer.`
        : `Sauvegarde téléchargée (${nomFichier}). Gardez ce fichier en lieu sûr.`,
      { duree: 9000 }
    );
  } catch (erreur) {
    console.error(erreur);
    afficherMessage("Impossible d'exporter la sauvegarde.", { duree: 8000 });
  }
}

/** Lit un fichier de sauvegarde et propose de fusionner ou de remplacer. */
async function importerFichier(fichier) {
  const erreurFichier = () => afficherMessage("Ce fichier n'est pas une sauvegarde Omni-Notes valide.", { duree: 8000 });

  let donnees;
  try {
    donnees = JSON.parse(await fichier.text());
  } catch {
    erreurFichier();
    return;
  }
  if (!donnees || typeof donnees !== 'object' || donnees.application !== 'omni-notes') { erreurFichier(); return; }

  let notesBrutes;
  let modelesBruts;
  if (donnees.chiffre) {
    const dechiffre = await dechiffrerSauvegarde(donnees);
    if (!dechiffre) return; // annulé ou erreur déjà signalée
    notesBrutes = dechiffre.notesBrutes;
    modelesBruts = dechiffre.modelesBrutes;
  } else {
    notesBrutes = donnees.notes;
    modelesBruts = donnees.modeles;
  }
  if (!Array.isArray(notesBrutes)) { erreurFichier(); return; }

  // Normalise et dédoublonne par identifiant (en gardant la version la plus récente).
  const parId = new Map();
  for (const brute of notesBrutes) {
    const note = normaliserNote(brute);
    if (!note) continue;
    const precedente = parId.get(note.id);
    if (!precedente || horodatageNote(note) >= horodatageNote(precedente)) {
      parId.set(note.id, note);
    }
  }
  const importees = [...parId.values()];
  if (importees.length === 0) {
    afficherMessage('Ce fichier ne contient aucune note.', { duree: 6000 });
    return;
  }

  const modelesImportes = Array.isArray(modelesBruts)
    ? modelesBruts.map(normaliserModele).filter(Boolean)
    : null;

  const choix = await demander({
    titre: 'Importer des notes',
    message: [
      `Le fichier contient ${pluriel(importees.length, 'note')}.`,
      '« Fusionner » ajoute les notes du fichier à vos notes actuelles. Si une note existe des deux côtés, la version la plus récente est gardée.',
      '« Remplacer » efface toutes vos notes actuelles et les remplace par celles du fichier.',
    ],
    boutons: [
      { texte: 'Fusionner avec mes notes', valeur: 'fusionner', style: 'principal' },
      { texte: 'Remplacer toutes mes notes', valeur: 'remplacer', style: 'danger' },
      { texte: 'Annuler', valeur: null },
    ],
  });
  if (!choix.valeur) return;

  try {
    if (choix.valeur === 'remplacer') {
      const ok = await confirmer(
        'Remplacer toutes vos notes ?',
        `Vos ${pluriel(etat.notes.length, 'note actuelle', 'notes actuelles')} (corbeille comprise) seront effacées définitivement et remplacées par les ${importees.length} du fichier. Cette action est irréversible.`,
        'Oui, tout remplacer'
      );
      if (!ok) return;
      await remplacerNotes(importees);
      if (modelesImportes) {
        etat.modeles = modelesImportes;
        await sauverModeles();
      }
      afficherMessage(`${pluriel(importees.length, 'note importée', 'notes importées')}. Vos anciennes notes ont été remplacées.`, { duree: 8000 });
    } else {
      const analyse = analyserFusion(importees);
      const messagesFusion = [
        `Nouvelles notes ajoutées : ${analyse.ajoutees.length}`,
        `Notes mises à jour : ${analyse.misesAJour.length}`,
        `Notes déjà à jour (inchangées) : ${analyse.inchangees.length}`,
      ];
      if (analyse.misesAJour.length > 0) {
        const titresMaj = analyse.misesAJour
          .slice(0, 5)
          .map((n) => `« ${n.titre.trim() || 'Sans titre'} »`)
          .join(', ');
        const reste = analyse.misesAJour.length > 5
          ? ` (et ${analyse.misesAJour.length - 5} autre${analyse.misesAJour.length - 5 > 1 ? 's' : ''})`
          : '';
        messagesFusion.push(`Mises à jour concernées : ${titresMaj}${reste}.`);
      }
      const confirmerFusion = await demander({
        titre: 'Comparer avant de fusionner',
        message: messagesFusion,
        boutons: [
          { texte: 'Confirmer la fusion', valeur: 'confirmer', style: 'principal' },
          { texte: 'Annuler', valeur: null },
        ],
      });
      if (confirmerFusion.valeur !== 'confirmer') return;

      const bilan = await fusionnerNotes(importees);
      if (modelesImportes && modelesImportes.length > 0) {
        const existants = new Set(etat.modeles.map((m) => m.id));
        const ajoutsModeles = modelesImportes.filter((m) => !existants.has(m.id));
        if (ajoutsModeles.length > 0) {
          etat.modeles.push(...ajoutsModeles);
          await sauverModeles();
        }
      }
      afficherMessage(`Import terminé : ${pluriel(bilan.ajoutees, 'note ajoutée', 'notes ajoutées')}, ${pluriel(bilan.misesAJour, 'mise à jour', 'mises à jour')}, ${pluriel(bilan.inchangees, 'déjà à jour', 'déjà à jour')}.`, { duree: 9000 });
    }
    etat.filtreEtiquette = null;
  } catch (erreur) {
    console.error(erreur);
    afficherMessage("L'importation a échoué : impossible d'enregistrer les notes sur cet appareil.", { duree: 9000 });
  }
}

/** Demande le mot de passe d'une sauvegarde chiffrée et la déchiffre. */
async function dechiffrerSauvegarde(donnees) {
  const iterations = Number(donnees.iterations);
  if (typeof donnees.sel !== 'string' || typeof donnees.iv !== 'string' || typeof donnees.donnees !== 'string'
    || !Number.isInteger(iterations) || iterations < 1000 || iterations > 10000000) {
    afficherMessage("Ce fichier de sauvegarde est abîmé et ne peut pas être lu.", { duree: 8000 });
    return null;
  }
  let selOctets;
  try {
    selOctets = chiffrement.depuisBase64(donnees.sel);
    chiffrement.depuisBase64(donnees.iv);
    chiffrement.depuisBase64(donnees.donnees);
  } catch {
    afficherMessage("Ce fichier de sauvegarde est abîmé et ne peut pas être lu.", { duree: 8000 });
    return null;
  }

  let message = 'Cette sauvegarde est protégée. Entrez le mot de passe qui était utilisé au moment où elle a été faite.';
  for (;;) {
    const reponse = await demander({
      titre: 'Sauvegarde chiffrée',
      message,
      champ: { label: 'Mot de passe de la sauvegarde', type: 'password' },
      boutons: [
        { texte: 'Ouvrir la sauvegarde', valeur: 'ok', style: 'principal' },
        { texte: 'Annuler', valeur: null },
      ],
    });
    if (reponse.valeur !== 'ok') return null;
    try {
      afficherMessage('Vérification du mot de passe…', { duree: 3000 });
      const cle = await chiffrement.deriverCle(reponse.saisie, selOctets, iterations);
      const notesBrutes = await chiffrement.dechiffrer(cle, donnees);
      let modelesBrutes = null;
      if (donnees.modelesChiffres) {
        try {
          modelesBrutes = await chiffrement.dechiffrer(cle, donnees.modelesChiffres);
        } catch { modelesBrutes = null; }
      }
      return { notesBrutes, modelesBrutes };
    } catch {
      message = 'Mot de passe incorrect. Réessayez.';
    }
  }
}

function analyserFusion(importees) {
  const ajoutees = [];
  const misesAJour = [];
  const inchangees = [];
  for (const note of importees) {
    const existante = trouverNote(note.id);
    if (!existante) ajoutees.push(note);
    else if (horodatageNote(note) > horodatageNote(existante)) misesAJour.push(note);
    else inchangees.push(note);
  }
  return { ajoutees, misesAJour, inchangees };
}

async function remplacerNotes(nouvelles) {
  await enregistrerMaintenant();
  const operations = [{ magasin: 'notes', action: 'vider' }];
  for (const note of nouvelles) operations.push({ magasin: 'notes', action: 'ecrire', valeur: await versStockage(note) });
  await enFile(() => db.groupe(operations));
  etat.notes = nouvelles;
  etat.notesIllisibles = 0;
  await purgerCorbeille();
}

async function fusionnerNotes(importees) {
  await enregistrerMaintenant();
  const analyse = analyserFusion(importees);
  const aEcrire = [...analyse.ajoutees, ...analyse.misesAJour];
  const operations = [];
  for (const note of aEcrire) operations.push({ magasin: 'notes', action: 'ecrire', valeur: await versStockage(note) });
  if (operations.length) await enFile(() => db.groupe(operations));
  for (const note of aEcrire) {
    etat.notes = etat.notes.filter((n) => n.id !== note.id);
    etat.notes.push(note);
  }
  await purgerCorbeille();
  return {
    ajoutees: analyse.ajoutees.length,
    misesAJour: analyse.misesAJour.length,
    inchangees: analyse.inchangees.length,
  };
}

/* =====================================================================
   7. Mot de passe et chiffrement
   ===================================================================== */

let minuterieInactivite = null;
let derniereActiviteInactivite = 0;

function annulerMinuterieInactivite() {
  clearTimeout(minuterieInactivite);
  minuterieInactivite = null;
}

function reinitialiserMinuterieInactivite(forcer = false) {
  const minutes = Number(etat.prefs.verrouInactiviteMinutes) || 0;
  if (!motDePasseActif() || etat.verrouille || minutes <= 0) {
    annulerMinuterieInactivite();
    return;
  }
  const maintenant = Date.now();
  if (!forcer && minuterieInactivite && maintenant - derniereActiviteInactivite < 1000) return;
  derniereActiviteInactivite = maintenant;
  clearTimeout(minuterieInactivite);
  minuterieInactivite = setTimeout(() => { verrouiller(); }, minutes * 60 * 1000);
}

function afficherVerrou() {
  etat.verrouille = true;
  $('#champ-verrou').value = '';
  $('#champ-verrou').type = 'password';
  $('#voir-verrou').checked = false;
  $('#erreur-verrou').textContent = '';
  montrerEcran('verrou');
  $('#champ-verrou').focus();
}

/** Vérifie un mot de passe et renvoie la clé correspondante (ou null s'il est faux). */
async function verifierMotDePasse(motDePasse) {
  const s = etat.securite;
  try {
    const cle = await chiffrement.deriverCle(motDePasse, chiffrement.depuisBase64(s.sel), s.iterations);
    const verification = await chiffrement.dechiffrer(cle, s.verif);
    return verification && verification.verification === TEXTE_VERIFICATION ? cle : null;
  } catch {
    return null;
  }
}

let mdpEnCours = false;

async function deverrouiller(evenement) {
  evenement.preventDefault();
  const champ = $('#champ-verrou');
  const bouton = $('#btn-deverrouiller');
  const texteBouton = $('#texte-deverrouiller');
  const erreur = $('#erreur-verrou');
  if (!champ.value) { erreur.textContent = 'Entrez votre mot de passe.'; return; }

  bouton.disabled = true;
  erreur.textContent = '';
  const ancienTexte = texteBouton.textContent;
  texteBouton.textContent = 'Vérification…';
  try {
    const cle = await verifierMotDePasse(champ.value);
    if (!cle) {
      erreur.textContent = 'Mot de passe incorrect.';
      champ.select();
      return;
    }
    champ.value = '';
    etat.cle = cle;
    await chargerNotes();
    history.replaceState({ ecran: 'liste' }, '');
    ouvrirApplication();
  } finally {
    bouton.disabled = false;
    texteBouton.textContent = ancienTexte;
  }
}

/** Verrouille l'application : la clé et les notes sont retirées de la mémoire et du DOM. */
async function verrouiller() {
  if (!motDePasseActif() || etat.verrouille) return;
  etat.verrouille = true;
  annulerMinuterieInactivite();
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  try {
    if (etat.ecran === 'edition') await quitterEditeur();
    else await enregistrerMaintenant();
    await enFile(() => {}); // attend la fin des écritures en cours avant de jeter la clé
  } catch (erreur) {
    console.error(erreur);
  } finally {
    clearTimeout(minuterieEnregistrement);
    minuterieEnregistrement = null;
    noteEnAttente = null;
    clearTimeout(minuterieMessage);
    $('#message').hidden = true;
    $('#message-texte').textContent = '';

    etat.cle = null;
    etat.notes = [];
    etat.modeles = [];
    etat.noteOuverteId = null;
    etat.masquerCoches = false;
    etat.recherche = '';
    etat.filtreEtiquette = null;

    // On vide aussi tout le DOM pouvant contenir des notes ou étiquettes.
    $('#liste-notes').replaceChildren();
    $('#liste-corbeille').replaceChildren();
    $('#liste-archives').replaceChildren();
    $('#filtres-etiquettes').replaceChildren();
    $('#filtres-etiquettes').hidden = true;
    $('#etiquettes-note').replaceChildren();
    $('#liste-etiquettes').replaceChildren();
    $('#elements-liste').replaceChildren();
    $('#vue-lecture').replaceChildren();
    $('#vue-lecture').hidden = true;
    $('#bandeau-lecture-seule').hidden = true;
    $('#btn-verrouiller-rapide').hidden = true;
    $('#champ-recherche').value = '';
    $('#champ-titre').value = '';
    $('#champ-contenu').value = '';
    $('#champ-etiquette').value = '';
    $('#dates-note').textContent = '';
    $('#statut-sauvegarde').textContent = '';
    afficherVerrou();
  }
}

/** Ouvre la fenêtre du mot de passe. mode = 'activer' | 'modifier' | 'desactiver' */
function ouvrirDialogueMotDePasse(mode) {
  const dialogue = $('#dialogue-mdp');
  if (dialogue.open) return;
  dialogue.dataset.mode = mode;
  const titres = { activer: 'Activer un mot de passe', modifier: 'Modifier le mot de passe', desactiver: 'Désactiver le mot de passe' };
  $('#mdp-titre').textContent = titres[mode];
  $('#mdp-avertissement').hidden = mode === 'desactiver';
  $('#zone-mdp-actuel').hidden = mode === 'activer';
  $('#zone-mdp-nouveau').hidden = mode === 'desactiver';
  $('#zone-mdp-confirmation').hidden = mode === 'desactiver';
  $('#zone-mdp-compris').hidden = mode === 'desactiver';
  for (const id of ['mdp-actuel', 'mdp-nouveau', 'mdp-confirmation']) {
    $('#' + id).value = '';
    $('#' + id).type = 'password';
  }
  $('#mdp-compris').checked = false;
  $('#mdp-voir').checked = false;
  $('#mdp-erreur').textContent = '';
  $('#mdp-valider').textContent = mode === 'desactiver' ? 'Désactiver et déchiffrer mes notes' : 'Valider';
  $('#mdp-valider').disabled = false;
  $('#mdp-annuler').disabled = false;
  dialogue.showModal();
  $(mode === 'activer' ? '#mdp-nouveau' : '#mdp-actuel').focus();
}

function fermerDialogueMotDePasse() {
  if (mdpEnCours) return;
  for (const id of ['mdp-actuel', 'mdp-nouveau', 'mdp-confirmation']) $('#' + id).value = '';
  $('#dialogue-mdp').close();
}

async function validerMotDePasse(evenement) {
  evenement.preventDefault();
  if (mdpEnCours) return;
  const mode = $('#dialogue-mdp').dataset.mode;
  const erreur = $('#mdp-erreur');
  const actuel = $('#mdp-actuel').value;
  const nouveau = $('#mdp-nouveau').value;
  const confirmation = $('#mdp-confirmation').value;
  erreur.textContent = '';

  if (!window.crypto || !window.crypto.subtle) {
    erreur.textContent = 'Le chiffrement nécessite une adresse sécurisée (HTTPS ou localhost).';
    return;
  }

  // 1. Vérifications simples avant de commencer.
  if (mode !== 'activer' && !actuel) { erreur.textContent = 'Entrez votre mot de passe actuel.'; return; }
  if (mode !== 'desactiver') {
    if (nouveau.length < LONGUEUR_MIN_MDP) { erreur.textContent = `Le nouveau mot de passe doit contenir au moins ${LONGUEUR_MIN_MDP} caractères.`; return; }
    if (nouveau !== confirmation) { erreur.textContent = 'Les deux mots de passe ne sont pas identiques.'; return; }
    if (!$('#mdp-compris').checked) { erreur.textContent = 'Cochez la case pour confirmer que vous avez compris l\'avertissement.'; return; }
  }

  const bouton = $('#mdp-valider');
  const annuler = $('#mdp-annuler');
  const texteBouton = bouton.textContent;
  mdpEnCours = true;
  bouton.disabled = true;
  annuler.disabled = true;
  bouton.textContent = 'Patientez…';
  try {
    // 2. Vérification du mot de passe actuel (modifier / désactiver).
    if (mode !== 'activer') {
      const cle = await verifierMotDePasse(actuel);
      if (!cle) { erreur.textContent = 'Le mot de passe actuel est incorrect.'; return; }
    }
    // 3. L'opération elle-même.
    if (mode === 'desactiver') await appliquerChiffrement(null);
    else await appliquerChiffrement(nouveau);

    mdpEnCours = false;
    fermerDialogueMotDePasse();
    reinitialiserMinuterieInactivite(true);
    rendreReglages();
    const messages = {
      activer: 'Mot de passe activé : vos notes sont maintenant chiffrées.',
      modifier: 'Mot de passe modifié.',
      desactiver: 'Mot de passe désactivé : vos notes ne sont plus chiffrées.',
    };
    // Les anciens fichiers de sauvegarde ne changent pas : on le rappelle.
    const rappelAnciennes = mode !== 'activer' && etat.prefs.derniereSauvegarde
      ? ' Pensez à refaire une sauvegarde : les anciennes gardent l\'ancien mot de passe.'
      : '';
    afficherMessage(messages[mode] + rappelAnciennes, { duree: rappelAnciennes ? 10000 : 6000 });
  } catch (e) {
    console.error(e);
    erreur.textContent = 'Une erreur est survenue. Rien n\'a été modifié.';
  } finally {
    mdpEnCours = false;
    bouton.disabled = false;
    annuler.disabled = false;
    bouton.textContent = texteBouton;
  }
}

/**
 * Chiffre toutes les notes avec un nouveau mot de passe,
 * ou les déchiffre toutes si motDePasse vaut null.
 * Tout est écrit d'un seul coup (« tout ou rien ») : en cas de problème,
 * les anciennes données restent intactes.
 */
async function appliquerChiffrement(motDePasse) {
  await enregistrerMaintenant();
  await enFile(async () => {
    let cle = null;
    let securite = null;
    if (motDePasse !== null) {
      const sel = chiffrement.nouveauSel();
      cle = await chiffrement.deriverCle(motDePasse, sel, chiffrement.ITERATIONS);
      securite = {
        cle: 'securite',
        actif: true,
        sel: chiffrement.versBase64(sel),
        iterations: chiffrement.ITERATIONS,
        verif: await chiffrement.chiffrer(cle, { verification: TEXTE_VERIFICATION }),
      };
    }
    const operations = [];
    for (const note of etat.notes) {
      operations.push({
        magasin: 'notes',
        action: 'ecrire',
        valeur: await versStockage(note, cle, { autoriserClair: motDePasse === null }),
      });
    }
    if (etat.modeles.length > 0) {
      operations.push({
        magasin: 'reglages',
        action: 'ecrire',
        valeur: await versStockageModeles(etat.modeles, cle, { autoriserClair: motDePasse === null }),
      });
    }
    operations.push(securite
      ? { magasin: 'reglages', action: 'ecrire', valeur: securite }
      : { magasin: 'reglages', action: 'effacer', cle: 'securite' });
    await db.groupe(operations);
    // Seulement maintenant que tout est bien écrit, on change l'état en mémoire.
    etat.cle = cle;
    etat.securite = securite;
  });
}

/** Mot de passe oublié : tout effacer pour repartir de zéro. */
async function toutEffacer() {
  const reponse = await demander({
    titre: 'Tout effacer ?',
    message: [
      'Toutes les notes de cet appareil seront effacées définitivement, ainsi que le mot de passe. Cette action est irréversible.',
      'Pour confirmer, écrivez EFFACER ci-dessous.',
    ],
    champ: { label: 'Écrivez EFFACER', type: 'text' },
    boutons: [
      { texte: 'Tout effacer', valeur: 'ok', style: 'danger' },
      { texte: 'Annuler', valeur: null },
    ],
  });
  if (reponse.valeur !== 'ok') return;
  if (reponse.saisie.trim().toUpperCase() !== 'EFFACER') {
    afficherMessage('Le mot EFFACER n\'a pas été écrit correctement. Rien n\'a été effacé.', { duree: 6000 });
    return;
  }
  await enFile(() => db.groupe([
    { magasin: 'notes', action: 'vider' },
    { magasin: 'reglages', action: 'effacer', cle: 'securite' },
    { magasin: 'reglages', action: 'effacer', cle: 'modeles' },
  ]));
  etat.securite = null;
  etat.cle = null;
  etat.notes = [];
  etat.modeles = [];
  etat.notesIllisibles = 0;
  etat.recherche = '';
  etat.filtreEtiquette = null;
  $('#champ-recherche').value = '';
  const oubli = document.querySelector('#ecran-verrou details.oubli');
  if (oubli) oubli.open = false;
  history.replaceState({ ecran: 'liste' }, '');
  ouvrirApplication();
  afficherMessage('Tout a été effacé. Vous pouvez recommencer ou importer une sauvegarde depuis les Réglages.', { duree: 9000 });
}

/* =====================================================================
   8. Réglages et apparence
   ===================================================================== */

function appliquerApparence() {
  const racine = document.documentElement;
  const { theme, taille } = etat.prefs;
  if (theme === 'clair' || theme === 'sombre') racine.dataset.theme = theme;
  else delete racine.dataset.theme;
  if (taille === 'grande' || taille === 'tres-grande') racine.dataset.taille = taille;
  else delete racine.dataset.taille;
  try { localStorage.setItem(CLE_APPARENCE, JSON.stringify({ theme, taille })); } catch { /* pas grave */ }
  // La barre du téléphone prend la couleur du fond de l'application.
  const fond = getComputedStyle(racine).getPropertyValue('--fond').trim();
  if (fond) $('#couleur-theme').setAttribute('content', fond);
}

function rendreReglages() {
  document.querySelectorAll('input[name="theme"]').forEach((r) => { r.checked = r.value === etat.prefs.theme; });
  document.querySelectorAll('input[name="taille"]').forEach((r) => { r.checked = r.value === etat.prefs.taille; });

  $('#info-derniere-sauvegarde').textContent = etat.prefs.derniereSauvegarde
    ? `Dernière sauvegarde : ${dateLisible(etat.prefs.derniereSauvegarde)}.`
    : 'Dernière sauvegarde : jamais.';

  const actif = motDePasseActif();
  const cryptoDisponible = Boolean(window.crypto && window.crypto.subtle);
  $('#btn-activer-mdp').disabled = !cryptoDisponible;
  if (!cryptoDisponible && !actif) {
    $('#etat-mdp').textContent = 'Le chiffrement par mot de passe nécessite une adresse sécurisée (HTTPS ou localhost).';
  } else {
    $('#etat-mdp').textContent = actif
      ? 'Le mot de passe est activé : vos notes sont chiffrées et l\'application se verrouille au lancement, ainsi qu\'après 5 minutes en arrière-plan.'
      : 'Aucun mot de passe. Vous pouvez en activer un pour chiffrer vos notes et verrouiller l\'application. C\'est facultatif.';
  }
  $('#actions-mdp-actif').hidden = !actif;
  $('#actions-mdp-inactif').hidden = actif;
  $('#select-verrou-inactivite').value = String(DELAIS_INACTIVITE.includes(Number(etat.prefs.verrouInactiviteMinutes)) ? etat.prefs.verrouInactiviteMinutes : 0);
}

/* =====================================================================
   Branchement des boutons et des événements
   ===================================================================== */

function brancherEvenements() {
  // Tous les boutons « Retour »
  document.querySelectorAll('[data-retour]').forEach((b) => b.addEventListener('click', retour));

  // Liste
  $('#btn-mise-a-jour').addEventListener('click', async (e) => {
    if (!inscriptionSw || !inscriptionSw.waiting) return;
    miseAJourDemandee = true;
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = 'Mise à jour…';
    await enregistrerMaintenant();
    inscriptionSw.waiting.postMessage({ type: 'activer' });
  });
  $('#btn-nouvelle-note').addEventListener('click', choisirTypeNouvelleNote);
  $('#btn-verrouiller-rapide').addEventListener('click', verrouiller);
  $('#btn-ouvrir-archives').addEventListener('click', () => allerA('archives'));
  $('#btn-ouvrir-corbeille').addEventListener('click', async () => { await purgerCorbeille(); allerA('corbeille'); });
  $('#btn-ouvrir-reglages').addEventListener('click', () => allerA('reglages'));
  $('#champ-recherche').addEventListener('input', (e) => { etat.recherche = e.target.value; rendreListe(); });
  $('#select-tri').addEventListener('change', async (e) => {
    etat.prefs.tri = TRIS_VALIDES.includes(e.target.value) ? e.target.value : 'modification';
    rendreListe();
    await sauverPreferences();
  });
  $('#rappel-sauver').addEventListener('click', exporter);
  $('#rappel-plus-tard').addEventListener('click', reporterRappel);

  // Édition
  $('#champ-titre').addEventListener('input', (e) => {
    const note = noteOuverte();
    if (!note || note.lectureSeule) return;
    note.titre = e.target.value;
    signalerModification();
  });
  $('#champ-titre').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const note = noteOuverte();
    if (!note || note.lectureSeule) return;
    if (note.type === 'texte') $('#champ-contenu').focus();
    else {
      const premier = $('#elements-liste .element-texte');
      if (premier) premier.focus(); else ajouterLigne(0);
    }
  });
  $('#champ-contenu').addEventListener('input', (e) => {
    const note = noteOuverte();
    if (!note || note.lectureSeule) return;
    note.contenu = e.target.value;
    ajusterHauteur(e.target);
    signalerModification();
  });
  window.addEventListener('resize', () => {
    if (etat.ecran === 'edition') ajusterHauteur($('#champ-contenu'));
  });
  $('#btn-ajouter-ligne').addEventListener('click', () => ajouterLigne());
  $('#btn-masquer-coches').addEventListener('click', basculerMasquerCoches);
  $('#btn-tout-decocher').addEventListener('click', toutDecocher);
  $('#btn-supprimer-coches').addEventListener('click', supprimerCoches);
  $('#btn-epingler').addEventListener('click', basculerEpingle);
  $('#btn-supprimer-note').addEventListener('click', supprimerNoteOuverte);
  $('#form-etiquette').addEventListener('submit', ajouterEtiquette);
  $('#btn-changer-type').addEventListener('click', changerType);
  $('#btn-lecture-seule').addEventListener('click', basculerLectureSeule);
  $('#btn-quitter-lecture-seule').addEventListener('click', basculerLectureSeule);
  $('#btn-archiver-note').addEventListener('click', basculerArchivage);
  $('#btn-sauver-modele').addEventListener('click', enregistrerCommeModele);
  $('#btn-exporter-txt').addEventListener('click', exporterNoteTexte);
  $('#btn-exporter-md').addEventListener('click', exporterNoteMarkdown);
  $('#btn-partager-note').addEventListener('click', partagerNote);

  // Corbeille
  $('#btn-vider-corbeille').addEventListener('click', viderCorbeille);

  // Réglages
  document.querySelectorAll('input[name="theme"]').forEach((r) => r.addEventListener('change', async () => {
    etat.prefs.theme = r.value;
    appliquerApparence();
    await sauverPreferences();
  }));
  document.querySelectorAll('input[name="taille"]').forEach((r) => r.addEventListener('change', async () => {
    etat.prefs.taille = r.value;
    appliquerApparence();
    await sauverPreferences();
  }));
  $('#btn-exporter').addEventListener('click', exporter);
  $('#btn-importer').addEventListener('click', () => $('#champ-fichier').click());
  $('#champ-fichier').addEventListener('change', async (e) => {
    const fichier = e.target.files[0];
    e.target.value = ''; // permet de réimporter le même fichier plus tard
    if (fichier) await importerFichier(fichier);
  });
  $('#btn-activer-mdp').addEventListener('click', () => ouvrirDialogueMotDePasse('activer'));
  $('#btn-modifier-mdp').addEventListener('click', () => ouvrirDialogueMotDePasse('modifier'));
  $('#btn-desactiver-mdp').addEventListener('click', () => ouvrirDialogueMotDePasse('desactiver'));
  $('#btn-verrouiller').addEventListener('click', verrouiller);
  $('#select-verrou-inactivite').addEventListener('change', async (e) => {
    const val = Number(e.target.value);
    etat.prefs.verrouInactiviteMinutes = DELAIS_INACTIVITE.includes(val) ? val : 0;
    await sauverPreferences();
    reinitialiserMinuterieInactivite(true);
  });
  $('#btn-reglages-archives').addEventListener('click', () => allerA('archives'));
  $('#btn-ouvrir-apropos').addEventListener('click', () => allerA('apropos'));

  // Raccourcis clavier (ordinateur) et détection d'activité pour verrouillage
  for (const evt of ['pointerdown', 'keydown', 'touchstart']) {
    document.addEventListener(evt, () => reinitialiserMinuterieInactivite(false), { passive: true });
  }
  document.addEventListener('keydown', async (e) => {
    if (etat.verrouille || etat.ecran === 'verrou' || etat.ecran === 'chargement') return;
    if (document.querySelector('dialog[open]')) return;

    const mod = e.ctrlKey || e.metaKey;
    const touche = e.key.toLowerCase();

    if (mod && !e.altKey && !e.shiftKey && touche === 'k') {
      e.preventDefault();
      if (etat.ecran !== 'liste') {
        if (etat.ecran === 'edition') await quitterEditeur();
        history.replaceState({ ecran: 'liste' }, '');
        afficherEcran('liste');
      }
      const champ = $('#champ-recherche');
      champ.focus();
      champ.select();
      return;
    }

    if (etat.ecran === 'liste' && ((e.altKey && !mod && touche === 'n') || (mod && e.shiftKey && touche === 'n'))) {
      e.preventDefault();
      choisirTypeNouvelleNote();
      return;
    }

    if (etat.ecran === 'edition' && mod && !e.shiftKey && !e.altKey && touche === 's') {
      e.preventDefault();
      await enregistrerMaintenant();
      return;
    }

    if (etat.ecran === 'liste' && e.key === 'Escape' && $('#champ-recherche').value !== '') {
      e.preventDefault();
      $('#champ-recherche').value = '';
      etat.recherche = '';
      rendreListe();
    }
  });

  // Fenêtre du mot de passe
  $('#form-mdp').addEventListener('submit', validerMotDePasse);
  $('#mdp-annuler').addEventListener('click', fermerDialogueMotDePasse);
  $('#dialogue-mdp').addEventListener('cancel', (e) => {
    if (mdpEnCours) { e.preventDefault(); return; }
    for (const id of ['mdp-actuel', 'mdp-nouveau', 'mdp-confirmation']) $('#' + id).value = '';
  });
  $('#mdp-voir').addEventListener('change', (e) => {
    for (const id of ['mdp-actuel', 'mdp-nouveau', 'mdp-confirmation']) $('#' + id).type = e.target.checked ? 'text' : 'password';
  });

  // Écran de verrouillage
  $('#form-verrou').addEventListener('submit', deverrouiller);
  $('#voir-verrou').addEventListener('change', (e) => { $('#champ-verrou').type = e.target.checked ? 'text' : 'password'; });
  $('#btn-tout-effacer').addEventListener('click', toutEffacer);

  // Le thème « Automatique » suit le téléphone en direct.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', appliquerApparence);

  // Quand l'application passe en arrière-plan (on change d'appli, on éteint
  // l'écran…), on enregistre immédiatement : aucune perte de données.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      enregistrerMaintenant();
      etat.cacheeDepuis = Date.now();
    } else {
      const depuis = etat.cacheeDepuis;
      etat.cacheeDepuis = null;
      if (depuis && Date.now() - depuis > DELAI_VERROU_AUTO) {
        verrouiller();
      }
    }
  });
  window.addEventListener('pagehide', () => { enregistrerMaintenant(); });
}

// C'est parti !
demarrer();
