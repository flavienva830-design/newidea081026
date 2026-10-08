-- Espace Famille : invitations de membres.
--
-- 1. Recherche d'une invitation par EMPREINTE de jeton, avant l'adhésion.
--    La RLS isole "invitations" par foyer actif ; or un invité n'est pas encore membre, donc aucun foyer n'est
--    actif pour lui. Plutôt que de confier le rôle de service (qui contourne toute la RLS) au processus web,
--    une fonction SECURITY DEFINER étroite expose UNE ligne, et seulement pour une empreinte exacte
--    (HMAC d'un jeton de 256 bits d'aléa : non devinable, non énumérable). Le reste de l'acceptation
--    (adhésion, profil, invitation consommée) s'exécute ensuite sous la RLS ordinaire du foyer.
-- 2. Aucun jeton en clair ne peut être stocké : la base refuse tout "tokenHash" qui n'est pas une empreinte
--    hexadécimale de 64 caractères (un jeton brut fait 43 caractères base64url).
-- 3. Une seule invitation en attente par (foyer, email), sans tenir compte de la casse. Les invitations expirées
--    mais non révoquées sont révoquées par l'application avant d'en créer une nouvelle.

CREATE OR REPLACE FUNCTION invitation_lookup(p_token_hash text)
RETURNS TABLE (
  "id" uuid,
  "householdId" uuid,
  "householdName" text,
  "email" text,
  "role" text,
  "invitedById" text,
  "expiresAt" timestamp,
  "acceptedAt" timestamp,
  "revokedAt" timestamp
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT i."id", i."householdId", h."name", i."email", i."role"::text, i."invitedById", i."expiresAt", i."acceptedAt", i."revokedAt"
  FROM public.invitations i
  JOIN public.households h ON h."id" = i."householdId"
  WHERE p_token_hash ~ '^[0-9a-f]{64}$'
    AND i."tokenHash" = p_token_hash
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION invitation_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION invitation_lookup(text) TO mai_app;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mai_service') THEN
    GRANT EXECUTE ON FUNCTION invitation_lookup(text) TO mai_service;
  END IF;
END $$;

ALTER TABLE "invitations" ADD CONSTRAINT "invitations_token_hash_format" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_email_len" CHECK (char_length("email") BETWEEN 3 AND 254);

CREATE UNIQUE INDEX "invitations_one_pending_per_email"
  ON "invitations" ("householdId", lower("email"))
  WHERE "acceptedAt" IS NULL AND "revokedAt" IS NULL;
