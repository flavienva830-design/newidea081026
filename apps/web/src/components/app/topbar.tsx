"use client";

import { LogOut, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function Topbar({ name, email, householdName }: { name: string; email: string; householdName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";

  async function signOut() {
    setBusy(true);
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  }
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-line bg-white/80 px-5 backdrop-blur-xl sm:px-8">
      <label className="relative hidden max-w-[420px] flex-1 sm:block">
        <span className="sr-only">Rechercher</span>
        <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <input type="search" disabled placeholder="Rechercher (bientôt disponible)" className="h-10 w-full rounded-full border border-line bg-subtle pl-11 pr-4 text-[14px] placeholder:text-faint disabled:cursor-not-allowed" />
      </label>
      <div className="ml-auto flex items-center gap-4">
        <p className="hidden text-[13px] text-soft md:block">{householdName}</p>
        <div className="flex items-center gap-3">
          <span title={email} className="grid size-9 place-items-center rounded-full bg-fg text-[12px] font-medium text-white">{initials}</span>
          <button type="button" onClick={signOut} disabled={busy} className="grid size-9 place-items-center rounded-full text-soft transition-colors hover:bg-muted hover:text-fg" aria-label="Se déconnecter">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
