import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const MIGRATIONS = fileURLToPath(new URL("../../../../packages/db/prisma/migrations", import.meta.url));

export type IsolatedDb = { url: string; drop: () => Promise<void> };

/**
 * Crée une base VIDE et jetable, y rejoue toutes les migrations (SQL brut, dans l'ordre) puis renvoie l'URL du rôle de service.
 * Sert aux tests qui comptent des lignes globales (indicateurs, pagination) : ils ne peuvent pas partager la base de test commune.
 * `adminUrl` doit pouvoir créer une base (propriétaire / superutilisateur) ; `serviceUrl` fournit le rôle et le serveur.
 */
export async function createIsolatedDb(adminUrl: string, serviceUrl: string): Promise<IsolatedDb> {
  const name = `mai_iso_${randomBytes(5).toString("hex")}`;
  const withDb = (u: string) => {
    const x = new URL(u);
    x.pathname = `/${name}`;
    return x.toString();
  };
  const root = new pg.Client({ connectionString: adminUrl });
  await root.connect();
  try {
    await root.query(`CREATE DATABASE ${name}`);
  } finally {
    await root.end();
  }
  const drop = async () => {
    const c = new pg.Client({ connectionString: adminUrl });
    await c.connect();
    try {
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    } finally {
      await c.end();
    }
  };
  const owner = new pg.Client({ connectionString: withDb(adminUrl) });
  try {
    await owner.connect();
    for (const dir of readdirSync(MIGRATIONS).filter((d) => /^\d{14}_/.test(d)).sort()) {
      await owner.query(readFileSync(`${MIGRATIONS}/${dir}/migration.sql`, "utf8"));
    }
  } catch (e) {
    await owner.end().catch(() => {});
    await drop();
    throw e;
  }
  await owner.end();
  return { url: withDb(serviceUrl), drop };
}
