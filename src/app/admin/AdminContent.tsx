'use client';

import React, { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import {
    ArrowLeft, Users, Zap, ShieldCheck, Activity, Sparkles,
    Search, RotateCw, Dumbbell, UserPlus,
} from 'lucide-react';
import { Card, Button } from '@/components/ui';
import { ReturnCode } from '@/lib/data/type';
import type { AdminUserRow, AdminStats } from '@/app/actions/admin';
import type { PromotionSummary } from '@/lib/billing/promotions';
import { PromotionsPanel } from './PromotionsPanel';
import {
    updateUserPlanAction,
    updateUserRoleAction,
    resetUserTokensAction,
} from '@/app/actions/admin';

type Props = {
    initialUsers: AdminUserRow[];
    initialStats: AdminStats | null;
    initialPromotions: PromotionSummary[];
};

const PLAN_OPTIONS: Array<'free' | 'dev' | 'pro'> = ['free', 'dev', 'pro'];
const ROLE_OPTIONS: Array<'user' | 'admin'> = ['user', 'admin'];

const PLAN_PILL: Record<'free' | 'dev' | 'pro', string> = {
    free: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700',
    dev:  'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 border-amber-200 dark:border-amber-500/30',
    pro:  'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300 border-green-200 dark:border-green-500/30',
};

const ROLE_PILL: Record<'user' | 'admin', string> = {
    user:  'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700',
    admin: 'bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-300 border-purple-200 dark:border-purple-500/30',
};

function formatDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(iso: string | null): string {
    if (!iso) return 'Jamais';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'Jamais';
    return d.toLocaleString('fr-FR', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

function daysSince(iso: string | null): number | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
}

export const AdminContent: React.FC<Props> = ({ initialUsers, initialStats, initialPromotions }) => {
    const [users, setUsers]       = useState<AdminUserRow[]>(initialUsers);
    const [stats]                 = useState<AdminStats | null>(initialStats);
    const [query, setQuery]       = useState('');
    const [planFilter, setPlanFilter] = useState<'all' | 'free' | 'dev' | 'pro'>('all');
    const [error, setError]       = useState<string | null>(null);
    const [pendingId, setPendingId] = useState<string | null>(null);
    const [, startTransition]     = useTransition();

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return users.filter((u) => {
            if (planFilter !== 'all' && u.plan !== planFilter) return false;
            if (!q) return true;
            const haystack = `${u.email} ${u.firstName} ${u.lastName}`.toLowerCase();
            return haystack.includes(q);
        });
    }, [users, query, planFilter]);

    async function handlePlanChange(userId: string, plan: 'free' | 'dev' | 'pro') {
        setError(null);
        setPendingId(userId);
        const prev = users;
        setUsers((rows) => rows.map((r) => (r.id === userId ? { ...r, plan } : r)));
        startTransition(async () => {
            const res = await updateUserPlanAction(userId, plan);
            if (res.state !== ReturnCode.RC_OK) {
                setUsers(prev);
                setError('Impossible de mettre à jour le plan.');
            }
            setPendingId(null);
        });
    }

    async function handleRoleChange(userId: string, role: 'user' | 'admin') {
        setError(null);
        setPendingId(userId);
        const prev = users;
        setUsers((rows) => rows.map((r) => (r.id === userId ? { ...r, role } : r)));
        startTransition(async () => {
            const res = await updateUserRoleAction(userId, role);
            if (res.state !== ReturnCode.RC_OK) {
                setUsers(prev);
                setError('Impossible de mettre à jour le rôle (vous ne pouvez pas vous retirer votre propre rôle admin).');
            }
            setPendingId(null);
        });
    }

    async function handleResetTokens(userId: string) {
        if (!confirm('Réinitialiser les compteurs IA (tokens mensuels + appels plan/workout) ?')) return;
        setError(null);
        setPendingId(userId);
        startTransition(async () => {
            const res = await resetUserTokensAction(userId);
            if (res.state === ReturnCode.RC_OK) {
                setUsers((rows) => rows.map((r) =>
                    r.id === userId
                        ? { ...r, tokenPerMonth: 0, aiPlanCallsCount: 0, aiWorkoutCallsCount: 0 }
                        : r,
                ));
            } else {
                setError('Impossible de réinitialiser les compteurs.');
            }
            setPendingId(null);
        });
    }

    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10">

            {/* ── Header ───────────────────────────────────────────────── */}
            <div className="flex items-center justify-between gap-3 mb-6">
                <div>
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-1">
                        <ShieldCheck size={14} className="text-purple-500" />
                        <span className="uppercase tracking-wider font-semibold">Administration</span>
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
                        Tableau de bord admin
                    </h1>
                </div>
                <Link href="/">
                    <Button variant="outline" icon={ArrowLeft} size="sm">Retour</Button>
                </Link>
            </div>

            {error && (
                <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-sm text-red-700 dark:text-red-300">
                    {error}
                </div>
            )}

            {/* ── Stats cards ──────────────────────────────────────────── */}
            {stats && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
                    <StatCard
                        icon={Users}
                        iconColor="text-blue-500"
                        label="Utilisateurs"
                        value={stats.totalUsers.toString()}
                        sub={`${stats.newUsersLast30Days} nouveaux / 30j`}
                    />
                    <StatCard
                        icon={Activity}
                        iconColor="text-emerald-500"
                        label="Actifs 7j / 30j"
                        value={`${stats.activeLast7Days} / ${stats.activeLast30Days}`}
                        sub="Dernière connexion"
                    />
                    <StatCard
                        icon={Sparkles}
                        iconColor="text-amber-500"
                        label="Tokens IA (mois)"
                        value={stats.totalTokensThisMonth.toLocaleString('fr-FR')}
                        sub={`${stats.totalWorkouts} workouts totaux`}
                    />
                    <StatCard
                        icon={Zap}
                        iconColor="text-purple-500"
                        label="Répartition plans"
                        value={`${stats.usersByPlan.pro} Pro · ${stats.usersByPlan.dev} Dev`}
                        sub={`${stats.usersByPlan.free} Free · ${stats.adminsCount} admin(s)`}
                    />
                </div>
            )}

            {/* ── Codes promo ──────────────────────────────────────────── */}
            <PromotionsPanel initialPromotions={initialPromotions} />

            {/* ── Filtres ──────────────────────────────────────────────── */}
            <Card className="mb-4">
                <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                    <div className="relative flex-1 max-w-md">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Rechercher par email ou nom…"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            className="w-full h-10 pl-9 pr-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
                        />
                    </div>
                    <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
                        {(['all', 'free', 'dev', 'pro'] as const).map((opt) => (
                            <button
                                key={opt}
                                onClick={() => setPlanFilter(opt)}
                                className={`px-3 h-8 rounded-lg text-xs font-semibold uppercase transition-colors ${
                                    planFilter === opt
                                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
                                }`}
                            >
                                {opt === 'all' ? 'Tous' : opt}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                    {filtered.length} utilisateur{filtered.length > 1 ? 's' : ''}
                </div>
            </Card>

            {/* ── Table ────────────────────────────────────────────────── */}
            <Card noPadding className="overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                <th className="px-4 py-3 font-semibold">Utilisateur</th>
                                <th className="px-4 py-3 font-semibold">Plan</th>
                                <th className="px-4 py-3 font-semibold">Rôle</th>
                                <th className="px-4 py-3 font-semibold whitespace-nowrap">Tokens / mois</th>
                                <th className="px-4 py-3 font-semibold whitespace-nowrap">Appels IA</th>
                                <th className="px-4 py-3 font-semibold whitespace-nowrap">Activité</th>
                                <th className="px-4 py-3 font-semibold whitespace-nowrap">Dernière connexion</th>
                                <th className="px-4 py-3 font-semibold">Inscrit</th>
                                <th className="px-4 py-3 font-semibold text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 && (
                                <tr>
                                    <td colSpan={9} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                                        Aucun utilisateur ne correspond.
                                    </td>
                                </tr>
                            )}
                            {filtered.map((u) => {
                                const days = daysSince(u.lastLoginAt);
                                const isStale = days === null || days > 30;
                                return (
                                    <tr
                                        key={u.id}
                                        className={`border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors ${
                                            pendingId === u.id ? 'opacity-60' : ''
                                        }`}
                                    >
                                        {/* Utilisateur */}
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-slate-900 dark:text-white">
                                                {u.firstName || u.lastName ? `${u.firstName} ${u.lastName}`.trim() : '—'}
                                            </div>
                                            <div className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[240px]">
                                                {u.email}
                                            </div>
                                        </td>

                                        {/* Plan */}
                                        <td className="px-4 py-3">
                                            <select
                                                value={u.plan}
                                                disabled={pendingId === u.id}
                                                onChange={(e) => handlePlanChange(u.id, e.target.value as 'free' | 'dev' | 'pro')}
                                                className={`h-8 px-2 pr-7 rounded-lg border text-xs font-semibold uppercase tracking-wide cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-400 ${PLAN_PILL[u.plan]}`}
                                            >
                                                {PLAN_OPTIONS.map((p) => (
                                                    <option key={p} value={p}>{p}</option>
                                                ))}
                                            </select>
                                        </td>

                                        {/* Rôle */}
                                        <td className="px-4 py-3">
                                            <select
                                                value={u.role}
                                                disabled={pendingId === u.id}
                                                onChange={(e) => handleRoleChange(u.id, e.target.value as 'user' | 'admin')}
                                                className={`h-8 px-2 pr-7 rounded-lg border text-xs font-semibold uppercase tracking-wide cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-400 ${ROLE_PILL[u.role]}`}
                                            >
                                                {ROLE_OPTIONS.map((r) => (
                                                    <option key={r} value={r}>{r}</option>
                                                ))}
                                            </select>
                                        </td>

                                        {/* Tokens / mois */}
                                        <td className="px-4 py-3 whitespace-nowrap">
                                            <div className="font-mono text-slate-900 dark:text-white">
                                                {u.tokenPerMonth.toLocaleString('fr-FR')}
                                            </div>
                                            <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                                reset {u.tokenPerMonthResetDate ?? '—'}
                                            </div>
                                        </td>

                                        {/* Appels IA */}
                                        <td className="px-4 py-3 whitespace-nowrap text-xs">
                                            <div className="flex items-center gap-1 text-slate-700 dark:text-slate-300">
                                                <Sparkles size={11} className="text-purple-500" />
                                                plan&nbsp;{u.aiPlanCallsCount}
                                            </div>
                                            <div className="flex items-center gap-1 text-slate-700 dark:text-slate-300">
                                                <Dumbbell size={11} className="text-blue-500" />
                                                wkt&nbsp;{u.aiWorkoutCallsCount}
                                            </div>
                                        </td>

                                        {/* Activité */}
                                        <td className="px-4 py-3 whitespace-nowrap text-xs">
                                            <div className="text-slate-700 dark:text-slate-300">
                                                {u.workoutsCount} workouts
                                            </div>
                                            <div className="text-slate-500 dark:text-slate-400">
                                                {u.plansCount} plan{u.plansCount > 1 ? 's' : ''}
                                            </div>
                                        </td>

                                        {/* Dernière connexion */}
                                        <td className={`px-4 py-3 whitespace-nowrap text-xs ${isStale ? 'text-slate-500' : 'text-slate-700 dark:text-slate-300'}`}>
                                            {formatDateTime(u.lastLoginAt)}
                                            {days !== null && (
                                                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                                    il y a {days} j
                                                </div>
                                            )}
                                        </td>

                                        {/* Inscrit */}
                                        <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                                            <div className="flex items-center gap-1">
                                                <UserPlus size={11} />
                                                {formatDate(u.createdAt)}
                                            </div>
                                        </td>

                                        {/* Actions */}
                                        <td className="px-4 py-3 text-right whitespace-nowrap">
                                            <button
                                                onClick={() => handleResetTokens(u.id)}
                                                disabled={pendingId === u.id}
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                                                title="Réinitialiser les compteurs IA"
                                            >
                                                <RotateCw size={12} />
                                                Reset
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
};

// ─── Stat card ───────────────────────────────────────────────────────────────

const StatCard: React.FC<{
    icon: React.ElementType;
    iconColor: string;
    label: string;
    value: string;
    sub?: string;
}> = ({ icon: Icon, iconColor, label, value, sub }) => (
    <Card className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
            <Icon size={14} className={iconColor} />
            {label}
        </div>
        <div className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
            {value}
        </div>
        {sub && (
            <div className="text-xs text-slate-500 dark:text-slate-400">
                {sub}
            </div>
        )}
    </Card>
);
