"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { updateDeletionRequest } from "@/server/admin/actions";

export function DeletionActions({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const run = (action: "execute_now" | "cancel") => start(async () => {
    const r = await updateDeletionRequest({ id, action, reason });
    setMsg(r.ok ? (r.message ?? "Fait.") : r.error);
    if (r.ok) router.refresh();
  });
  return (
    <div className="space-y-2">
      <input aria-label="Motif" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Motif (obligatoire)" className="h-9 w-56 rounded-full border border-line-strong px-3 text-[12px] focus:border-accent focus:outline-none" />
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={pending || reason.trim().length < 3} onClick={() => run("cancel")}>Annuler</Button>
        <Button size="sm" variant="danger" disabled={pending || reason.trim().length < 3} onClick={() => { if (window.confirm("Exécuter cette suppression maintenant ? C'est irréversible.")) run("execute_now"); }}>Exécuter maintenant</Button>
      </div>
      {msg && <p role="status" className="text-[12px] text-soft">{msg}</p>}
    </div>
  );
}
