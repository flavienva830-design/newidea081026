import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Sonde de disponibilité : volontairement minimale (aucun détail d'infrastructure exposé). */
export function GET() {
  return NextResponse.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
}
