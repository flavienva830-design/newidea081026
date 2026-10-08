import type { Metadata } from "next";
import { ArrowRight, BellRing, FileSearch, Lock, Mail, PenLine, PiggyBank, ServerCog, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal, SplitWords } from "@/components/ui/reveal";
import { HeroVisualLazy } from "@/components/marketing/hero-visual-lazy";
import { ProductMock } from "@/components/marketing/product-mock";
import { Pricing } from "@/components/marketing/pricing";

export const metadata: Metadata = {
  title: { absolute: "Mon Agent IA — Votre assistant administratif, disponible 24h/24" },
  alternates: { canonical: "/" },
};

const FAQ = [
  ["Mes documents sont-ils en sécurité ?", "Ils sont chiffrés, hébergés en Europe et ne sont jamais revendus ni utilisés à des fins publicitaires. Chaque foyer dispose de sa propre clé de chiffrement et vous pouvez tout supprimer à tout moment."],
  ["L'agent envoie-t-il des courriers sans mon accord ?", "Non. L'agent propose et prépare ; rien n'est envoyé sans votre validation explicite."],
  ["Est-ce un conseil juridique ou fiscal ?", "Non. Mon Agent IA vous aide à comprendre et organiser vos démarches. Pour une situation complexe, rapprochez-vous d'un professionnel."],
  ["L'IA peut-elle se tromper ?", "Oui, comme tout outil automatique. C'est pourquoi chaque résumé renvoie au document d'origine et que vous validez chaque courrier avant envoi."],
  ["Puis-je résilier quand je veux ?", "Oui, en un clic depuis votre compte. Vous conservez l'accès jusqu'à la fin de la période déjà payée."],
  ["Comment transférer mes documents ?", "Par glisser-déposer, depuis votre mobile, ou en transférant un email à votre adresse personnelle. L'agent s'occupe du reste."],
] as const;

const STEPS = [
  ["01", "Vous transférez", "Un courrier photographié, un PDF, un email transféré : l'agent accepte tout ce qui arrive du quotidien."],
  ["02", "L'agent comprend", "Il lit, classe, extrait les montants et les dates, mesure l'urgence et repère ce qui cloche."],
  ["03", "Vous validez", "Vous recevez une action claire et un courrier prêt à relire. Rien ne part sans votre accord."],
] as const;

const FEATURES = [
  { icon: FileSearch, title: "Lecture complète", text: "PDF, scans et photos : nom de l'organisme, montant, référence, échéance, pénalités." },
  { icon: BellRing, title: "Échéances suivies", text: "Impôts, assurances, mutuelles, renouvellements : des rappels avant qu'il soit trop tard." },
  { icon: PiggyBank, title: "Économies détectées", text: "Abonnements oubliés, doublons, hausses de tarif : chiffrés par mois et par an." },
  { icon: PenLine, title: "Courriers prêts à valider", text: "Résiliation, contestation, remboursement, relance : générés, relus par vous, exportés en PDF." },
  { icon: Mail, title: "Votre adresse personnelle", text: "Transférez un email : l'agent extrait les pièces jointes et classe tout automatiquement." },
  { icon: Users, title: "Pour tout le foyer", text: "Conjoint, enfants, proches : des profils et des permissions, un espace strictement isolé." },
] as const;

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", name: "Mon Agent IA", url: process.env["APP_URL"] ?? "https://monagentia.com" },
    {
      "@type": "SoftwareApplication", name: "Mon Agent IA", applicationCategory: "BusinessApplication", operatingSystem: "Web",
      offers: [
        { "@type": "Offer", name: "Gratuit", price: "0", priceCurrency: "EUR" },
        { "@type": "Offer", name: "Solo", price: "9.90", priceCurrency: "EUR" },
        { "@type": "Offer", name: "Famille", price: "19.90", priceCurrency: "EUR" },
      ],
    },
    { "@type": "FAQPage", mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
  ],
};

