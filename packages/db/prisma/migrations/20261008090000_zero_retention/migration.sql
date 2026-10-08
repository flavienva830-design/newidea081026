-- RÉTENTION MINIMALE : plus aucun fichier, texte intégral, courrier ni extrait de document n'est stocké.
-- Les documents sont analysés en mémoire puis oubliés. Ne subsistent que des données structurées courtes.

-- DropForeignKey
ALTER TABLE "document_texts" DROP CONSTRAINT "document_texts_documentId_fkey";

-- DropForeignKey
ALTER TABLE "document_versions" DROP CONSTRAINT "document_versions_documentId_fkey";

-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_inboundEmailId_fkey";

-- DropForeignKey
ALTER TABLE "extractions" DROP CONSTRAINT "extractions_documentId_fkey";

-- DropForeignKey
ALTER TABLE "letters" DROP CONSTRAINT "letters_actionId_fkey";

-- DropForeignKey
ALTER TABLE "letters" DROP CONSTRAINT "letters_documentId_fkey";

-- DropForeignKey
ALTER TABLE "letters" DROP CONSTRAINT "letters_householdId_fkey";

-- DropIndex
DROP INDEX "documents_householdId_status_idx";

-- AlterTable
ALTER TABLE "documents" DROP COLUMN "currentVersion",
DROP COLUMN "failureReason",
DROP COLUMN "inboundEmailId",
DROP COLUMN "status",
DROP COLUMN "summary";

-- AlterTable
ALTER TABLE "inbound_emails" DROP COLUMN "fromDomain",
DROP COLUMN "rejectReason",
DROP COLUMN "subject";

-- AlterTable
ALTER TABLE "usage_counters" ADD COLUMN     "lettersGenerated" INTEGER NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "document_texts";

-- DropTable
DROP TABLE "document_versions";

-- DropTable
DROP TABLE "extractions";

-- DropTable
DROP TABLE "letters";

-- DropEnum
DROP TYPE "DocumentStatus";

-- DropEnum
DROP TYPE "LetterChannel";

-- DropEnum
DROP TYPE "LetterKind";

-- DropEnum
DROP TYPE "LetterStatus";

-- DropEnum
DROP TYPE "OcrMethod";


-- Garde-fous structurels : un champ texte ne peut pas contenir un extrait de document (longueurs plafonnées).
ALTER TABLE documents ADD CONSTRAINT documents_title_len CHECK (char_length(title) <= 120);
ALTER TABLE documents ADD CONSTRAINT documents_org_len CHECK (organization IS NULL OR char_length(organization) <= 120);
ALTER TABLE deadlines ADD CONSTRAINT deadlines_title_len CHECK (char_length(title) <= 160);
ALTER TABLE savings ADD CONSTRAINT savings_title_len CHECK (char_length(title) <= 160);
ALTER TABLE savings ADD CONSTRAINT savings_rationale_len CHECK (char_length(rationale) <= 300);
ALTER TABLE recommended_actions ADD CONSTRAINT actions_title_len CHECK (char_length(title) <= 160);
ALTER TABLE recommended_actions ADD CONSTRAINT actions_rationale_len CHECK (char_length(rationale) <= 300);
ALTER TABLE detected_subscriptions ADD CONSTRAINT detsub_org_len CHECK (char_length(organization) <= 120);
