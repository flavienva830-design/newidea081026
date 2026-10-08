import * as React from "react";
import { cn } from "@/lib/cn";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...props }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "h-12 w-full rounded-control border bg-white px-4 text-[15px] text-fg placeholder:text-faint transition-[border-color,box-shadow] duration-200",
          "border-line-strong hover:border-faint focus:border-accent focus:shadow-[0_0_0_4px_rgba(73,168,255,0.18)] focus:outline-none",
          invalid && "border-danger focus:border-danger focus:shadow-[0_0_0_4px_rgba(217,45,32,0.12)]",
          className,
        )}
        {...props}
      />
    );
  },
);

export function Field({ label, htmlFor, hint, error, children }: {
  label: string; htmlFor: string; hint?: string; error?: string | null; children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-fg">{label}</label>
      {children}
      {hint && !error && <p className="text-[12px] text-soft">{hint}</p>}
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}

export function Alert({ tone = "danger", children }: { tone?: "danger" | "info" | "ok"; children: React.ReactNode }) {
  const tones = {
    danger: "bg-danger-wash text-danger border-[#fecdca]",
    info: "bg-accent-wash text-[#0b5cad] border-[#bfe0ff]",
    ok: "bg-[#ecfdf3] text-[#067647] border-[#abefc6]",
  } as const;
  return <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-control border px-4 py-3 text-[13px]", tones[tone])}>{children}</div>;
}
