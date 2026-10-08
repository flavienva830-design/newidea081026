"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { AuthShell } from "@/components/auth/shell";
import { Turnstile, captchaEnabled } from "@/components/auth/turnstile";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";
import { safeNext } from "@/lib/safe-next";

type Step = "credentials" | "magic-sent" | "totp";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const invite = next.startsWith("/invite/"); // arrivée depuis un lien d'invitation à un foyer
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [reset, setReset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [info] = useState<string | null>(params.get("verified") ? "Adresse confirmée. Vous pouvez vous connecter." : null);
  const [loading, setLoading] = useState(false);
  const onToken = useCallback((t: string | null) => setToken(t), []);
  const headers = token ? { "x-captcha-response": token } : undefined;
  const googleEnabled = process.env["NEXT_PUBLIC_GOOGLE_ENABLED"] === "true";

  const guard = () => {
    if (captchaEnabled && !token) { setError("Merci de valider la vérification anti-robot."); return false; }
    return true;
  };
  const fail = (status?: number, message?: string) => {
    setReset((r) => r + 1); setToken(null);
    setError(status === 429 ? "Trop de tentatives. Réessayez dans quelques minutes." : status === 403 ? (message ?? "Vérifiez votre adresse email avant de vous connecter.") : "Identifiants incorrects.");
  };

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!guard()) return;
    setLoading(true);
    const res = await authClient.signIn.email({ email: email.trim(), password, callbackURL: next, fetchOptions: { headers } });
    setLoading(false);
    if (res.error) return fail(res.error.status, res.error.message);
    if (res.data && "twoFactorRedirect" in res.data && res.data.twoFactorRedirect) return setStep("totp");
    router.replace(next);
    router.refresh();
  }

  async function magic() {
    setError(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError("Saisissez d'abord votre adresse email.");
    if (!guard()) return;
    setLoading(true);
    const res = await authClient.signIn.magicLink({ email: email.trim(), callbackURL: next, fetchOptions: { headers } });
    setLoading(false);
    if (res.error && res.error.status === 429) return fail(429);
    setStep("magic-sent"); // réponse identique que le compte existe ou non
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault(); setError(null); setLoading(true);
    const res = backup
      ? await authClient.twoFactor.verifyBackupCode({ code: code.trim() })
      : await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, "") });
    setLoading(false);
    if (res.error) return setError(res.error.status === 429 ? "Trop de tentatives. Réessayez plus tard." : "Code invalide ou expiré.");
    router.replace(next);
    router.refresh();
  }

  if (step === "magic-sent") {
    return (
      <AuthShell title="Consultez vos emails" subtitle="Si un compte existe pour cette adresse, un lien de connexion valable 10 minutes vient d'être envoyé.">
        <Button variant="secondary" onClick={() => setStep("credentials")}>Retour</Button>
      </AuthShell>
    );
  }

  if (step === "totp") {
    return (
      <AuthShell title="Double authentification" subtitle={backup ? "Saisissez l'un de vos codes de secours." : "Saisissez le code à 6 chiffres de votre application d'authentification."}>
        <form onSubmit={verify} className="space-y-5">
          {error && <Alert>{error}</Alert>}
          <Field label={backup ? "Code de secours" : "Code"} htmlFor="code">
            <Input id="code" inputMode={backup ? "text" : "numeric"} autoComplete="one-time-code" autoFocus required value={code} onChange={(e) => setCode(e.target.value)} className="text-center text-[20px] tracking-[0.3em]" />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={loading}>Valider</Button>
          <button type="button" className="text-[13px] text-soft underline" onClick={() => { setBackup(!backup); setCode(""); setError(null); }}>
            {backup ? "Utiliser mon application" : "Utiliser un code de secours"}
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Bon retour"
      subtitle="Connectez-vous à votre espace."
      footer={<>Pas encore de compte ? <Link href={invite ? `/signup?next=${encodeURIComponent(next)}` : "/signup"} className="font-medium text-fg underline underline-offset-4">Créer mon espace</Link></>}
    >
      <form onSubmit={submitPassword} className="space-y-5" noValidate>
        {invite && <Alert tone="info">Vous avez été invité(e) à rejoindre un foyer. Connectez-vous avec l'adresse email qui a reçu l'invitation, ou créez votre espace avec cette même adresse : vous reviendrez ensuite sur l'invitation.</Alert>}
        {info && <Alert tone="ok">{info}</Alert>}
        {error && <Alert>{error}</Alert>}
        <Field label="Adresse email" htmlFor="email"><Input id="email" type="email" autoComplete="email username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Mot de passe" htmlFor="password">
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="mt-2 text-right"><Link href="/forgot-password" className="text-[13px] text-soft underline underline-offset-4 hover:text-fg">Mot de passe oublié ?</Link></div>
        </Field>
        <Turnstile onToken={onToken} resetKey={reset} />
        <Button type="submit" size="lg" className="w-full" loading={loading}>Se connecter</Button>
        <div className="flex items-center gap-4 text-[12px] text-faint"><span className="h-px flex-1 bg-line" />ou<span className="h-px flex-1 bg-line" /></div>
        <Button type="button" variant="secondary" size="lg" className="w-full" onClick={magic} disabled={loading}>Recevoir un lien de connexion</Button>
        {googleEnabled && <Button type="button" variant="secondary" size="lg" className="w-full" onClick={() => authClient.signIn.social({ provider: "google", callbackURL: next })}>Continuer avec Google</Button>}
      </form>
    </AuthShell>
  );
}
