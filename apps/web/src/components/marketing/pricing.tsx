"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { useState } from "react";
import { PLANS } from "@mon-agent-ia/core/plans";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const euro = (cents: number) => (cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });

type Card = { tier: "FREE" | "SOLO" | "FAMILLE"; name: string; blurb: string; features: string[]; cta: string; variant: "secondary" | "primary" | "dark"; featured?: boolean };
const CARDS: Card[] = [
  { tier: "FREE", name: "Gratuit", blurb: "Pour découvrir l'agent.", features: ["5 documents par mois", "Résumés et échéances", "Détection d'économies", "1 profil"], cta: "Commencer", variant: "secondary" },
  { tier: "SOLO", name: "Solo", blurb: "L'assistant de votre quotidien.", features: ["500 documents par mois", "Courriers prêts à envoyer", "Adresse email personnelle", "Agent proactif et rappels"], cta: "Choisir Solo", variant: "primary", featured: true },
  { tier: "FAMILLE", name: "Famille", blurb: "Un espace pour tout le foyer.", features: ["Tout Solo", "Jusqu'à 5 profils", "Permissions par membre", "Espace partagé isolé"], cta: "Choisir Famille", variant: "dark" },
];

export function Pricing() {
  const [yearly, setYearly] = useState(false);
  return (
    <div>
      <div role="group" aria-label="Période de facturation" className="relative mx-auto mb-12 flex w-fit rounded-full border border-line-strong p-1">
        {[false, true].map((y) => (
          <button key={String(y)} type="button" aria-pressed={yearly === y} onClick={() => setYearly(y)} className="relative z-10 rounded-full px-5 py-2 text-[13px] font-medium transition-colors">
            {yearly === y && <motion.span layoutId="billing-pill" className="absolute inset-0 -z-10 rounded-full bg-fg" transition={{ type: "spring", stiffness: 400, damping: 34 }} />}
            <span className={cn(yearly === y ? "text-white" : "text-soft")}>{y ? "Annuel · 2 mois offerts" : "Mensuel"}</span>
          </button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {CARDS.map((c) => {
          const p = PLANS[c.tier];
          const price = yearly ? p.priceCents.year : p.priceCents.month;
          return (
            <motion.div
              key={c.tier}
              whileHover={{ y: -6 }}
              transition={{ type: "spring", stiffness: 300, damping: 24 }}
              className={cn("flex flex-col rounded-[20px] border p-8", c.featured ? "border-fg shadow-lift" : "border-line")}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-[22px]">{c.name}</h3>
                {c.featured && <span className="rounded-full bg-accent-wash px-3 py-1 text-[11px] font-medium text-[#0b5cad]">Le plus choisi</span>}
              </div>
              <p className="mt-1 text-[14px] text-soft">{c.blurb}</p>
              <p className="mt-8 flex items-baseline gap-1.5">
                <span className="font-display text-[56px] font-medium leading-none tracking-tighter">{euro(price)}&nbsp;€</span>
                <span className="text-[14px] text-soft">{price === 0 ? "" : yearly ? "/ an" : "/ mois"}</span>
              </p>
              <ul className="mt-8 flex-1 space-y-3">
                {c.features.map((f) => (
                  <li key={f} className="flex items-start gap-3 text-[14px]"><Check className="mt-0.5 size-4 shrink-0 text-accent-strong" />{f}</li>
                ))}
              </ul>
              <Button href={c.tier === "FREE" ? "/signup" : `/signup?plan=${c.tier.toLowerCase()}&billing=${yearly ? "year" : "month"}`} variant={c.variant} size="lg" className="mt-10 w-full">{c.cta}</Button>
            </motion.div>
          );
        })}
      </div>
      <p className="mt-6 text-center text-[13px] text-soft">Sans engagement. Résiliable à tout moment. Prix TTC.</p>
    </div>
  );
}
