-- Essai gratuit (1er mois offert), écrit exclusivement par le webhook Stripe.
-- trial_used_at : consomme définitivement le droit à l'essai, jamais remis à null
--                 (y compris à la résiliation) — c'est lui qui interdit un 2e essai.
-- trial_ends_at : fin de l'essai en cours, null dès que l'abonnement devient payant.
-- Voir src/lib/billing/trial.ts et src/app/api/stripe/webhook/route.ts.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trial_used_at timestamp with time zone;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trial_ends_at timestamp with time zone;
