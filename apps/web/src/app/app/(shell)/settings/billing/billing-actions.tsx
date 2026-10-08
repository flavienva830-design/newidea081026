"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { PLANS } from "@mon-agent-ia/core/plans";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/field";
import { cn } from "@/lib/cn";

const euro = (c: number) => (c / 100).toLocaleString("fr-FR", { minimumFractionDigits: c % 100 ? 2 : 0 });

export function BillingActions({ plan, hasCustomer, configured }: { plan: "FREE" | "SOLO" | "FAMILLE"; hasCustomer: boolean; configured: boolean }) {
  const [interval, setInterval_] = useState<"month" | "year">("month");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go(path: string, body: unknown, key: string) {
    setError(null); setBusy(key);
    try {
      const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) { setError(data.error ?? "Opération impossible."); return; }
      window.location.href = data.url;
    } catch {
      setError("Connexion interrompue. Réessayez.");
    } finally {
      setBusy(null);
    }
  }

  if (!configured) return <Alert tone="info">Le paiement en ligne sera disponible très prochainement.</Alert>;

  if (plan !== "FREE") {
    return (
      <section className="rounded-[20px] border border-line p-6 sm:p-8">
        <h2 className="text-[20px] tracking-tight">Gérer l'abonnement</h2>
        <p className="mt-1 max-w-[56ch] text-[14px] text-soft">Changer d'offre, mettre à jour votre moyen de paiement, télécharger vos factures ou résilier : tout se fait depuis le portail sécurisé de notre prestataire de paiement.</p>
        {error && <div className="mt-4"><Alert>{error}</Alert></div>}
        <div className="mt-6"><Button loading={busy === "portal"} onClick={() => go("/api/billing/portal", {}, "portal")}>Ouvrir le portail</Button></div>
      </section>
    );
  }

  return (
    <section className="rounded-[20px] border border-line p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-[20px] tracking-tight">Passer à une offre payante</h2>
        <div role="group" aria-label="Période de facturation" className="flex rounded-full border border-line-strong p-1">
          {(["month", "year"] as const).map((i) => (
            <button key={i} type="button" aria-pressed={interval === i} onClick={() => setInterval_(i)} className={cn("rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors", interval === i ? "bg-fg text-white" : "text-soft")}>{i === "month" ? "Mensuel" : "Annuel · 2 mois offerts"}</button>
          ))}
        </div>
      </div>
      {error && <div className="mt-4"><Alert>{error}</Alert></div>}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {(["SOLO", "FAMILLE"] as const).map((p) => (
          <div key={p} className="rounded-card border border-line p-6">
            <p className="text-[18px] font-medium tracking-tight">{p === "SOLO" ? "Solo" : "Famille"}</p>
            <p className="mt-3 font-display text-[36px] font-medium leading-none tracking-tight">{euro(PLANS[p].priceCents[interval])}&nbsp;€<span className="text-[13px] text-soft"> / {interval === "month" ? "mois" : "an"}</span></p>
            <ul className="mt-5 space-y-2 text-[13px] text-soft">
              <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-accent-strong" />{PLANS[p].documentsPerMonth} documents par mois</li>
              <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-accent-strong" />{PLANS[p].lettersPerMonth} courriers par mois</li>
              <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-accent-strong" />{PLANS[p].profiles === 1 ? "1 profil" : `Jusqu'à ${PLANS[p].profiles} profils`}</li>
            </ul>
            <div className="mt-6"><Button className="w-full" loading={busy === p} variant={p === "SOLO" ? "primary" : "dark"} onClick={() => go("/api/billing/checkout", { plan: p, interval }, p)}>Choisir {p === "SOLO" ? "Solo" : "Famille"}</Button></div>
          </div>
        ))}
      </div>
      <p className="mt-5 text-[12px] text-faint">Paiement sécurisé par notre prestataire. Résiliable à tout moment. {hasCustomer ? "" : "Vous serez redirigé vers la page de paiement."}</p>
    </section>
  );
}
