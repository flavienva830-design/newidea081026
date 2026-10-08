/**
 * Attribution des rôles d'équipe (portail d'administration), en ligne de commande uniquement.
 * Il n'existe volontairement aucun écran pour s'attribuer un rôle : ça passe par un accès à la base.
 *
 *   pnpm --filter @mon-agent-ia/db staff list
 *   pnpm --filter @mon-agent-ia/db staff grant  prenom@exemple.fr ADMIN   "Motif"
 *   pnpm --filter @mon-agent-ia/db staff revoke prenom@exemple.fr         "Motif"
 *
 * Variable : DATABASE_ADMIN_URL (sinon DATABASE_SERVICE_URL).
 */
import pg from "pg";
import { randomUUID } from "node:crypto";

const ROLES = ["SUPPORT", "ADMIN"] as const;
type Role = (typeof ROLES)[number];

function usage(): never {
  console.error("Usage : staff list | grant <email> <SUPPORT|ADMIN> <motif> | revoke <email> <motif>");
  process.exit(2);
}

async function main() {
  const [cmd, email, a3, a4] = process.argv.slice(2);
  const url = process.env["DATABASE_ADMIN_URL"] ?? process.env["DATABASE_SERVICE_URL"];
  if (!url) throw new Error("DATABASE_ADMIN_URL (ou DATABASE_SERVICE_URL) requis");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    if (cmd === "list") {
      const r = await client.query(`SELECT email, "staffRole", "twoFactorEnabled", "bannedAt" FROM users WHERE "staffRole" <> 'NONE' ORDER BY email`);
      if (r.rowCount === 0) console.log("Aucun membre d'équipe.");
      for (const u of r.rows) console.log(`${u.staffRole.padEnd(8)} ${u.email}  2FA:${u.twoFactorEnabled ? "oui" : "NON"}${u.bannedAt ? "  SUSPENDU" : ""}`);
      return;
    }
    if (cmd !== "grant" && cmd !== "revoke") usage();
    if (!email || !email.includes("@")) usage();
    const role: Role | "NONE" = cmd === "revoke" ? "NONE" : ((ROLES as readonly string[]).includes(a3 ?? "") ? (a3 as Role) : usage());
    const reason = (cmd === "revoke" ? a3 : a4)?.trim();
    if (!reason) throw new Error("Un motif est obligatoire (il est écrit dans le journal d'audit).");

    await client.query("BEGIN");
    const u = await client.query(`SELECT id, "emailVerified", "twoFactorEnabled" FROM users WHERE lower(email) = lower($1) FOR UPDATE`, [email]);
    const row = u.rows[0];
    if (!row) throw new Error("Utilisateur introuvable (il doit d'abord créer son compte).");
    if (role !== "NONE" && !row.emailVerified) throw new Error("L'adresse e-mail doit être vérifiée avant d'attribuer un rôle.");
    await client.query(`UPDATE users SET "staffRole" = $2::"StaffRole" WHERE id = $1`, [row.id, role]);
    await client.query(
      `INSERT INTO audit_logs (id, "actorId", action, "targetType", "targetId", metadata) VALUES ($1, 'cli', $2, 'user', $3, $4)`,
      [randomUUID(), role === "NONE" ? "admin.staff.revoke" : "admin.staff.grant", row.id, JSON.stringify({ role, reason })],
    );
    await client.query("COMMIT");
    console.log(`${role === "NONE" ? "Rôle retiré" : `Rôle ${role} attribué`} à ${email}.${role !== "NONE" && !row.twoFactorEnabled ? " ATTENTION : la double authentification est obligatoire pour accéder au portail (hors développement)." : ""}`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
