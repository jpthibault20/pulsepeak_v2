-- Champs d'abonnement Stripe, écrits exclusivement par le webhook Stripe
DO $$ BEGIN
    CREATE TYPE "billing_status" AS ENUM ('active', 'past_due', 'canceled', 'incomplete');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id varchar(255);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_subscription_id varchar(255);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_price_id varchar(255);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS billing_status billing_status;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS current_period_end timestamp with time zone;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS billing_interval varchar(10);
