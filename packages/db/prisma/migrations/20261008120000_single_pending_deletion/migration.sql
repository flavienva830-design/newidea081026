-- Une seule demande de suppression active par utilisateur (anti-doublon, y compris en cas de requêtes simultanées).
CREATE UNIQUE INDEX "deletion_requests_one_active_per_user" ON "deletion_requests"("userId") WHERE status IN ('PENDING', 'PROCESSING');
