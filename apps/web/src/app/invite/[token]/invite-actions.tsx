"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";
import { acceptInvitation } from "@/server/family";

/** Bouton d'acceptation : l'action côté serveur revérifie tout (jeton, email vérifié, places) ; ici seulement l'affichage. */
export function AcceptInvitation({ token, label }: { token: string; label: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <Button
        type="button" size="lg" className="w-full" loading={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await acceptInvitation({ token });
            if (!r.ok) { setError(r.error); return; }
            router.replace("/app/family");
            router.refresh();
          });
        }}
      >
        {label}
      </Button>
    </div>
  );
}

/** Se déconnecter pour revenir avec la bonne adresse (le lien d'invitation est conservé dans `next`). */
export function SwitchAccount({ next }: { next: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button" variant="secondary" size="lg" className="w-full" loading={busy}
      onClick={async () => {
        setBusy(true);
        await authClient.signOut();
        router.replace(`/login?next=${encodeURIComponent(next)}`);
        router.refresh();
      }}
    >
      Me connecter avec une autre adresse
    </Button>
  );
}
