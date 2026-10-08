import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/server/session";
import { MfaPanel } from "./mfa-panel";
import { SessionsPanel } from "./sessions-panel";

export const metadata: Metadata = { title: "Sécurité" };

export default async function SecurityPage() {
  const session = await requireSession();
  const [user, events] = await Promise.all([
    db().user.findUniqueOrThrow({ where: { id: session.user.id }, select: { twoFactorEnabled: true, email: true } }),
    db().loginEvent.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: "desc" }, take: 12, select: { id: true, createdAt: true, success: true, country: true, userAgent: true, suspicious: true, method: true } }),
  ]);

  return (
    <div className="mx-auto max-w-[760px] space-y-10">
      <div><h1 className="display-md">Sécurité</h1><p className="mt-2 text-[15px] text-soft">Protégez l'accès à vos documents.</p></div>

      <MfaPanel enabled={user.twoFactorEnabled} />
      <SessionsPanel currentToken={session.session.token} />

      <section className="rounded-[20px] border border-line p-6 sm:p-8">
        <h2 className="text-[20px] tracking-tight">Activité de connexion</h2>
        <p className="mt-1 text-[14px] text-soft">Les 12 dernières connexions à votre compte. Si vous ne reconnaissez pas l'une d'elles, changez votre mot de passe.</p>
        <ul className="mt-5 divide-y divide-line">
          {events.length === 0 && <li className="py-4 text-[14px] text-soft">Aucune activité enregistrée.</li>}
          {events.map((e) => (
            <li key={e.id} className="flex items-center gap-4 py-3.5 text-[14px]">
              {e.success ? <CheckCircle2 className="size-4 shrink-0 text-ok" /> : <AlertTriangle className="size-4 shrink-0 text-danger" />}
              <div className="min-w-0 flex-1">
                <p className="truncate">{e.success ? "Connexion réussie" : "Tentative échouée"}{e.country ? ` · ${e.country}` : ""}{e.suspicious ? " · inhabituelle" : ""}</p>
                <p className="truncate text-[12px] text-faint">{e.userAgent ?? "Appareil inconnu"}</p>
              </div>
              <time dateTime={e.createdAt.toISOString()} className="shrink-0 text-[12px] text-soft">{e.createdAt.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</time>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
