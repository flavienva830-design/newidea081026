-- Une même échéance (type, date, libellé) n'existe qu'une fois par foyer : l'idempotence est garantie par la base,
-- y compris quand deux analyses du même document s'exécutent en parallèle.
CREATE UNIQUE INDEX "deadlines_householdId_kind_dueDate_title_key" ON "deadlines"("householdId", "kind", "dueDate", "title");
