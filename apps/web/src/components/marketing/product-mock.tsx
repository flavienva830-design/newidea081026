"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, Check, FileText, Mail, PiggyBank } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";

const ACTIONS = [
  { id: "a", icon: PiggyBank, title: "Abonnement internet : +6 €/mois depuis octobre", sub: "Geste commercial ou résiliation — courrier prêt", tag: "72 €/an", tone: "accent" },
  { id: "b", icon: FileText, title: "Courrier de la mutuelle : réponse avant le 14", sub: "Résumé en 3 lignes, brouillon de réponse", tag: "Urgent", tone: "dark" },
  { id: "c", icon: Mail, title: "Salle de sport : préavis de 30 jours", sub: "Résiliation à envoyer avant le 02/12", tag: "34 €/mois", tone: "plain" },
] as const;

/** Maquette interactive du produit (données d'exemple, signalées comme telles). */
export function ProductMock() {
  const reduce = useReducedMotion();
  const [done, setDone] = useState<string[]>([]);
  return (
    <div className="overflow-hidden rounded-[20px] border border-line bg-white shadow-lift">
      <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
        <span className="size-2.5 rounded-full bg-line-strong" /><span className="size-2.5 rounded-full bg-line-strong" /><span className="size-2.5 rounded-full bg-line-strong" />
        <span className="ml-3 text-[12px] text-faint">app.monagentia.com</span>
      </div>
      <div className="grid gap-0 md:grid-cols-[210px_1fr]">
        <aside className="hidden border-r border-line bg-subtle p-4 md:block">
          {["Tableau de bord", "Documents", "Échéances", "Économies", "Courriers", "Famille"].map((l, i) => (
            <div key={l} className={cn("rounded-[10px] px-3 py-2 text-[13px]", i === 0 ? "bg-white font-medium shadow-soft" : "text-soft")}>{l}</div>
          ))}
        </aside>
        <div className="p-5 sm:p-7">
          <div className="grid grid-cols-3 gap-3">
            {[["À traiter", "4"], ["Échéances 30 j", "7"], ["Économies / an", "312 €"]].map(([k, v]) => (
              <div key={k} className="rounded-[14px] border border-line p-3.5 sm:p-4">
                <p className="text-[11px] text-soft sm:text-[12px]">{k}</p>
                <p className="mt-1 font-display text-[22px] font-medium tracking-tight sm:text-[30px]">{v}</p>
              </div>
            ))}
          </div>
          <p className="mb-3 mt-7 text-[13px] font-medium">Actions recommandées</p>
          <div className="space-y-2.5">
            {ACTIONS.map((a, i) => {
              const ok = done.includes(a.id);
              return (
                <motion.div
                  key={a.id}
                  initial={reduce ? false : { opacity: 0, x: 16 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ duration: 0.8, delay: i * 0.12, ease: [0.16, 1, 0.3, 1] }}
                  className={cn("flex items-center gap-3 rounded-[14px] border p-3.5 transition-colors duration-500", ok ? "border-[#abefc6] bg-[#f6fef9]" : "border-line hover:border-line-strong")}
                >
                  <span className={cn("grid size-10 shrink-0 place-items-center rounded-[11px]", ok ? "bg-ok text-white" : "bg-muted")}>
                    {ok ? <Check className="size-4" /> : <a.icon className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{a.title}</p>
                    <p className="truncate text-[12px] text-soft">{ok ? "Courrier préparé : à valider avant envoi" : a.sub}</p>
                  </div>
                  <span className={cn("hidden rounded-full px-2.5 py-1 text-[11px] font-medium sm:inline", a.tone === "accent" ? "bg-accent-wash text-[#0b5cad]" : a.tone === "dark" ? "bg-fg text-white" : "bg-muted text-soft")}>{a.tag}</span>
                  <button
                    type="button"
                    onClick={() => setDone((d) => (d.includes(a.id) ? d : [...d, a.id]))}
                    className="grid size-9 shrink-0 place-items-center rounded-full border border-line-strong transition-colors hover:border-fg hover:bg-fg hover:text-white"
                    aria-label={`Préparer la démarche : ${a.title}`}
                  >
                    <ArrowUpRight className="size-4" />
                  </button>
                </motion.div>
              );
            })}
          </div>
          <p className="mt-5 text-[11px] text-faint">Aperçu illustratif — données d'exemple.</p>
        </div>
      </div>
    </div>
  );
}
