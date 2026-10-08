/**
 * Formats d'affichage du portail. Module SANS « use client » : utilisable depuis les pages serveur.
 * Les graphiques (composants client) reçoivent une `unit` (texte), jamais une fonction : une fonction ne peut pas traverser
 * la frontière serveur → client.
 */
export const fmtInt = (v: number) => Math.round(v).toLocaleString("fr-FR");
export const fmtEuro = (cents: number) => (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: cents % 100 === 0 ? 0 : 2 });
export const fmtEuro2 = (cents: number) => (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

export type Unit = "int" | "euro" | "euro2";
export const formatter = (u: Unit | undefined): ((v: number) => string) => (u === "euro" ? fmtEuro : u === "euro2" ? fmtEuro2 : fmtInt);
