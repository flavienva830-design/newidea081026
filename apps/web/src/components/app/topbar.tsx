"use client";

import { Check, ChevronDown, Home, LogOut, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { MembershipRole } from "@mon-agent-ia/core/rbac";
import { authClient } from "@/lib/auth-client";
import { ROLE_LABEL } from "@/lib/roles";
import { switchHousehold } from "@/server/family";

export type HouseholdOption = { id: string; name: string; role: MembershipRole };

export function Topbar({ name, email, householdName, households = [], activeHouseholdId }: {
  name: string; email: string; householdName: string; households?: HouseholdOption[]; activeHouseholdId?: string;
}) {
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
        {/* Le sélecteur n'apparaît que s'il y a un choix à faire (au moins deux foyers). */}
        {households.length >= 2
          ? <HouseholdSwitcher households={households} activeId={activeHouseholdId} />
          : <p className="hidden text-[13px] text-soft md:block">{householdName}</p>}
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

/**
 * Menu de changement de foyer : un bouton qui déplie une liste de boutons (motif « disclosure », naturellement
 * accessible au clavier). Échap referme et rend le focus ; un clic à l'extérieur referme. Le choix passe par la
 * Server Action `switchHousehold`, qui revérifie l'appartenance avant d'écrire le cookie.
 */
function HouseholdSwitcher({ households, activeId }: { households: HouseholdOption[]; activeId?: string }) {
  const router = useRouter();
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const active = households.find((h) => h.id === activeId) ?? households[0]!;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); toggle.current?.focus(); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  function pick(id: string) {
    if (id === active.id) { setOpen(false); return; }
    setError(null);
    start(async () => {
      const r = await switchHousehold({ householdId: id });
      if (!r.ok) { setError(r.error); return; }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={toggle} type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}
        className="flex h-10 max-w-[260px] items-center gap-2 rounded-full border border-line-strong bg-white px-4 text-[13px] transition-colors hover:border-fg"
      >
        <Home className="size-4 shrink-0 text-soft" aria-hidden />
        <span className="sr-only">Changer de foyer. Foyer actif :</span>
        <span className="truncate font-medium">{active.name}</span>
        <ChevronDown className={`size-4 shrink-0 text-soft transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div id={panelId} role="group" aria-label="Vos foyers" className="absolute right-0 top-12 z-30 w-[300px] rounded-card border border-line bg-white p-2 shadow-lift">
          <ul>
            {households.map((h) => (
              <li key={h.id}>
                <button
                  type="button" disabled={pending} aria-current={h.id === active.id ? "true" : undefined} onClick={() => pick(h.id)}
                  className="flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-left text-[14px] transition-colors hover:bg-muted disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{h.name}</span>
                    <span className="block text-[12px] text-soft">{ROLE_LABEL[h.role]}</span>
                  </span>
                  {h.id === active.id && <Check className="size-4 shrink-0 text-accent-strong" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
          {error && <p role="alert" className="px-3 py-2 text-[12px] text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
