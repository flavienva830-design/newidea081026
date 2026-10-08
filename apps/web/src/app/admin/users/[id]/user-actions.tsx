"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Input } from "@/components/ui/field";
import { addSupportNote, banUser, revokeSessions, unbanUser, type AdminResult } from "@/server/admin/actions";

export function UserActions({ userId, banned, admin, target, note }: { userId: string; banned?: boolean; admin?: boolean; target?: boolean; note?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<AdminResult>, after?: () => void) => start(async () => {
    const r = await fn();
    setMsg(r.ok ? { ok: true, text: r.message ?? "Fait." } : { ok: false, text: r.error });
    if (r.ok) { after?.(); router.refresh(); }
  });

  if (note) {
    return (
      <div className="space-y-3">
        {msg && <Alert tone={msg.ok ? "ok" : "danger"}>{msg.text}</Alert>}
        <label className="sr-only" htmlFor="note">Nouvelle note</label>
        <textarea id="note" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} rows={3} placeholder="Ajouter une note…" className="w-full rounded-control border border-line-strong bg-white p-3 text-[13px] focus:border-accent focus:outline-none" />
        <Button size="sm" variant="secondary" disabled={pending || !text.trim()} onClick={() => run(() => addSupportNote({ id: userId, body: text }), () => setText(""))}>Ajouter la note</Button>
      </div>
    );
  }
  if (!admin) return <p className="text-[13px] text-soft">Votre rôle ne permet que la consultation et les notes.</p>;
  if (target) return <p className="text-[13px] text-soft">Ce compte (le vôtre ou celui d'un administrateur) ne peut pas être modifié depuis le portail.</p>;
  return (
    <div className="space-y-3">
      {msg && <Alert tone={msg.ok ? "ok" : "danger"}>{msg.text}</Alert>}
      <label className="block text-[12px] font-medium" htmlFor="reason">Motif (obligatoire)</label>
      <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Ex. : demande du titulaire, fraude suspectée…" />
      <div className="flex flex-wrap gap-2">
        {banned
          ? <Button size="sm" disabled={pending || reason.trim().length < 3} onClick={() => run(() => unbanUser({ id: userId, reason }), () => setReason(""))}>Réactiver le compte</Button>
          : <Button size="sm" variant="danger" disabled={pending || reason.trim().length < 3} onClick={() => { if (window.confirm("Suspendre ce compte et fermer toutes ses sessions ?")) run(() => banUser({ id: userId, reason }), () => setReason("")); }}>Suspendre le compte</Button>}
        <Button size="sm" variant="secondary" disabled={pending || reason.trim().length < 3} onClick={() => run(() => revokeSessions({ id: userId, reason }), () => setReason(""))}>Fermer les sessions</Button>
      </div>
    </div>
  );
}
