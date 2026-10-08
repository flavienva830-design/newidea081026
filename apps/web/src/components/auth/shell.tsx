import { Logo } from "@/components/ui/logo";
import { Lock, ShieldCheck, Server } from "lucide-react";

export function AuthShell({ title, subtitle, children, footer }: {
  title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12 lg:px-20">
        <Logo />
        <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-12">
          <h1 className="text-[40px] leading-[1.05] tracking-tight">{title}</h1>
          {subtitle && <p className="mt-3 text-[15px] text-soft">{subtitle}</p>}
          <div className="mt-9">{children}</div>
          {footer && <div className="mt-8 text-[14px] text-soft">{footer}</div>}
        </div>
      </div>
      <aside className="relative hidden overflow-hidden bg-muted lg:block" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_70%_30%,rgba(73,168,255,0.35),transparent),radial-gradient(50%_40%_at_20%_80%,rgba(73,168,255,0.18),transparent)]" />
        <div className="relative flex h-full flex-col justify-end gap-6 p-16">
          {[
            [ShieldCheck, "Données minimales", "Seules les dates et montants utiles sont gardés."],
            [Lock, "Aucun fichier conservé", "Vos documents sont analysés puis oubliés."],
            [Server, "Hébergé en Europe", "Conformité RGPD dès la conception."],
          ].map(([I, t, d]) => {
            const Icon = I as typeof Lock;
            return (
              <div key={t as string} className="flex items-start gap-4 rounded-[16px] border border-white/70 bg-white/70 p-5 shadow-soft backdrop-blur-xl">
                <span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-fg text-white"><Icon className="size-4" /></span>
                <div><p className="text-[15px] font-medium">{t as string}</p><p className="text-[13px] text-soft">{d as string}</p></div>
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
