import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PageHead({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-10">
      <h1 className="display-md">{title}</h1>
      {subtitle && <p className="mt-2 max-w-[60ch] text-[16px] text-soft">{subtitle}</p>}
    </div>
  );
}

export function Empty({ title, text, cta }: { title: string; text: string; cta?: boolean }) {
  return (
    <div className="rounded-[20px] bg-subtle p-12 text-center">
      <Sparkles className="mx-auto size-6 text-accent-strong" strokeWidth={1.5} />
      <p className="mt-4 text-[16px] font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-[44ch] text-[14px] text-soft">{text}</p>
      {cta && <div className="mt-6"><Button href="/app/analyze">Analyser un document</Button></div>}
    </div>
  );
}

export const euro = (c: number) => (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: c % 100 ? 2 : 0 });
export const dayFr = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
