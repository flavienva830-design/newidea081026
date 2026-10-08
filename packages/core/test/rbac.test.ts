import { describe, expect, it } from "vitest";
import { assertCan, can, canAssignRole, canRemoveOrDemote, ForbiddenError, PERMISSIONS, staffCan } from "../src/rbac.ts";

describe("RBAC", () => {
  it("READ ne peut que lire", () => {
    expect(can("READ", "document:read")).toBe(true);
    for (const p of PERMISSIONS.filter((p) => !p.endsWith(":read"))) expect(can("READ", p)).toBe(false);
  });
  it("WRITE ne peut ni supprimer, ni valider un courrier, ni gérer les membres", () => {
    expect(can("WRITE", "document:write")).toBe(true);
    expect(can("WRITE", "document:delete")).toBe(false);
    expect(can("WRITE", "letter:validate")).toBe(false);
    expect(can("WRITE", "member:invite")).toBe(false);
  });
  it("ADMIN gère les membres mais pas la facturation ni la suppression du foyer", () => {
    expect(can("ADMIN", "member:invite")).toBe(true);
    expect(can("ADMIN", "billing:manage")).toBe(false);
    expect(can("ADMIN", "household:delete")).toBe(false);
  });
  it("OWNER a tout", () => {
    for (const p of PERMISSIONS) expect(can("OWNER", p)).toBe(true);
  });
  it("refus par défaut", () => {
    expect(can(null, "document:read")).toBe(false);
    expect(can(undefined, "document:read")).toBe(false);
    expect(can("HACKER" as never, "document:read")).toBe(false);
    expect(() => assertCan("READ", "document:write")).toThrow(ForbiddenError);
    expect(() => assertCan("OWNER", "document:write")).not.toThrow();
  });
  it("anti-élévation : pas de rôle supérieur ou égal, pas soi-même", () => {
    expect(canAssignRole("ADMIN", "OWNER", false)).toBe(false);
    expect(canAssignRole("ADMIN", "ADMIN", false)).toBe(false);
    expect(canAssignRole("ADMIN", "WRITE", false)).toBe(true);
    expect(canAssignRole("ADMIN", "WRITE", true)).toBe(false);
    expect(canAssignRole("WRITE", "READ", false)).toBe(false);
    expect(canAssignRole("OWNER", "OWNER", false)).toBe(true);
  });
  it("le dernier OWNER est protégé", () => {
    expect(canRemoveOrDemote(1, "OWNER")).toBe(false);
    expect(canRemoveOrDemote(2, "OWNER")).toBe(true);
    expect(canRemoveOrDemote(1, "WRITE")).toBe(true);
  });
  it("rôles staff", () => {
    expect(staffCan("ADMIN", "manage")).toBe(true);
    expect(staffCan("SUPPORT", "read_users")).toBe(true);
    expect(staffCan("SUPPORT", "manage")).toBe(false);
    expect(staffCan("NONE", "read_users")).toBe(false);
  });
});
