"use client";

import { useCallback, useEffect, useState } from "react";
import { Laptop } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

type S = { token: string; userAgent?: string | null; ipAddress?: string | null; createdAt: Date | string };

export function SessionsPanel({ currentToken }: { currentToken: string }) {
  const [sessions, setSessions] = useState<S[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await authClient.listSessions();
    setSessions((res.data as S[] | null) ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function revoke(token: string) { setBusy(true); await authClient.revokeSession({ token }); await load(); setBusy(false); }
  async function revokeOthers() { setBusy(true); await authClient.revokeOtherSessions(); await load(); setBusy(false); }

  return (
    <section className="rounded-[20px] border border-line p-6 sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <div><h2 className="text-[20px] tracking-tight">Appareils connectés</h2><p className="mt-1 text-[14px] text-soft">Déconnectez les appareils que vous ne reconnaissez pas.</p></div>
        {sessions && sessions.length > 1 && <Button variant="secondary" size="sm" onClick={revokeOthers} disabled={busy}>Tout déconnecter sauf celui-ci</Button>}
      </div>
      <ul className="mt-5 divide-y divide-line">
        {sessions === null && <li className="py-4 text-[14px] text-soft">Chargement…</li>}
        {sessions?.map((s) => (
          <li key={s.token} className="flex items-center gap-4 py-3.5 text-[14px]">
            <Laptop className="size-4 shrink-0 text-faint" />
            <div className="min-w-0 flex-1"><p className="truncate">{s.userAgent ?? "Appareil inconnu"}</p><p className="text-[12px] text-faint">Connecté le {new Date(s.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</p></div>
            {s.token === currentToken ? <span className="rounded-full bg-accent-wash px-2.5 py-1 text-[11px] font-medium text-[#0b5cad]">Cet appareil</span> : <Button variant="ghost" size="sm" onClick={() => revoke(s.token)} disabled={busy}>Déconnecter</Button>}
          </li>
        ))}
      </ul>
    </section>
  );
}
