"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CalendarClock, Download, FileUp, Loader2, PiggyBank, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type Record_ = {
  kind: string; title: string; organization: string | null; amountCents: number | null; urgencyScore: number;
  deadlines: { kind: string; title: string; dueDate: string; amountCents: number | null }[];
  savings: { title: string; rationale: string; monthlyCents: number; annualCents: number }[];
  actions: { type: string; title: string; rationale: string; priority: number }[];
};
type Result = {
  name: string; record: Record_;
  display: { summary: string; keyPoints: string[]; risks: { label: string; severity: "low" | "medium" | "high" }[] };
  saved: { deadlines: number; savings: number; actions: number; reminders: number };
};
type Item = { id: number; name: string; state: "pending" | "running" | "done" | "error"; result?: Result; error?: string; forLabel?: string };
export type Person = { id: string; label: string; isYou: boolean };

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.docx,application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const euro = (c: number) => (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: c % 100 ? 2 : 0 });
const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Résumé téléchargeable : l'utilisateur le garde chez lui, nous ne le conservons pas. */
function toText(r: Result): string {
  const L = [`${r.record.title}${r.record.organization ? ` — ${r.record.organization}` : ""}`, "", r.display.summary, ""];
  if (r.display.keyPoints.length) L.push("Points clés", ...r.display.keyPoints.map((k) => `- ${k}`), "");
  if (r.record.deadlines.length) L.push("Échéances", ...r.record.deadlines.map((d) => `- ${day(d.dueDate)} : ${d.title}`), "");
  if (r.record.savings.length) L.push("Économies", ...r.record.savings.map((s) => `- ${s.title} (${euro(s.annualCents)} par an) : ${s.rationale}`), "");
  if (r.record.actions.length) L.push("Actions proposées", ...r.record.actions.map((a) => `- ${a.title} : ${a.rationale}`), "");
  if (r.display.risks.length) L.push("Points d'attention", ...r.display.risks.map((k) => `- ${k.label}`), "");
  return L.join("\n");
}
function download(r: Result) {
  const url = URL.createObjectURL(new Blob([toText(r)], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = "analyse.txt"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Analyzer({ people = [] }: { people?: Person[] }) {
  const [items, setItems] = useState<Item[]>([]);
  const [profileId, setProfileId] = useState("");
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const busy = useRef(false);
  const queue = useRef<{ id: number; file: File; profileId: string }[]>([]);

  const patch = (id: number, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const pump = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    while (queue.current.length) {
      const { id, file, profileId: forProfile } = queue.current.shift()!;
      patch(id, { state: "running" });
      try {
        const fd = new FormData();
        fd.append("file", file);
        if (forProfile) fd.append("profileId", forProfile); // facultatif : le serveur vérifie qu'il appartient au foyer
        const res = await fetch("/api/analyze", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) patch(id, { state: "error", error: data.error ?? "Analyse impossible." });
        else patch(id, { state: "done", result: { name: file.name, record: data.record, display: data.display, saved: data.saved } });
      } catch {
        patch(id, { state: "error", error: "Connexion interrompue. Réessayez." });
      }
    }
    busy.current = false;
  }, []);

  const add = (files: FileList | File[]) => {
    const list = Array.from(files).slice(0, 10);
    const person = people.find((p) => p.id === profileId);
    const added = list.map((file) => ({ id: ++seq.current, file, profileId }));
    setItems((xs) => [...added.map(({ id, file }) => ({ id, name: file.name, state: "pending" as const, forLabel: person?.label })), ...xs]);
    queue.current.push(...added);
    void pump();
  };

  return (
    <div>
      {people.length >= 2 && (
        <div className="mb-6 max-w-sm">
          <label htmlFor="doc-profile" className="mb-2 block text-[13px] font-medium">Pour qui est ce document ? <span className="font-normal text-soft">(facultatif)</span></label>
          <select
            id="doc-profile" value={profileId} onChange={(e) => setProfileId(e.target.value)}
            className="h-12 w-full rounded-control border border-line-strong bg-white px-4 text-[15px] focus:border-accent focus:outline-none focus:shadow-[0_0_0_4px_rgba(73,168,255,0.18)]"
          >
            <option value="">Non précisé</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.label}{p.isYou ? " (vous)" : ""}</option>)}
          </select>
        </div>
      )}
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) add(e.dataTransfer.files); }}
        className={cn("relative rounded-[24px] border-2 border-dashed p-10 text-center transition-all duration-300 sm:p-16", over ? "scale-[1.01] border-accent bg-accent-wash" : "border-line-strong bg-subtle hover:border-faint")}
      >
        <motion.div animate={over ? { y: -4 } : { y: 0 }} className="mx-auto grid size-14 place-items-center rounded-full bg-white shadow-soft"><FileUp className="size-6" strokeWidth={1.5} /></motion.div>
        <p className="mt-6 text-[20px] font-medium tracking-tight">Glissez vos documents ici</p>
        <p className="mt-1 text-[14px] text-soft">PDF, photo (JPEG, PNG) ou Word · 20 Mo maximum · 10 fichiers à la fois</p>
        <div className="mt-6"><Button type="button" onClick={() => input.current?.click()}>Choisir des fichiers</Button></div>
        <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ""; }} aria-label="Choisir des fichiers à analyser" />
        <p className="mx-auto mt-6 flex max-w-[52ch] items-center justify-center gap-2 text-[12px] text-faint"><ShieldCheck className="size-3.5 shrink-0" /> Le fichier n'est ni enregistré ni conservé : il est analysé en mémoire puis oublié.</p>
      </div>

      <ul className="mt-8 space-y-4" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map((it) => (
            <motion.li key={it.id} layout initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} className="rounded-[20px] border border-line p-5 sm:p-7">
              <div className="flex items-center gap-3">
                {it.state === "running" || it.state === "pending" ? <Loader2 className="size-4 animate-spin text-accent-strong" /> : it.state === "error" ? <AlertTriangle className="size-4 text-danger" /> : <Sparkles className="size-4 text-accent-strong" />}
                <p className="min-w-0 flex-1 truncate text-[14px] font-medium">{it.name}{it.forLabel && <span className="ml-2 font-normal text-soft">· pour {it.forLabel}</span>}</p>
                <span className="text-[12px] text-soft">{it.state === "pending" ? "En attente" : it.state === "running" ? "Analyse en cours…" : it.state === "error" ? "Échec" : "Terminé"}</span>
              </div>
              {it.state === "error" && <p role="alert" className="mt-3 text-[14px] text-danger">{it.error}</p>}
              {it.result && <ResultView r={it.result} />}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}

