import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";

/**
 * Apparitions pilotées en CSS (aucun JavaScript, aucune dépendance à l'hydratation) :
 *  - `hero` : animation au chargement, pour le contenu au-dessus de la ligne de flottaison ;
 *  - par défaut : apparition au défilement via `animation-timeline: view()` là où le navigateur le gère,
 *    contenu simplement visible ailleurs. Désactivées si l'utilisateur réduit les animations (voir globals.css).
 */
export function Reveal({ children, delay = 0, hero, className }: {
  children: React.ReactNode; delay?: number; y?: number; hero?: boolean; className?: string;
}) {
  return (
    <div className={cn(hero ? "reveal-hero" : "reveal-scroll", className)} style={{ "--d": `${delay}s` } as CSSProperties}>
      {children}
    </div>
  );
}

/** Titre dont les mots montent en cascade (CSS pur, rendu côté serveur : visible dès le premier affichage). */
export function SplitWords({ text, className, delay = 0 }: { text: string; className?: string; delay?: number }) {
  const words = text.split(" ");
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      {words.map((w, i) => (
        <span key={i} aria-hidden className="inline-block overflow-hidden pb-[0.12em] align-bottom -mb-[0.12em]">
          <span className="word-up inline-block" style={{ "--d": `${delay + i * 0.06}s` } as CSSProperties}>
            {w}{i < words.length - 1 ? " " : ""}
          </span>
        </span>
      ))}
    </span>
  );
}
