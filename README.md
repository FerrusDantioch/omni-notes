# Omni-Notes

Un bloc-notes et pense-bête pour téléphone Android (et ordinateur), créé par
Ferrus Dantioch. **Gratuit, sans compte, hors ligne** : vos notes restent sur
votre appareil et rien n'est envoyé sur internet.

**Ouvrir l'application :** https://ferrusdantioch.github.io/omni-notes/

---

## Ce que fait l'application

- **Notes texte** : un titre et un contenu, enregistrés automatiquement pendant
  la frappe (aucun bouton « Enregistrer » à chercher).
- **Listes à cocher** : cases à cocher, ajout et suppression de lignes. La touche
  « Entrée » crée une nouvelle ligne. Une note texte peut devenir une liste, et
  inversement.
- **Organisation** : recherche (sans tenir compte des accents ni des majuscules),
  épinglage en haut de la liste, six couleurs douces et des étiquettes, avec un
  filtre par étiquette.
- **Corbeille** : une note supprimée y reste 30 jours. On peut la restaurer, ou
  l'effacer tout de suite (après confirmation). Après 30 jours, elle est effacée
  définitivement, automatiquement.
- **Sauvegarde** : export de toutes les notes dans un fichier `.json`, puis import
  de ce fichier au choix en **fusionnant** (la version la plus récente de chaque
  note est gardée) ou en **remplaçant** tout (avec double confirmation). Un rappel
  discret apparaît si aucune sauvegarde n'a été faite depuis 14 jours.
- **Mot de passe optionnel** : activable, modifiable et désactivable dans les
  réglages. Quand il est activé, les notes sont **chiffrées** (PBKDF2 avec
  600 000 itérations + AES-GCM 256 bits, grâce à la Web Crypto API du
  navigateur). Un écran de déverrouillage apparaît au lancement, et après
  5 minutes passées en arrière-plan. Les sauvegardes exportées sont alors
  chiffrées elles aussi.
  ⚠️ **Un mot de passe oublié est irrécupérable** : il n'est enregistré nulle
  part. La seule solution est alors de tout effacer et de repartir de zéro.
- **Réglages** : thème clair, sombre ou automatique, et trois tailles de texte.
- **Confort** : aucune animation, aucun son, aucun clignotement, couleurs douces,
  gros boutons, le bouton « retour » du téléphone fonctionne partout.

## Les fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | La page : tous les écrans de l'application (un seul visible à la fois) |
| `style.css` | L'apparence : couleurs, tailles, thèmes clair et sombre |
| `app.js` | Le fonctionnement : notes, liste, corbeille, sauvegarde, mot de passe, réglages |
| `db.js` | Le stockage des données sur l'appareil (IndexedDB) |
| `chiffrement.js` | Le chiffrement par mot de passe (PBKDF2 + AES-GCM) |
| `sw.js` | Le « service worker » : garde une copie de l'application pour le hors ligne |
| `manifest.json` | La carte d'identité de l'application (nom, icônes, couleurs) pour l'installation |
| `icones/` | Les icônes de l'application |
| `LICENSE` | La licence du code |

Il n'y a aucun outil à installer ni rien à compiler : ce sont de simples
fichiers HTML, CSS et JavaScript.

## Publier une mise à jour

L'application est publiée par GitHub Pages depuis la branche `main`, dossier
racine. Elle se met à jour 1 à 2 minutes après chaque envoi.

**Important :** à chaque modification d'un fichier, changez aussi le numéro de
version dans `sw.js` (ligne `const VERSION_CACHE = 'omni-notes-v1.0.0';`, par
exemple en `v1.0.1`) et dans `app.js` (ligne `const VERSION = '1.0.0';`). C'est
ce qui indique aux téléphones qu'une nouvelle version existe. Elle s'applique
au lancement suivant de l'application.

Les notes ne sont jamais touchées par une mise à jour : elles sont rangées à part
(dans IndexedDB), pas dans les fichiers de l'application.

## Installer l'application sur un téléphone Android

1. Ouvrez https://ferrusdantioch.github.io/omni-notes/ dans **Chrome**.
2. Touchez le menu **⋮** (en haut à droite), puis **Ajouter à l'écran
   d'accueil** (ou **Installer l'application**).
3. Confirmez avec **Installer**. L'icône Omni-Notes apparaît avec vos autres
   applications et fonctionne ensuite sans internet.

## Où sont mes notes ? Que faire pour ne pas les perdre ?

Les notes sont enregistrées dans le navigateur du téléphone. Elles disparaissent
si vous désinstallez l'application ou si vous effacez les données de Chrome pour
ce site. **Faites une sauvegarde de temps en temps** (Réglages → Exporter toutes
mes notes) et gardez le fichier ailleurs (ordinateur, clé USB…).

## Droits et licence

**Code : © 2026 Ferrus Dantioch — Creative Commons BY-NC-ND 4.0**
([résumé de la licence en français](https://creativecommons.org/licenses/by-nc-nd/4.0/deed.fr)).
En clair : le partage est autorisé, à l'identique et en citant l'auteur ;
l'usage commercial est interdit ; la modification et les œuvres dérivées sont
interdites. Le logiciel est fourni « en l'état », sans aucune garantie. Texte
complet dans le fichier [LICENSE](LICENSE) : le texte officiel en anglais, suivi
de la traduction française officielle publiée par Creative Commons.

Réalisé avec l'aide de Claude, l'intelligence artificielle d'Anthropic. L'idée
et la conception de l'application sont de Ferrus Dantioch.

Découvrir les autres applications : https://ferrusdantioch.github.io/omni-systeme/
