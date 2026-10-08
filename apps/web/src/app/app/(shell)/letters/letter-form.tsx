"use client";

import { AlertTriangle, Copy, Download, FileText, Lock } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/field";
import { letterToPdf } from "@/lib/letter-pdf";

const KINDS = [
  ["CANCELLATION", "Résiliation"], ["CONTESTATION", "Contestation"], ["COMPLAINT", "Réclamation"],
  ["REFUND_REQUEST", "Demande de remboursement"], ["FORMAL_NOTICE", "Mise en demeure"], ["FREE", "Courrier libre"],
] as const;

type Initial = { kind: string; actionId: string | null; organization: string; topic: string };
type Letter = { subject: string; text: string; disclaimer: string };

/** Coordonnées gardées dans CE navigateur seulement (localStorage), jamais envoyées pour être stockées. */
const KEY = "mai.sender";
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<{ address: string; city: string }>; } catch { return {}; } };

export function LetterForm({ defaultName, included, initial }: { defaultName: string; included: boolean; initial: Initial }) {
  const [kind, setKind] = useState(initial.kind);
  const [organization, setOrganization] = useState(initial.organization);
  const [topic, setTopic] = useState(initial.topic);
  const [note, setNote] = useState("");
  const [fullName, setFullName] = useState(defaultName);
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [reference, setReference] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [letter, setLetter] = useState<Letter | null>(null);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => { const s = read(); if (s.address) { setAddress(s.address); setRemember(true); } if (s.city) setCity(s.city); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      const res = await fetch("/api/letters", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, actionId: initial.actionId ?? undefined, organization: organization || undefined, topic: topic || undefined, note: note || undefined, sender: { fullName, address, city, reference: reference || undefined } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "Rédaction impossible."); return; }
      try { remember ? localStorage.setItem(KEY, JSON.stringify({ address, city })) : localStorage.removeItem(KEY); } catch { /* stockage indisponible : sans conséquence */ }
      setLetter(data); setText(data.text);
    } catch {
      setError("Connexion interrompue. Réessayez.");
    } finally {
      setLoading(false);
    }
  }

  async function pdf() {
    const bytes = await letterToPdf(text);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url; a.download = "courrier.pdf"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (!included) {
    return (
      <div className="rounded-[20px] bg-subtle p-12 text-center">
        <Lock className="mx-auto size-6 text-accent-strong" strokeWidth={1.5} />
        <p className="mt-4 text-[16px] font-medium">La rédaction de courriers est incluse dans les offres Solo et Famille</p>
        <div className="mt-6"><Button href="/#tarifs">Voir les offres</Button></div>
      </div>
    );
  }

  if (letter) {
    return (
      <div className="space-y-5">
        <Alert tone="info">{letter.disclaimer}</Alert>
        <label className="block text-[13px] font-medium" htmlFor="letter-text">Courrier (modifiable)</label>
        <textarea id="letter-text" value={text} onChange={(e) => setText(e.target.value)} rows={22} className="w-full rounded-card border border-line-strong bg-white p-5 font-mono text-[13px] leading-relaxed focus:border-accent focus:outline-none focus:shadow-[0_0_0_4px_rgba(73,168,255,0.18)]" />
        {/\[à compléter\]/.test(text) && <p className="flex items-center gap-2 text-[13px] text-[#b54708]"><AlertTriangle className="size-4" /> Des passages « [à compléter] » restent à renseigner avant l'envoi.</p>}
        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={pdf}><Download className="size-4" /> Télécharger en PDF</Button>
          <Button type="button" variant="secondary" onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }}><Copy className="size-4" /> {copied ? "Copié" : "Copier"}</Button>
          <Button type="button" variant="ghost" onClick={() => setLetter(null)}>Modifier la demande</Button>
        </div>
        <p className="text-[12px] text-faint">Ce courrier n'est pas conservé : fermez cette page et il disparaît. L'envoi reste de votre responsabilité.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Type de courrier" htmlFor="kind">
          <select id="kind" value={kind} onChange={(e) => setKind(e.target.value)} className="h-12 w-full rounded-control border border-line-strong bg-white px-4 text-[15px] focus:border-accent focus:outline-none focus:shadow-[0_0_0_4px_rgba(73,168,255,0.18)]">
            {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Organisme destinataire" htmlFor="org"><Input id="org" value={organization} onChange={(e) => setOrganization(e.target.value)} maxLength={120} placeholder="Opérateur, assurance, administration…" /></Field>
      </div>
      <Field label="Objet de la demande" htmlFor="topic" hint="Une phrase : ce que vous voulez obtenir."><Input id="topic" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={160} placeholder="Résilier mon abonnement avant la hausse" /></Field>
      <Field label="Précisions (facultatif)" htmlFor="note" hint="Faits utiles : dates, échanges précédents. N'indiquez ni IBAN ni numéro de carte."><textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={800} rows={3} className="w-full rounded-control border border-line-strong bg-white p-4 text-[15px] focus:border-accent focus:outline-none focus:shadow-[0_0_0_4px_rgba(73,168,255,0.18)]" /></Field>

      <fieldset className="space-y-5 rounded-card border border-line p-5 sm:p-6">
        <legend className="px-2 text-[13px] font-medium"><FileText className="mr-1.5 inline size-4" /> Vos coordonnées (insérées après la rédaction, jamais envoyées à l'IA)</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Nom et prénom" htmlFor="name"><Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required /></Field>
          <Field label="Ville" htmlFor="city"><Input id="city" value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" required /></Field>
        </div>
        <Field label="Adresse" htmlFor="addr"><textarea id="addr" value={address} onChange={(e) => setAddress(e.target.value)} rows={2} autoComplete="street-address" required className="w-full rounded-control border border-line-strong bg-white p-4 text-[15px] focus:border-accent focus:outline-none focus:shadow-[0_0_0_4px_rgba(73,168,255,0.18)]" /></Field>
        <Field label="Référence client ou contrat (facultatif)" htmlFor="ref"><Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} /></Field>
        <label className="flex cursor-pointer items-start gap-3 text-[13px] text-soft"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-0.5 size-4 accent-[#111]" />Mémoriser mon adresse sur cet appareil uniquement</label>
      </fieldset>

      <div className="flex items-center justify-between gap-4">
        <Link href="/app/actions" className="text-[14px] text-soft underline underline-offset-4">Retour aux actions</Link>
        <Button type="submit" size="lg" loading={loading}>Rédiger le courrier</Button>
      </div>
    </form>
  );
}
