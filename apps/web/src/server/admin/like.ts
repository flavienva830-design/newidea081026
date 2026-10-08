/**
 * Prisma ne neutralise PAS « % » et « _ » dans `contains` / `startsWith` : ils restent des jokers SQL.
 * Un terme saisi par l'équipe doit être littéral (sinon « %%% » listerait tout le monde). Le caractère d'échappement par défaut de LIKE est « \ ».
 */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");
