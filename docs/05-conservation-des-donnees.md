# Mon Agent IA — Conservation des données

Principe du produit : **ne conserver aucun document**. Ce dossier traite de tout le reste : ce qui est conservé, combien de temps, et comment on le prouve. Le RGPD (art. 5-1-e) exige une durée limitée, justifiée, et **effectivement appliquée** : une durée écrite dans une politique mais jamais purgée est un manquement.

## 1. Ce qui est conservé

| Catégorie | Contenu | Durée | Qui décide |
|---|---|---|---|
| Documents, texte extrait, courriers générés | **rien** : traitement en mémoire le temps de l'analyse | 0 | architecture (D10) |
| Enregistrements structurés (organisme, type, montants, échéances, économies, actions) | données courtes issues de l'analyse | jusqu'à suppression par l'utilisateur ou clôture du compte | l'utilisateur |
| Compte, foyer, membres, consentements | identité minimale, rôles, preuve des consentements | durée du compte | l'utilisateur |
| **Données d'exploitation** (§2) | connexions, appels IA techniques, audit, paiements reçus, notifications, etc. | **durées ci-dessous, purgées chaque nuit** | politique du produit |

## 2. Durées des données d'exploitation

Source unique : `packages/core/src/retention-policy.ts` (le worker, le portail d'administration `/admin/privacy` et la page de confidentialité en dépendent : une durée modifiée l'est partout).

| Donnée | Durée | Pourquoi |
|---|---|---|
| Historique de connexions | 12 mois | sécurité et détection d'abus ; adresses IP et appareils en empreintes, jamais en clair |
| Appels IA (jetons, coût, latence) | 24 mois | suivi des coûts et de la fiabilité ; aucun contenu |
| Journal d'audit | 24 mois | preuve des actions sensibles ; ajout seul, **plancher de 12 mois imposé par la base** |
| Événements de paiement reçus | 13 mois | diagnostic ; Stripe reste la référence comptable |
| Notifications | 6 mois si lues, 12 mois sinon | confort d'usage |
| Rappels déjà traités | 3 mois | diagnostic des envois (un rappel à envoyer n'est jamais purgé) |
| Sessions et jetons de vérification expirés | 30 jours / 7 jours | aucune utilité une fois expirés |
| Invitations terminées | 30 jours | elles contiennent l'adresse e-mail de l'invité |
| Demandes RGPD terminées (suppression annulée ou en échec, export) | 12 mois | traçabilité (une suppression en attente n'est jamais purgée) |
| Notes internes du support | 24 mois | minimisation |
| Compteurs d'usage mensuels | 24 mois | litiges de facturation |

Ces durées sont des **propositions** posées faute de décision : à valider par le DPO / un juriste, puis à reporter dans la politique de confidentialité (déjà alimentée automatiquement par ces valeurs).

## 3. Comment c'est appliqué

- **Worker** : tâche `purge-retention` planifiée chaque nuit (03 h 30 UTC) — `apps/worker/src/retention.ts`.
  - Suppression **par lots** de 5 000 lignes (transactions courtes, pas de verrou long), jusqu'à ce qu'un lot ne soit pas plein.
  - Chaque catégorie est traitée **indépendamment** : l'échec de l'une est signalé (`failed`) sans bloquer les autres, et sera repris au passage suivant. Le message d'erreur n'est jamais recopié (il pourrait citer une donnée).
  - Une ligne `retention.purged` (comptes par catégorie, rien d'autre) est ajoutée au journal d'audit : on peut **démontrer** que la politique tourne. Le portail `/admin/privacy` affiche la dernière purge et alerte s'il n'y en a aucune.
- **Index** sur les colonnes de date (`createdAt`, `expiresAt`, `receivedAt`) : la purge ne parcourt pas des tables entières.
- **Journal d'audit** : jamais modifiable ni supprimable par l'application, **y compris le rôle de service**. Une seule voie : la fonction SQL `purge_audit_logs(interval)`, réservée au rôle de service, qui refuse une durée de moins de 12 mois ; en plus, le déclencheur de la table refuse de supprimer une ligne de moins de 12 mois **même avec l'indicateur de purge armé** (plancher imposé par la base, indépendant de l'application).
- **Suppression de compte** (déjà en place) : délai de rétractation de 14 jours, puis le worker supprime le foyer et toutes ses données en cascade, le client Stripe, les sessions, les consentements, les notes de support.

## 4. Ce qui est testé

`apps/worker/test/retention.test.ts` (11 tests, base réelle) : pour chaque catégorie, une ligne **plus ancienne que la durée est supprimée et une plus récente est conservée, limite comprise** ; un rappel à envoyer et une suppression de compte en attente ne sont jamais purgés ; le journal d'audit n'est purgeable que par la fonction réservée, jamais avant 12 mois, jamais modifiable, et l'indicateur de purge ne reste pas armé ; la purge par lots et la reprise ; l'échec d'une catégorie n'empêche pas les autres et ne fuite aucun message. Un test de mutation a vérifié qu'un seuil de purge erroné fait échouer la suite.
`packages/core/test/retention-policy.test.ts` : chaque catégorie purgée est présentée dans le portail et la documentation (rien d'oublié), plancher du journal.

## 5. Ce qui n'est PAS purgé, et pourquoi (décisions à prendre)

1. **Historique de facturation interne (`billing_history`)** : identifiants de foyer, offres et montants, utilisé pour le MRR et le churn. Aucune donnée directe sur une personne ; après suppression d'un foyer il ne reste qu'un identifiant opaque. Conservé sans limite aujourd'hui : **à borner** (proposition : 5 ans, durée de prescription comptable) ou à agréger.
2. **Preuve de consentement** : les consentements sont supprimés **avec le compte** (suppression en cascade). Le responsable de traitement doit pouvoir *démontrer* un consentement (art. 7-1) : à discuter avec le DPO s'il faut conserver, après suppression, une preuve minimale (empreinte de l'identifiant, type, date) pendant la durée de prescription.
3. **Journal d'audit après suppression d'un compte** : les lignes restent jusqu'à 24 mois avec un identifiant d'utilisateur désormais orphelin et des empreintes d'adresse IP (HMAC avec un secret serveur). Pseudonymes, non effacés avant l'échéance : à mentionner dans le registre des traitements.
4. **Profils archivés** d'anciens membres (prénom) : ils restent attachés aux documents du foyer qui les concernent. À mentionner aux membres au moment de leur retrait.
5. **Sauvegardes de la base** : une donnée supprimée subsiste dans les sauvegardes jusqu'à leur expiration. La durée de rétention des sauvegardes (proposition : 7 à 30 jours) doit être fixée chez l'hébergeur et annoncée dans la politique de confidentialité (`[x] jours`, encore vide).
6. **Sous-traitants** : leur propre conservation échappe à cette purge — OpenAI (contrat de conservation zéro à obtenir), Stripe (obligations comptables), Resend (journaux d'envoi), hébergeur (journaux d'accès), supervision d'erreurs (voir `docs/06-observabilite.md` si présent). À lister dans la politique de confidentialité avec leur durée.

## 6. Modifier une durée

1. Changer la valeur dans `packages/core/src/retention-policy.ts` (et le libellé si besoin).
2. `pnpm test` : le test de cohérence signale une catégorie non présentée ; le journal d'audit ne peut pas descendre sous 12 mois.
3. Vérifier la politique de confidentialité (alimentée automatiquement) et informer les utilisateurs si la durée s'allonge.
4. Raccourcir une durée supprime les données concernées dès la nuit suivante : irréversible.
