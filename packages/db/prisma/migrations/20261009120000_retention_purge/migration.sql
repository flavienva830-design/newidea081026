-- Durées de conservation des données d'exploitation (RGPD : limitation de la conservation).
--
-- 1. Index sur les colonnes de date utilisées par la purge quotidienne du worker : sans eux, chaque purge
--    parcourrait entièrement des tables qui grossissent avec l'usage (connexions, appels IA, journal d'audit).
-- 2. Journal d'audit : il reste en ajout seul (aucune modification, suppression interdite à tous les rôles
--    applicatifs). La SEULE voie de suppression est `purge_audit_logs`, réservée au rôle de service, et le
--    déclencheur refuse en plus toute suppression de ligne de moins de 12 mois, même avec l'indicateur de purge
--    (plancher imposé par la base, indépendant de l'application).

CREATE INDEX "login_events_createdAt_idx" ON "login_events"("createdAt");
CREATE INDEX "ai_runs_createdAt_idx" ON "ai_runs"("createdAt");
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");
CREATE INDEX "stripe_events_receivedAt_idx" ON "stripe_events"("receivedAt");
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");
CREATE INDEX "verifications_expiresAt_idx" ON "verifications"("expiresAt");
CREATE INDEX "invitations_expiresAt_idx" ON "invitations"("expiresAt");

CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.audit_retention_purge', true) = 'on'
     AND OLD."createdAt" < (now() AT TIME ZONE 'utc') - interval '12 months' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only';
END $$;

CREATE OR REPLACE FUNCTION purge_audit_logs(p_keep interval) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  n bigint;
BEGIN
  IF p_keep < interval '12 months' THEN
    RAISE EXCEPTION 'audit_logs retention cannot be shorter than 12 months';
  END IF;
  PERFORM set_config('app.audit_retention_purge', 'on', true);
  DELETE FROM public.audit_logs WHERE "createdAt" < (now() AT TIME ZONE 'utc') - p_keep;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('app.audit_retention_purge', 'off', true);
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION purge_audit_logs(interval) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mai_service') THEN
    GRANT EXECUTE ON FUNCTION purge_audit_logs(interval) TO mai_service;
  END IF;
END $$;
