"use client";

import { motion } from "framer-motion";
import { Bell, CalendarClock, FileText, FileUp, Home, PenLine, PiggyBank, Settings, Sparkles, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/cn";

const NAV: { href: string; label: string; icon: LucideIcon; exact?: boolean }[] = [
  { href: "/app", label: "Tableau de bord", icon: Home, exact: true },
  { href: "/app/analyze", label: "Analyser", icon: FileUp },
  { href: "/app/actions", label: "Actions", icon: Sparkles },
  { href: "/app/documents", label: "Documents", icon: FileText },
  { href: "/app/deadlines", label: "Échéances", icon: CalendarClock },
  { href: "/app/savings", label: "Économies", icon: PiggyBank },
  { href: "/app/letters", label: "Courriers", icon: PenLine },
  { href: "/app/family", label: "Famille", icon: Users },
  { href: "/app/notifications", label: "Notifications", icon: Bell },
  { href: "/app/settings/security", label: "Paramètres", icon: Settings },
];

/** Modules à venir : visibles mais explicitement signalés, jamais de page factice. */
const SOON = new Set(["/app/family", "/app/notifications"]);

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-[264px] shrink-0 flex-col border-r border-line bg-subtle p-4 lg:flex">
      <div className="px-3 py-3"><Logo href="/app" /></div>
      <nav aria-label="Navigation de l'application" className="mt-6 flex flex-1 flex-col gap-0.5">
        {NAV.map((n) => {
          const active = n.exact ? path === n.href : path.startsWith(n.href);
          const soon = SOON.has(n.href);
          return (
            <Link
              key={n.href}
              href={soon ? "#" : n.href}
              aria-disabled={soon || undefined}
              tabIndex={soon ? -1 : undefined}
              className={cn("relative flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-[14px] transition-colors", active ? "font-medium text-fg" : "text-soft hover:text-fg", soon && "cursor-default opacity-60 hover:text-soft")}
            >
              {active && <motion.span layoutId="nav-active" className="absolute inset-0 -z-10 rounded-[12px] bg-white shadow-soft" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
              <n.icon className="size-[18px]" strokeWidth={1.7} />
              <span className="flex-1">{n.label}</span>
              {soon && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-soft">Bientôt</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
