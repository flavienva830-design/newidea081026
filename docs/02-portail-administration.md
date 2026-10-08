# Mon Agent IA — Portail d'administration

Interface interne (`/admin`) pour piloter l'activité (revenus, utilisateurs, coût de l'IA), assister les clients et rendre des comptes (journal d'audit, RGPD). Elle repose sur le principe central du produit : **aucun fichier, texte ni courrier d'utilisateur n'est conservé**. Le portail ne peut donc pas en afficher : il ne manipule que des identifiants, des dates, des compteurs et des montants.

## 1. Accès et rôles

| | SUPPORT | ADMIN |
|---|---|---|
| Recherche et fiche d'un utilisateur (e-mail, offre, foyers, usage du mois, consentements, dernières connexions) | ✅ | ✅ |
| Notes internes (500 caractères maximum) | ✅ | ✅ |
| Suspendre / réactiver un compte, fermer ses sessions | — | ✅ |
| Vue d'ensemble, abonnements et revenus, activité IA | — | ✅ |
| Journal d'audit, connexions inhabituelles | — | ✅ |
| RGPD : demandes de suppression en cours (avancer ou annuler) | — | ✅ |

Règles d'accès (toutes imposées côté serveur, jamais par l'interface) :

- **Le portail n'existe pas pour les autres** : un compte sans rôle d'équipe reçoit une page 404, y compris sur les sous-pages. Un visiteur non connecté est renvoyé vers la connexion.
- **Le rôle est relu en base à chaque requête** (page ou action), jamais déduit de la session ni d'un cookie : retirer un rôle ou suspendre un membre de l'équipe prend effet immédiatement.
- **Double authentification obligatoire** (hors développement). Sans elle, redirection vers la page de sécurité du compte.
- **Session récente exigée pour les actions sensibles** (suspension, réactivation, fermeture de sessions, suppression de compte) : connexion de moins de 4 heures. Les notes internes, faible risque, ne l'exigent pas.
- **Chaque page revérifie l'autorisation** (le *layout* n'est pas rejoué à chaque navigation).
- **Aucune élévation depuis le portail** : on ne peut ni se donner un rôle, ni suspendre son propre compte, ni suspendre un administrateur. L'attribution d'un rôle passe uniquement par la ligne de commande ci-dessous.

### Attribuer ou retirer un rôle (accès base de données requis)

```bash
pnpm --filter @mon-agent-ia/db staff list
pnpm --filter @mon-agent-ia/db staff grant  prenom@exemple.fr ADMIN "Premier administrateur"
pnpm --filter @mon-agent-ia/db staff revoke prenom@exemple.fr "Départ de l'équipe"
```

Variable utilisée : `DATABASE_ADMIN_URL` (à défaut `DATABASE_SERVICE_URL`). Le compte doit exister et avoir son e-mail vérifié. Un **motif est obligatoire** : il est écrit dans le journal d'audit (`admin.staff.grant` / `admin.staff.revoke`, auteur `cli`). La commande rappelle d'activer la double authentification si ce n'est pas fait.

*En test automatisé uniquement*, la route `/api/dev/staff` attribue un rôle : elle renvoie 404 sauf si `APP_ENV=dev` **et** `E2E_OUTBOX=1`, deux réglages que l'application refuse en production et en préproduction.

## 2. Ce que le portail ne montre jamais

