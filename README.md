# Mon Agent IA

Assistant administratif IA pour particuliers et familles.

- `docs/00-analyse-et-architecture.md` : analyse, décisions d'architecture, sécurité, roadmap.
- `legacy/` : première landing statique (référence de contenu, sera remplacée par `apps/web`).
- `packages/db` : schéma Prisma, migrations, RLS Postgres, isolation par foyer.
- `packages/core` : chiffrement d'enveloppe, RBAC, limitation de débit, validation de fichiers, risque de connexion, plans/quotas.
- `packages/config` : validation de l'environnement.
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

En développement, les emails (liens de vérification, de connexion) s'affichent dans la console du serveur.

Les tests d'intégration (`TEST_ADMIN_URL`, `TEST_APP_URL`, `TEST_REDIS_URL`) sont ignorés s'ils ne sont pas définis ; la CI les exécute tous.
