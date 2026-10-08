# Mon Agent IA

Assistant administratif IA pour particuliers et familles.

- `docs/00-analyse-et-architecture.md` : analyse, décisions d'architecture, sécurité, roadmap.
- `docs/01-exploitation-et-deploiement.md` : mise en ligne, variables d'environnement, supervision.
- `docs/02-espace-famille.md` : foyers multiples, rôles, invitations, profils (modèle de sécurité).
- `legacy/` : première landing statique (référence de contenu, sera remplacée par `apps/web`).
- `packages/db` : schéma Prisma, migrations, RLS Postgres, isolation par foyer.
- `packages/core` : chiffrement d'enveloppe, RBAC, limitation de débit, validation de fichiers, risque de connexion, plans/quotas.
- `packages/ai` : moteur d'analyse (extraction en mémoire PDF/DOCX/images, prompts versionnés, sortie JSON stricte, nettoyage, fournisseurs OpenAI et factice).
- `packages/config` : validation de l'environnement.
- `apps/worker` : tâches planifiées sans contenu (BullMQ) : envoi des rappels d'échéance. `pnpm --filter @mon-agent-ia/worker start` (nécessite `REDIS_URL` et `DATABASE_SERVICE_URL`).
- `packages/mail` : transport d'emails (Resend) et gabarits.
- `apps/web` : Next.js 15 (landing, authentification Better Auth avec double authentification, onboarding, tableau de bord, sécurité du compte).

## Développement local

```bash
pnpm install
cp .env.example .env.local        # puis renseigner les valeurs
pnpm db:generate && pnpm db:migrate
pnpm typecheck && pnpm test
```

### Application web

```bash
cd apps/web
cp ../../.env.example .env.local   # APP_ENV=dev ; E2E_OUTBOX=1 pour les tests E2E
pnpm dev                           # http://localhost:3000 (dossier de build dédié : .next-dev)
pnpm build && pnpm start           # build de production
pnpm test                          # unitaires + intégration (Postgres requis)
pnpm test:e2e                      # Playwright (lance `pnpm start` ; PW_CHROMIUM pour un Chromium existant)
```

Sans clé `OPENAI_API_KEY`, l'analyse utilise en développement un fournisseur factice déterministe (`AI_PROVIDER=fake`, interdit hors `APP_ENV=dev`). Avec une clé : `AI_PROVIDER=openai`.

En développement, les emails (liens de vérification, de connexion) s'affichent dans la console du serveur.

Les tests d'intégration (`TEST_ADMIN_URL`, `TEST_APP_URL`, `TEST_REDIS_URL`) sont ignorés s'ils ne sont pas définis ; la CI les exécute tous.
