"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { AuthShell } from "@/components/auth/shell";
import { Turnstile, captchaEnabled } from "@/components/auth/turnstile";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const onToken = useCallback((t: string | null) => setToken(t), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (captchaEnabled && !token) return setError("Merci de valider la vérification anti-robot.");
    setLoading(true);
    const res = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: "/reset-password", fetchOptions: { headers: token ? { "x-captcha-response": token } : {} } });
    setLoading(false);
    if (res.error?.status === 429) return setError("Trop de demandes. Réessayez plus tard.");
    setSent(true); // même réponse que le compte existe ou non
  }

  if (sent) {
    return (
      <AuthShell title="Vérifiez vos emails" subtitle="Si un compte existe pour cette adresse, un lien de réinitialisation valable 1 heure vient d'être envoyé.">
        <Button href="/login" variant="secondary">Retour à la connexion</Button>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Mot de passe oublié" subtitle="Saisissez votre adresse : nous vous envoyons un lien pour en choisir un nouveau." footer={<Link href="/login" className="underline underline-offset-4">Retour à la connexion</Link>}>
      <form onSubmit={submit} className="space-y-5" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Adresse email" htmlFor="email"><Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Turnstile onToken={onToken} />
        <Button type="submit" size="lg" className="w-full" loading={loading}>Envoyer le lien</Button>
      </form>
    </AuthShell>
  );
}
