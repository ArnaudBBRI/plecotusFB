# Classification des contacts de chauves-souris : méthode du prototype

L'objectif est un **nombre de contacts par espèce**, obtenu à partir des suggestions Kaleidoscope et d'une partie des enregistrements vérifiée à la main. La procédure comprend deux branches : validation collective des AUTO-ID après contrôle de la référence, ou répartition des contacts restants au prorata des identifications manuelles. Chaque attribution calculée reste distincte d'une identification humaine. L'outil ne traite pas les sons et ne construit pas de classificateur acoustique à partir des mesures du CSV.

L'interface et la documentation sont en français ; champs source, codes et étiquettes importées sont conservés. Cette procédure remplace les anciens préréglages Prudent/Équilibré/Rapide.

## Parcours de vérification

Le **mode minimaliste**, activé par défaut à chaque ouverture de l'application, commence par une vue d'ensemble sous les quatre compteurs compacts : total des contacts, contrôles requis, attributions calculées et décisions manuelles. Un **graphique à barres verticales** indique les contrôles manuels restant à faire pour chaque groupe `AUTO-ID`, avec les noms français reconnus. Les groupes NoID et sans identification sont également représentés. Les contacts Noise sont ignorés par défaut et ne créent pas de contrôle requis, sauf si une vérification volontaire reste en brouillon. **Démarrer** présente le premier contact dont une vérification est requise. L'enregistrement d'une décision fait avancer vers le prochain contact requis. Les repères du fichier permettent de retrouver l'enregistrement dans Kaleidoscope ; le nom du vérificateur se règle une fois et reste proposé pour les décisions suivantes.

Avant **Démarrer**, un encart distingue les cellules `MANUAL ID` non vides du **CSV source**, celles qui sont encore les **décisions actives**, et celles remplacées par un contrôle enregistré dans Plecotus. Il indique les libellés non résolus ou libres non reconnus, ainsi que leur conséquence : ils sont repris comme des décisions terminées, sans prétendre qu'une espèce a été résolue. Le compteur des décisions manuelles peut comprendre d'autres contrôles enregistrés depuis l'import ; il ne correspond donc pas nécessairement au nombre de cellules source renseignées. Cet affichage explicite la provenance et les règles existantes, sans modifier les décisions ni les attributions.

Pendant l'examen d'un contact, deux **barres horizontales à droite** affichent l'avancement pour son groupe `AUTO-ID` et pour l'ensemble du fichier. Chaque barre comporte un repère mobile et un nombre de contrôles restants. **Vue d’ensemble** revient au graphique tout en conservant les décisions et les brouillons. La progression reste regroupée selon l'identification automatique source : corriger un contact vers une autre espèce ne le déplace pas dans le plan de vérification d'un autre groupe.

Ces indicateurs mesurent le **travail humain prévu**, et non le nombre de contacts en attente d'une attribution finale. Les lignes attribuées par validation collective ou au prorata ne comptent pas comme des contrôles manuels. Avant confirmation de la référence d'un groupe éligible à la branche directe, le plan prévoit cette référence ainsi que les autres contrôles actuellement requis. Pour une espèce exclue de cette branche ou dont la majorité de ratios ne remplit pas la condition, il prévoit déjà l'échantillon requis et l'éventuel déficit pour atteindre la cible. Les contrôles humains importés et les vérifications supplémentaires sont pris en compte dans l'avancement ; un brouillon n'est pas un contrôle terminé. Le total prévu et les nombres restants se recalculent après une décision, une modification de règle ou un changement d'échantillon. La confirmation ou la correction d'une référence peut donc réduire ou augmenter le travail restant.

**Vue complète** ouvre les tableaux de résultats, les filtres, les règles et les contrôles de sélection de l'échantillon. Elle permet aussi de vérifier des contacts supplémentaires. **Mode minimaliste** revient au parcours guidé. Le choix de vue reste actif pendant la consultation du jeu de données ; une ouverture, un nouvel import ou l'ouverture d'un projet enregistré revient en mode minimaliste. Les deux vues utilisent le même classement, les mêmes décisions, les mêmes cibles et les mêmes calculs ; un changement de vue n'altère aucune identification.

Lorsque plus aucun contact n'attend une décision ou une attribution, **Voir le tableau final** affiche le rapport d'activité exportable dans le mode minimaliste. Les contacts ignorés ne bloquent pas cette étape. Si une sélection personnalisée ne permet plus d'atteindre la cible de vérification, les résultats restent en attente : la vue complète permet d'ajouter des contrôles ou d'adapter explicitement l'objectif selon la procédure décrite ci-dessous.

Dans **Réglages**, le logiciel d'ouverture des WAV se choisit une fois pour les contacts suivants : **Kaleidoscope** est le premier choix et celui par défaut ; **ChiroSurf** est également proposé. Le choix et les chemins distincts des deux exécutables sont mémorisés par navigateur et origine de la page, hors du projet JSON ; un ancien chemin Kaleidoscope enregistré est repris. Les noms ChiroSurf avec version numérique, tels que `ChiroSurf_4.6.exe` et `ChiroSurf4.6.exe`, sont acceptés en plus de `ChiroSurf.exe`. Un logiciel choisi sans chemin valide produit un message, sans basculer automatiquement vers l'autre.

