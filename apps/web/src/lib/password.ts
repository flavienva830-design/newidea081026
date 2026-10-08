export const MIN_PASSWORD = 12;

export type Strength = { score: 0 | 1 | 2 | 3 | 4; label: string };

/** Indicateur simple et honnête : longueur + variété. La vraie protection reste le contrôle des fuites côté serveur. */
export function passwordStrength(pw: string): Strength {
  if (!pw) return { score: 0, label: "" };
  let score = 0;
  if (pw.length >= MIN_PASSWORD) score++;
  if (pw.length >= 16) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length < MIN_PASSWORD) score = Math.min(score, 1) as number;
  const s = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
  return { score: s, label: ["Trop court", "Faible", "Correct", "Solide", "Excellent"][pw.length < MIN_PASSWORD ? 0 : s]! };
}
