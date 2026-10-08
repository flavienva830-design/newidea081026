"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatter, type Unit } from "./format";

/**
 * Graphiques SVG mono-série (sans dépendance), conformes à la charte : une seule teinte de marque,
 * marques fines (barres ≤ 24 px, coin supérieur arrondi à 4 px, ligne de 2 px), grille en filet,
 * survol et clavier avec infobulle, et TOUJOURS une vue tableau : l'infobulle complète, elle ne conditionne rien.
 * Les libellés viennent de données : ils ne passent que par React (échappés), jamais par innerHTML.
 */
export type Point = { label: string; value: number };

const MARK = "#1f8bef"; // teinte de marque validée (≥ 3:1 sur blanc)
const GRID = "#ececec";
const INK2 = "#6b6b6b";
const MUTED = "#757575";
const H = 200;
const M = { r: 12, t: 10, b: 26 };


const dayFmt = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
};

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Graduations « rondes » (0, 25, 50…) : 4 intervalles environ, maximum arrondi au pas supérieur. */
export function niceScale(max: number): { max: number; ticks: number[] } {
  if (!(max > 0)) return { max: 1, ticks: [0, 1] };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const r = raw / mag;
  const step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 1000; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { max: top, ticks };
}

/** Barre de 4 px de rayon sur l'extrémité (haut), angle droit sur la ligne de base. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function Tooltip({ x, y, width, label, value }: { x: number; y: number; width: number; label: string; value: string }) {
  const left = Math.min(Math.max(x, 70), width - 70);
  return (
    <div role="status" className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-[10px] border border-line bg-white px-3 py-2 shadow-soft" style={{ left, top: Math.max(0, y - 54) }}>
      <p className="flex items-center gap-2 text-[15px] font-semibold leading-tight text-fg"><span aria-hidden className="inline-block h-0.5 w-3 rounded-full" style={{ background: MARK }} />{value}</p>
      <p className="mt-0.5 text-[12px] leading-tight text-soft">{label}</p>
    </div>
  );
}

function DataTable({ data, valueLabel, format, labelFmt }: { data: Point[]; valueLabel: string; format: (v: number) => string; labelFmt: (s: string) => string }) {
  return (
    <details className="mt-3 text-[12px]">
      <summary className="cursor-pointer text-soft hover:text-fg">Voir le tableau</summary>
      <div className="mt-2 max-h-56 overflow-auto rounded-control border border-line">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-subtle text-soft"><tr><th className="px-3 py-1.5 font-medium">Période</th><th className="px-3 py-1.5 text-right font-medium">{valueLabel}</th></tr></thead>
          <tbody>{[...data].reverse().map((p) => <tr key={p.label} className="border-t border-line"><td className="px-3 py-1.5 text-soft">{labelFmt(p.label)}</td><td className="px-3 py-1.5 text-right tabular-nums">{format(p.value)}</td></tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

type TimeProps = { data: Point[]; title: string; valueLabel: string; unit?: Unit; kind: "bar" | "line" };

/** Série temporelle : barres (flux : inscriptions, analyses, coût) ou courbe (stock : MRR). */
export function TimeChart({ data, title, valueLabel, unit, kind }: TimeProps) {
  const format = formatter(unit);
  const [ref, width] = useWidth();
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const n = data.length;
  const innerH = H - M.t - M.b;
  const { max, ticks } = niceScale(Math.max(0, ...data.map((d) => d.value)));
  // Graduations sans décimales quand elles sont rondes (« 3 000 € ») et marge gauche adaptée à la plus longue : rien n'est rogné.
  const axisFormat = unit === "euro2" ? formatter(ticks.some((t) => t % 100 !== 0) ? "euro2" : "euro") : format; // décimales partout ou nulle part sur un même axe
  const ml = Math.max(36, Math.ceil(14 + 6.4 * Math.max(...ticks.map((t) => axisFormat(t).length))));
  const innerW = width - ml - M.r;
  const y = (v: number) => M.t + innerH - (v / max) * innerH;
  const slot = innerW / Math.max(1, n);
  const barW = Math.max(2, Math.min(24, slot - 2)); // 2 px de blanc entre deux barres
  const xBar = (i: number) => ml + i * slot + (slot - barW) / 2;
  const xLine = (i: number) => ml + (n === 1 ? innerW / 2 : (i * innerW) / (n - 1));
  const xAt = (i: number) => (kind === "bar" ? xBar(i) + barW / 2 : xLine(i));

  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 80))));
  const total = data.reduce((s, d) => s + d.value, 0);
  const summary = `${title} : ${n} jours, ${kind === "bar" ? `total ${format(total)}` : `dernière valeur ${format(data[n - 1]?.value ?? 0)}`}.`;

  const pick = (clientX: number, rect: DOMRect) => {
    const px = clientX - rect.left - ml;
    const i = kind === "bar" ? Math.floor(px / slot) : Math.round((px / Math.max(1, innerW)) * (n - 1));
    setActive(Math.min(n - 1, Math.max(0, i)));
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
    else if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? n) - 1));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(n - 1);
    else if (e.key === "Escape") setActive(null);
    else return;
    e.preventDefault();
  };
  const a = active !== null ? data[active] : undefined;

  return (
    <div>
      <div
        ref={ref} style={{ height: H }} className="relative w-full min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-control" tabIndex={0} aria-describedby={`${id}-s`}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())} onPointerLeave={() => setActive(null)}
        onFocus={() => setActive((x) => x ?? n - 1)} onBlur={() => setActive(null)} onKeyDown={onKey}
      >
        <svg width={width} height={H} role="img" aria-label={summary} className="absolute left-0 top-0 block">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={ml} x2={width - M.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
              <text x={ml - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={MUTED}>{axisFormat(t)}</text>
            </g>
          ))}
          {data.map((p, i) => (i % labelEvery === 0 || i === n - 1) ? (
            <text key={p.label} x={xAt(i)} y={H - 8} textAnchor={kind === "line" && i === n - 1 ? "end" : "middle"} fontSize={11} fill={MUTED}>{dayFmt(p.label)}</text>
          ) : null)}

          {kind === "bar" ? data.map((p, i) => {
            const h = (p.value / max) * innerH;
            return p.value > 0 ? <path key={p.label} d={barPath(xBar(i), y(p.value), barW, h)} fill={MARK} opacity={active === null || active === i ? 1 : 0.55} /> : null;
          }) : n > 0 && (() => {
            const pts = data.map((p, i) => `${xLine(i).toFixed(1)},${y(p.value).toFixed(1)}`);
            const last = n - 1;
            return (
              <>
                <path d={`M${xLine(0)},${y(0)}L${pts.join("L")}L${xLine(last)},${y(0)}Z`} fill={MARK} opacity={0.1} />
                <path d={`M${pts.join("L")}`} fill="none" stroke={MARK} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {active !== null && <line x1={xLine(active)} x2={xLine(active)} y1={M.t} y2={M.t + innerH} stroke={INK2} strokeWidth={1} opacity={0.5} />}
                <circle cx={xLine(active ?? last)} cy={y(data[active ?? last]!.value)} r={6} fill="#fff" />
                <circle cx={xLine(active ?? last)} cy={y(data[active ?? last]!.value)} r={4} fill={MARK} />
              </>
            );
          })()}
        </svg>
        {a && active !== null && <Tooltip x={xAt(active)} y={y(a.value)} width={width} label={dayFmt(a.label)} value={format(a.value)} />}
      </div>
      <p id={`${id}-s`} className="sr-only">{summary} Utilisez les flèches pour parcourir les valeurs.</p>
      <DataTable data={data} valueLabel={valueLabel} format={format} labelFmt={dayFmt} />
    </div>
  );
}

