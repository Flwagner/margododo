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
- **Sensibilité réglable** : curseur de 0 à 100, mémorisé entre deux sessions, qui règle directement le seuil de −20 à −60 dBFS (plus sensible = seuil plus bas), sans calibration ambiante.
- **Jauge du microphone** : niveau sonore en direct et repère du seuil de déclenchement sur une même échelle.
- **Alerte distante ntfy** : chaque déclenchement automatique publie une notification prioritaire sur le topic `margododo`.
- **Mode Local / Remote** : les mêmes contrôles permettent de lire/arrêter le son, choisir la durée ou activer/désactiver la détection sur un autre téléphone via ntfy.
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
3. Laisser l'application visible : la surveillance commence immédiatement, sans mesurer ni apprendre le bruit ambiant, et maintient l'écran allumé.
4. Observer la jauge du microphone et ajuster la sensibilité pour placer le trait du seuil au-dessus du bruit blanc déjà présent, mais en dessous des pleurs si leurs niveaux le permettent. Les dBFS indiquent un niveau numérique, pas un volume acoustique en dB SPL.
5. Des sons au-dessus du seuil et satisfaisant le filtre vocal déclenchent la lecture lorsqu'ils cumulent 1,2 seconde sur les 3 dernières secondes. Les pauses sont tolérées. La surveillance reprend cinq secondes après l'arrêt de la lecture.

Le seuil ne s'adapte jamais automatiquement à la pièce. Un bruit blanc ou une voix qui dépasse le seuil et satisfait le filtre vocal peut donc déclencher la lecture. La jauge est en pause pendant la lecture et le délai de reprise. Un changement de sensibilité efface la fenêtre de détection précédente.

Le signal du microphone est analysé localement en temps réel. Il n'est ni enregistré, ni conservé, ni envoyé sur Internet. Lors d'un déclenchement, seuls l'événement et la durée configurée sont transmis à `ntfy.sh`. Cette détection acoustique simple peut confondre des pleurs avec une voix, une télévision ou un autre bruit prolongé : ajuster la sensibilité selon la chambre.

Pour recevoir l'alerte sur un autre téléphone, installer l'application ntfy, s'abonner au topic `margododo` sur le serveur `https://ntfy.sh`, puis autoriser ses notifications. Le topic est public et facile à deviner : un tiers peut potentiellement s'y abonner ou y publier de fausses alertes.

### Télécommande : téléphone A dans la chambre, B dans le salon

1. Sur **A**, conserver le mode **Local**, appuyer une fois sur **Lecture** pour autoriser l'audio, puis arrêter le son si nécessaire. Le contexte audio reste disponible après l'arrêt.
2. Pour pouvoir aussi commander la détection depuis B, activer une première fois la **surveillance sur A** et autoriser le microphone. La surveillance peut ensuite être désactivée ; l'autorisation est retenue pour cette session.
3. Laisser **A branché, écran allumé, application visible**. Après la préparation audio, l'application demande de maintenir l'écran allumé même quand le son est arrêté. Le navigateur ou le système peut refuser cette demande : vérifier l'écran.
4. Sur **B**, ouvrir la même application et sélectionner **Remote**. Aucune association ni application ntfy supplémentaire n'est nécessaire. Le dernier mode choisi est mémorisé sur chaque téléphone.
5. Attendre la réponse de A, puis utiliser les contrôles habituels : lecture/arrêt, durée (y compris ∞) et surveillance. Le volume, la sensibilité et la jauge micro restent uniquement sur A. En Remote, aucun son n'est joué et aucun accès au microphone n'est demandé sur B.

L'état affiché vient des confirmations de A, pas du simple envoi d'une commande. Une commande en cours bloque temporairement les autres contrôles. **Actualiser l'état** permet de vérifier que A répond. L'état est aussi demandé à l'ouverture, à la reconnexion, au retour au premier plan et toutes les cinq minutes pendant que la télécommande est visible ; les changements sur A sont transmis spontanément. L'âge de la dernière réponse est affiché et l'état est considéré ancien après six minutes. Le compte à rebours est calculé sur B à partir de l'heure de fin reçue, sans publication à chaque seconde.

Les échanges utilisent les topics fixes **`margododo-commands`** et **`margododo-state`** sur `https://ntfy.sh`, séparés des alertes de pleurs existantes. Ils sont **publics, sans authentification** : toute personne connaissant ces topics peut lire les états ou envoyer des commandes. Prévu pour **un seul téléphone Local et une télécommande Remote** ; plusieurs téléphones Local recevraient les demandes d'état et rendraient la sélection ambiguë. Ne pas s'abonner à ces topics techniques dans l'application ntfy pour recevoir les alertes : utiliser seulement `margododo`.

Les publications de commande/état ne sont pas mises en cache et les abonnements ne demandent aucun historique. Les doublons et messages de plus de quinze secondes sont ignorés. Les commandes ciblent la session de A découverte par la télécommande ; après rechargement de A, actualiser l'état sur B. Maintenir les horloges des deux téléphones à l'heure automatique. Un délai de dix secondes sans confirmation affiche une erreur ; l'exécution d'une commande déjà en cours n'est pas annulée et aucun nouvel envoi automatique n'est effectué.

Le contrôle distant nécessite Internet sur les deux appareils et reste soumis aux quotas/disponibilité de ntfy.sh. Une erreur ntfy n'arrête pas le fonctionnement local. Les permissions du navigateur ne peuvent pas être accordées depuis B : si A demande une interaction ou une autorisation, intervenir sur A. Après un rechargement, repasser par la préparation audio/micro sur A. Passer A en Remote arrête sa lecture et sa surveillance locales et ferme son microphone.

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
| `remote.js` | Transport ntfy : commandes, confirmations, fraîcheur des états et reconnexion |
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
- L'alerte ntfy nécessite une connexion Internet. Son échec ne bloque pas le démarrage du bruit blanc et n'est pas retenté automatiquement.
- Le volume réglé dans l'app est le **volume de départ** de la courbe ; le volume physique du téléphone reste le volume maître global.
- Les notifications web et le badge d'icône requièrent une PWA installée (Android récent / iOS 16.4+).

## Fonctionnement technique

- Le son est un buffer de bruit blanc en boucle, filtré (highpass ~80 Hz, lowpass ~3,2 kHz, renforcement ~1,1 kHz) avec un bourdonnement à 100/200 Hz très discret.
- L'enveloppe de volume est programmée sur l'horloge audio (`setValueCurveAtTime`) : fondu d'entrée ~1,2 s puis décroissance quadratique jusqu'à 0 exactement à la fin — aucun clic, fiable même si l'onglet est mis en veille.
- Le compte à rebours est ancré sur `Date.now()`, ce qui le rend tolérant au throttling des onglets en arrière-plan.
- La détection mesure le niveau RMS toutes les 100 ms et le compare uniquement au seuil réglé, puis applique un filtre fréquentiel approximatif entre 250 Hz et 4 kHz. Une fenêtre glissante cumule les passages concordants : déclenchement à 1,2 seconde sur 3 secondes. Les interruptions d'analyse ne comptent pas comme du son et une longue interruption remet la fenêtre à zéro. Aucun modèle d'IA ni calibration du bruit ambiant n'est utilisé.
- Après un déclenchement automatique réussi, l'application publie un POST non bloquant vers `https://ntfy.sh/margododo` avec une priorité élevée. Les démarrages manuels ne publient rien.
- Le service worker sert les navigations en *network-first* (avec repli cache hors ligne) et les assets en cache-first ; une nouvelle version déployée est détectée automatiquement et proposée via un bandeau de rechargement.
