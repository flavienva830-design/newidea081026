import { MarketingNav } from "@/components/marketing/nav";
import { Footer } from "@/components/marketing/footer";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a href="#contenu" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-fg focus:px-4 focus:py-2 focus:text-white">Aller au contenu</a>
      <MarketingNav />
      <main id="contenu">{children}</main>
      <Footer />
    </>
  );
}
