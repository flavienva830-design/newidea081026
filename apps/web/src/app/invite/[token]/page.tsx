import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/shell";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ROLE_HELP, ROLE_LABEL } from "@/lib/roles";
import { isInviteToken, previewInvitation, type InviteView } from "@/server/family-service";
import { getSession } from "@/server/session";
import { AcceptInvitation, SwitchAccount } from "./invite-actions";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const here = `/invite/${token}`;

  // Jeton d'allure invalide : même écran que pour une invitation expirée (aucune information en plus).
  if (!isInviteToken(token)) return <Invalid />;

  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(here)}`);

  if (!session.user.emailVerified) {
    return (
      <AuthShell title="Confirmez votre adresse email" subtitle="Pour rejoindre un foyer, l'adresse email de votre compte doit d'abord être confirmée. Consultez votre boîte mail, puis revenez sur ce lien.">
        <SwitchAccount next={here} />
      </AuthShell>
    );
  }

  const view: InviteView = await previewInvitation(
    { db: db(), pepper: env().HASH_PEPPER },
    { id: session.user.id, email: session.user.email, emailVerified: session.user.emailVerified, name: session.user.name },
    token,
  );

  if (view.state === "invalid") return <Invalid signedIn />;

  if (view.state === "wrong_email") {
    // On ne dit pas à quelle adresse l'invitation est destinée.
    return (
      <AuthShell
        title="Invitation destinée à une autre adresse"
        subtitle="Vous êtes connecté(e) avec une adresse email différente de celle qui a reçu cette invitation. Connectez-vous avec la bonne adresse pour rejoindre le foyer."
        footer={<Link href="/app" className="underline underline-offset-4">Retour à mon espace</Link>}
      >
        <SwitchAccount next={here} />
      </AuthShell>
    );
  }

  if (view.state === "already_member") {
    return (
      <AuthShell title="Vous faites déjà partie de ce foyer" subtitle={`Vous êtes déjà membre de « ${view.householdName} ». Votre rôle ne change pas.`}>
        <AcceptInvitation token={token} label="Ouvrir ce foyer" />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={`Rejoindre « ${view.householdName} »`}
      subtitle="Vous avez été invité(e) à partager l'espace administratif de ce foyer."
      footer={<Link href="/app" className="underline underline-offset-4">Plus tard, retour à mon espace</Link>}
    >
      <div className="space-y-6">
        <div className="rounded-card border border-line bg-subtle p-5">
          <p className="text-[12px] text-soft">Votre rôle</p>
          <p className="mt-1 text-[16px] font-medium">{ROLE_LABEL[view.role]}</p>
          <p className="mt-1 text-[13px] text-soft">{ROLE_HELP[view.role]}</p>
        </div>
        <p className="text-[13px] text-soft">
          En rejoignant ce foyer, ses membres verront votre nom et votre adresse email. Vos autres foyers restent séparés : vous pourrez passer de l'un à l'autre à tout moment.
        </p>
        <AcceptInvitation token={token} label="Rejoindre le foyer" />
      </div>
    </AuthShell>
  );
}

/** Jeton inconnu, expiré, révoqué ou déjà utilisé : toujours ce même message. */
function Invalid({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <AuthShell
      title="Invitation introuvable ou expirée"
      subtitle="Ce lien n'est plus valable : il a peut-être expiré, été annulé ou déjà été utilisé. Demandez à la personne qui vous a invité de vous en envoyer un nouveau."
    >
      <Button href={signedIn ? "/app" : "/login"} variant="secondary" size="lg" className="w-full">{signedIn ? "Aller à mon espace" : "Me connecter"}</Button>
    </AuthShell>
  );
}
