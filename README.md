# margododo

Application web autonome qui diffuse un bruit blanc de type sèche-cheveux pour aider bébé à s'endormir. Conçue pour être utilisée sur un smartphone, hébergée sur GitHub Pages (aucun backend).

## Fonctionnalités

- **Bruit blanc généré procéduralement** via la Web Audio API (passe-bas + léger bourdonnement moteur) — aucun fichier audio à fournir.
- **Durée paramétrable** : présélections (5, 10, 30, 60 min), mode continu ∞, ou curseur de 1 à 120 min.
- **Baisse progressive du volume** sur toute la durée (courbe quadratique `V·(1−t²)`) : le volume reste proche du réglage pendant la phase d'endormissement, puis décroît en douceur jusqu'au silence à la fin.
- **Contrôle média natif Android** (Media Session) : boutons lecture/arrêt et durée restante depuis le panneau de notifications et l'écran de verrouillage ; un tap rouvre l'app.
- **Notification persistante** : temps restant mis à jour en direct + bouton "Arrêter" ; un tap rouvre l'app.
- **Anneau de progression** autour du bouton lecture : le cercle se vide au fil du temps restant.
- **Badge d'icône** (Badging API) : le lanceur Android affiche les minutes restantes pendant la lecture.
- **Réglages mémorisés** : durée, volume et mode ∞ conservés entre deux sessions (`localStorage`).
- **Aperçu de la courbe** : visualisation de la décroissance du volume pour la durée choisie.
- **Mise à jour automatique** : bandeau "Nouvelle version disponible" quand une nouvelle version est déployée (stratégie *network-first* sur les navigations).
- **Écran maintenu allumé** pendant la lecture (Wake Lock API).
- **PWA installable** : ajout à l'écran d'accueil, fonctionnement hors ligne.
- UI responsive pensée pour le tactile (thème sombre, grandes zones de tap).

## Installation / mise en ligne

1. Pousser le contenu du repo sur `main` (aucune étape de build).
2. Activer GitHub Pages : **Settings → Pages → Deploy from a branch → `main` → `/ (root)`**.
3. L'app est alors disponible à l'URL `https://<utilisateur>.github.io/<repo>/`.

### Utilisation sur téléphone

1. Ouvrir l'URL dans Chrome sur Android, puis **Ajouter à l'écran d'accueil** (obligatoire pour les notifications et l'installation PWA).
2. Ouvrir l'app installée, appuyer sur **Lecture** → autoriser les notifications.
3. Le son se lance, la notification s'affiche (temps restant, bouton Arrêter) et le contrôle média apparaît au verrouillage.

### Utilisation avec une enceinte Bluetooth

Le montage (téléphone → enceinte BT dans la chambre) fonctionne sans configuration particulière. Points de vigilance :

- **Volume** : sur Android, le volume média du téléphone pilote aussi le volume de l'enceinte BT (*absolute volume*). Régler le volume une fois, puis n'utiliser que le curseur de l'app pour éviter de modifier le niveau dans la chambre par accident.
- **Appels et notifications** : un appel entrant ou une notification peut interrompre le son. L'app ne gère pas encore l'événement d'interruption audio (`interrupted`), le son peut donc s'arrêter sans reprise automatique.
- **Sonneries et notifications passent par l'enceinte** : activer le mode **Ne pas déranger** sur le téléphone pendant la lecture.
- **Déconnexion Bluetooth** : si le lien saute (batterie, portée), le son peut basculer sur le haut-parleur du téléphone ou se couper — pas de danger pour bébé (le téléphone n'est pas dans la chambre), mais à surveiller.
- **Batterie** : le wake lock maintient l'écran allumé et le Bluetooth consomme ; brancher le téléphone la nuit si possible. Éteindre l'écran manuellement coupe le wake lock mais l'audio continue en arrière-plan sur Android (la mise à jour de la notification peut alors ralentir).
- **Sécurité auditive** : garder un volume doux et placer l'enceinte assez loin du berceau ; éviter les niveaux élevés prolongés.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Application complète : UI, génération du son, timer, Media Session, notifications, réglages |
| `sw.js` | Service worker : clics de notification, cache hors ligne (*network-first* navigations) |
| `manifest.webmanifest` | Manifeste PWA |
| `icon.svg`, `icon-192.png`, `icon-512.png` | Icônes |
| `tools/make-icons.py` | Régénération des icônes PNG (Python stdlib) |

## Test local

```sh
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

`localhost` est un contexte sécurisé : service worker et notifications fonctionnent en local.

## Limites connues

- Si l'app est **balaуée** des apps récentes, le navigateur stoppe l'audio (limite du web) et la notification reste affichée avec un temps figé ; son tap rouvre l'app.
- Le volume réglé dans l'app est le **volume de départ** de la courbe ; le volume physique du téléphone reste le volume maître global.
- Les notifications web et le badge d'icône requièrent une PWA installée (Android récent / iOS 16.4+).

## Fonctionnement technique

- Le son est un buffer de bruit blanc en boucle, filtré (highpass ~80 Hz, lowpass ~3,2 kHz, renforcement ~1,1 kHz) avec un bourdonnement à 100/200 Hz très discret.
- L'enveloppe de volume est programmée sur l'horloge audio (`setValueCurveAtTime`) : fondu d'entrée ~1,2 s puis décroissance quadratique jusqu'à 0 exactement à la fin — aucun clic, fiable même si l'onglet est mis en veille.
- Le compte à rebours est ancré sur `Date.now()`, ce qui le rend tolérant au throttling des onglets en arrière-plan.
- Le service worker sert les navigations en *network-first* (avec repli cache hors ligne) et les assets en cache-first ; une nouvelle version déployée est détectée automatiquement et proposée via un bandeau de rechargement.
