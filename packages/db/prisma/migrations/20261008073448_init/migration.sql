-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('NONE', 'SUPPORT', 'ADMIN');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'WRITE', 'READ');

-- CreateEnum
CREATE TYPE "ProfileRelation" AS ENUM ('SELF', 'SPOUSE', 'CHILD', 'PARENT', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'SCANNING', 'QUARANTINED', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "DocumentSource" AS ENUM ('WEB_UPLOAD', 'EMAIL', 'MOBILE');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('UNKNOWN', 'INVOICE', 'CONTRACT', 'TAX', 'INSURANCE', 'HEALTH', 'BANK_STATEMENT', 'UTILITY', 'TELECOM', 'OFFICIAL_LETTER', 'PAYSLIP', 'OTHER');

-- CreateEnum
CREATE TYPE "OcrMethod" AS ENUM ('NATIVE_TEXT', 'VISION_LLM', 'OCR_ENGINE');

-- CreateEnum
CREATE TYPE "DeadlineKind" AS ENUM ('PAYMENT', 'RENEWAL', 'CANCELLATION_NOTICE', 'TAX_FILING', 'RESPONSE_REQUIRED', 'OTHER');

-- CreateEnum
CREATE TYPE "DeadlineStatus" AS ENUM ('OPEN', 'DONE', 'DISMISSED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "ProvenanceSource" AS ENUM ('AI', 'USER');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'PUSH', 'IN_APP');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'SENT', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "SavingKind" AS ENUM ('FORGOTTEN_SUBSCRIPTION', 'DUPLICATE', 'PRICE_INCREASE', 'COSTLY_INSURANCE', 'UNSUITED_PLAN', 'FEE', 'OTHER');

-- CreateEnum
CREATE TYPE "SavingStatus" AS ENUM ('DETECTED', 'ACCEPTED', 'DISMISSED', 'REALIZED');

-- CreateEnum
CREATE TYPE "DetectedSubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "BillingPeriod" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('CANCEL_CONTRACT', 'CONTEST', 'REQUEST_REFUND', 'FOLLOW_UP', 'REPLY_REQUIRED', 'PAY_BEFORE', 'REVIEW_DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'IN_PROGRESS', 'DONE', 'DISMISSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "LetterKind" AS ENUM ('CANCELLATION', 'CONTESTATION', 'COMPLAINT', 'REFUND_REQUEST', 'FORMAL_NOTICE', 'FREE');

-- CreateEnum
CREATE TYPE "LetterStatus" AS ENUM ('DRAFT', 'VALIDATED', 'SENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LetterChannel" AS ENUM ('PDF_EXPORT', 'EMAIL', 'REGISTERED_EMAIL', 'POSTAL');

-- CreateEnum
CREATE TYPE "InboundEmailStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "AiTask" AS ENUM ('OCR', 'CLASSIFY', 'EXTRACT', 'SUMMARIZE', 'DEADLINES', 'SAVINGS', 'LETTER', 'AGENT');

-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('OK', 'INVALID_OUTPUT', 'ERROR', 'REFUSED');

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('FREE', 'SOLO', 'FAMILLE');

-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'INCOMPLETE', 'UNPAID');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('TERMS', 'PRIVACY', 'SENSITIVE_DATA_PROCESSING', 'AI_PROCESSING', 'MARKETING_EMAIL');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'fr',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris',
    "staffRole" "StaffRole" NOT NULL DEFAULT 'NONE',
    "onboardingStep" INTEGER NOT NULL DEFAULT 0,
    "onboardedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "bannedAt" TIMESTAMP(3),
    "deletionRequestedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two_factors" (
    "id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "two_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_events" (
    "id" UUID NOT NULL,
    "userId" TEXT,
    "emailHash" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "method" TEXT NOT NULL,
    "failReason" TEXT,
    "ipHash" TEXT NOT NULL,
    "ipPrefix" TEXT,
    "country" TEXT,
    "userAgent" TEXT,
    "deviceHash" TEXT,
    "suspicious" BOOLEAN NOT NULL DEFAULT false,
    "riskReasons" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "households" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "wrappedDek" BYTEA NOT NULL,
    "kekVersion" INTEGER NOT NULL DEFAULT 1,
    "inboundAlias" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "households_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "userId" TEXT,
    "displayName" TEXT NOT NULL,
    "relation" "ProfileRelation" NOT NULL,
    "birthYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "profileId" UUID,
    "uploadedById" TEXT,
    "source" "DocumentSource" NOT NULL,
    "inboundEmailId" UUID,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "kind" "DocumentKind" NOT NULL DEFAULT 'UNKNOWN',
    "title" TEXT NOT NULL,
    "organization" TEXT,
    "summary" TEXT,
    "urgencyScore" INTEGER,
    "amountCents" INTEGER,
    "currency" TEXT DEFAULT 'EUR',
    "documentDate" TIMESTAMP(3),
    "failureReason" TEXT,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "scanStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_texts" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "textEnc" BYTEA NOT NULL,
    "method" "OcrMethod" NOT NULL,
    "language" TEXT,
    "pageCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_texts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "system" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_tags" (
    "documentId" UUID NOT NULL,
    "tagId" UUID NOT NULL,
    "householdId" UUID NOT NULL,

    CONSTRAINT "document_tags_pkey" PRIMARY KEY ("documentId","tagId")
);

-- CreateTable
CREATE TABLE "extractions" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "dataEnc" BYTEA NOT NULL,
    "confidence" DOUBLE PRECISION,
    "aiRunId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deadlines" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "documentId" UUID,
    "kind" "DeadlineKind" NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER,
    "currency" TEXT DEFAULT 'EUR',
    "status" "DeadlineStatus" NOT NULL DEFAULT 'OPEN',
    "source" "ProvenanceSource" NOT NULL DEFAULT 'AI',
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deadlines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "deadlineId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "remindAt" TIMESTAMP(3) NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "detected_subscriptions" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "organization" TEXT NOT NULL,
    "label" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "period" "BillingPeriod" NOT NULL,
    "status" "DetectedSubscriptionStatus" NOT NULL DEFAULT 'UNKNOWN',
    "firstSeenAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "renewalDate" TIMESTAMP(3),
    "noticeDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "detected_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "savings" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "documentId" UUID,
    "subscriptionId" UUID,
    "kind" "SavingKind" NOT NULL,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "monthlyCents" INTEGER NOT NULL,
    "annualCents" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "SavingStatus" NOT NULL DEFAULT 'DETECTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "savings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommended_actions" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "type" "ActionType" NOT NULL,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "ActionStatus" NOT NULL DEFAULT 'PROPOSED',
    "documentId" UUID,
    "savingId" UUID,
    "dedupeKey" TEXT NOT NULL,
    "aiRunId" UUID,
    "expiresAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommended_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "letters" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "documentId" UUID,
    "actionId" UUID,
    "kind" "LetterKind" NOT NULL,
    "status" "LetterStatus" NOT NULL DEFAULT 'DRAFT',
    "subject" TEXT NOT NULL,
    "bodyEnc" BYTEA NOT NULL,
    "recipientEnc" BYTEA,
    "pdfKey" TEXT,
    "createdById" TEXT,
    "validatedById" TEXT,
    "validatedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "sentVia" "LetterChannel",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "letters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "householdId" UUID,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_emails" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "fromDomain" TEXT,
    "subject" TEXT,
    "status" "InboundEmailStatus" NOT NULL DEFAULT 'RECEIVED',
    "rejectReason" TEXT,
    "attachmentCount" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_runs" (
    "id" UUID NOT NULL,
    "householdId" UUID,
    "documentId" UUID,
    "task" "AiTask" NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicros" BIGINT NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "status" "AiRunStatus" NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_subscriptions" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT,
    "plan" "PlanTier" NOT NULL DEFAULT 'FREE',
    "status" "BillingStatus" NOT NULL DEFAULT 'ACTIVE',
    "interval" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_counters" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "documents" INTEGER NOT NULL DEFAULT 0,
    "aiCostMicros" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "usage_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorId" TEXT,
    "householdId" UUID,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ConsentType" NOT NULL,
    "version" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_export_requests" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "archiveKey" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "data_export_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deletion_requests" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_providerId_accountId_key" ON "accounts"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");

-- CreateIndex
CREATE INDEX "two_factors_userId_idx" ON "two_factors"("userId");

-- CreateIndex
CREATE INDEX "login_events_userId_createdAt_idx" ON "login_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "login_events_emailHash_createdAt_idx" ON "login_events"("emailHash", "createdAt");

-- CreateIndex
CREATE INDEX "login_events_ipHash_createdAt_idx" ON "login_events"("ipHash", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "households_inboundAlias_key" ON "households"("inboundAlias");

-- CreateIndex
CREATE INDEX "memberships_userId_idx" ON "memberships"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_householdId_userId_key" ON "memberships"("householdId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "invitations_householdId_idx" ON "invitations"("householdId");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- CreateIndex
CREATE INDEX "profiles_householdId_idx" ON "profiles"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_householdId_userId_key" ON "profiles"("householdId", "userId");

-- CreateIndex
CREATE INDEX "documents_householdId_createdAt_idx" ON "documents"("householdId", "createdAt");

-- CreateIndex
CREATE INDEX "documents_householdId_kind_idx" ON "documents"("householdId", "kind");

-- CreateIndex
CREATE INDEX "documents_householdId_status_idx" ON "documents"("householdId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_storageKey_key" ON "document_versions"("storageKey");

-- CreateIndex
CREATE INDEX "document_versions_householdId_sha256_idx" ON "document_versions"("householdId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_documentId_version_key" ON "document_versions"("documentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "document_texts_documentId_key" ON "document_texts"("documentId");

-- CreateIndex
CREATE INDEX "document_texts_householdId_idx" ON "document_texts"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "tags_householdId_name_key" ON "tags"("householdId", "name");

-- CreateIndex
CREATE INDEX "document_tags_householdId_idx" ON "document_tags"("householdId");

-- CreateIndex
CREATE INDEX "extractions_householdId_documentId_idx" ON "extractions"("householdId", "documentId");

-- CreateIndex
CREATE INDEX "deadlines_householdId_dueDate_idx" ON "deadlines"("householdId", "dueDate");

-- CreateIndex
CREATE INDEX "deadlines_householdId_status_idx" ON "deadlines"("householdId", "status");

-- CreateIndex
CREATE INDEX "reminders_status_remindAt_idx" ON "reminders"("status", "remindAt");

-- CreateIndex
CREATE INDEX "reminders_householdId_idx" ON "reminders"("householdId");

-- CreateIndex
CREATE INDEX "detected_subscriptions_householdId_status_idx" ON "detected_subscriptions"("householdId", "status");

-- CreateIndex
CREATE INDEX "savings_householdId_status_priority_idx" ON "savings"("householdId", "status", "priority");

-- CreateIndex
CREATE INDEX "recommended_actions_householdId_status_priority_idx" ON "recommended_actions"("householdId", "status", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "recommended_actions_householdId_dedupeKey_key" ON "recommended_actions"("householdId", "dedupeKey");

-- CreateIndex
CREATE INDEX "letters_householdId_status_idx" ON "letters"("householdId", "status");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_type_channel_key" ON "notification_preferences"("userId", "type", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_userId_idx" ON "push_subscriptions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_emails_householdId_providerMessageId_key" ON "inbound_emails"("householdId", "providerMessageId");

-- CreateIndex
CREATE INDEX "ai_runs_householdId_createdAt_idx" ON "ai_runs"("householdId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_runs_task_createdAt_idx" ON "ai_runs"("task", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "billing_subscriptions_householdId_key" ON "billing_subscriptions"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "billing_subscriptions_stripeCustomerId_key" ON "billing_subscriptions"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "billing_subscriptions_stripeSubscriptionId_key" ON "billing_subscriptions"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "usage_counters_householdId_period_key" ON "usage_counters"("householdId", "period");

-- CreateIndex
CREATE INDEX "audit_logs_householdId_createdAt_idx" ON "audit_logs"("householdId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "consents_userId_type_createdAt_idx" ON "consents"("userId", "type", "createdAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_inboundEmailId_fkey" FOREIGN KEY ("inboundEmailId") REFERENCES "inbound_emails"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_texts" ADD CONSTRAINT "document_texts_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_tags" ADD CONSTRAINT "document_tags_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_tags" ADD CONSTRAINT "document_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_deadlineId_fkey" FOREIGN KEY ("deadlineId") REFERENCES "deadlines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detected_subscriptions" ADD CONSTRAINT "detected_subscriptions_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings" ADD CONSTRAINT "savings_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings" ADD CONSTRAINT "savings_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings" ADD CONSTRAINT "savings_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "detected_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommended_actions" ADD CONSTRAINT "recommended_actions_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommended_actions" ADD CONSTRAINT "recommended_actions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommended_actions" ADD CONSTRAINT "recommended_actions_savingId_fkey" FOREIGN KEY ("savingId") REFERENCES "savings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letters" ADD CONSTRAINT "letters_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letters" ADD CONSTRAINT "letters_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letters" ADD CONSTRAINT "letters_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "recommended_actions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_export_requests" ADD CONSTRAINT "data_export_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
