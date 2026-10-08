import type { Metadata } from "next";
import { Analyzer } from "./analyzer";
import { Reveal } from "@/components/ui/reveal";

export const metadata: Metadata = { title: "Analyser un document" };

export default function AnalyzePage() {
  return (
    <div className="mx-auto max-w-[900px]">
      <Reveal hero><h1 className="display-md">Analyser un document</h1></Reveal>
      <Reveal hero delay={0.1}><p className="mt-2 max-w-[60ch] text-[16px] text-soft">Déposez un courrier, une facture ou un contrat. L'agent le lit, vous présente le résultat, puis oublie le fichier.</p></Reveal>
      <div className="mt-10"><Analyzer /></div>
    </div>
  );
}
