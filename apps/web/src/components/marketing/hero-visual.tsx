"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { FileText, Sparkles, TrendingDown, CalendarClock } from "lucide-react";
import { useRef } from "react";

/**
 * Objet signature : un flux de documents qui se transforme en information.
 * Rubans translucides (bleu → blanc) + cartes flottantes. SVG pur : aucun WebGL, aucun poids ajouté.
 */
type Curve = number[]; // M x0 y0 C x1 y1 x2 y2 x3 y3 S x4 y4 x5 y5

const lerp = (a: Curve, b: Curve, t: number) => a.map((v, i) => v + (b[i]! - v) * t);
const toPath = (c: Curve) => `M${c[0]} ${c[1]} C${c[2]} ${c[3]} ${c[4]} ${c[5]} ${c[6]} ${c[7]} S${c[8]} ${c[9]} ${c[10]} ${c[11]}`;

/** Nappe de fils de soie : N courbes interpolées entre deux courbes de bord (effet « ruban » sans WebGL). */
function Silk({ from, to, count, hue, delay, opacity = 1 }: { from: Curve; to: Curve; count: number; hue: "blue" | "ink"; delay: number; opacity?: number }) {
  const reduce = useReducedMotion();
  return (
    <g>
      {Array.from({ length: count }, (_, i) => {
        const t = i / (count - 1);
        const edge = 1 - Math.abs(t - 0.5) * 2; // plus lumineux au centre de la nappe
        return (
          <motion.path
            key={i}
            d={toPath(lerp(from, to, t))}
            fill="none"
            stroke={hue === "blue" ? "url(#silk-blue)" : "url(#silk-ink)"}
            strokeWidth={hue === "blue" ? 1.2 + edge * 1.2 : 1}
            strokeLinecap="round"
            strokeOpacity={(0.22 + edge * 0.7) * opacity}
            initial={reduce ? false : { pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 2.4, delay: delay + i * 0.025, ease: [0.16, 1, 0.3, 1] }}
          />
        );
      })}
    </g>
  );
}

export function HeroVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const yRibbon = useTransform(scrollYProgress, [0, 1], [0, 90]);
  const yCards = useTransform(scrollYProgress, [0, 1], [0, -50]);

  return (
    <div ref={ref} aria-hidden className="relative h-[460px] w-full sm:h-[560px] lg:h-[680px]">
      <div className="absolute left-[10%] top-[28%] size-[70%] rounded-full bg-[radial-gradient(closest-side,rgba(73,168,255,0.22),transparent)] blur-2xl" />
      <motion.svg style={{ y: yRibbon }} viewBox="0 0 800 680" className="absolute inset-0 size-full overflow-visible">
        <defs>
          <linearGradient id="silk-blue" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#49a8ff" stopOpacity="0" />
            <stop offset="0.25" stopColor="#49a8ff" />
            <stop offset="0.7" stopColor="#1f8bef" />
            <stop offset="1" stopColor="#bfe0ff" stopOpacity="0.2" />
          </linearGradient>
          <linearGradient id="silk-ink" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#111" stopOpacity="0" />
            <stop offset="0.5" stopColor="#111" />
            <stop offset="1" stopColor="#111" stopOpacity="0" />
          </linearGradient>
        </defs>
        <Silk from={[-60, 600, 140, 600, 250, 250, 440, 250, 660, 250, 880, 40]} to={[-60, 300, 200, 330, 320, 600, 480, 590, 700, 570, 880, 380]} count={56} hue="blue" delay={0.1} />
        <Silk from={[-60, 640, 220, 650, 320, 500, 500, 460, 720, 430, 880, 520]} to={[-60, 480, 260, 520, 360, 330, 540, 290, 720, 230, 880, 180]} count={30} hue="ink" delay={0.5} opacity={0.35} />
      </motion.svg>

      <motion.div style={{ y: yCards }} className="absolute inset-0">
        <FloatCard className="left-[2%] top-[8%] w-[210px]" delay={0.9} drift={0}>
          <Row icon={<FileText className="size-4" />} title="Facture énergie" meta="Reçue il y a 2 min" />
        </FloatCard>
        <FloatCard className="right-[2%] top-[18%] w-[250px]" delay={1.2} drift={1}>
          <Row tone="accent" icon={<TrendingDown className="size-4" />} title="Hausse détectée" meta="+6 €/mois · 72 €/an" />
        </FloatCard>
        <FloatCard className="left-[8%] bottom-[12%] w-[245px]" delay={1.5} drift={2}>
          <Row icon={<CalendarClock className="size-4" />} title="Résiliation avant le 15 nov." meta="Courrier prêt à valider" />
        </FloatCard>
        <FloatCard className="right-[4%] bottom-[2%] w-[235px]" delay={1.8} drift={3} dark>
          <div className="flex items-center gap-2 text-[12px] text-white/70"><Sparkles className="size-3.5 text-accent" /> Agent</div>
          <p className="mt-1.5 text-[14px] font-medium leading-snug text-white">137 € d'économies potentielles. Préparer les démarches ?</p>
        </FloatCard>
      </motion.div>
    </div>
  );
}

function FloatCard({ children, className, delay, drift, dark }: {
  children: React.ReactNode; className: string; delay: number; drift: number; dark?: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 28, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 1, delay, ease: [0.16, 1, 0.3, 1] }}
      className={`absolute ${className}`}
    >
      <div
        style={reduce ? undefined : { animation: `float-slow ${6 + drift}s ease-in-out ${drift * -1.3}s infinite` }}
        className={`rounded-[16px] border p-3.5 shadow-lift backdrop-blur-xl ${dark ? "border-white/10 bg-[#111]/92" : "border-white/70 bg-white/85"}`}
      >
        {children}
      </div>
    </motion.div>
  );
}

function Row({ icon, title, meta, tone }: { icon: React.ReactNode; title: string; meta: string; tone?: "accent" }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`grid size-9 shrink-0 place-items-center rounded-[10px] ${tone === "accent" ? "bg-accent text-fg" : "bg-muted text-fg"}`}>{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium leading-tight text-fg">{title}</p>
        <p className="truncate text-[12px] text-soft">{meta}</p>
      </div>
    </div>
  );
}
