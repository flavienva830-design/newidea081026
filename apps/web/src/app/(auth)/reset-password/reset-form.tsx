"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AuthShell } from "@/components/auth/shell";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";
import { MIN_PASSWORD } from "@/lib/password";

export function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!token) return <AuthShell title="Lien invalide" subtitle="Ce lien est incomplet ou a expiré."><Button href="/forgot-password">Demander un nouveau lien</Button></AuthShell>;

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (pw.length < MIN_PASSWORD) return setError(`Au moins ${MIN_PASSWORD} caractères.`);
    setLoading(true);
    const res = await authClient.resetPassword({ newPassword: pw, token: token! });
    setLoading(false);
    if (res.error) return setError(res.error.message ?? "Lien invalide ou expiré.");
    router.replace("/login?verified=1");
  }
  return (
    <AuthShell title="Nouveau mot de passe" subtitle="Choisissez un mot de passe d'au moins 12 caractères. Vos autres sessions seront déconnectées.">
      <form onSubmit={submit} className="space-y-5" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Nouveau mot de passe" htmlFor="pw"><Input id="pw" type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Button type="submit" size="lg" className="w-full" loading={loading}>Enregistrer</Button>
      </form>
    </AuthShell>
  );
}