/** Barres horizontales d'une série nominale (types de documents) : même teinte pour toutes les barres, valeur au bout. */
export function CategoryBars({ data, title, valueLabel, unit }: { data: Point[]; title: string; valueLabel: string; unit?: Unit }) {
  const format = formatter(unit);
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  if (data.length === 0) return <p className="text-[13px] text-soft">Aucune donnée sur la période.</p>;
  return (
    <div>
      <ul role="img" aria-label={`${title} : ${data.map((d) => `${d.label} ${format(d.value)}`).join(", ")}`} className="space-y-2.5">
        {data.map((d, i) => (
          <li key={d.label} className="grid grid-cols-[minmax(0,150px)_1fr_auto] items-center gap-3 text-[13px]" onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)}>
            <span className="truncate text-soft">{d.label}</span>
            <span className="relative h-5">
              <span className="absolute inset-y-0.5 left-0 rounded-r-[4px] transition-opacity" style={{ width: `${Math.max(1, (d.value / max) * 100)}%`, maxHeight: 16, background: MARK, opacity: active === null || active === i ? 1 : 0.55 }} />
            </span>
            <span className="w-14 text-right tabular-nums text-fg">{format(d.value)}</span>
          </li>
        ))}
      </ul>
      <DataTable data={data} valueLabel={valueLabel} format={format} labelFmt={(s) => s} />
    </div>
  );
}
