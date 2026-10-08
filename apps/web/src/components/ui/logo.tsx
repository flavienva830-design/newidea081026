import Link from "next/link";
import { cn } from "@/lib/cn";

export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7", className)}>
      <rect width="32" height="32" rx="9" fill="#111" />
      <path d="M9 21.5 14 9.5h1.6l5 12h-2.3l-1-2.6h-5.1l-1 2.6H9Zm4.7-4.6h3.6L15.5 12.5l-1.8 4.4Z" fill="#fff" transform="translate(0.8 0.4)" />
      <circle cx="23.4" cy="9.2" r="2.3" fill="#49A8FF" />
    </svg>
  );
}

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} aria-label="Mon Agent IA, accueil" className={cn("inline-flex items-center gap-2.5 text-[15px] font-semibold tracking-tight", className)}>
      <Mark />
      Mon Agent IA
    </Link>
  );
}
