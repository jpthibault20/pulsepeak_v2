import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProfile } from '@/lib/data/crud';
import { PricingContent } from './PricingContent';
import type { Plan } from '@/lib/subscription/context';
import { LAUNCH_OFFER_END_DATE } from '@/app/actions/constants';
import { isTrialEligible } from '@/lib/billing/trial';

export default async function PricingPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        redirect('/auth');
    }

    const profile = await getProfile();
    const currentPlan = (profile?.plan ?? 'free') as Plan;
    const launchOfferActive = new Date() < new Date(`${LAUNCH_OFFER_END_DATE}T23:59:59`);

    return (
        <PricingContent
            currentPlan={currentPlan}
            launchOfferActive={launchOfferActive}
            trialEligible={isTrialEligible(profile)}
            priceIds={{
                monthly:       process.env.STRIPE_PRICE_MONTHLY ?? '',
                annual:        process.env.STRIPE_PRICE_ANNUAL ?? '',
                monthlyLaunch: process.env.STRIPE_PRICE_MONTHLY_LAUNCH ?? '',
            }}
        />
    );
}