- Aucun contenu de document, de courrier ou de résumé (il n'en existe pas dans la base).
- Aucune donnée de paiement : ni carte, ni IBAN. Les montants affichés viennent du catalogue de prix, Stripe reste la référence comptable.
- Aucun mot de passe, secret d'authentification, code de secours ni clé de chiffrement.
- Pas de « connexion en tant que l'utilisateur » (*impersonation*) : volontairement non fournie.
- Les adresses IP ne sont pas affichées, seulement un pays et des signaux d'alerte ; en base elles sont hachées avec un secret serveur.

Données personnelles qu'il affiche tout de même : e-mail, nom, dates, offre, usage mensuel, consentements, historique de connexion. En conséquence :

- la **recherche exige 3 caractères au minimum** (en dessous, la liste des 25 derniers comptes s'affiche, sans filtre : pas d'énumération par lettre) et traite `%` et `_` comme des caractères ordinaires ;
- **consulter une fiche est enregistré** dans le journal (`admin.user.view`) ;
- les **notes internes sont des données personnelles** : elles figurent dans l'export de la personne (sans l'identité de l'agent), disparaissent avec la suppression du compte, et la table est inaccessible au rôle applicatif des utilisateurs.

## 3. Définitions des indicateurs

Elles sont affichées telles quelles à l'écran et verrouillées par des tests sur des jeux de données calculés à la main (`admin-metrics.integration.test.ts`).

| Indicateur | Définition |
|---|---|
| **MRR (estimé)** | Somme, pour chaque foyer ayant un abonnement *actif, en essai, ou impayé dans la période déjà payée*, du prix catalogue ramené au mois (annuel ÷ 12, arrondi). **Estimation** : remises, coupons, taxes et devises ne sont pas pris en compte. |
| **ARR** | MRR × 12. |
| **Foyers abonnés** / **ARPU** | Nombre de foyers comptés dans le MRR ; MRR ÷ foyers abonnés. |
| **MRR dans le temps** | MRR de départ + somme cumulée des variations enregistrées dans l'historique de facturation (`billing_history`, une ligne à chaque changement d'offre ou de montant, y compris la suppression d'un compte). |
| **Churn 30 jours (comptes)** | Foyers passés d'un MRR > 0 à 0 sur 30 jours ÷ foyers payants au début de la fenêtre. |
| **Churn 30 jours (revenu)** | MRR perdu par ces résiliations ÷ MRR au début de la fenêtre. |
| **Conversion** | Part des foyers créés depuis moins de 90 jours qui ont un abonnement accordant une offre payante *maintenant* (même règle que le MRR). |
| **Activation** | Parmi les comptes vérifiés créés il y a 7 à 37 jours : part ayant analysé eux-mêmes un document dans les 7 jours suivant l'inscription. |
| **Connectés / jour, 7 j, 30 j** | Utilisateurs distincts ayant ouvert une session avec succès sur la période (échecs exclus). |
| **Coût IA par document** | Coût des analyses de la période ÷ documents analysés sur la même période. |
| **Latence p50 / p95** | Percentiles continus de la durée des appels IA. |
| **Taux d'erreur IA** | Appels dont le statut n'est pas « OK » (erreur, sortie invalide, refus) ÷ appels. |

Tous les ratios sans dénominateur s'affichent « — » (jamais 0 % ni division par zéro). Les séries quotidiennes contiennent **tous les jours** de la période (zéros compris). Les graphiques suivent une seule teinte, ont une version tableau accessible et une infobulle au survol comme au clavier.

## 4. Actions et garde-fous

| Action | Effet | Garde-fous |
|---|---|---|
| Suspendre un compte | `bannedAt` posé, **toutes les sessions supprimées**, aucune nouvelle session possible (mot de passe, lien magique, Google) | motif obligatoire (3 à 200 caractères) ; refusé sur soi-même, sur un administrateur, sur un compte inconnu ; confirmation dans le navigateur |
| Réactiver | `bannedAt` retiré | seulement si le compte est suspendu (idempotent : un second clic ne journalise rien) |
| Fermer les sessions | supprime les sessions de la personne | motif obligatoire ; nombre fermé journalisé |
| Note interne | texte de 1 à 500 caractères (contrainte en base) | le texte de la note n'est **jamais** recopié dans le journal |
| Suppression de compte | avancer l'échéance (le worker exécute dans la minute) ou annuler | uniquement pour une demande « en attente » ; motif obligatoire |

Un compte suspendu : la fermeture des sessions est immédiate en base, mais le cookie de session signé peut rester accepté **jusqu'à 60 secondes** (cache de cookie de Better Auth). Les pages du portail relisent la base à chaque requête et ne sont pas concernées. Il n'y a pas de suppression de compte « immédiate » depuis le portail pour une personne qui ne l'a pas demandée.

Le **journal d'audit** (`audit_logs`) est en ajout seul : un déclencheur Postgres interdit toute modification ou suppression, **même au rôle de service** (testé). Il ne contient que des identifiants, des empreintes et des paramètres (auteur, cible, motif). Il est paginé par curseur `(date, identifiant)` : 50 lignes par page, sans perte ni doublon même quand plusieurs lignes partagent la même milliseconde (testé avec 70 lignes simultanées). Filtres : début d'action (littéral), foyer, auteur.

## 5. Ce qui est testé

| Test | Ce qu'il verrouille |
|---|---|
| `packages/core/test/staff.test.ts` | décision d'accès : rôle, MFA, suspension, fraîcheur de session, refus par défaut |
| `apps/web/test/admin-metrics.integration.test.ts` (base isolée) | chaque définition du §3 sur un jeu déterministe : utilisateurs, DAU/WAU/MAU, MRR 990 + 1658 + 990, ARR, ARPU, fusion par offre, churn compte/revenu, conversion, activation, séries sans trou, MRR dans le temps, percentiles, coût par document, recherche (casse, 3 caractères, jokers), fiche utilisateur ; identique sous trois fuseaux horaires |
| `apps/web/test/admin-ops.integration.test.ts` (base isolée) | suspension, refus (soi-même, administrateur, inconnu), réactivation idempotente, notes, suppression, journal append-only, pagination par curseur, filtres littéraux, export des notes |
| `apps/web/test/auth.integration.test.ts` | un compte suspendu ne peut ouvrir aucune session avec le bon mot de passe ; la réactivation rétablit l'accès ; la tentative refusée n'est pas comptée comme une connexion réussie |
| `packages/billing/test/handler.test.ts`, `apps/worker/test/deletion.test.ts` | écriture de l'historique de facturation (changement d'offre, résiliation, suppression de compte) |
| `apps/web/e2e/admin.spec.ts` | 404 pour un utilisateur ordinaire, ouverture et retrait de rôle sans reconnexion, menu et redirections par rôle, parcours SUPPORT (notes, pas de suspension), parcours ADMIN (suspension → journal → connexion refusée → réactivation → connexion) |

Les tests d'indicateurs créent une base **vide et jetable** (`test/helpers/isolated-db.ts` rejoue les migrations) : ils comptent des lignes globales et ne peuvent pas partager la base de test commune.

## 6. Limites connues

- **MRR estimé**, pas comptable (voir §3). L'historique de facturation ne commence qu'à la mise en service : les courbes antérieures n'existent pas.
- Pas de remboursement, d'avoir ni de changement d'offre depuis le portail : à faire dans le tableau de bord Stripe.
- Les périodes d'essai ne sont pas proposées ; un abonnement « en essai » serait compté au prix plein.
- Pas d'export CSV des indicateurs ni d'alertes automatiques (voir `01-exploitation-et-deploiement.md`, §5).
- Pas d'e-mail de notification envoyé à la personne lors d'une suspension (à décider avec le juriste : information de la personne et recours).
