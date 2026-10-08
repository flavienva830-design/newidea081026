# Mon Agent IA — Espace Famille (membres, rôles, invitations, profils)

Ce document décrit le fonctionnement et les décisions de sécurité de l'espace Famille : plusieurs foyers par utilisateur, choix du foyer actif, membres et rôles, invitations par email, profils sans compte, rattachement d'un document à une personne. **Ce qui n'a pas été vérifié en conditions réelles est signalé « à vérifier ».**

## 1. Ce que l'utilisateur voit

| Écran | Rôle |
|---|---|
| `/app/family` | Membres (nom, email, rôle, date), changement de rôle, retrait, « Quitter le foyer » ; invitations en attente (renvoyer, révoquer) ; profils sans compte ; renommer le foyer. |
| `/invite/<jeton>` | Page d'acceptation d'une invitation (hors `/app`, rendue dynamiquement, CSP à nonce, `noindex`, `Referrer-Policy: no-referrer`). |
| Barre du haut | Sélecteur de foyer, visible seulement s'il y a au moins deux foyers (bouton + liste de boutons, Échap referme). |
| `/app/analyze` | Question facultative « Pour qui est ce document ? » (visible s'il y a au moins deux personnes). |
| `/app/documents` | Affiche « Pour <prénom> » quand un document est rattaché à une personne. |

Tout est contrôlé **côté serveur** ; l'interface ne fait que masquer les commandes interdites (un membre en lecture seule ne voit aucun bouton d'écriture).

## 2. Foyer actif

