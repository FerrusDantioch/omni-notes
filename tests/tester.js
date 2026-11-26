/* Omni-Notes — © 2026 Ferrus Dantioch
   Licence : Creative Commons BY-NC-ND 4.0 (texte complet dans le fichier LICENSE)
   https://creativecommons.org/licenses/by-nc-nd/4.0/ */

/* ============================================================
   Tests automatiques d'Omni-Notes.
   Lancer (Playwright doit être installé) :  node tests/tester.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { lancer, section, verifier, nouvellePage, controlesCommuns, RACINE } = require('./outils.js');

const texte = (p, sel) => p.$eval(sel, (el) => el.textContent.replace(/\s+/g, ' ').trim());

lancer('Omni-Notes', async () => {
  await controlesCommuns({ serviceWorker: 'sw.js' });

  const { ctx, p } = await nouvellePage();
  await p.waitForTimeout(800);

  await section('Création d’une note texte et persistance', async () => {
    await p.click('#btn-nouvelle-note');
    await p.click('#dialogue-boutons button[value="0"]');
    await p.fill('#champ-titre', 'Courses du week-end');
    await p.fill('#champ-contenu', 'Acheter du pain et du café.');
    await p.waitForTimeout(700);
    verifier((await texte(p, '#statut-sauvegarde')) === 'Enregistré', 'enregistrement automatique confirmé');
    await p.click('#ecran-edition [data-retour]');
    await p.waitForTimeout(300);

    const titres = await p.$$eval('#liste-notes .carte-titre', (els) => els.map((e) => e.textContent.trim()));
    verifier(titres.includes('Courses du week-end'), 'la note apparaît dans la liste', titres);

    await p.reload();
    await p.waitForTimeout(800);
    const titresApres = await p.$$eval('#liste-notes .carte-titre', (els) => els.map((e) => e.textContent.trim()));
    verifier(titresApres.includes('Courses du week-end'), 'la note persiste après rechargement');
  });

  await section('Liste à cocher et conversion de type', async () => {
    await p.click('#btn-nouvelle-note');
    await p.click('#dialogue-boutons button[value="1"]');
    await p.fill('#champ-titre', 'Checklist voyage');
    await p.fill('#elements-liste .element-texte', 'Passeport');
    await p.press('#elements-liste .element-texte', 'Enter');
    await p.waitForTimeout(100);
    const champs = await p.$$('#elements-liste .element-texte');
    await champs[1].fill('Billets');
    await p.check('#elements-liste .element input[type="checkbox"]');
    await p.waitForTimeout(700);

    // Transformation en note texte puis retour en liste
    await p.click('#options-note > summary');
    await p.click('#btn-changer-type');
    await p.click('#dialogue-boutons button[value="0"]'); // confirmer
    await p.waitForTimeout(200);
    verifier(await p.isVisible('#champ-contenu'), 'convertie en note texte');
    const contenuTexte = await p.$eval('#champ-contenu', (el) => el.value);
    verifier(contenuTexte.includes('Passeport') && contenuTexte.includes('Billets'), 'lignes conservées', contenuTexte);

    await p.click('#btn-changer-type');
    await p.waitForTimeout(200);
    verifier(await p.isVisible('#zone-liste'), 'reconvertie en liste à cocher');
  });

  await section('Étiquettes (casse/accents), épinglage et recherche', async () => {
    await p.fill('#champ-etiquette', 'Été');
    await p.click('#form-etiquette button[type="submit"]');
    await p.click('#btn-epingler');
    await p.waitForTimeout(700);
    await p.click('#ecran-edition [data-retour]');
    await p.waitForTimeout(300);

    // Créer une seconde note avec étiquette "ete" (minuscule sans accent)
    await p.click('#btn-nouvelle-note');
    await p.click('#dialogue-boutons button[value="0"]');
    await p.fill('#champ-titre', 'Vacances');
    await p.fill('#champ-contenu', 'Réserver le train');
    await p.click('#options-note > summary');
    await p.fill('#champ-etiquette', 'ete');
    await p.click('#form-etiquette button[type="submit"]');
    await p.waitForTimeout(700);
    await p.click('#ecran-edition [data-retour]');
    await p.waitForTimeout(300);

    // Cliquer sur le filtre "Été" : les 2 notes doivent apparaître
    const boutonFiltre = p.locator('#filtres-etiquettes button', { hasText: /^Été$/i });
    await boutonFiltre.click();
    await p.waitForTimeout(200);
    const cartesFiltrees = await p.$$eval('#liste-notes .carte-titre', (els) => els.map((e) => e.textContent.trim()));
    verifier(cartesFiltrees.includes('Checklist voyage') && cartesFiltrees.includes('Vacances'), 'filtre étiquette insensible aux accents/casse', cartesFiltrees);

    await p.click('#filtres-etiquettes button:first-child'); // Toutes
    await p.fill('#champ-recherche', 'cafe');
    await p.waitForTimeout(200);
    const cartesRecherche = await p.$$eval('#liste-notes .carte-titre', (els) => els.map((e) => e.textContent.trim()));
    verifier(cartesRecherche.length === 1 && cartesRecherche[0] === 'Courses du week-end', 'recherche sans accent fonctionne', cartesRecherche);
    await p.fill('#champ-recherche', '');
  });

  await section('Corbeille, annulation et suppression définitive', async () => {
    await p.click('#liste-notes .carte:has-text("Vacances")');
    await p.waitForTimeout(200);
    await p.click('#btn-supprimer-note');
    await p.waitForTimeout(300);
    verifier(await p.isVisible('#message'), 'toast « Note placée dans la corbeille » affiché');

    // Supprimer définitivement depuis la corbeille, puis vérifier qu'un clic rapide ou autre ne ressuscite pas
    await p.click('#btn-ouvrir-corbeille');
    await p.waitForTimeout(200);
    const nbCorbeille = await p.$$eval('#liste-corbeille > li', (els) => els.length);
    verifier(nbCorbeille === 1, '1 note dans la corbeille', nbCorbeille);
    await p.click('#liste-corbeille .bouton.danger');
    await p.click('#dialogue-boutons button[value="0"]'); // Effacer définitivement
    await p.waitForTimeout(300);
    verifier(await p.isVisible('#corbeille-vide'), 'la corbeille est vide après suppression définitive');
    await p.click('#ecran-corbeille [data-retour]');
    await p.waitForTimeout(300);
  });

  await section('Export et import en fusion', async () => {
    await p.click('#btn-ouvrir-reglages');
    await p.waitForTimeout(200);
    const [telechargement] = await Promise.all([
      p.waitForEvent('download'),
      p.click('#btn-exporter')
    ]);
    const cheminExport = path.join(RACINE, 'tests', 'export-temp.json');
    await telechargement.saveAs(cheminExport);
    const contenuExport = JSON.parse(fs.readFileSync(cheminExport, 'utf8'));
    verifier(contenuExport.application === 'omni-notes' && contenuExport.notes.length === 2, 'export JSON valide avec 2 notes');

    // Simule un fichier contenant un doublon d'ID (version plus récente mise à la corbeille)
    const noteExistante = contenuExport.notes.find((n) => n.titre === 'Courses du week-end');
    const copieSupprimee = { ...noteExistante, supprimeeLe: Date.now() + 5000, modifieLe: noteExistante.modifieLe };
    const fichierFusion = path.join(RACINE, 'tests', 'fusion-temp.json');
    fs.writeFileSync(fichierFusion, JSON.stringify({
      ...contenuExport,
      notes: [noteExistante, copieSupprimee]
    }));

    await p.setInputFiles('#champ-fichier', fichierFusion);
    await p.waitForTimeout(200);
    await p.click('#dialogue-boutons button[value="0"]'); // Fusionner
    await p.waitForTimeout(200);
    const titreCompare = await texte(p, '#dialogue-titre');
    const msgCompare = await texte(p, '#dialogue-message');
    verifier(titreCompare.includes('Comparer avant de fusionner') && msgCompare.includes('Courses du week-end'), 'assistant Comparer avant de fusionner affiché', { titreCompare, msgCompare });
    await p.click('#dialogue-boutons button[value="0"]'); // Confirmer la fusion
    await p.waitForTimeout(400);

    await p.click('#ecran-reglages [data-retour]');
    await p.waitForTimeout(200);
    const titresRestants = await p.$$eval('#liste-notes .carte-titre', (els) => els.map((e) => e.textContent.trim()));
    verifier(!titresRestants.includes('Courses du week-end'), 'la fusion propage une mise à la corbeille plus récente et dédoublonne les IDs', titresRestants);

    fs.unlinkSync(cheminExport);
    fs.unlinkSync(fichierFusion);
  });

  await section('Listes à cocher améliorées (réorganisation, compteur, actions)', async () => {
    await p.click('#btn-nouvelle-note');
    await p.click('#dialogue-boutons button[value="1"]');
    await p.fill('#champ-titre', 'Liste améliorée');
    await p.fill('#elements-liste .element-texte', 'Pommes');
    await p.press('#elements-liste .element-texte', 'Enter');
    await p.waitForTimeout(100);
    let champs = await p.$$('#elements-liste .element-texte');
    await champs[1].fill('Poires');
    await p.check('#elements-liste .element input[type="checkbox"]');
    await p.waitForTimeout(200);

    const debordListe = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    verifier(debordListe <= 0, 'aucun débordement horizontal dans une liste à 390 px', debordListe);

    const premierMonterDesactive = await p.$eval('#elements-liste .element:first-child .bouton-monter', (b) => b.disabled);
    const dernierDescendreDesactive = await p.$eval('#elements-liste .element:last-child .bouton-descendre', (b) => b.disabled);
    verifier(premierMonterDesactive && dernierDescendreDesactive, 'boutons ↑ et ↓ désactivés aux extrémités');

    await p.click('#elements-liste .element:first-child .bouton-descendre');
    await p.waitForTimeout(150);
    const ordreApres = await p.$$eval('#elements-liste .element-texte', (els) => els.map((e) => e.value));
    verifier(ordreApres[0] === 'Poires' && ordreApres[1] === 'Pommes', 'bouton ↓ réordonne les lignes', ordreApres);

    await p.click('#btn-masquer-coches');
    await p.waitForTimeout(150);
    const nbVisiblesMasque = await p.$$eval('#elements-liste .element:not([hidden])', (els) => els.length);
    const txtMasquer = await texte(p, '#btn-masquer-coches');
    verifier(nbVisiblesMasque === 1 && txtMasquer.includes('Afficher les cochés (1)'), 'masquer les cochés fonctionne', { nbVisiblesMasque, txtMasquer });
    await p.click('#btn-masquer-coches');

    await p.click('#btn-tout-decocher');
    await p.waitForTimeout(150);
    const nbCochesApresDecocher = await p.$$eval('#elements-liste .element input[type="checkbox"]:checked', (els) => els.length);
    verifier(nbCochesApresDecocher === 0 && !(await p.isVisible('#btn-tout-decocher')), 'tout décocher fonctionne');

    await p.check('#elements-liste .element:first-child input[type="checkbox"]');
    await p.click('#btn-supprimer-coches');
    await p.click('#dialogue-boutons button[value="0"]');
    await p.waitForTimeout(200);
    const restants = await p.$$eval('#elements-liste .element-texte', (els) => els.map((e) => e.value));
    verifier(restants.length === 1 && restants[0] === 'Pommes', 'retirer les cochés supprime les lignes cochées', restants);

    await p.waitForTimeout(600);
    await p.click('#ecran-edition [data-retour]');
    await p.waitForTimeout(200);
    const texteCarte = await texte(p, '#liste-notes .carte:has-text("Liste améliorée")');
    verifier(texteCarte.includes('0 / 1 cochés'), 'puce compteur cochés affichée sur la carte', texteCarte);
  });

  await section('Tri personnalisable et Archives', async () => {
    await p.selectOption('#select-tri', 'titre');
    await p.waitForTimeout(200);
    await p.reload();
    await p.waitForTimeout(800);
    const triPersiste = await p.$eval('#select-tri', (el) => el.value);
    verifier(triPersiste === 'titre', 'tri persisté après rechargement', triPersiste);

    await p.click('#liste-notes .carte:has-text("Liste améliorée")');
    await p.waitForTimeout(200);
    await p.click('#options-note > summary');
    await p.click('#btn-archiver-note');
    await p.waitForTimeout(300);
    verifier(await p.isVisible('#message') && await p.isVisible('#btn-ouvrir-archives'), 'note archivée avec toast et accès Archives visible');
    const txtBtnArchives = await texte(p, '#btn-ouvrir-archives');
    verifier(txtBtnArchives.includes('Archives (1)'), 'compteur Archives (1) affiché', txtBtnArchives);

    await p.click('#btn-ouvrir-archives');
    await p.waitForTimeout(200);
    const nbArchives = await p.$$eval('#liste-archives > li', (els) => els.length);
    verifier(nbArchives === 1, '1 note dans les archives', nbArchives);
    await p.click('#liste-archives .bouton.principal'); // Désarchiver
    await p.waitForTimeout(200);
    verifier(await p.isVisible('#archives-vide'), 'archives vides après désarchivage');
    await p.click('#ecran-archives [data-retour]');
    await p.waitForTimeout(200);

    await p.click('#btn-ouvrir-reglages');
    await p.click('#btn-reglages-archives');
    await p.waitForTimeout(200);
    verifier(await p.isVisible('#ecran-archives'), 'accès aux archives depuis les réglages');
    await p.click('#ecran-archives [data-retour]');
    await p.click('#ecran-reglages [data-retour]');
    await p.waitForTimeout(200);
  });

  await section('Modèles intégrés et modèles personnalisés', async () => {
    await p.click('#btn-nouvelle-note');
    await p.click('#dialogue-boutons button[value="2"]'); // À partir d'un modèle
    await p.waitForTimeout(200);
    await p.locator('#dialogue-message button.bouton-modele', { hasText: 'Liste de courses' }).click();
    await p.waitForTimeout(300);
    verifier((await p.$eval('#champ-titre', (el) => el.value)) === 'Liste de courses', 'note créée depuis modèle intégré');

    await p.click('#options-note > summary');
    await p.click('#btn-sauver-modele');
    await p.fill('#dialogue-champ', 'Courses perso');
    await p.click('#dialogue-boutons button[value="0"]');
    await p.waitForTimeout(300);
    await p.click('#ecran-edition [data-retour]');
    await p.waitForTimeout(200);

    await p.click('#btn-nouvelle-note');
    await p.click('#dialogue-boutons button[value="2"]');
    await p.waitForTimeout(200);
    const aModelePerso = await p.locator('#dialogue-message button.bouton-modele', { hasText: 'Courses perso' }).count();
    verifier(aModelePerso === 1, 'modèle personnalisé disponible dans le sélecteur');
    await p.click('#dialogue-boutons button[value="annuler"]');
  });

  await section('Mode lecture seule, liens cliquables, anti-XSS, exports et raccourcis', async () => {
    await p.click('#btn-nouvelle-note');
    await p.click('#dialogue-boutons button[value="0"]');
    await p.fill('#champ-titre', 'Note sécurisée');
    await p.fill('#champ-contenu', '# Titre\n## Sous-titre\n- Puce **gras**\nhttps://example.com/a test@example.com +33 6 12 34 56 78\n<script>window.__xssTest=1</script>');
    await p.waitForTimeout(600);

    // Export unitaire .txt et .md
    await p.click('#options-note > summary');
    const [dlTxt] = await Promise.all([p.waitForEvent('download'), p.click('#btn-exporter-txt')]);
    verifier(dlTxt.suggestedFilename().endsWith('.txt'), 'export .txt déclenché', dlTxt.suggestedFilename());
    const [dlMd] = await Promise.all([p.waitForEvent('download'), p.click('#btn-exporter-md')]);
    verifier(dlMd.suggestedFilename().endsWith('.md'), 'export .md déclenché', dlMd.suggestedFilename());

    // Activation lecture seule
    await p.click('#btn-lecture-seule');
    await p.waitForTimeout(200);
    const lecture = await p.evaluate(() => {
      const vue = document.querySelector('#vue-lecture');
      return {
        bandeau: !document.querySelector('#bandeau-lecture-seule').hidden,
        titreRO: document.querySelector('#champ-titre').readOnly,
        contenuCache: document.querySelector('#champ-contenu').hidden,
        vueVisible: !vue.hidden,
        h3: vue.querySelectorAll('h3').length,
        h4: vue.querySelectorAll('h4').length,
        li: vue.querySelectorAll('ul li').length,
        strong: vue.querySelectorAll('strong').length,
        lienHttp: Boolean(vue.querySelector('a[href="https://example.com/a"]')),
        lienMail: Boolean(vue.querySelector('a[href="mailto:test@example.com"]')),
        lienTel: Boolean(vue.querySelector('a[href="tel:+33612345678"]')),
        scripts: vue.querySelectorAll('script').length,
        xssGlobal: typeof window.__xssTest !== 'undefined',
        texteInerte: vue.textContent.includes('<script>window.__xssTest=1</script>')
      };
    });
    verifier(
      lecture.bandeau && lecture.titreRO && lecture.contenuCache && lecture.vueVisible
      && lecture.h3 === 1 && lecture.h4 === 1 && lecture.li === 1 && lecture.strong === 1
      && lecture.lienHttp && lecture.lienMail && lecture.lienTel
      && lecture.scripts === 0 && !lecture.xssGlobal && lecture.texteInerte,
      'mode lecture seule, mise en forme, liens cliquables et anti-XSS vérifiés',
      lecture
    );

    await p.click('#btn-quitter-lecture-seule');
    await p.waitForTimeout(150);
    verifier(!(await p.$eval('#champ-titre', (el) => el.readOnly)), 'sortie du mode lecture seule rétablit l’édition');

    // Raccourcis clavier Ctrl+K et Escape
    await p.keyboard.press('Control+k');
    await p.waitForTimeout(300);
    verifier(await p.isVisible('#ecran-liste'), 'Ctrl+K ramène à la liste et focalise la recherche');
    await p.fill('#champ-recherche', 'securisee');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(150);
    verifier((await p.$eval('#champ-recherche', (el) => el.value)) === '', 'Escape vide la recherche');
  });

  await section('Mot de passe, chiffrement et nettoyage DOM au verrouillage', async () => {
    await p.click('#btn-ouvrir-reglages');
    await p.waitForTimeout(200);
    await p.click('#btn-activer-mdp');
    await p.fill('#mdp-nouveau', 'phrase-secrete-2026');
    await p.fill('#mdp-confirmation', 'phrase-secrete-2026');
    await p.check('#mdp-compris');
    await p.click('#mdp-valider');
    await p.waitForSelector('#actions-mdp-actif:not([hidden])', { timeout: 15000 });
    verifier(await p.isVisible('#btn-verrouiller'), 'mot de passe activé');

    await p.selectOption('#select-verrou-inactivite', '5');
    await p.waitForTimeout(200);
    verifier((await p.$eval('#select-verrou-inactivite', (el) => el.value)) === '5', 'délai verrouillage inactivité configurable');

    await p.click('#ecran-reglages [data-retour]');
    await p.waitForTimeout(200);
    const debordBarreVerrou = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    verifier(await p.isVisible('#btn-verrouiller-rapide') && debordBarreVerrou <= 0, 'bouton Verrouiller rapide visible sans débordement à 390 px', debordBarreVerrou);

    await p.click('#btn-verrouiller-rapide');
    await p.waitForTimeout(400);
    verifier(await p.isVisible('#ecran-verrou'), 'écran de verrouillage affiché');

    const fuitesDom = await p.evaluate(() => ({
      filtres: document.querySelector('#filtres-etiquettes').children.length,
      listeNotes: document.querySelector('#liste-notes').children.length,
      listeArchives: document.querySelector('#liste-archives').children.length,
      datalist: document.querySelector('#liste-etiquettes').children.length,
      recherche: document.querySelector('#champ-recherche').value
    }));
    verifier(fuitesDom.filtres === 0 && fuitesDom.listeNotes === 0 && fuitesDom.listeArchives === 0 && fuitesDom.datalist === 0 && fuitesDom.recherche === '', 'DOM sensible intégralement vidé au verrouillage', fuitesDom);

    // Mauvais mot de passe
    await p.fill('#champ-verrou', 'mauvais');
    await p.click('#btn-deverrouiller');
    await p.waitForSelector('#erreur-verrou:not(:empty)', { timeout: 15000 });
    verifier(/incorrect/i.test(await texte(p, '#erreur-verrou')), 'mauvais mot de passe refusé');

    // Bon mot de passe
    await p.fill('#champ-verrou', 'phrase-secrete-2026');
    await p.click('#btn-deverrouiller');
    await p.waitForSelector('#ecran-liste:not([hidden])', { timeout: 15000 });
    const titresDeverrouilles = await p.$$eval('#liste-notes .carte-titre', (els) => els.map((e) => e.textContent.trim()));
    verifier(titresDeverrouilles.includes('Checklist voyage'), 'notes déchiffrées après déverrouillage', titresDeverrouilles);

    // Modèle personnalisé chiffré toujours disponible après déverrouillage
    await p.click('#btn-nouvelle-note');
    await p.click('#dialogue-boutons button[value="2"]');
    await p.waitForTimeout(200);
    const modeleApresUnlock = await p.locator('#dialogue-message button.bouton-modele', { hasText: 'Courses perso' }).count();
    verifier(modeleApresUnlock === 1, 'modèle personnalisé chiffré déchiffré après déverrouillage');
    await p.click('#dialogue-boutons button[value="annuler"]');

    // Désactivation du mot de passe
    await p.click('#btn-ouvrir-reglages');
    await p.click('#btn-desactiver-mdp');
    await p.fill('#mdp-actuel', 'phrase-secrete-2026');
    await p.click('#mdp-valider');
    await p.waitForSelector('#actions-mdp-inactif:not([hidden])', { timeout: 15000 });
    verifier(await p.isVisible('#btn-activer-mdp'), 'mot de passe désactivé');
  });

  await ctx.close();
});