function ResultView({ r }: { r: Result }) {
  const { record: a } = r;
  const total = a.savings.reduce((n, s) => n + s.annualCents, 0);
  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-[24px] tracking-tight">{a.title}</h3>
          <p className="text-[14px] text-soft">{[a.organization, a.amountCents != null ? euro(a.amountCents) : null].filter(Boolean).join(" · ") || "Organisme non identifié"}</p>
        </div>
        <div className="text-right"><p className="text-[12px] text-soft">Urgence</p>
          <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-line"><div className={cn("h-full rounded-full", a.urgencyScore >= 70 ? "bg-danger" : a.urgencyScore >= 40 ? "bg-[#f79009]" : "bg-ok")} style={{ width: `${a.urgencyScore}%` }} /></div>
        </div>
      </div>

      {total > 0 && (
        <div className="flex items-center gap-4 rounded-card bg-fg p-5 text-white">
          <PiggyBank className="size-6 shrink-0 text-accent" strokeWidth={1.5} />
          <p className="text-[16px] font-medium">J'ai détecté {euro(total)} d'économies potentielles par an. Souhaitez-vous préparer les démarches ?</p>
        </div>
      )}

      <p className="text-[15px] leading-relaxed">{r.display.summary}</p>
      {r.display.keyPoints.length > 0 && <ul className="list-disc space-y-1 pl-5 text-[14px] text-soft">{r.display.keyPoints.map((k, i) => <li key={i}>{k}</li>)}</ul>}

      {r.display.risks.length > 0 && (
        <div className="space-y-2">{r.display.risks.map((k, i) => (
          <p key={i} className={cn("flex items-start gap-2 rounded-control px-4 py-3 text-[13px]", k.severity === "high" ? "bg-danger-wash text-danger" : "bg-muted text-soft")}><AlertTriangle className="mt-0.5 size-4 shrink-0" />{k.label}</p>
        ))}</div>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        {a.deadlines.length > 0 && (
          <div><p className="mb-2 flex items-center gap-2 text-[13px] font-medium"><CalendarClock className="size-4" /> Échéances ajoutées</p>
            <ul className="divide-y divide-line rounded-card border border-line">{a.deadlines.map((d, i) => <li key={i} className="flex justify-between gap-3 px-4 py-3 text-[13px]"><span>{d.title}</span><span className="shrink-0 text-soft">{day(d.dueDate)}</span></li>)}</ul></div>
        )}
        {a.actions.length > 0 && (
          <div><p className="mb-2 flex items-center gap-2 text-[13px] font-medium"><Sparkles className="size-4" /> Actions proposées</p>
            <ul className="divide-y divide-line rounded-card border border-line">{a.actions.map((x, i) => <li key={i} className="px-4 py-3 text-[13px]"><p className="font-medium">{x.title}</p><p className="text-soft">{x.rationale}</p></li>)}</ul></div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        <p className="max-w-[56ch] text-[12px] text-faint">Conservé pour vos rappels : organisme, nature, montant, échéances et économies. Ce résumé n'est pas conservé : téléchargez-le si vous voulez le garder.</p>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => download(r)}><Download className="size-4" /> Télécharger le résumé</Button>
          <Button href="/app/actions" variant="dark" size="sm">Voir mes actions</Button>
        </div>
      </div>
      <Link href="/app/documents" className="sr-only">Voir les documents analysés</Link>
    </div>
  );
}
