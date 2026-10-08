"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "/app/settings/security", label: "Sécurité" },
  { href: "/app/settings/billing", label: "Abonnement" },
  { href: "/app/settings/data", label: "Mes données" },
];

export function SettingsNav() {
  const path = usePathname();
  return (
    <nav aria-label="Paramètres" className="flex gap-1 rounded-full border border-line p-1 w-fit">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={path === t.href ? "page" : undefined} className={cn("rounded-full px-4 py-2 text-[13px] font-medium transition-colors", path === t.href ? "bg-fg text-white" : "text-soft hover:text-fg")}>{t.label}</Link>
      ))}
    </nav>
  );
}
