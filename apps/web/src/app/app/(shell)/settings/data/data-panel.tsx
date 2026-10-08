"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert, Input } from "@/components/ui/field";
import { cancelAccountDeletion, eraseHouseholdRecords, requestAccountDeletion, setConsent, type Result } from "@/server/privacy";

type Props = { consents: { sensitive: boolean; ai: boolean; marketing: boolean }; deletion: { at: string; status: string } | null };

export function DataPanel({ consents, deletion }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [erase, setErase] = useState("");
  const [del, setDel] = useState("");
  const [immediate, setImmediate_] = useState(false);

  const run = (fn: () => Promise<Result>) => start(async () => {
    const r = await fn();
    setMsg(r.ok ? { ok: true, text: r.message ?? "C'est fait." } : { ok: false, text: r.error });
    router.refresh();
  });

  async function download() {
    const res = await fetch("/api/account/export", { method: "POST" });
    if (!res.ok) return setMsg({ ok: false, text: (await res.json().catch(() => ({}))).error ?? "Export impossible." });
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url; a.download = "mes-donnees-mon-agent-ia.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const toggles: [string, string, boolean, "SENSITIVE_DATA_PROCESSING" | "AI_PROCESSING" | "MARKETING_EMAIL"][] = [
    ["Traitement de données sensibles", "Nécessaire pour analyser vos documents (santé, finances).", consents.sensitive, "SENSITIVE_DATA_PROCESSING"],
    ["Analyse par intelligence artificielle", "Nécessaire à l'analyse et à la rédaction de courriers.", consents.ai, "AI_PROCESSING"],
    ["Actualités du produit", "Nouveautés occasionnelles par email.", consents.marketing, "MARKETING_EMAIL"],
  ];

  return (
    <div className="space-y-8">
      <div><h1 className="display-md">Mes données</h1><p className="mt-2 text-[15px] text-soft">Vos fichiers ne sont jamais conservés. Voici comment gérer le reste.</p></div>
      {msg && <Alert tone={msg.ok ? "ok" : "danger"}>{msg.text}</Alert>}

      <section className="rounded-[20px] border border-line p-6 sm:p-8">
        <h2 className="text-[20px] tracking-tight">Consentements</h2>
        <ul className="mt-4 divide-y divide-line">
          {toggles.map(([t, d, on, type]) => (
            <li key={type} className="flex items-center gap-4 py-4">
              <div className="flex-1"><p className="text-[15px] font-medium">{t}</p><p className="text-[13px] text-soft">{d}</p></div>
              <Button variant={on ? "secondary" : "primary"} size="sm" disabled={pending} onClick={() => run(() => setConsent({ type, granted: !on }))}>{on ? "Retirer" : "Accorder"}</Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-[20px] border border-line p-6 sm:p-8">
        <h2 className="text-[20px] tracking-tight">Télécharger mes données</h2>
        <p className="mt-1 max-w-[56ch] text-[14px] text-soft">Une archive JSON de ce que nous conservons : compte, consentements, historique de connexion, échéances, économies et actions.</p>
        <div className="mt-5"><Button variant="secondary" onClick={download}>Télécharger l'archive</Button></div>
      </section>

      <section className="rounded-[20px] border border-line p-6 sm:p-8">
        <h2 className="text-[20px] tracking-tight">Effacer les données analysées</h2>
        <p className="mt-1 max-w-[56ch] text-[14px] text-soft">Supprime tous les documents analysés du foyer et ce qui en découle. Votre compte est conservé. Irréversible.</p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Input aria-label="Confirmation" placeholder="Tapez EFFACER" value={erase} onChange={(e) => setErase(e.target.value)} className="max-w-[220px]" />
          <Button variant="danger" disabled={pending || erase !== "EFFACER"} onClick={() => run(() => eraseHouseholdRecords({ confirm: erase }))}>Effacer</Button>
        </div>
      </section>

      <section className="rounded-[20px] border border-danger/30 p-6 sm:p-8">
        <h2 className="text-[20px] tracking-tight">Supprimer mon compte</h2>
        {deletion ? (
          <div className="mt-3 space-y-4">
            <Alert tone="info">{deletion.status === "PROCESSING" ? "Suppression en cours." : `Suppression programmée le ${new Date(deletion.at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}.`}</Alert>
            {deletion.status === "PENDING" && <Button variant="secondary" disabled={pending} onClick={() => run(cancelAccountDeletion)}>Annuler la suppression</Button>}
          </div>
        ) : (
          <>
            <p className="mt-1 max-w-[56ch] text-[14px] text-soft">Supprime définitivement votre compte, vos données et, si vous êtes seul dans le foyer, le foyer et son abonnement. Un délai de 14 jours permet de changer d'avis.</p>
            <label className="mt-4 flex items-center gap-2 text-[13px] text-soft"><input type="checkbox" checked={immediate} onChange={(e) => setImmediate_(e.target.checked)} className="size-4 accent-[#111]" />Supprimer immédiatement, sans délai</label>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Input aria-label="Confirmation" placeholder="Tapez SUPPRIMER" value={del} onChange={(e) => setDel(e.target.value)} className="max-w-[220px]" />
              <Button variant="danger" disabled={pending || del !== "SUPPRIMER"} onClick={() => run(() => requestAccountDeletion({ confirm: del, immediate }))}>Supprimer mon compte</Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
