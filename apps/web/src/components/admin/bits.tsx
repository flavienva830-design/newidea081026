import Link from "next/link";
import { cn } from "@/lib/cn";

export function Card({ title, subtitle, children, className }: { title?: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-[20px] border border-line p-5 sm:p-6", className)}>
      {title && <h2 className="text-[17px] tracking-tight">{title}</h2>}
      {subtitle && <p className="mt-0.5 text-[12px] text-soft">{subtitle}</p>}
      <div className={title ? "mt-4" : ""}>{children}</div>
    </section>
  );
}

/** Tuile d'indicateur : libellé, valeur (chiffres proportionnels), précision optionnelle. */
export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-card border border-line p-4">
      <p className="text-[12px] text-soft">{label}</p>
      <p className="mt-1.5 font-display text-[28px] font-medium leading-none tracking-tight">{value}</p>
      {hint && <p className="mt-2 text-[11px] leading-snug text-faint">{hint}</p>}
    </div>
  );
}

/** Le chiffre phare de la vue : un seul par page, ≥ 48 px. */
export function Hero({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[20px] bg-fg p-6 text-white sm:p-8">
      <p className="text-[13px] text-white/60">{label}</p>
      <p className="mt-2 font-display text-[56px] font-medium leading-none tracking-tight sm:text-[64px]">{value}</p>
      {hint && <p className="mt-3 max-w-[44ch] text-[12px] leading-snug text-white/50">{hint}</p>}
    </div>
  );
}

export const pct = (r: number | null, digits = 1) => (r === null ? "—" : `${(r * 100).toLocaleString("fr-FR", { maximumFractionDigits: digits })} %`);

/** Filtre de période : une seule rangée au-dessus des graphiques, périodes prédéfinies. */
export function RangeTabs({ current, base }: { current: number; base: string }) {
  return (
    <nav aria-label="Période" className="flex w-fit gap-1 rounded-full border border-line p-1">
      {[7, 30, 90].map((d) => (
        <Link key={d} href={`${base}?range=${d}`} aria-current={current === d ? "page" : undefined} className={cn("rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors", current === d ? "bg-fg text-white" : "text-soft hover:text-fg")}>{d} jours</Link>
      ))}
    </nav>
  );
}

export function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "ok" | "warn" | "danger" }) {
  const t = { neutral: "bg-muted text-soft", ok: "bg-[#ecfdf3] text-[#067647]", warn: "bg-[#fffaeb] text-[#93370d]", danger: "bg-danger-wash text-danger" } as const;
  return <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium", t[tone])}>{children}</span>;
}

// Affichage en heure de Paris, quel que soit le fuseau du serveur (en production : UTC).
const TZ = "Europe/Paris";
export const dateFr = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: TZ }) : "—");
export const dateTimeFr = (d: Date | string) => new Date(d).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ });

export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-control border border-line">
      <table className="w-full text-left text-[13px]">
        <thead className="bg-subtle text-soft"><tr>{head.map((h) => <th key={h} scope="col" className="whitespace-nowrap px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
        <tbody className="[&>tr]:border-t [&>tr]:border-line [&_td]:px-4 [&_td]:py-2.5 [&_td]:align-top">{children}</tbody>
      </table>
    </div>
  );
}
