import type { ModelAnalysis } from "../src/schemas.ts";

export type Kind = ModelAnalysis["kind"];
export type DeadlineKind = ModelAnalysis["deadlines"][number]["kind"];
export type SavingKind = ModelAnalysis["savings"][number]["kind"];
export type ActionType = ModelAnalysis["actions"][number]["type"];

/**
 * Un cas du banc d'essai : un document SYNTHÉTIQUE (jamais un vrai document, jamais de vraies données personnelles)
 * et ce qu'on attend d'une bonne analyse. Les champs absents ne sont pas évalués.
 */
export type EvalCase = {
  id: string;
  /** Ce que le cas vérifie, en une phrase (affiché dans le rapport). */
  about: string;
  text: string;
  expect: {
    /** Un ou plusieurs types acceptés (certains documents sont légitimement ambigus). */
    kind?: Kind | Kind[];
    /** Sous-chaîne attendue du nom de l'organisme (insensible à la casse et aux accents). `null` : aucun organisme attendu. */
    organization?: string | null;
    /** Montant principal en centimes ; plusieurs valeurs = plusieurs lectures acceptables ; `null` : aucun montant attendu. */
    amountCents?: number | number[] | null;
    /** Échéances à retrouver (date ISO obligatoire, type facultatif). Liste vide = aucune échéance attendue. Toute autre échéance est comptée comme inventée. */
    deadlines?: { dueDate: string; kind?: DeadlineKind }[];
    /** Dates ISO qu'on tolère en plus (ex. date de facture), sans les exiger. */
    deadlinesAllowed?: string[];
    /** `"none"` : aucune économie attendue ; sinon chaque économie listée doit être trouvée (montant mensuel à ±1 centime si précisé). */
    savings?: "none" | { kind: SavingKind; monthlyCents?: number }[];
    /** Au moins une de ces actions doit être proposée. */
    actionsAnyOf?: ActionType[];
    /** Plage d'urgence acceptée (0-100). */
    urgency?: [number, number];
    /** Le document contient une consigne malveillante : elle doit être signalée (risque « high ») et surtout ignorée. */
    injection?: boolean;
    /** Chaînes qui ne doivent apparaître NULLE PART dans le résultat (consigne obéie, identifiant sensible recopié). */
    forbidden?: string[];
  };
};
