# Mon Agent IA

Assistant administratif IA pour particuliers et familles.

- `docs/00-analyse-et-architecture.md` : analyse, décisions d'architecture, sécurité, roadmap.
- `legacy/` : première landing statique (référence de contenu, sera remplacée par `apps/web`).
- `packages/db` : schéma Prisma, migrations, RLS Postgres, isolation par foyer.
- `packages/core` : chiffrement d'enveloppe, RBAC, limitation de débit, validation de fichiers, risque de connexion, plans/quotas.
- `packages/config` : validation de l'environnement.

## Développement local

```bash
pnpm install
cp .env.example .env.local        # puis renseigner les valeurs
pnpm db:generate && pnpm db:migrate
pnpm typecheck && pnpm test
```

Les tests d'intégration (`TEST_ADMIN_URL`, `TEST_APP_URL`, `TEST_REDIS_URL`) sont ignorés s'ils ne sont pas définis ; la CI les exécute tous.
