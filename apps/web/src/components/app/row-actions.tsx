"use client";

import { Check, Trash2, X } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { Result } from "@/server/records";

export type RowAction = { label: string; icon?: "check" | "x" | "trash"; run: () => Promise<Result>; variant?: "primary" | "secondary" | "ghost" | "danger"; confirm?: string };

const ICONS = { check: Check, x: X, trash: Trash2 } as const;

/** Boutons d'action d'une ligne : appelle une Server Action, désactive pendant l'exécution, confirme si nécessaire. */
export function RowActions({ actions }: { actions: RowAction[] }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex shrink-0 gap-2">
      {actions.map((a) => {
        const Icon = a.icon ? ICONS[a.icon] : null;
        return (
          <Button
            key={a.label} type="button" size="sm" variant={a.variant ?? "secondary"} disabled={pending}
            onClick={() => { if (a.confirm && !window.confirm(a.confirm)) return; start(async () => { await a.run(); }); }}
          >
            {Icon && <Icon className="size-4" />}{a.label}
          </Button>
        );
      })}
    </div>
  );
}
