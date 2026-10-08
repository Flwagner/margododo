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
- **Détection automatique** : le microphone peut surveiller les sons prolongés dans la bande vocale et lancer le bruit blanc pendant la durée configurée.
- **Sensibilité réglable** : seuil de détection de 0 à 100, mémorisé entre deux sessions.
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

### Surveillance automatique

1. Choisir une durée finie : le mode automatique n'est pas disponible avec la durée ∞.
2. Régler la sensibilité, puis appuyer sur **Activer la surveillance** et autoriser le microphone.
3. Laisser l'application visible : elle calibre le bruit ambiant pendant 2,5 secondes, puis maintient l'écran allumé.
4. Un son assez fort et prolongé dans la bande de la voix déclenche la lecture. La surveillance reprend cinq secondes après son arrêt.

Le signal du microphone est analysé localement en temps réel. Il n'est ni enregistré, ni conservé, ni envoyé sur Internet. Cette détection acoustique simple peut confondre des pleurs avec une voix, une télévision ou un autre bruit prolongé : ajuster la sensibilité selon la chambre.

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
- La surveillance automatique exige que l'application reste visible avec l'écran allumé. Android peut suspendre l'accès au microphone si l'application passe en arrière-plan ou si l'écran est verrouillé.
- L'autorisation du microphone et l'activation de la surveillance doivent être renouvelées après chaque rechargement de l'application.
- Le volume réglé dans l'app est le **volume de départ** de la courbe ; le volume physique du téléphone reste le volume maître global.
- Les notifications web et le badge d'icône requièrent une PWA installée (Android récent / iOS 16.4+).

## Fonctionnement technique

- Le son est un buffer de bruit blanc en boucle, filtré (highpass ~80 Hz, lowpass ~3,2 kHz, renforcement ~1,1 kHz) avec un bourdonnement à 100/200 Hz très discret.
- L'enveloppe de volume est programmée sur l'horloge audio (`setValueCurveAtTime`) : fondu d'entrée ~1,2 s puis décroissance quadratique jusqu'à 0 exactement à la fin — aucun clic, fiable même si l'onglet est mis en veille.
- Le compte à rebours est ancré sur `Date.now()`, ce qui le rend tolérant au throttling des onglets en arrière-plan.
- La détection mesure le niveau RMS, le compare à un seuil absolu et au bruit ambiant calibré, puis vérifie que l'énergie est concentrée entre 250 Hz et 4 kHz. Le déclenchement demande environ 1,6 seconde de signal concordant.
- Le service worker sert les navigations en *network-first* (avec repli cache hors ligne) et les assets en cache-first ; une nouvelle version déployée est détectée automatiquement et proposée via un bandeau de rechargement.