Le clic sur le nom du WAV nécessite le lanceur Windows **`Demarrer-Plecotus.cmd`**, utilisable sans droits administrateur, et un visualiseur déjà disponible. Le fichier HTML seul ne peut pas lancer d'exécutable. Le lanceur transmet un unique chemin WAV entre guillemets au logiciel choisi ; il n'envoie ni canal ni décalage de segment. L'ouverture réelle dans Kaleidoscope ou ChiroSurf reste à vérifier sur les installations utilisées ; les contrôles du lanceur ne constituent pas un essai de ces applications installées. Ce choix de visualiseur ne modifie pas le classement, les règles ni les décisions.

## Ce que fournit Kaleidoscope

Kaleidoscope Lite fournit le visualiseur, les mesures et les identifications manuelles ; produire de nouvelles identifications automatiques nécessite Pro ([fonctionnalités officielles](https://www.wildlifeacoustics.com/products/kaleidoscope-pro)). Le prototype utilise les AUTO-ID déjà présents. Pour la Belgique, conservez le classificateur européen, la région et les espèces choisies, sa version et les paramètres du traitement, notamment settings.ini. La [liste officielle des codes européens](https://answers.wildlifeacoustics.com/r/en-US/Bat-Auto-ID-Performance-and-Supported-Species/Bat-Auto-ID-Supported-Species-and-Abbreviated-Codes) indique les espèces prises en charge, sans prouver leur présence sur un site.

Une ligne d'id.csv peut représenter un fichier entier ou un segment. Le nom de fichier, le canal et le décalage permettent de retrouver le contact ; chaque ligne est conservée, même si des repères se répètent. Les mesures par passage à zéro résument les cris détectés sans restituer tous les détails d'un spectrogramme en spectre complet ([guide utilisateur 2025](https://www.wildlifeacoustics.com/uploads/user-guides/Kaleidoscope03192025.pdf)).

## Classement et périmètre de l'espèce

Un groupe rassemble **toutes les lignes du CSV portant le même AUTO-ID normalisé**, sans séparation par dossier, site ou nuit. Ces métadonnées restent visibles et conservées. Importez des CSV distincts pour traiter séparément des périmètres d'étude ; la règle actuelle ne compense pas des performances différentes entre sites ou nuits.

Les contacts d'un groupe sont classés selon :

1. MATCHING décroissant.
2. MATCH RATIO décroissant.
3. MARGIN décroissant.
4. Numéro de ligne source croissant.

La première clé différente détermine l'ordre ; aucun score pondéré n'est calculé. Le tri historique de Kaleidoscope utilisait l'espèce, MATCHING puis MATCH RATIO ([guide 4.3.1, p. 50](https://www.wildlifeacoustics.com/uploads/user-guides/Kaleidoscope.pdf)). MARGIN et le départage par ligne sont des ajouts du prototype ; la marge est comparée seulement au sein du même AUTO-ID.

Le premier devient la **référence obligatoire** de cette espèce. Ce rang favorise le nombre de cris correspondants, sans garantir une identification correcte : 20 cris favorables sur 40 précèdent 2 sur 2. Le ratio, la forme des cris et les alternatives restent utiles pendant l'examen.

Les valeurs manquantes ou invalides suivent les valeurs exploitables. Un ratio absent peut être calculé si PULSES est positif et MATCHING exploitable sans dépasser PULSES ; sa provenance calculée est affichée, et la cellule source reste intacte. Les incohérences sont signalées. Une fréquence, une durée ou un nombre de cris n'établit pas une probabilité universelle d'identification.

La remarque **« X contact(s) sur Y présentent des anomalies de données »** porte uniquement sur les lignes dont l'`AUTO-ID` source n'est pas `Noise` : X est le nombre de ces contacts ayant au moins une anomalie, Y leur nombre total. Une ligne qui cumule plusieurs anomalies ne compte qu'une fois dans X. Cette exclusion concerne les deux nombres de la remarque, indépendamment du réglage de vérification des Noise ou d'une correction manuelle. Les anomalies source de toutes les lignes, y compris les Noise, restent consultables dans les fiches et conservées dans le journal de vérification.

## Dictionnaire des champs

Les en-têtes varient selon la version de Kaleidoscope et le MetaForm de l'utilisateur. L'outil reconnaît les variantes courantes, conserve les colonnes originales et affiche les champs supplémentaires sans les interpréter. Les tableaux suivants décrivent les champs courants d'`id.csv`, sans prétendre couvrir tous les champs personnalisables du schéma.

**Emplacement et temps** — définitions officielles du [guide utilisateur de 2025](https://www.wildlifeacoustics.com/uploads/user-guides/Kaleidoscope03192025.pdf). Ces champs servent à retrouver et regrouper les contacts ; aucun n'est un score de confiance.

| Champ | Signification |
|---|---|
| `INDIR`, `OUTDIR` | Chemins racines d'entrée et de sortie |
| `FOLDER` | Sous-dossier d'entrée relatif à la racine |
| `IN FILE` | Nom du fichier d'entrée |
| `CHANNEL` | Canal d'entrée ; 0 à gauche, 1 à droite |
| `OFFSET` | Début du segment, en secondes depuis le début du fichier |
| `DURATION` | Durée du fichier ou du segment, en secondes |
| `OUT FILE FS`, `OUT FILE ZC` | Nom du fichier de sortie en spectre complet ou par passage à zéro |
| `DATE`, `TIME`, `HOUR` | Date, heure et heure entière de l'enregistrement |
| `DATE-12`, `TIME-12`, `HOUR-12` | Horodatage de l'enregistrement décalé de 12 heures en arrière |

**Identification et mesures des cris** — définitions du [guide officiel historique, p. 19–22](https://www.wildlifeacoustics.com/uploads/user-guides/Kaleidoscope.pdf) et de la [spécification des métadonnées Wildlife Acoustics](https://www.wildlifeacoustics.com/SCHEMA/GUANO.html). Le sens du classement décrit notre implémentation, sauf lorsqu'une interprétation officielle est indiquée.

| Champ | Signification | Utilisation pour le contrôle |
|---|---|---|
| `AUTO-ID` / `AUTO ID` | Espèce suggérée pour le fichier | Groupe d'espèce et étiquette source de validation |
| `PULSES` | Nombre de cris utilisé dans le résumé du classificateur | Contexte ; dénominateur du ratio |
| `MATCHING` | Cris favorables à l'`AUTO-ID` | Décroissant |
| `MATCH RATIO` | `MATCHING` divisé par `PULSES` | Décroissant |
| `MARGIN` | Indicateur de confiance non calibré | Décroissant au sein d'une même espèce uniquement |
| `ALTERNATE 1`, `ALTERNATE 2`, ancien `ALTERNATES` | Autres candidats ; plusieurs chauves-souris possibles | Examiner l'ambiguïté |
| `N` | Cris détectés utilisés pour les moyennes | Contexte |
| `Fc` | Fréquence caractéristique, en kHz | Forme du cri |
| `Sc` | Pente du corps du cri, en octaves/seconde | Forme du cri |
| `Dur` | Durée moyenne d'un cri, en ms | Forme du cri |
| `Fmax`, `Fmin` | Moyennes des fréquences maximale et minimale des cris, en kHz | Forme du cri |
| `Fmean` | Moyenne de la fréquence des cris pondérée par le temps, en kHz | Forme du cri |
| `TBC` | Intervalle moyen entre les débuts des cris, en ms | Séquence de cris |
| `Fk`, `Tk` | Fréquence du coude, en kHz, et temps correspondant, en ms | Forme du cri |
| `S1` | Pente initiale, en octaves/seconde | Forme du cri |
| `Tc` | Temps jusqu'au point caractéristique | Forme du cri ; vérifier l'unité |
| `Qual` | Mesure de régularité du cri | Une valeur faible signifie un cri plus régulier ; inutilisé pour le classement |
| `FILES` | Constante 1 destinée au comptage | Comptage uniquement |
| `MANUAL ID` | Identification attribuée par une personne | Validation humaine ; prioritaire dans le résultat final |

La fréquence, la durée, la pente et les temps n'ont **aucun sens universel « meilleur »**. Ils varient selon l'espèce et le comportement vocal. `Qual` n'est pas une probabilité, en pourcentage, d'identification correcte. `DURATION` et `Dur` décrivent des objets différents.

Les guides décrivent `PULSES` tantôt comme tous les cris détectés exploitables, tantôt comme les cris classés par espèce ; `N` désigne explicitement le nombre total de détections. Ne supposez pas leur égalité. Les anciens documents CSV/métadonnées indiquent `Tc` en millisecondes, alors que des libellés de schémas de base de données plus récents peuvent utiliser les secondes. Conservez l'en-tête et la valeur ; vérifiez les unités avant comparaison. Ces différences expliquent pourquoi la première version ne construit pas de scores supplémentaires à partir des moyennes acoustiques.

**Autres métadonnées courantes** — [définitions officielles des métadonnées](https://www.wildlifeacoustics.com/SCHEMA/GUANO.html). Elles documentent la provenance ou le contexte de l'enregistrement ; aucune n'influence le classement.

| Champs / variantes | Signification |
|---|---|
| `LAT`, `LON`, `LATITUDE`, `LONGITUDE` | Coordonnées de l'enregistrement |
| `MODEL`, `SERIAL`, `FIRMWARE`, `PREFIX` | Modèle, numéro de série, micrologiciel et préfixe de fichier de l'enregistreur |
| `NOTES` / `NOTE` | Notes libres sur l'enregistrement |
| `ORGID`, `USERID` | Organisation et utilisateur source |
| `REVIEW ORGID`, `REVIEW USERID` | Organisation et utilisateur chargés du contrôle |
| `INPATHMD5` | Empreinte interne de recherche du chemin d'entrée |
| Champs du classificateur, de version et de paramètres | Provenance de l'analyse en amont |

## Les deux branches d'attribution

Une valeur non vide de MANUAL ID importée est considérée comme une décision humaine terminée. Une décision valide enregistrée dans Plecotus prend la priorité pour sa ligne. Les brouillons ne remplacent pas une décision enregistrée et une saisie non enregistrée ne valide pas un contrôle. L'identification source reste conservée pour rendre les remplacements traçables.

Cette reprise ne valide pas le sens d'un texte libre. Les `MANUAL ID` `NoID`, `NoID Pip`, `NoID Ser`, `NoID Myo` et `NoID Ple` sont des décisions terminées de chauve-souris non identifiée au niveau indiqué ; elles sont conservées dans le rapport avec leurs effectifs et ne créent pas de contrôle obligatoire supplémentaire. Une note de doute ou de retour sur le contact dans `MANUAL ID` est également reprise comme une décision terminée : elle n'est pas interprétée automatiquement comme une consigne de revérification. Une étiquette non reconnue est conservée comme libellé libre avec **Nom non renseigné** et peut participer au prorata. L'indication visible avant le démarrage distingue ces valeurs des espèces reconnues ; elle informe la personne sans transformer une note en identification acoustique. La vue complète permet de revérifier volontairement ces contacts et d'enregistrer une nouvelle décision.

### Confirmation explicite de tout un groupe

Dans la fiche d'une espèce du mode minimaliste, **Confirmer tous les contacts pour cette espèce** applique l'`AUTO-ID` source du groupe affiché à **toutes ses lignes du CSV**, quels que soient leurs dossiers, nuits ou ratios. Le nombre de lignes concernées est affiché près du bouton ; une correction non enregistrée dans la fiche ne modifie pas l'étiquette confirmée par cette action. Une décision humaine est enregistrée pour chaque contact avec le nom de vérificateur proposé, l'horodatage et la note « Confirmation globale des contacts de cette espèce (AUTO-ID : …). », ajoutée aux notes antérieures. Cette note ne prétend pas que chaque son a été examiné individuellement. Ces décisions remplacent les identifications manuelles importées, les décisions enregistrées et les brouillons du groupe. Les autres groupes restent inchangés.

Cette confirmation est une action explicite de la personne : elle ne dépend ni du seuil de majorité, ni de la cible d'échantillon, ni de la liste d'exclusion des deux branches calculées ci-dessous. Le groupe n'a ensuite plus de contrôle requis et le parcours passe au prochain contact à vérifier. **Annuler** restaure en une seule action les décisions et brouillons précédents. Les confirmations du groupe participent normalement au tableau final, au journal et aux exports `MANUAL ID` ; elles sont conservées dans les sauvegardes de projet version 3.

### Validation collective des résultats Kaleidoscope

La branche directe exige simultanément :

1. La référence est identifiée manuellement et son étiquette confirme son AUTO-ID, sans décision d'incertitude.
2. **Strictement plus de 50 %** de toutes les lignes de cet AUTO-ID ont un MATCH RATIO **strictement supérieur à 0,6**. Une valeur de 0,6 ne passe pas ; exactement la moitié ne suffit pas. Les ratios absents ou invalides restent dans le dénominateur mais ne passent pas le seuil.
3. L'espèce n'appartient pas à la liste d'exclusion du projet.

Si ces conditions sont remplies, SEMIMANUAL ID reçoit l'AUTO-ID original sur **toutes** les lignes du groupe, y compris celles dont le ratio est faible et celles déjà vérifiées. Son texte source exact est conservé. Cette colonne matérialise la validation collective demandée. Une décision manuelle particulière demeure prioritaire pour le résultat final et le bilan, même lorsqu'elle diffère de cette colonne. Les champs de provenance expliquent cette priorité.

La liste, fixe dans cette version, est exactement celle fournie pour ce projet : BARBAR, RHIFER, RHIHIP, MYOBEC, MYODAS, MYOMYO, MYOEMA, NYCNOC, NYCLEI. Les noms scientifiques complets de ces neuf espèces sont reconnus comme équivalents aux codes. Les réglages de pourcentage, de cible et de sélection n'altèrent pas cette liste.

Les sept premiers correspondent aux chauves-souris Natura 2000 reprises dans l'[annexe officielle des objectifs de conservation wallons, p. 4–6](https://wallex.wallonie.be/files/medias/3/13576.pdf). La note DEMNA/DNF de 2012 classe les deux noctules en sensibilité forte. **La liste du projet n'est pas l'ensemble exhaustif des espèces de sensibilité moyenne ou forte de cette note** : son tableau I classe aussi les pipistrelles commune, pygmée et de Nathusius en sensibilité forte, et la sérotine commune en sensibilité moyenne. La liste demandée est conservée sans ajout automatique ([note rédigée par le SPW, copie hébergée, tableau I p. 10–11](https://www.ventderaison.org/images/textes_legaux/DGO3-note_prise_en_compte_biodiversite_-_parcs_eoliens_-_2012.pdf)). Il s'agit d'un paramètre explicite de classification, pas d'une qualification réglementaire exhaustive.

### Contrôle par échantillon puis attribution au prorata

Lorsque la branche directe ne s'applique pas, la cible initiale est **ceil(20 % × nombre total de contacts du groupe)**, avec au moins un contact et au plus le total du groupe. Le pourcentage est réglable et la référence compte dans cette cible. Les classes sont **[0 ; 0,2], ]0,2 ; 0,4], ]0,4 ; 0,6], ]0,6 ; 0,8], ]0,8 ; 1]**, plus une classe pour les valeurs absentes ou invalides. Les quotas sont proportionnels aux effectifs des classes, avec parties entières puis plus forts restes. La classe de la référence reçoit au moins une place, prise si nécessaire sur la classe la plus surreprésentée. Une classe rare peut recevoir zéro contrôle après arrondi. À l'intérieur d'une classe, une empreinte déterministe des repères du contact et de la ligne source départage la sélection.

Dans **Parcours par espèce**, **Objectif manuel (% des contacts)** permet de saisir pour un groupe un pourcentage de 0 à 100, avec des décimales, plus bas ou plus haut que le pourcentage général. **Appliquer l’objectif** ou **Entrée** valide cette saisie ; une simple modification du champ ne change ni la cible active ni les résultats. Le calcul est `min(total du groupe, max(1, ceil(pourcentage / 100 × total du groupe)))` : la référence est comprise dans la cible et demeure requise à 0 %. Par exemple, 20 % de 12 contacts donne 3 contrôles, soit une part effective de 25 %. L'aperçu **soit X contacts · référence comprise** indique le nombre de contrôles résultant de cet arrondi.

Vous pouvez examiner toute ligne, ajouter ou retirer des lignes de la sélection et remplacer les contacts proposés. La référence reste requise. Retirer un contact de la sélection ne réduit pas automatiquement la cible et ne déclenche pas de remplacement automatique ; atteignez l'objectif avec d'autres vérifications ou modifiez-le explicitement. Appliquer un nouvel objectif conserve les sélections personnalisées. **Adapter l’objectif à ma sélection** fixe la cible au nombre exact de contacts que vous avez retenus, affiché en pourcentage ; **Reprendre la sélection proposée** restaure la recommandation et l'objectif par défaut. Le projet enregistre ces choix. Les cibles des anciens projets enregistrées en nombre de contacts restent exactement conservées : l'affichage en pourcentage et une validation sans modifier la valeur affichée ne les convertissent pas à nouveau et n'ajoutent pas un contrôle par arrondi, y compris pour les fractions comme un contact sur trois. Les effectifs sélectionnés par classe permettent de voir l'effet des modifications sur la représentation des ratios. Le tableau **Classes de rapport et échantillon** est contenu dans chaque carte et conserve les quatre colonnes **Rapport**, **Contacts**, **Sélection**, **Manuels** ; lorsque leur largeur dépasse celle de la carte, le défilement est horizontal à l'intérieur du tableau.

L'attribution est déclenchée lorsque la référence est renseignée, que la cible est atteinte et que les contacts sélectionnés ont une décision enregistrée ou une identification humaine importée. Elle utilise **toutes les décisions manuelles du groupe**, y compris les vérifications supplémentaires ou faites hors de la sélection. Les autres lignes sont réparties suivant leurs proportions d'étiquettes humaines. Une correction différente de l'AUTO-ID enrichit ces proportions ; elle ne bloque plus automatiquement le groupe comme dans l'ancienne procédure.

Les deux conditions **quota numérique atteint** et **sélection remplie** sont distinctes. Des identifications importées hors de la sélection augmentent le nombre de contrôles terminés et réduisent le déficit numérique, mais ne dispensent pas de renseigner les contacts retenus pour représenter les classes de MATCH RATIO. Il peut donc rester des contrôles sélectionnés même si le nombre de `MANUAL ID` dépasse déjà la cible. La référence demeure requise ; si elle est vide, les autres valeurs manuelles du groupe ne la remplacent pas. Le plan de vérification tient compte de ces contacts encore obligatoires et d'un éventuel déficit pour atteindre la cible. Modifier explicitement la sélection ou son objectif reste possible.

Pour une étiquette L, la proportion est nombre de contacts manuels L / nombre total de contacts manuels du groupe. Sur R lignes restantes, l'effectif théorique est R × proportion. La méthode des **plus forts restes** attribue d'abord la partie entière de chaque effectif, puis distribue les places encore disponibles aux plus grandes parties décimales. Les égalités et l'association des étiquettes aux lignes sont départagées de manière reproductible. La somme vaut toujours R.

Exemple : 20 contacts vérifiés sur 100, dont 2 A, 16 B et 2 C. Les 80 autres reçoivent 8 A, 64 B et 8 C ; le bilan compte finalement 10 A, 80 B et 10 C. Si seules 7 lignes restent, les effectifs théoriques 0,7 / 5,6 / 0,7 deviennent 1 / 5 / 1. Les choix de lignes ne représentent pas une détection acoustique de ces espèces.

Cette répartition fournit une **estimation des effectifs**, enregistrée ligne par ligne pour assurer un bilan complet et traçable. L'étiquette calculée d'une ligne peut ne pas correspondre à l'espèce réellement enregistrée dans ce fichier. Les étiquettes de genre/groupe, bruit et incertitude participent aux proportions. Les cinq catégories explicites `NoID` conservent leur étiquette et sont incluses dans le rapport, y compris après propagation au prorata ; une incertitude générique sans cette catégorie reste non résolue et exclue du rapport. La procédure ne répartit pas plusieurs espèces au sein d'un même contact.

## Contrôle manuel et interprétation

Les groupes source NoID, Noise et sans AUTO-ID ne suivent pas ces deux branches. Les `AUTO-ID` `NoID` et les lignes sans AUTO-ID sans décision existante restent à contrôler individuellement. Un `AUTO-ID` `NoID` indique un échec de classification, pas une absence de chauve-souris. Il ne suffit pas à attribuer la catégorie finale `NoID` : celle-ci requiert une décision humaine ou une attribution au prorata dans un groupe auquel cette règle s'applique.

Le réglage **Ignorer les contacts Noise**, coché par défaut, dispense de vérification les lignes dont l'AUTO-ID source est Noise et qui n'ont ni identification humaine ni brouillon de contrôle volontaire. Ces lignes restent présentes dans le CSV et le total de contacts, avec une provenance et un effectif de contacts ignorés distincts. Elles ne reçoivent aucune identification humaine ni attribution calculée, ne contribuent pas aux proportions d'espèces et sont exclues des contrôles requis, du graphique, des barres d'avancement et du rapport d'activité. Dans les règles de la **Vue complète**, décocher ce réglage rétablit leur contrôle individuel. Ce choix opérationnel du projet n'assimile pas Noise à une absence démontrée de chauve-souris : ce groupe peut inclure des cris rejetés par les paramètres de détection ([guide 2024, p. 39](https://www.wildlifeacoustics.com/uploads/user-guides/Kaleidoscope11112024.pdf)).

Une décision humaine déjà enregistrée ou une valeur de MANUAL ID importée sur un contact Noise reste prioritaire, quel que soit ce réglage. Une correction vers une espèce contribue normalement à son effectif dans le rapport. Un brouillon de contrôle volontaire reste en attente jusqu'à son enregistrement ; ignorer les Noise ne termine pas cette vérification à la place de la personne.

Retrouvez le contact dans Kaleidoscope ou ChiroSurf et examinez le spectrogramme, l'écoute et les mesures. Confirmez l'espèce, saisissez une correction, un genre/groupe ou une incertitude. Conservez les remarques sur les séquences mixtes. Les données et rangs du CSV aident à organiser cette vérification ; ils ne la remplacent pas.

La fiche de contrôle offre une sélection rapide de cinq catégories de chauves-souris non identifiées : `NoID` (**Chauve-souris non identifiée**), `NoID Pip` (**Pipistrelle non identifiée**), `NoID Ser` (**Sérotule non identifiée**), `NoID Myo` (**Murin non identifié**) et `NoID Ple` (**Oreillard non identifié**). Une fois la décision enregistrée, le contact compte dans sa catégorie même si le statut choisi est incertain. Un statut générique **Incertain** sans l'une de ces étiquettes reste traité comme une incertitude non résolue. Sélectionner une étiquette sans enregistrer la fiche ne termine pas le contrôle.

Le fabricant recommande la vérification manuelle des suggestions ([conseils Auto-ID](https://www.wildlifeacoustics.com/products/kaleidoscope/automatic-bat-identification)). Ses résultats de performance excluent les enregistrements faibles, ambigus ou avec plusieurs chauves-souris simultanées ([limites publiées](https://answers.wildlifeacoustics.com/r/en-US/Bat-Auto-ID-Performance-and-Supported-Species/About-the-Kaleidoscope-Classifier-Performance-Table)). Les seuils 0,6, 50 % et 20 % constituent la procédure du projet ; ils ne sont pas des taux de précision démontrés ni une méthode de validation prescrite par Wildlife Acoustics.

La représentativité des classes de ratio ne garantit pas celle des sites, nuits ou situations acoustiques. Un échantillon petit ou choisi manuellement peut biaiser les proportions. Comparer les résultats à des contacts identifiés indépendamment permet de mesurer les erreurs par espèce. La compatibilité doit être vérifiée avec la version et les paramètres de Kaleidoscope utilisés pour chaque étude ; la bonne lecture d'un CSV ne constitue pas une validation acoustique des identifications.

## Bilan, export et reprise

Le résultat final suit la priorité **décision manuelle > attribution calculée > en attente** pour les contacts à traiter ; les Noise dispensés de contrôle ont une provenance distincte de contacts ignorés. Chaque ligne contribue une fois au bilan détaillé, y compris les lignes ignorées. Les nombres manuels, calculés et ignorés restent séparés ; bruit, incertitudes et absence d'identification restent visibles. Une file de contrôle terminée n'implique pas que toutes les espèces soient résolues. Les contacts sont des lignes du CSV, pas des individus.

Le **rapport d'activité** présente trois colonnes : **Nom scientifique**, **Nom vernaculaire**, **Nombre de contacts**. Le catalogue associe les 31 codes européens de [Wildlife Acoustics](https://answers.wildlifeacoustics.com/r/en-US/Bat-Auto-ID-Performance-and-Supported-Species/Bat-Auto-ID-Supported-Species-and-Abbreviated-Codes) aux noms scientifiques et français ; les formes reconnues d'une même espèce sont fusionnées pour additionner leurs contacts. Les noms français s'appuient notamment sur [Plecotus/Natagora](https://plecotus.natagora.be/decouvrez-les-chauves-souris/especes) et le [Plan national d'actions en faveur des Chiroptères](https://plan-actions-chiropteres.fr/les-chauves-souris/les-especes/). Les mesures et les champs source ne changent pas. La sérotine commune conserve le nom **Eptesicus serotinus** dans le rapport ; **Cnephaeus serotinus**, utilisé dans la liste de Natagora, est traité comme un alias.

Les différences d'accents, d'apostrophes ou de casse, ainsi qu'une autorité taxonomique explicite avec année après un nom reconnu, peuvent être rapprochées. Les groupes reconnus restent des groupes, par exemple **Myotis sp. / Murin indéterminé**. Une étiquette inconnue est conservée avec **Nom non renseigné** dans la colonne vernaculaire ; elle n'est pas transformée en espèce supposée. Les complexes avec plusieurs noms et les mentions `cf.` ou `?` ne sont pas réduits à leur première espèce. Cette présentation des noms n'altère ni les identifications source ni les règles de classification.

Les cinq catégories explicites `NoID` figurent dans le tableau d'activité avec leurs effectifs. La colonne **Nom scientifique** contient respectivement `NoID`, `NoID Pip`, `NoID Ser`, `NoID Myo` ou `NoID Ple`, et **Nom vernaculaire** reprend le libellé français ci-dessus : aucun nom latin n'est supposé. Ces contacts peuvent provenir de décisions humaines importées ou enregistrées, ou d'une répartition au prorata ; une étiquette explicite est conservée même avec un statut incertain. Ils contribuent aux mêmes catégories dans le CSV d'activité, le camembert, les barres et les images exportées.

Le tableau d'activité exclut les contacts ignorés, le bruit, les résultats en attente et les incertitudes génériques sans l'une de ces cinq catégories. Leurs effectifs restent visibles à côté du tableau et dans le bilan détaillé, afin d'expliquer la différence entre la somme du rapport et le total du CSV source. Le nombre de contacts d'une ligne comprend les décisions humaines et les attributions calculées, avec priorité aux décisions humaines. Le rapport simple ne contient pas la provenance : les exports détaillés conservent cette information, notamment pour distinguer les répartitions statistiques des identifications acoustiques individuelles et les contacts ignorés par choix de procédure.

Sur la page du tableau final, un indicateur affiche le **nombre exact de contacts Noise ignorés**, y compris zéro. Il compte uniquement les lignes dispensées de contrôle par le réglage d'exclusion, pas toutes les lignes dont l'AUTO-ID source était Noise. Une identification humaine vers une espèce reste incluse dans le tableau et le graphique sous cette espèce.

Le graphique de répartition utilise par défaut les mêmes lignes regroupées et les mêmes effectifs que le tableau d'activité, y compris les cinq catégories explicites `NoID`. Le **Camembert** est affiché par défaut ; **Barres** permet de changer de représentation pendant la session. Pour chaque ligne affichée, la part vaut son nombre de contacts divisé par la somme des nombres de contacts affichés dans le graphique. Les contacts Noise, ignorés, en attente et les incertitudes génériques sans catégorie explicite sont exclus de ce dénominateur. Les groupes et étiquettes libres sont conservés comme dans le tableau : le graphique ne leur attribue pas une espèce supposée.

La case **Inclure la Pipistrelle commune** est cochée par défaut. La décocher masque uniquement les contacts dont l'espèce finale est reconnue comme **Pipistrellus pipistrellus**, y compris ses formes reconnues `PIPPIP` et françaises. Les espèces `PIPNAT` et `PIPPYG`, la catégorie `NoID Pip`, les groupes et les libellés ambigus ne sont pas concernés. Le filtre s'applique aux deux représentations ainsi qu'aux images exportées ; la note du graphique donne le nombre de contacts retirés. Les pourcentages, le total représenté et les longueurs de barres sont recalculés à partir des seuls contacts affichés. Le choix reste actif pendant la session et après un nouvel import, mais n'est pas sauvegardé dans le projet JSON. Il n'altère aucune identification, aucun compteur, ni le tableau final ou son CSV d'activité : la Pipistrelle commune reste incluse dans ces résultats.

Le graphique courant est exportable en **PNG**, **JPEG** ou **SVG**. Chaque fichier conserve la représentation et le filtre choisis, un fond blanc, la légende et les effectifs, le total des contacts représentés et le nombre de Noise ignorés. Lorsque la Pipistrelle commune est décochée, l'image porte une mention de ce retrait et son effectif ; le nom de fichier reçoit le suffixe `_sans_pipistrelle_commune`. Si aucun contact ne reste à afficher, les trois exports d'image sont désactivés. Le SVG inclut sa mise en forme et ne dépend pas des fichiers CSS ni JavaScript de Plecotus. Il conserve les textes comme textes, sans les transformer en espèces reconnues. PNG et JPEG fournissent des images matricielles du même contenu. L'export du graphique reste possible lorsque le tableau est consulté pendant les vérifications : la mention **Provisoire** apparaît si des contacts sont encore en attente. Les contacts déjà attribués y suivent les mêmes règles de priorité et d'exclusion que dans le tableau à cet instant. Exporter une image ne termine aucun contrôle, ne modifie pas les règles et ne lève pas la condition d'accès au CSV d'activité final.

L'export **activites_chiropteres.csv** contient uniquement ces trois colonnes, avec un séparateur point-virgule et un encodage UTF-8 avec BOM, et inclut les effectifs des cinq catégories explicites `NoID`. Il est disponible lorsque plus aucun contact n'attend de résultat. Un contact Noise ignoré est conservé séparément et ne bloque pas cet export. Une incertitude générique sans catégorie explicite, enregistrée ou propagée, reste non résolue et exclue du tableau ; elle n'est pas assimilée à un contact en attente et ne bloque donc pas cet export.

AUTO-ID reste la suggestion source ; MANUAL ID reste l'identification humaine ; SEMIMANUAL ID contient le calcul de cette procédure. **Résultats avec SEMIMANUAL ID · CSV** produit un fichier dont le nom se termine par **-semi-manuel.csv**, en conservant les colonnes source et en exportant le travail humain dans MANUAL ID et les calculs dans SEMIMANUAL ID. Le CSV détaillé des contacts classés ajoute la provenance, le type de branche, les raisons et les règles appliquées. Le CSV des identifications manuelles destiné à Kaleidoscope contient uniquement le travail humain. Conservez le journal, les réglages, la sélection et le projet JSON avec les exports.

Toute nouvelle décision, modification de règle ou modification d'échantillon recalcule la procédure et les totaux. Une modification de règle ou d'échantillon conserve les décisions humaines ; une confirmation explicite de tout un groupe remplace celles de ce groupe et peut être annulée. Les projets version 3 conservent les choix d'échantillon et les cibles par espèce ; l'ouverture d'anciens projets v1/v2 récupère les identifications manuelles et applique cette nouvelle procédure.

Le **nom du vérificateur** est une préférence mémorisée dans le navigateur et proposée pour les prochaines décisions, même après l'import d'un autre CSV. Il peut être renseigné une fois depuis le réglage global ou le champ d'une fiche de contact. Changer ce nom ne réécrit pas les auteurs des décisions existantes. Le projet conserve également le nom proposé ; il sert de repli à l'ouverture lorsqu'aucune préférence locale n'est disponible. Les auteurs et horodatages de chaque décision restent consultables dans le journal.

## Sources primaires

Références consultées le 10 octobre 2026 :

- [Fonctionnalités de Kaleidoscope](https://www.wildlifeacoustics.com/products/kaleidoscope-pro).
- [Guide utilisateur du 19 mars 2025](https://www.wildlifeacoustics.com/uploads/user-guides/Kaleidoscope03192025.pdf).
- [Guide utilisateur du 11 novembre 2024](https://www.wildlifeacoustics.com/uploads/user-guides/Kaleidoscope11112024.pdf).
- [Kaleidoscope 4.3.1, 2017](https://www.wildlifeacoustics.com/uploads/user-guides/Kaleidoscope.pdf).
- [Métadonnées GUANO](https://www.wildlifeacoustics.com/SCHEMA/GUANO.html).
- [Espèces et codes Auto-ID](https://answers.wildlifeacoustics.com/r/en-US/Bat-Auto-ID-Performance-and-Supported-Species/Bat-Auto-ID-Supported-Species-and-Abbreviated-Codes).
- [Plecotus/Natagora — Les différentes espèces de chauves-souris](https://plecotus.natagora.be/decouvrez-les-chauves-souris/especes), pour les noms belges et les alias Cnephaeus.
- [SPW — Tableau des espèces de chauves-souris](https://biodiversite-old.wallonie.be/servlet/Repository/intro-especes.pdf?ID=31438&saveFile=true), pour les anciens noms français également reconnus.
- [SPW/Natagora — Liste rouge des chauves-souris de Wallonie, 2021](https://biodiversite.wallonie.be/files/02.DOCUMENTS/01.eval_biologique/01.monitoring_especes/Mammif%C3%A8res/Chauves-souris/listerouge_chauvessouris_2021.pdf).
- [Plan national d'actions en faveur des Chiroptères — Espèces de France métropolitaine](https://plan-actions-chiropteres.fr/les-chauves-souris/les-especes/) et [INPN — Référentiel de sensibilité à la diffusion](https://inpn.mnhn.fr/docs-web/docs/download/435603), pour les noms français complémentaires.
- [SECEM — Eptesicus isabellinus](https://secem.es/index.php/pt/mamiferos/atlas/eptesicus-isabellinus), pour la sérotine isabelle.
- [Conseils Auto-ID](https://www.wildlifeacoustics.com/products/kaleidoscope/automatic-bat-identification) et [limites des performances](https://answers.wildlifeacoustics.com/r/en-US/Bat-Auto-ID-Performance-and-Supported-Species/About-the-Kaleidoscope-Classifier-Performance-Table).
- [Objectifs de conservation Natura 2000, annexe officielle wallonne](https://wallex.wallonie.be/files/medias/3/13576.pdf).
- [DEMNA/DNF, Note de référence pour la prise en compte de la biodiversité, 2012](https://www.ventderaison.org/images/textes_legaux/DGO3-note_prise_en_compte_biodiversite_-_parcs_eoliens_-_2012.pdf) : document du SPW consulté dans une copie hébergée, l'ancienne adresse officielle n'étant plus accessible lors de la vérification.
