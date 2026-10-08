-- Sécurité au niveau base de données : rôle applicatif restreint + Row-Level Security.
--
-- Modèle
--  * Les migrations s'exécutent avec le propriétaire des tables (pas de FORCE : maintenance possible).
--  * L'application se connecte avec le rôle "mai_app", soumis à la RLS.
--  * Chaque transaction applicative positionne :
--      app.user_id       -> l'utilisateur authentifié
--      app.household_id  -> le foyer actif (après vérification de l'appartenance)
--    via set_config(..., true) (portée transaction : sûr avec un pool de connexions).
--  * Sans contexte, aucune ligne métier n'est visible ni modifiable.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mai_app') THEN
    CREATE ROLE mai_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

-- Rôle de service (worker, webhooks Stripe, portail admin) : accès inter-foyers, jamais exposé au navigateur.
-- Sur un hébergeur qui interdit BYPASSRLS (ex. Supabase), utiliser le rôle administrateur fourni à la place.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mai_service') THEN
    BEGIN
      CREATE ROLE mai_service NOLOGIN BYPASSRLS;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'BYPASSRLS non autorisé : créer mai_service manuellement ou utiliser le rôle admin de l''hébergeur';
    END;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO mai_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mai_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mai_app;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mai_service') THEN
    GRANT USAGE ON SCHEMA public TO mai_service;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mai_service;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mai_service;
  END IF;
END $$;

-- Fonctions de contexte (STABLE : évaluées une fois par requête).
CREATE OR REPLACE FUNCTION app_household_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.household_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_user_id() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;

-- Tables dont l'isolement repose sur "householdId".
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'invitations','profiles','documents','document_versions','document_texts',
    'tags','document_tags','extractions','deadlines','reminders',
    'detected_subscriptions','savings','recommended_actions','letters',
    'inbound_emails','billing_subscriptions','usage_counters'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY household_isolation ON %I USING ("householdId" = app_household_id()) WITH CHECK ("householdId" = app_household_id())',
      t);
  END LOOP;
END $$;

-- memberships : visibles pour le foyer actif OU pour l'utilisateur lui-même (résolution des foyers à la connexion).
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY membership_by_household ON memberships
  USING ("householdId" = app_household_id())
  WITH CHECK ("householdId" = app_household_id());
CREATE POLICY membership_by_user ON memberships
  FOR SELECT USING ("userId" = app_user_id());

-- households : le foyer actif, ou tout foyer dont l'utilisateur est membre (lecture).
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
CREATE POLICY household_active ON households
  USING (id = app_household_id())
  WITH CHECK (id = app_household_id());
CREATE POLICY household_member_read ON households
  FOR SELECT USING (id IN (SELECT "householdId" FROM memberships WHERE "userId" = app_user_id()));

-- Journal d'audit : ajout seul. Le rôle applicatif n'a ni UPDATE ni DELETE ;
-- le trigger protège aussi contre le propriétaire (sauf purge de rétention explicite).
REVOKE UPDATE, DELETE ON audit_logs FROM mai_app;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mai_service') THEN REVOKE UPDATE, DELETE ON audit_logs FROM mai_service; END IF; END $$;

CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.audit_retention_purge', true) = 'on' AND TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only';
END $$;

CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only();

-- Contraintes d'intégrité métier.
ALTER TABLE documents ADD CONSTRAINT documents_urgency_range CHECK ("urgencyScore" IS NULL OR "urgencyScore" BETWEEN 0 AND 100);
ALTER TABLE savings ADD CONSTRAINT savings_confidence_range CHECK (confidence BETWEEN 0 AND 1);
ALTER TABLE savings ADD CONSTRAINT savings_nonneg CHECK ("monthlyCents" >= 0 AND "annualCents" >= 0);
-- Un courrier envoyé doit avoir été validé par un humain.
ALTER TABLE letters ADD CONSTRAINT letters_sent_requires_validation
  CHECK (status <> 'SENT' OR ("validatedAt" IS NOT NULL AND "validatedById" IS NOT NULL));
