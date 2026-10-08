"use client";

import { Activity, CreditCard, LayoutDashboard, ScrollText, ShieldCheck, Sparkles, Users, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/cn";

const ITEMS = [
  { href: "/admin", label: "Vue d'ensemble", icon: LayoutDashboard, exact: true, admin: true },
  { href: "/admin/users", label: "Utilisateurs", icon: Users, admin: false },
  { href: "/admin/billing", label: "Abonnements", icon: CreditCard, admin: true },
  { href: "/admin/ai", label: "Activité IA", icon: Sparkles, admin: true },
  { href: "/admin/audit", label: "Journal d'audit", icon: ScrollText, admin: true },
  { href: "/admin/privacy", label: "RGPD", icon: ShieldCheck, admin: true },
];

export function AdminNav({ role, email }: { role: "SUPPORT" | "ADMIN"; email: string }) {
  const path = usePathname();
  const items = ITEMS.filter((i) => role === "ADMIN" || !i.admin);
  const isActive = (i: (typeof ITEMS)[number]) => (i.exact ? path === i.href : path.startsWith(i.href));
  const badge = (
    <p className="inline-flex w-fit items-center gap-1.5 rounded-full bg-fg px-2.5 py-0.5 text-[11px] font-medium text-white"><Activity className="size-3" />Administration · {role === "ADMIN" ? "Admin" : "Support"}</p>
  );
  return (
    <>
      <aside className="sticky top-0 hidden h-dvh w-[250px] shrink-0 flex-col border-r border-line bg-subtle p-4 lg:flex">
        <div className="px-3 py-3"><Logo href="/admin" /></div>
        <div className="mx-3 mt-2">{badge}</div>
        <nav aria-label="Administration" className="mt-6 flex flex-1 flex-col gap-0.5">
          {items.map((i) => (
            <Link key={i.href} href={i.href} aria-current={isActive(i) ? "page" : undefined} className={cn("flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-[14px] transition-colors", isActive(i) ? "bg-white font-medium text-fg shadow-soft" : "text-soft hover:text-fg")}>
              <i.icon className="size-[18px]" strokeWidth={1.7} />{i.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-line pt-4">
          <p className="truncate px-3 text-[12px] text-soft" title={email}>{email}</p>
          <Link href="/app" className="mt-2 flex items-center gap-2 rounded-[12px] px-3 py-2 text-[13px] text-soft hover:text-fg"><ArrowLeft className="size-4" />Retour à l'application</Link>
        </div>
      </aside>

      {/* Mobile : en-tête fixe, navigation défilante horizontalement (le menu latéral n'existe qu'à partir de 1024 px). */}
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 pt-3">
          <Logo href="/admin" />
          {badge}
        </div>
        <nav aria-label="Administration (mobile)" className="flex gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {items.map((i) => (
            <Link key={i.href} href={i.href} aria-current={isActive(i) ? "page" : undefined} className={cn("flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-[13px] transition-colors", isActive(i) ? "bg-fg font-medium text-white" : "text-soft hover:text-fg")}>
              <i.icon className="size-[15px]" strokeWidth={1.8} />{i.label}
            </Link>
          ))}
          <Link href="/app" className="flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-[13px] text-soft hover:text-fg"><ArrowLeft className="size-[15px]" />Application</Link>
        </nav>
      </header>
    </>
  );
}
