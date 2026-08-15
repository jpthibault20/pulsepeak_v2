'use client';

import React from 'react';
import type { Plan, Status } from '@/lib/subscription/context';

interface PlanBadgeProps {
    plan:    Plan;
    status?: Status;
    size?:   'sm' | 'md';
}

const CONFIG: Record<Plan, { label: string; className: string }> = {
    free: { label: 'GRATUIT',  className: 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600' },
    dev:  { label: 'ACCÈS COMPLET', className: 'bg-blue-50 dark:bg-blue-600/20 text-blue-600 dark:text-blue-300 border-blue-200 dark:border-blue-500/40' },
    pro:  { label: 'PRO',      className: 'bg-blue-50 dark:bg-blue-600/20 text-blue-600 dark:text-blue-300 border-blue-200 dark:border-blue-500/40' },
};

export function PlanBadge({ plan, status, size = 'md' }: PlanBadgeProps) {
    const { label, className } = CONFIG[plan];
    const isTrial = status === 'trial';

    return (
        <span className={`
            inline-flex items-center gap-1 border rounded-full font-bold tracking-wider
            ${size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-0.5 text-xs'}
            ${className}
        `}>
            {isTrial && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            )}
            {isTrial ? 'TRIAL' : label}
        </span>
    );
}
