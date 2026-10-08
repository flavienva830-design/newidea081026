export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <article className="container-x max-w-[820px] pb-12 pt-[148px]">
      <h1 className="display-lg">{title}</h1>
      <p className="mt-4 text-[13px] text-faint">Dernière mise à jour : {updated}</p>
      <p className="mt-8 rounded-card border border-[#fedf89] bg-[#fffaeb] p-4 text-[13px] text-[#93370d]">
        Document de travail : les passages entre crochets [ ] doivent être complétés, et l'ensemble validé par un professionnel du droit avant la mise en ligne.
      </p>
      <div className="mt-10 space-y-4 text-[15px] leading-relaxed text-soft [&_h2]:mb-1 [&_h2]:mt-10 [&_h2]:text-[22px] [&_h2]:text-fg [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-fg">{children}</div>
    </article>
  );
}
