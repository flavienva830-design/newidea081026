"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/#fonctionnement", label: "Fonctionnement" },
  { href: "/#agent", label: "Agent proactif" },
  { href: "/#securite", label: "Sécurité" },
  { href: "/#tarifs", label: "Tarifs" },
  { href: "/#faq", label: "FAQ" },
];

export function MarketingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <header className={cn("fixed inset-x-0 top-0 z-50 transition-all duration-500", scrolled ? "border-b border-line bg-white/80 backdrop-blur-xl" : "border-b border-transparent")}>
      <div className="container-x flex h-[68px] items-center justify-between">
        <Logo />
        <nav aria-label="Navigation principale" className="hidden items-center gap-1 lg:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-full px-4 py-2 text-[14px] text-soft transition-colors hover:text-fg">{l.label}</Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <Button href="/login" variant="ghost" size="sm">Se connecter</Button>
          <Button href="/signup" size="sm" magnetic>Commencer</Button>
        </div>
        <button type="button" className="grid size-10 place-items-center rounded-full hover:bg-muted lg:hidden" aria-label={open ? "Fermer le menu" : "Ouvrir le menu"} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-x-0 top-[68px] h-[calc(100dvh-68px)] bg-white px-6 pb-10 pt-6 lg:hidden"
          >
            <nav aria-label="Menu mobile" className="flex flex-col">
              {LINKS.map((l, i) => (
                <motion.div key={l.href} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i + 0.1 }}>
                  <Link href={l.href} onClick={() => setOpen(false)} className="block border-b border-line py-4 font-display text-[28px] tracking-tight">{l.label}</Link>
                </motion.div>
              ))}
            </nav>
            <div className="mt-8 flex flex-col gap-3">
              <Button href="/signup" size="lg">Commencer gratuitement</Button>
              <Button href="/login" variant="secondary" size="lg">Se connecter</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
