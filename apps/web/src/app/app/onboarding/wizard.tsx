"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Bell, FileText, PenLine, Plus, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/field";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/cn";
import { acceptConsents, finishOnboarding, saveHousehold, saveProfile, type ActionResult } from "@/server/onboarding";

type Member = { displayName: string; relation: "SPOUSE" | "CHILD" | "PARENT" | "OTHER" };
const RELATIONS: { v: Member["relation"]; l: string }[] = [{ v: "SPOUSE", l: "Conjoint(e)" }, { v: "CHILD", l: "Enfant" }, { v: "PARENT", l: "Parent" }, { v: "OTHER", l: "Autre" }];
const STEPS = ["Confidentialité", "Profil", "Foyer", "Prêt"];

export function OnboardingWizard({ initialStep, name, householdName, plan }: { initialStep: number; name: string; householdName: string; plan: "FREE" | "SOLO" | "FAMILLE" }) {
  const router = useRouter();
  const [step, setStep] = useState(initialStep);
  const [dir, setDir] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const [sensitive, setSensitive] = useState(false);
  const [ai, setAi] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [pname, setPname] = useState(name);
  const [tz, setTz] = useState("Europe/Paris");
  const [hname, setHname] = useState(householdName);
  const [members, setMembers] = useState<Member[]>([]);
  const canAddMembers = plan === "FAMILLE";

  const go = (n: number) => { setDir(n > step ? 1 : -1); setStep(n); setError(null); };
  const run = (fn: () => Promise<ActionResult>, next: number) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error);
      if (next > 3) { router.replace("/app"); router.refresh(); return; }
      go(next);
    });

  return (
    <div className="min-h-dvh bg-white">
      <header className="container-x flex h-[68px] items-center justify-between"><Logo href="/app" /><span className="text-[13px] text-soft">Étape {step + 1} sur {STEPS.length}</span></header>
      <div className="mx-auto max-w-[560px] px-6 pb-24 pt-6">
        <div className="mb-12 flex gap-2" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1} aria-label="Progression">
          {STEPS.map((s, i) => (
            <div key={s} className="flex-1">
              <div className="h-1 overflow-hidden rounded-full bg-line"><motion.div className="h-full rounded-full bg-accent" initial={false} animate={{ width: i <= step ? "100%" : "0%" }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }} /></div>
              <p className={cn("mt-2 hidden text-[12px] sm:block", i <= step ? "text-fg" : "text-faint")}>{s}</p>
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait" custom={dir}>
          <motion.div key={step} custom={dir} initial={{ opacity: 0, x: dir * 32 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -32 }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
            {error && <div className="mb-6"><Alert>{error}</Alert></div>}

            {step === 0 && (
              <section>
                <h1 className="display-md">Vos documents, vos règles.</h1>
                <p className="mt-3 text-[15px] text-soft">Pour analyser vos courriers, l'agent traite des informations sensibles (santé, finances). Nous ne le faisons qu'avec votre accord explicite, que vous pouvez retirer à tout moment.</p>
                <div className="mt-8 space-y-3">
                  <Consent checked={sensitive} onChange={setSensitive} title="Traitement de données sensibles" text="J'autorise l'analyse des documents que je transfère, y compris ceux contenant des données de santé ou financières." required />
                  <Consent checked={ai} onChange={setAi} title="Analyse par intelligence artificielle" text="J'autorise l'envoi du contenu de mes documents à un prestataire d'IA situé dans l'Union européenne, sans conservation ni réutilisation." required />
                  <Consent checked={marketing} onChange={setMarketing} title="Actualités du produit" text="Recevoir occasionnellement des nouveautés par email (facultatif)." />
                </div>
                <div className="mt-8 flex justify-end"><Button size="lg" disabled={!sensitive || !ai} loading={pending} onClick={() => run(() => acceptConsents({ sensitive, ai, marketing }), 1)}>Continuer</Button></div>
              </section>
            )}

            {step === 1 && (
              <section>
                <h1 className="display-md">Faisons connaissance.</h1>
                <p className="mt-3 text-[15px] text-soft">Ces informations servent à personnaliser vos courriers et vos rappels.</p>
                <div className="mt-8 space-y-5">
                  <Field label="Votre nom" htmlFor="pname"><Input id="pname" value={pname} onChange={(e) => setPname(e.target.value)} autoComplete="name" /></Field>
                  <Field label="Fuseau horaire" htmlFor="tz" hint="Pour envoyer vos rappels à la bonne heure.">
                    <select id="tz" value={tz} onChange={(e) => setTz(e.target.value)} className="h-12 w-full rounded-control border border-line-strong bg-white px-4 text-[15px] focus:border-accent focus:outline-none focus:shadow-[0_0_0_4px_rgba(73,168,255,0.18)]">
                      <option value="Europe/Paris">France (Paris)</option><option value="Europe/Brussels">Belgique</option><option value="Europe/Zurich">Suisse</option><option value="Europe/Luxembourg">Luxembourg</option><option value="America/Montreal">Québec</option>
                    </select>
                  </Field>
                </div>
                <Nav onBack={() => go(0)} pending={pending} onNext={() => run(() => saveProfile({ name: pname, timezone: tz }), 2)} />
              </section>
            )}

            {step === 2 && (
              <section>
                <h1 className="display-md">Votre foyer.</h1>
                <p className="mt-3 text-[15px] text-soft">Un foyer regroupe les documents partagés. Vous pouvez y ajouter des profils : conjoint, enfants, proches.</p>
                <div className="mt-8 space-y-5">
                  <Field label="Nom du foyer" htmlFor="hname"><Input id="hname" value={hname} onChange={(e) => setHname(e.target.value)} /></Field>
                  {canAddMembers ? (
                    <div className="space-y-3">
                      <p className="text-[13px] font-medium">Profils</p>
                      {members.map((m, i) => (
                        <div key={i} className="flex gap-2">
                          <Input aria-label="Prénom" placeholder="Prénom" value={m.displayName} onChange={(e) => setMembers(members.map((x, j) => (j === i ? { ...x, displayName: e.target.value } : x)))} />
                          <select aria-label="Lien" value={m.relation} onChange={(e) => setMembers(members.map((x, j) => (j === i ? { ...x, relation: e.target.value as Member["relation"] } : x)))} className="h-12 rounded-control border border-line-strong bg-white px-3 text-[14px]">
                            {RELATIONS.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
                          </select>
                          <button type="button" aria-label="Retirer" onClick={() => setMembers(members.filter((_, j) => j !== i))} className="grid size-12 shrink-0 place-items-center rounded-control border border-line-strong hover:bg-muted"><X className="size-4" /></button>
                        </div>
                      ))}
                      {members.length < 4 && <Button type="button" variant="secondary" size="sm" onClick={() => setMembers([...members, { displayName: "", relation: "SPOUSE" }])}><Plus className="size-4" /> Ajouter un profil</Button>}
                    </div>
                  ) : (
                    <div className="rounded-card bg-subtle p-5 text-[14px] text-soft">Votre offre inclut un profil. Les profils supplémentaires (conjoint, enfants) font partie de l'offre <Link href="/#tarifs" className="font-medium text-fg underline">Famille</Link>.</div>
                  )}
                </div>
                <Nav onBack={() => go(1)} pending={pending} onNext={() => run(() => saveHousehold({ householdName: hname, members: members.filter((m) => m.displayName.trim()) }), 3)} />
              </section>
            )}

            {step === 3 && (
              <section>
                <h1 className="display-md">Tout est prêt.</h1>
                <p className="mt-3 text-[15px] text-soft">Voici ce que votre agent fera pour vous.</p>
                <ul className="mt-8 space-y-3">
                  {[[FileText, "Il lit vos documents", "Dès qu'ils arrivent, il extrait montants, dates et échéances."], [Bell, "Il vous prévient", "Des rappels avant chaque date limite, par email et dans l'application."], [Sparkles, "Il propose, vous décidez", "Économies, résiliations, contestations : prêts à valider."], [PenLine, "Il prépare vos courriers", "Rien n'est envoyé sans votre accord."]].map(([I, t, d]) => {
                    const Icon = I as typeof Bell;
                    return (
                      <li key={t as string} className="flex items-start gap-4 rounded-card border border-line p-4">
                        <span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-muted"><Icon className="size-4" /></span>
                        <div><p className="text-[15px] font-medium">{t as string}</p><p className="text-[13px] text-soft">{d as string}</p></div>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-8 flex items-center justify-between">
                  <button type="button" onClick={() => go(2)} className="inline-flex items-center gap-2 text-[14px] text-soft hover:text-fg"><ArrowLeft className="size-4" /> Retour</button>
                  <Button size="lg" loading={pending} onClick={() => run(finishOnboarding, 4)} magnetic>Accéder à mon espace</Button>
                </div>
              </section>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function Nav({ onBack, onNext, pending }: { onBack: () => void; onNext: () => void; pending: boolean }) {
  return (
    <div className="mt-8 flex items-center justify-between">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-[14px] text-soft hover:text-fg"><ArrowLeft className="size-4" /> Retour</button>
      <Button size="lg" loading={pending} onClick={onNext}>Continuer</Button>
    </div>
  );
}

function Consent({ checked, onChange, title, text, required }: { checked: boolean; onChange: (v: boolean) => void; title: string; text: string; required?: boolean }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-4 rounded-card border p-5 transition-colors duration-300", checked ? "border-fg bg-subtle" : "border-line hover:border-line-strong")}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 size-4 accent-[#111]" />
      <span><span className="block text-[15px] font-medium">{title}{required && <span className="ml-1 text-danger" aria-label="obligatoire">*</span>}</span><span className="mt-0.5 block text-[13px] text-soft">{text}</span></span>
    </label>
  );
}