export default function HomePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />

      {/* Hero */}
      <section className="relative overflow-hidden pt-[68px]">
        <div className="container-x grid items-center gap-4 lg:grid-cols-[1.05fr_1fr]">
          <div className="relative z-10 pb-6 pt-14 lg:py-24">
            <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-line px-3.5 py-1.5 text-[12px] text-soft">
              <span className="size-1.5 rounded-full bg-accent" /> Assistant administratif IA
            </p>
            <h1 className="display-xl">
              <SplitWords text="L'administratif, enfin géré pour vous." delay={0.02} />
            </h1>
            <Reveal hero delay={0.15}>
              <p className="mt-8 max-w-[46ch] text-[18px] leading-relaxed text-soft">
                Transférez un courrier, une facture ou un contrat. Votre agent le lit, suit les échéances, prépare la réponse et repère l'argent que vous perdez sans le savoir.
              </p>
            </Reveal>
            <Reveal hero delay={0.3}>
              <div className="mt-10 flex flex-wrap items-center gap-4">
                <Button href="/signup" size="lg" magnetic>Commencer gratuitement <ArrowRight className="size-4" /></Button>
                <a href="#fonctionnement" className="group text-[15px] font-medium">
                  <span className="border-b border-fg pb-0.5 transition-colors group-hover:border-accent group-hover:text-accent-strong">Voir comment ça marche</span>
                </a>
              </div>
              <p className="mt-6 text-[13px] text-faint">Gratuit pour commencer · Sans carte bancaire · Hébergé en Europe</p>
            </Reveal>
          </div>
          <HeroVisualLazy />
        </div>
      </section>

      {/* Fonctionnement */}
      <section id="fonctionnement" className="hairline scroll-mt-20 py-28 lg:py-40">
        <div className="container-x grid gap-16 lg:grid-cols-[1fr_1.2fr]">
          <Reveal><h2 className="display-lg">Trois gestes. Le reste, c'est l'agent.</h2></Reveal>
          <div>
            {STEPS.map(([n, t, d], i) => (
              <Reveal key={n} delay={i * 0.08}>
                <div className="group grid grid-cols-[56px_1fr] gap-4 border-t border-line py-9 first:border-t-0 first:pt-0">
                  <span className="pt-1 font-display text-[15px] text-faint transition-colors group-hover:text-accent-strong">{n}</span>
                  <div><h3 className="display-md">{t}</h3><p className="mt-3 max-w-[48ch] text-[16px] text-soft">{d}</p></div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Agent proactif */}
      <section id="agent" className="hairline scroll-mt-20 bg-subtle py-28 lg:py-40">
        <div className="container-x">
          <Reveal>
            <div className="mb-16 grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-end">
              <h2 className="display-lg">Il agit avant que vous ne le demandiez.</h2>
              <p className="max-w-[46ch] text-[18px] text-soft">Hausse de tarif, abonnement oublié, courrier important : l'agent détecte, chiffre le gain et prépare la démarche. Vous n'avez plus qu'à valider.</p>
            </div>
          </Reveal>
          <Reveal delay={0.1}><ProductMock /></Reveal>
          <div className="mt-20 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={(i % 3) * 0.08}>
                <div className="border-t border-line pt-6">
                  <f.icon className="size-5 text-accent-strong" strokeWidth={1.6} />
                  <h3 className="mt-5 text-[22px] tracking-tight">{f.title}</h3>
                  <p className="mt-2 text-[15px] text-soft">{f.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Sécurité */}
      <section id="securite" className="scroll-mt-20 bg-fg py-28 text-white lg:py-40">
        <div className="container-x">
          <Reveal>
            <div className="grid gap-10 lg:grid-cols-[1fr_1fr]">
              <h2 className="display-lg text-white">Vos documents sont ce que vous avez de plus privé.</h2>
              <p className="max-w-[46ch] text-[18px] text-white/60">Nous les traitons comme tels : isolés par foyer, chiffrés, hébergés en Europe, jamais revendus.</p>
            </div>
          </Reveal>
          <div className="mt-20 grid gap-px overflow-hidden rounded-[20px] bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [Lock, "Chiffrement par foyer", "Une clé de chiffrement propre à chaque foyer, jamais partagée."],
              [ShieldCheck, "Isolation stricte", "Vos données sont inaccessibles aux autres foyers, y compris en cas d'erreur logicielle."],
              [ServerCog, "Hébergé en Europe", "Données et traitements dans l'Union européenne, conformité RGPD."],
              [Users, "Vous gardez la main", "Aucun courrier n'est envoyé sans votre validation. Export et suppression en un clic."],
            ].map(([Icon, t, d]) => {
              const I = Icon as typeof Lock;
              return (
                <div key={t as string} className="bg-fg p-8 transition-colors duration-500 hover:bg-[#1a1a1a]">
                  <I className="size-5 text-accent" strokeWidth={1.6} />
                  <h3 className="mt-6 text-[20px] tracking-tight text-white">{t as string}</h3>
                  <p className="mt-2 text-[14px] text-white/55">{d as string}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Tarifs */}
      <section id="tarifs" className="scroll-mt-20 py-28 lg:py-40">
        <div className="container-x">
          <Reveal><div className="mx-auto mb-14 max-w-[720px] text-center"><h2 className="display-lg">Un abonnement qui se rentabilise.</h2><p className="mt-5 text-[18px] text-soft">Commencez gratuitement. Passez à l'abonnement quand l'agent vous a fait gagner du temps — et de l'argent.</p></div></Reveal>
          <Pricing />
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="hairline scroll-mt-20 py-28 lg:py-40">
        <div className="container-x grid gap-16 lg:grid-cols-[1fr_1.4fr]">
          <Reveal><h2 className="display-lg">Questions fréquentes</h2></Reveal>
          <div>
            {FAQ.map(([q, a]) => (
              <details key={q} className="group border-t border-line py-6 first:border-t-0 first:pt-0">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[20px] font-medium tracking-tight [&::-webkit-details-marker]:hidden">
                  {q}
                  <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full border border-line-strong text-[18px] leading-none transition-transform duration-300 group-open:rotate-45">+</span>
                </summary>
                <p className="mt-4 max-w-[60ch] text-[16px] text-soft">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="pb-8">
        <div className="container-x">
          <Reveal>
            <div className="relative overflow-hidden rounded-[28px] bg-accent-wash px-8 py-20 text-center sm:px-16 sm:py-28">
              <h2 className="display-lg mx-auto max-w-[16ch]">Reprenez la main sur votre administratif.</h2>
              <p className="mx-auto mt-6 max-w-[44ch] text-[18px] text-soft">Créez votre espace en deux minutes. Aucune carte bancaire requise.</p>
              <div className="mt-10"><Button href="/signup" variant="dark" size="lg" magnetic>Créer mon espace <ArrowRight className="size-4" /></Button></div>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
