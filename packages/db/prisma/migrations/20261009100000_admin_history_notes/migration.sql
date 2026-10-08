-- CreateTable
CREATE TABLE "billing_history" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromPlan" "PlanTier" NOT NULL,
    "toPlan" "PlanTier" NOT NULL,
    "fromStatus" "BillingStatus" NOT NULL,
    "toStatus" "BillingStatus" NOT NULL,
    "interval" TEXT,
    "mrrBeforeCents" INTEGER NOT NULL,
    "mrrAfterCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "billing_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_notes" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "billing_history_at_idx" ON "billing_history"("at");

-- CreateIndex
CREATE INDEX "billing_history_householdId_idx" ON "billing_history"("householdId");

-- CreateIndex
CREATE INDEX "support_notes_userId_createdAt_idx" ON "support_notes"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "support_notes" ADD CONSTRAINT "support_notes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Garde-fous : longueur d'une note, et tables réservées au rôle de service (le rôle applicatif n'y accède jamais).
ALTER TABLE support_notes ADD CONSTRAINT support_notes_len CHECK (char_length(body) BETWEEN 1 AND 500);
REVOKE ALL ON billing_history FROM mai_app;
REVOKE ALL ON support_notes FROM mai_app;
