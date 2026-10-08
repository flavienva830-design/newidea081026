-- Ordre des événements Stripe : un événement plus ancien que le dernier appliqué est ignoré.
ALTER TABLE "billing_subscriptions" ADD COLUMN "lastEventAt" TIMESTAMP(3);
