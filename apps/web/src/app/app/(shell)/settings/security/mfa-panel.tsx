"use client";

import QRCode from "qrcode";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";

type Phase = "idle" | "password" | "scan" | "codes" | "disable";

export function MfaPanel({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function start(e: React.FormEvent) {
    e.preventDefault(); setError(null); setLoading(true);
    const res = await authClient.twoFactor.enable({ password });
    setLoading(false);
    setPassword("");
    if (res.error || !res.data) return setError("Mot de passe incorrect.");
    if (res.data.method !== "totp") return setError("Méthode de double authentification non prise en charge.");
    setQr(await QRCode.toDataURL(res.data.totpURI, { margin: 1, width: 224 }));
    setSecret(new URL(res.data.totpURI).searchParams.get("secret"));
    setCodes(res.data.backupCodes);
    setPhase("scan");
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault(); setError(null); setLoading(true);
    const res = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, "") });
    setLoading(false);
    if (res.error) return setError("Code invalide. Vérifiez l'heure de votre téléphone et réessayez.");
    setCode(""); setPhase("codes");
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault(); setError(null); setLoading(true);
    const res = await authClient.twoFactor.disable({ password });
    setLoading(false); setPassword("");
    if (res.error) return setError("Mot de passe incorrect.");
    setPhase("idle"); router.refresh();
  }

  return (
    <section className="rounded-[20px] border border-line p-6 sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[20px] tracking-tight">Double authentification</h2>
          <p className="mt-1 max-w-[52ch] text-[14px] text-soft">Un code temporaire, généré par une application (1Password, Google Authenticator, Authy…), en plus de votre mot de passe.</p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium ${enabled ? "bg-[#ecfdf3] text-[#067647]" : "bg-muted text-soft"}`}>
          <ShieldCheck className="size-3.5" />{enabled ? "Activée" : "Désactivée"}
        </span>
      </div>

      {error && <div className="mt-5"><Alert>{error}</Alert></div>}

      {phase === "idle" && (
        <div className="mt-6">
          {enabled ? <Button variant="secondary" onClick={() => setPhase("disable")}>Désactiver</Button> : <Button onClick={() => setPhase("password")}>Activer</Button>}
        </div>
      )}

      {(phase === "password" || phase === "disable") && (
        <form onSubmit={phase === "password" ? start : disable} className="mt-6 max-w-[360px] space-y-4">
          <Field label="Confirmez votre mot de passe" htmlFor="mfa-pw"><Input id="mfa-pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <div className="flex gap-3"><Button type="submit" loading={loading} variant={phase === "disable" ? "danger" : "primary"}>{phase === "disable" ? "Désactiver" : "Continuer"}</Button><Button type="button" variant="ghost" onClick={() => { setPhase("idle"); setError(null); }}>Annuler</Button></div>
        </form>
      )}

      {phase === "scan" && qr && (
        <form onSubmit={confirm} className="mt-6 grid gap-8 sm:grid-cols-[224px_1fr]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR code à scanner avec votre application d'authentification" width={224} height={224} className="rounded-card border border-line" />
          <div className="space-y-4">
            <p className="text-[14px] text-soft">1. Scannez ce code avec votre application.<br />2. Saisissez le code à 6 chiffres affiché.</p>
            {secret && <p className="break-all rounded-control bg-subtle px-3 py-2 font-mono text-[12px] text-soft">Clé manuelle : {secret}</p>}
            <Field label="Code à 6 chiffres" htmlFor="mfa-code"><Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} className="max-w-[200px] text-center tracking-[0.3em]" /></Field>
            <Button type="submit" loading={loading}>Activer</Button>
          </div>
        </form>
      )}

      {phase === "codes" && (
        <div className="mt-6 space-y-4">
          <Alert tone="ok">Double authentification activée.</Alert>
          <p className="text-[14px] text-soft">Conservez ces codes de secours dans un endroit sûr. Chacun ne fonctionne qu'une fois et ne sera plus affiché.</p>
          <ul className="grid max-w-[360px] grid-cols-2 gap-2 rounded-card bg-subtle p-4 font-mono text-[14px]">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
          <Button onClick={() => { setPhase("idle"); setCodes([]); router.refresh(); }}>J'ai enregistré mes codes</Button>
        </div>
      )}
    </section>
  );
}