- Un utilisateur peut appartenir à plusieurs foyers (le sien, plus ceux qui l'ont invité).
- Le foyer actif est une **préférence** stockée dans le cookie `mai_hh` : `HttpOnly`, `SameSite=Lax`, `Secure` hors développement, `path=/`, 180 jours. Il ne contient qu'un identifiant de foyer et **n'est jamais une preuve** : à chaque requête, l'appartenance est relue en base.
- `resolveActiveTenant(db, userId, preferé)` (dans `server/tenant.ts`) : si l'utilisateur n'est pas (ou plus) membre du foyer demandé — retrait, départ, cookie forgé — il retombe sur son premier foyer. Le rôle vient toujours de la base. `resolveTenant` reste **strict** (renvoie `null`).
- Lecture du cookie : `requireTenant()` (Server Components et Actions, via `cookies()`) ; `householdIdFromCookieHeader()` pour les Route Handlers (`api/analyze`, `api/letters`, `api/billing/checkout`, `api/billing/portal`).
- **Tant que l'inscription n'est pas terminée, la préférence est ignorée** : l'assistant de bienvenue configure le foyer personnel et ses Server Actions ne vérifient pas de rôle ; un invité qui a déjà accepté une invitation ne doit pas pouvoir, par cet assistant, renommer ou modifier le foyer d'un autre. Une fois l'inscription finie, le foyer rejoint devient le foyer actif.
- Changement : Server Action `switchHousehold` (Zod `uuid`, appartenance vérifiée avant d'écrire le cookie).

## 3. Rôles et règles (appliquées dans `server/family-service.ts`)

| Action | Qui | Règles supplémentaires |
|---|---|---|
| Inviter | `member:invite` (OWNER, ADMIN) | rôle offert READ/WRITE/ADMIN, strictement inférieur au sien (OWNER : tous) |
| Changer un rôle | `member:set_role` (OWNER) | jamais soi-même ; rôle strictement inférieur (OWNER : tous) ; le dernier OWNER ne peut pas être rétrogradé |
| Retirer un membre | `member:remove` (OWNER, ADMIN) | jamais soi-même (voir « Quitter ») ; seulement un rôle strictement inférieur (un ADMIN ne retire ni un pair ni un OWNER) ; le dernier OWNER ne peut pas être retiré |
| Quitter | tout membre | impossible pour le dernier OWNER ; impossible si c'est son dernier foyer |
| Profils (ajout, archivage), renommer le foyer | OWNER, ADMIN | quotas de places |

Garanties techniques :

- **Le rôle de l'acteur est relu en base dans la transaction** : un rôle périmé en début de requête (rétrogradation concurrente) n'élève rien.
- **Verrou de foyer** (`SELECT … FOR NO KEY UPDATE` sur la ligne `households`) : les changements de membres d'un même foyer sont sérialisés. Deux propriétaires qui se rétrogradent ou partent simultanément ne peuvent pas laisser un foyer sans propriétaire ; deux invitations simultanées ne dépassent pas les places. `NO KEY UPDATE` plutôt que `UPDATE` pour ne pas bloquer les insertions ordinaires (les clés étrangères prennent un `KEY SHARE`).
- **Filtre explicite par `householdId`** dans toutes les requêtes : sous RLS, un membre voit aussi ses propres adhésions des **autres** foyers (politique `membership_by_user`) ; un `count({ role: "OWNER" })` sans filtre compterait un propriétaire d'un autre foyer. Un test couvre ce cas.
- Les identifiants reçus (membre, invitation, profil) sont toujours cherchés **dans le foyer actif** : un identifiant d'un autre foyer donne « introuvable » (IDOR).
- Les retraits sont définitifs pour l'adhésion, pas pour les données : le profil du membre est archivé et délié (même règle que la suppression de compte).
- Un membre retiré qui n'aurait plus aucun foyer reçoit un foyer personnel vide (Server Action `removeMember`), pour ne jamais laisser un compte sans foyer.

### Audit (`server/audit.ts`, ajout seul)

`member.role_changed`, `member.removed`, `member.left`, `member.joined`, `invitation.created|resent|revoked|accepted`, `profile.created|archived`, `household.renamed`, et `member.denied` (tentative contraire aux règles de hiérarchie : soi-même, rang insuffisant, dernier propriétaire — utile pour détecter une tentative d'élévation). Les métadonnées ne contiennent ni jeton ni adresse email.

## 4. Offre et places

- La famille est incluse si `PLANS[plan].features.family` (offre Famille). Sinon : message d'incitation vers l'abonnement.
- **Une « place » = un membre (compte) + un profil sans compte + une invitation en attente non expirée**, au plus `PLANS[plan].profiles` (Famille : 5). Une invitation en attente **réserve** sa place. La limite est la même que celle utilisée par la rétrogradation d'offre (`packages/billing`, qui archive les profils au-delà de la limite) ; l'onboarding compte déjà tous les profils.
- Le contrôle est refait **à l'acceptation** (l'offre a pu changer depuis l'envoi) ; en cas de refus l'invitation n'est pas consommée.
- Rétrogradation vers Solo/Gratuit : les membres existants restent (aucun retrait automatique), plus aucune invitation ni profil ne peut être ajouté.

## 5. Invitations

### Cycle de vie

1. Création (`inviteMember`) : Zod, droits, rôle, limites de débit, offre, places, unicité → ligne `invitations` + email.
2. Le lien `${APP_URL}/invite/<jeton>` arrive par email (`sendMail` + `actionEmail`). Même email, mêmes messages, que l'adresse ait déjà un compte ou non ; le texte mentionne le foyer, l'invitant et le rôle.
3. Acceptation (`acceptInvitation`) : voir §6.
4. Renvoyer = **nouveau jeton** (l'ancien lien meurt aussitôt) et nouvelle échéance. Révoquer = lien mort.

### Jeton

- `randomToken()` : 32 octets aléatoires (256 bits), base64url, 43 caractères. Il n'existe que dans l'email.
- **Seul son HMAC-SHA256 (`hmac(jeton, HASH_PEPPER)`) est stocké** dans `Invitation.tokenHash`. La base refuse tout `tokenHash` qui n'est pas une empreinte hexadécimale de 64 caractères (`CHECK`) : un jeton en clair (43 caractères) ne peut physiquement pas y être écrit. Le jeton n'apparaît ni dans l'audit, ni dans les notifications, ni dans les journaux.
- Validité 7 jours, **usage unique** (mise à jour conditionnelle `acceptedAt IS NULL AND revokedAt IS NULL AND expiresAt > maintenant` sous le verrou de foyer), révocable.
- **Une seule invitation en attente par (foyer, email)**, casse ignorée : index unique partiel `invitations_one_pending_per_email` (défense en profondeur) ; une invitation expirée mais non révoquée est révoquée avant d'en créer une autre.
- Rotation de `HASH_PEPPER` : les invitations en attente deviennent inutilisables (à renvoyer). Acceptable pour une durée de vie de 7 jours ; à savoir avant de faire tourner le secret.

### Pas de divulgation de l'existence d'un compte

- L'application ne cherche **jamais** un compte par email pour répondre : même email, même réponse (« Invitation envoyée »), même parcours (connexion ou inscription).
- Unique réponse dépendant d'une adresse : « fait déjà partie du foyer », donnée seulement si l'adresse figure dans la liste des membres que l'invitant voit déjà.
- Page d'invitation : jeton inconnu, mal formé, expiré, révoqué ou déjà utilisé → **un seul écran, un seul message**. Si le compte connecté n'a pas l'adresse invitée → « destinée à une autre adresse », sans jamais dire laquelle ni nommer le foyer.
- Limite de débit par destinataire (empreinte de l'adresse) : empêche d'inonder une adresse, quel que soit l'expéditeur.

### Pourquoi une fonction SQL `SECURITY DEFINER` plutôt que `dbService()`

Avant d'être membre, un invité ne peut rien lire : la RLS de `invitations` filtre par foyer actif (`app.household_id`), qu'il ne peut pas connaître sans l'invitation. Deux options :

| | `dbService()` (rôle `mai_service`) | Fonction `invitation_lookup(hash)` **(retenue)** |
|---|---|---|
| Portée | contourne **toute** la RLS | une ligne, une empreinte exacte |
| Surface | le processus web détient un accès inter-foyers pour cette seule recherche | aucun privilège élargi ; l'accès web reste `mai_app` |
| Contrôle | par discipline de code | par la base elle-même (`REVOKE` à `PUBLIC`, `EXECUTE` à `mai_app`/`mai_service`, `search_path` figé, objets qualifiés) |
| Requiert `DATABASE_SERVICE_URL` | oui | non |

La fonction (migration `20261009110000_family_invitations`) ne renvoie que : identifiant, foyer (id, nom), email invité, rôle, invitant, échéance, dates d'acceptation et de révocation — et uniquement si l'argument est une empreinte hexadécimale de 64 caractères égale à `tokenHash`. Elle ne permet ni de lister ni d'énumérer. Tout le reste de l'acceptation s'exécute ensuite **sous la RLS ordinaire du foyer** (`withTenant`, rôle `mai_app`).

*Risque résiduel* : la fonction s'exécute avec les droits du propriétaire des tables (qui n'est pas soumis à la RLS, pas de `FORCE`) ; sur un hébergeur où le rôle de migration n'est pas le propriétaire des tables, vérifier que `invitation_lookup` lit bien `invitations` (**à vérifier** sur l'hébergeur retenu).

## 6. Page `/invite/<jeton>`

| État | Comportement |
|---|---|
| Non connecté | redirection `/login?next=/invite/<jeton>` (`next` filtré par `safeNext`). La page de connexion explique l'invitation et propose « Créer mon espace » (`/signup?next=…`) ; après confirmation de l'email, retour direct sur l'invitation. |
| Connecté, email non vérifié | message, aucune action. |
| Email vérifié ≠ email invité (insensible à la casse) | « destinée à une autre adresse » + « Me connecter avec une autre adresse ». |
| Jeton invalide / expiré / révoqué / utilisé | message générique unique. |
| Déjà membre | rien ne change (ni promotion ni rétrogradation) ; l'invitation est consommée et le foyer devient actif. |
| Valide | « Rejoindre le foyer » → Server Action `acceptInvitation`. |

`acceptInvitation`, en **une transaction** sous le verrou de foyer : jeton valide, non révoqué, non utilisé, non expiré ; email vérifié identique ; offre et place disponibles ; puis consommation de l'invitation, création de l'`Membership` (rôle invité) et du profil du membre, notification à l'invitant, audit. Deux acceptations simultanées : une seule réussit. Ensuite le foyer actif bascule sur ce foyer (cookie).

## 7. Profils (personnes sans compte)

Enfants, parents… Ajout et archivage réservés à `member:invite` (OWNER, ADMIN), bornés par `checkProfileQuota` sur les **places** (voir §4). L'archivage est réversible côté données (rien n'est supprimé ; les documents rattachés gardent leur lien). Le profil d'un membre est créé à son adhésion et suit l'adhésion (archivé au départ) ; il ne s'archive pas à la main.

## 8. « Pour qui est ce document ? »

- `/api/analyze` accepte un champ multipart `profileId` (UUID) facultatif, transmis à `analyzeUpload` puis `persistAnalysis` (`Document.profileId`).
- **La RLS ne contrôle pas les clés étrangères** : un document du foyer A pourrait référencer le profil d'un foyer B. `analyzeUpload` vérifie donc explicitement que le profil est **actif et du foyer actif** avant tout (avant l'extraction et avant de consommer le quota) ; sinon `PROFILE` (422).
- Les membres en lecture seule ne voient plus la zone de dépôt (le serveur refusait déjà l'analyse).

## 9. Exploitation

- Migration `20261009110000_family_invitations` : ajout seul (fonction, deux contraintes, un index) ; rétrocompatible avec le code précédent. À appliquer avant le déploiement : `pnpm db:migrate`.
- Aucune nouvelle variable d'environnement. Limites de débit : `inviteByUser` 10/h, `inviteByHousehold` 30/jour, `inviteByRecipient` 3/jour, `inviteAcceptByUser` 20/10 min (`packages/core/src/rate-limit.ts`) — partagées par Redis en production.
- Surveillance suggérée : alerter sur un volume anormal de `member.denied` et d'`invitation.created`.

## 10. Limites connues et points à vérifier

- **Envoi réel des emails d'invitation (Resend)** : non exécuté ; seul le transport de test a servi. Le domaine d'envoi doit être vérifié (SPF/DKIM/DMARC) avant ouverture.
- Un invité doit s'inscrire (ou se connecter) **avec l'adresse invitée** ; il n'existe pas de procédure pour rattacher une invitation à une autre adresse (volontaire : c'est la garantie d'identité).
- Les routes API lisent le cookie de foyer mais n'appliquent pas la règle « ignoré avant la fin de l'inscription » (elles contrôlent les rôles elles-mêmes) ; seule `requireTenant()` l'applique.
- La page Courriers affiche encore le formulaire à un membre en lecture seule (l'API le refuse) ; hors périmètre de cette étape.
- Accessibilité : sélecteur de foyer, formulaires et libellés conçus pour le clavier et les lecteurs d'écran, mais **non audités avec un lecteur d'écran réel**.
- Pas de transfert de propriété en un clic : on nomme un second propriétaire (rôle OWNER), puis l'ancien peut partir.
