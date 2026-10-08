import type { Metadata } from "next";
import { CalendarClock, Check, FileText, PenLine, PiggyBank, ShieldCheck, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { loadDashboard } from "@/server/dashboard";
import { requireTenant } from "@/server/session";
import { Reveal } from "@/components/ui/reveal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Tableau de bord" };

const euro = (c: number) => (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const day = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

export default async function DashboardPage() {
  const { session, tenant } = await requireTenant();
  const [data, user] = await Promise.all([
    loadDashboard(db(), tenant),
    db().user.findUniqueOrThrow({ where: { id: session.user.id }, select: { twoFactorEnabled: true } }),
  ]);
  const first = session.user.name.split(" ")[0];

  const kpis = [
    { label: "Documents analysés", value: String(data.documents), icon: FileText },
    { label: "Actions à réaliser", value: String(data.actionsToDo), icon: Sparkles },
    { label: "Échéances à 30 jours", value: String(data.deadlines30d), icon: CalendarClock },
    { label: "Économies détectées / an", value: euro(data.savingsAnnualCents), icon: PiggyBank },
    { label: "Courriers générés", value: String(data.lettersGenerated), icon: PenLine },
  ];
  const checklist = [
    { label: "Créer votre espace", done: true },
    { label: "Sécuriser le compte (double authentification)", done: user.twoFactorEnabled, href: "/app/settings/security" },
    { label: "Ajouter votre premier document", done: data.documents > 0, soon: true },
    { label: "Inviter un proche", done: false, soon: true },
  ];

  return (
    <div className="mx-auto max-w-[1100px]">
      <Reveal><h1 className="display-md">Bonjour {first}.</h1><p className="mt-2 text-[16px] text-soft">Voici l'état de votre administratif.</p></Reveal>

      <div className="mt-10 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {kpis.map((k, i) => (
          <Reveal key={k.label} delay={i * 0.05} y={14}>
            <div className="h-full rounded-card border border-line p-5 transition-shadow duration-300 hover:shadow-soft">
              <k.icon className="size-4 text-faint" strokeWidth={1.7} />
              <p className="mt-4 font-display text-[34px] font-medium leading-none tracking-tight">{k.value}</p>
              <p className="mt-2 text-[12px] text-soft">{k.label}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Reveal>
          <section className="rounded-[20px] border border-line p-6 sm:p-8">
            <h2 className="text-[22px] tracking-tight">Actions recommandées</h2>
            {data.topActions.length === 0 ? (
              <div className="mt-6 rounded-card bg-subtle p-8 text-center">
                <Sparkles className="mx-auto size-6 text-accent-strong" strokeWidth={1.5} />
                <p className="mt-4 text-[15px] font-medium">Aucune action pour le moment</p>
                <p className="mx-auto mt-1 max-w-[40ch] text-[14px] text-soft">Dès que vous transférerez un document, l'agent détectera les échéances, les hausses de tarif et les économies possibles, puis oubliera le fichier.</p>
              </div>
            ) : (
              <ul className="mt-6 divide-y divide-line">
                {data.topActions.map((a) => (
                  <li key={a.id} className="py-4"><p className="text-[15px] font-medium">{a.title}</p><p className="text-[13px] text-soft">{a.rationale}</p></li>
                ))}
              </ul>
            )}
          </section>
        </Reveal>

        <div className="space-y-6">
          <Reveal delay={0.08}>
            <section className="rounded-[20px] border border-line p-6">
              <h2 className="text-[18px] tracking-tight">Premiers pas</h2>
              <ul className="mt-5 space-y-3.5">
                {checklist.map((c) => (
                  <li key={c.label} className="flex items-center gap-3 text-[14px]">
                    <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border", c.done ? "border-ok bg-ok text-white" : "border-line-strong")}>{c.done && <Check className="size-3" />}</span>
                    <span className={cn("flex-1", c.done && "text-soft line-through")}>{c.label}</span>
                    {!c.done && c.href && <Button href={c.href} variant="secondary" size="sm">Faire</Button>}
                    {!c.done && c.soon && <span className="text-[11px] text-faint">Bientôt</span>}
                  </li>
                ))}
              </ul>
            </section>
          </Reveal>
          <Reveal delay={0.12}>
            <section className="rounded-[20px] border border-line p-6">
              <h2 className="text-[18px] tracking-tight">Prochaines échéances</h2>
              {data.nextDeadlines.length === 0 ? <p className="mt-4 text-[14px] text-soft">Aucune échéance à venir.</p> : (
                <ul className="mt-4 divide-y divide-line">
                  {data.nextDeadlines.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 py-3 text-[14px]"><span className="truncate">{d.title}</span><span className="shrink-0 text-soft">{day(d.dueDate)}</span></li>
                  ))}
                </ul>
              )}
            </section>
          </Reveal>
          <Reveal delay={0.16}>
            <section className="flex items-start gap-3 rounded-[20px] bg-subtle p-6 text-[13px] text-soft">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent-strong" /> <p>Vos fichiers ne sont jamais conservés. Aucun courrier n'est envoyé sans votre validation.</p>
            </section>
          </Reveal>
        </div>
      </div>
    </div>
  );
}
