"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { MailCheck } from "lucide-react";
import { AuthShell } from "@/components/auth/shell";
import { Turnstile, captchaEnabled } from "@/components/auth/turnstile";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";
import { MIN_PASSWORD, passwordStrength } from "@/lib/password";
import { safeNext } from "@/lib/safe-next";

export function SignupForm() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"), "");
  const invite = next.startsWith("/invite/"); // inscription depuis un lien d'invitation : on y revient après la confirmation de l'email
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [reset, setReset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const onToken = useCallback((t: string | null) => setToken(t), []);
  const strength = passwordStrength(password);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) return setError(`Le mot de passe doit contenir au moins ${MIN_PASSWORD} caractères.`);
    if (!accepted) return setError("Merci d'accepter les conditions pour continuer.");
    if (captchaEnabled && !token) return setError("Merci de valider la vérification anti-robot.");
    setLoading(true);
    const plan = params.get("plan");
    const { error } = await authClient.signUp.email({
      name: name.trim(), email: email.trim(), password,
      callbackURL: invite ? next : plan ? `/app/onboarding?plan=${encodeURIComponent(plan)}` : "/app/onboarding",
      fetchOptions: { headers: token ? { "x-captcha-response": token } : {} },
    });
    setLoading(false);
    if (error) {
      setReset((r) => r + 1);
      setToken(null);
      return setError(error.status === 429 ? "Trop de tentatives. Réessayez dans quelques minutes." : error.message ?? "Création impossible. Vérifiez les informations saisies.");
    }
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell title="Vérifiez votre boîte mail" subtitle={`Si l'adresse ${email} peut être utilisée, un lien de confirmation vient d'être envoyé.`}>
        <div className="flex items-start gap-4 rounded-card border border-line bg-subtle p-5">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-accent-strong" />
          <p className="text-[14px] text-soft">Cliquez sur le lien reçu pour activer votre espace. Il est valable 24 heures. Pensez à vérifier vos courriers indésirables.</p>
        </div>
        <p className="mt-6 text-[14px] text-soft">Mauvaise adresse ? <button className="font-medium text-fg underline" onClick={() => setSent(false)}>Recommencer</button></p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Créer mon espace"
      subtitle="Gratuit pour commencer. Aucune carte bancaire."
      footer={<>Déjà un compte ? <Link href={invite ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="font-medium text-fg underline underline-offset-4">Se connecter</Link></>}
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        {invite && <Alert tone="info">Vous avez été invité(e) à rejoindre un foyer. Utilisez l'adresse email qui a reçu l'invitation : après la confirmation de votre adresse, vous reviendrez sur l'invitation.</Alert>}
        {error && <Alert>{error}</Alert>}
        <Field label="Prénom et nom" htmlFor="name"><Input id="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Camille Martin" /></Field>
        <Field label="Adresse email" htmlFor="email"><Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="camille@exemple.fr" /></Field>
        <Field label="Mot de passe" htmlFor="password" hint={`Au moins ${MIN_PASSWORD} caractères. Une phrase de passe est idéale.`}>
          <Input id="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="mt-2 flex items-center gap-1.5" aria-hidden>
            {[1, 2, 3, 4].map((i) => (
              <span key={i} className={cn("h-1 flex-1 rounded-full transition-colors duration-300", strength.score >= i ? (strength.score <= 1 ? "bg-danger" : strength.score === 2 ? "bg-[#f79009]" : "bg-ok") : "bg-line")} />
            ))}
          </div>
          {password && <p className="mt-1 text-[12px] text-soft" aria-live="polite">{strength.label}</p>}
        </Field>
        <label className="flex cursor-pointer items-start gap-3 text-[13px] text-soft">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 size-4 accent-[#111]" />
          <span>J'accepte les <Link href="/cgv" className="text-fg underline">conditions</Link> et la <Link href="/confidentialite" className="text-fg underline">politique de confidentialité</Link>.</span>
        </label>
        <Turnstile onToken={onToken} resetKey={reset} />
        <Button type="submit" size="lg" className="w-full" loading={loading}>Créer mon espace</Button>
      </form>
    </AuthShell>
  );
}
