'use client';

/******************************************************************************
 * @file    admin/PromotionsPanel.tsx
 * @brief   CRUD des codes promo dans le dashboard admin.
 *
 * Contraintes Stripe reflétées par l'UI (voir actions/promotions.ts) :
 *   - la remise d'un code existant est immuable → « modifier » = activer /
 *     désactiver / renommer ; changer la remise passe par « Dupliquer »,
 *     qui pré-remplit le formulaire de création ;
 *   - supprimer désactive le code et supprime le coupon : irréversible.
 ******************************************************************************/

import React, { useMemo, useState, useTransition } from 'react';
import { Ticket, Plus, Power, Trash2, Copy, Pencil, Check, X } from 'lucide-react';
import { Card, Button } from '@/components/ui';
import { Modal } from '@/components/ui/Modale';
import { ReturnCode } from '@/lib/data/type';
import {
    formatDiscount,
    formatDuration,
    promotionStatus,
    validatePromotionInput,
    type PromotionInput,
    type PromotionStatus,
    type PromotionSummary,
} from '@/lib/billing/promotions';
import {
    createPromotionAction,
    deletePromotionAction,
    updatePromotionAction,
} from '@/app/actions/promotions';

type Props = {
    initialPromotions: PromotionSummary[];
};

const EMPTY_FORM: PromotionInput = {
    code:             '',
    name:             '',
    discountType:     'percent',
    value:            20,
    duration:         'once',
    durationInMonths: 3,
    maxRedemptions:   null,
    expiresAt:        null,
    firstTimeOnly:    false,
};

const INPUT_CLASS = 'w-full h-10 px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400';
const LABEL_CLASS = 'block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5';

// Stripe laisse `active` à true sur un code expiré ou épuisé : le badge reflète
// le statut réellement opposable au Checkout, pas le seul drapeau Stripe.
const STATUS_PILL: Record<PromotionStatus, { label: string; className: string }> = {
    active:    { label: 'ACTIF',    className: 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300 border-green-200 dark:border-green-500/30' },
    disabled:  { label: 'INACTIF',  className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700' },
    expired:   { label: 'EXPIRÉ',   className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 border-amber-200 dark:border-amber-500/30' },
    exhausted: { label: 'ÉPUISÉ',   className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 border-amber-200 dark:border-amber-500/30' },
};

function formatDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export const PromotionsPanel: React.FC<Props> = ({ initialPromotions }) => {
    const [promotions, setPromotions] = useState<PromotionSummary[]>(initialPromotions);
    const [error, setError]           = useState<string | null>(null);
    const [pendingId, setPendingId]   = useState<string | null>(null);
    const [isFormOpen, setFormOpen]   = useState(false);
    const [form, setForm]             = useState<PromotionInput>(EMPTY_FORM);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [isSubmitting, startSubmit] = useTransition();
    const [, startTransition]         = useTransition();

    const activeCount = useMemo(
        () => promotions.filter(p => promotionStatus(p) === 'active').length,
        [promotions],
    );

    // Bloque la soumission dès l'ouverture, mais n'affiche le message qu'une fois
    // le formulaire entamé — sinon la modale s'ouvre déjà en rouge.
    const formError = isFormOpen ? validatePromotionInput(form) : null;
    const visibleFormError = form.code.trim() ? formError : null;

    function openCreateForm(preset?: PromotionSummary) {
        setError(null);
        // « Dupliquer » : la remise d'un code Stripe n'étant pas modifiable, on repart
        // du même paramétrage avec un nouveau code à saisir.
        setForm(preset
            ? {
                code:             '',
                name:             preset.name ?? '',
                discountType:     preset.percentOff !== null ? 'percent' : 'amount',
                value:            preset.percentOff ?? (preset.amountOffCents ?? 0) / 100,
                duration:         preset.duration,
                durationInMonths: preset.durationInMonths ?? 3,
                maxRedemptions:   preset.maxRedemptions,
                expiresAt:        preset.expiresAt ? preset.expiresAt.slice(0, 10) : null,
                firstTimeOnly:    false,
            }
            : EMPTY_FORM);
        setFormOpen(true);
    }

    function handleCreate() {
        setError(null);
        startSubmit(async () => {
            const res = await createPromotionAction(form);
            if (res.state === ReturnCode.RC_OK && res.promotion) {
                setPromotions(rows => [res.promotion!, ...rows]);
                setFormOpen(false);
                setForm(EMPTY_FORM);
            } else {
                setError(res.error ?? 'Impossible de créer ce code promo.');
            }
        });
    }

    function handleToggleActive(promo: PromotionSummary) {
        setError(null);
        setPendingId(promo.id);
        const prev = promotions;
        setPromotions(rows => rows.map(r => (r.id === promo.id ? { ...r, active: !r.active } : r)));
        startTransition(async () => {
            const res = await updatePromotionAction(promo.id, promo.couponId, { active: !promo.active });
            if (res.state !== ReturnCode.RC_OK) {
                setPromotions(prev);
                setError(res.error ?? 'Impossible de modifier ce code promo.');
            }
            setPendingId(null);
        });
    }

    function handleRename(promo: PromotionSummary) {
        const name = renameValue;
        setRenamingId(null);
        setError(null);
        setPendingId(promo.id);
        const prev = promotions;
        setPromotions(rows => rows.map(r => (r.id === promo.id ? { ...r, name: name.trim() || null } : r)));
        startTransition(async () => {
            const res = await updatePromotionAction(promo.id, promo.couponId, { name });
            if (res.state !== ReturnCode.RC_OK) {
                setPromotions(prev);
                setError(res.error ?? 'Impossible de renommer ce code promo.');
            }
            setPendingId(null);
        });
    }

    function handleDelete(promo: PromotionSummary) {
        if (!confirm(`Supprimer définitivement le code ${promo.code} ? Il deviendra inutilisable, mais les abonnements déjà remisés ne sont pas touchés.`)) return;
        setError(null);
        setPendingId(promo.id);
        const prev = promotions;
        setPromotions(rows => rows.filter(r => r.id !== promo.id));
        startTransition(async () => {
            const res = await deletePromotionAction(promo.id, promo.couponId);
            if (res.state !== ReturnCode.RC_OK) {
                setPromotions(prev);
                setError(res.error ?? 'Impossible de supprimer ce code promo.');
            }
            setPendingId(null);
        });
    }

    return (
        <>
            <Card noPadding className="overflow-hidden mb-6">
                {/* ── En-tête ─────────────────────────────────────────────── */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-4 border-b border-slate-200 dark:border-slate-800">
                    <div>
                        <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold">
                            <Ticket size={16} className="text-blue-500" />
                            Codes promo
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {promotions.length} code{promotions.length > 1 ? 's' : ''} · {activeCount} actif{activeCount > 1 ? 's' : ''}
                            {' '}· gérés directement dans Stripe
                        </p>
                    </div>
                    <Button size="sm" icon={Plus} onClick={() => openCreateForm()}>
                        Nouveau code
                    </Button>
                </div>

                {error && (
                    <div className="mx-4 mt-4 p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-sm text-red-700 dark:text-red-300">
                        {error}
                    </div>
                )}

                {/* ── Table ───────────────────────────────────────────────── */}
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                <th className="px-4 py-3 font-semibold">Code</th>
                                <th className="px-4 py-3 font-semibold">Remise</th>
                                <th className="px-4 py-3 font-semibold whitespace-nowrap">Durée</th>
                                <th className="px-4 py-3 font-semibold whitespace-nowrap">Utilisations</th>
                                <th className="px-4 py-3 font-semibold whitespace-nowrap">Expire le</th>
                                <th className="px-4 py-3 font-semibold">Statut</th>
                                <th className="px-4 py-3 font-semibold text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {promotions.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                                        Aucun code promo. Créez-en un pour un club, un proche ou une opération ponctuelle.
                                    </td>
                                </tr>
                            )}
                            {promotions.map((promo) => (
                                <tr
                                    key={promo.id}
                                    className={`border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors ${
                                        pendingId === promo.id ? 'opacity-60' : ''
                                    }`}
                                >
                                    {/* Code + libellé */}
                                    <td className="px-4 py-3">
                                        <div className="font-mono font-semibold text-slate-900 dark:text-white">
                                            {promo.code}
                                        </div>
                                        {renamingId === promo.id ? (
                                            <div className="flex items-center gap-1 mt-1">
                                                <input
                                                    autoFocus
                                                    value={renameValue}
                                                    maxLength={40}
                                                    onChange={(e) => setRenameValue(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') handleRename(promo);
                                                        if (e.key === 'Escape') setRenamingId(null);
                                                    }}
                                                    placeholder="Libellé interne"
                                                    className="h-7 px-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                                />
                                                <button
                                                    onClick={() => handleRename(promo)}
                                                    className="p-1 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
                                                    title="Valider"
                                                >
                                                    <Check size={13} />
                                                </button>
                                                <button
                                                    onClick={() => setRenamingId(null)}
                                                    className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                                                    title="Annuler"
                                                >
                                                    <X size={13} />
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => { setRenamingId(promo.id); setRenameValue(promo.name ?? ''); }}
                                                className="group flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                                                title="Renommer"
                                            >
                                                {promo.name || 'Sans libellé'}
                                                <Pencil size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                                            </button>
                                        )}
                                    </td>

                                    {/* Remise */}
                                    <td className="px-4 py-3 whitespace-nowrap font-semibold text-slate-900 dark:text-white">
                                        {formatDiscount(promo)}
                                    </td>

                                    {/* Durée */}
                                    <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">
                                        {formatDuration(promo.duration, promo.durationInMonths)}
                                    </td>

                                    {/* Utilisations */}
                                    <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">
                                        {promo.timesRedeemed}
                                        {promo.maxRedemptions !== null ? ` / ${promo.maxRedemptions}` : ' / ∞'}
                                    </td>

                                    {/* Expiration */}
                                    <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                                        {formatDate(promo.expiresAt)}
                                    </td>

                                    {/* Statut */}
                                    <td className="px-4 py-3">
                                        {(() => {
                                            const pill = STATUS_PILL[promotionStatus(promo)];
                                            return (
                                                <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border whitespace-nowrap ${pill.className}`}>
                                                    {pill.label}
                                                </span>
                                            );
                                        })()}
                                    </td>

                                    {/* Actions */}
                                    <td className="px-4 py-3 text-right whitespace-nowrap">
                                        <div className="inline-flex items-center gap-1">
                                            <button
                                                onClick={() => handleToggleActive(promo)}
                                                disabled={pendingId === promo.id || !promo.couponValid}
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                                                title={promo.active ? 'Désactiver' : 'Réactiver'}
                                            >
                                                <Power size={12} />
                                                {promo.active ? 'Désactiver' : 'Activer'}
                                            </button>
                                            <button
                                                onClick={() => openCreateForm(promo)}
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
                                                title="Créer un nouveau code avec la même remise"
                                            >
                                                <Copy size={12} />
                                                Dupliquer
                                            </button>
                                            <button
                                                onClick={() => handleDelete(promo)}
                                                disabled={pendingId === promo.id}
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-red-500 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50"
                                                title="Supprimer définitivement"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <p className="px-4 py-3 text-[11px] text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-800/60">
                    La remise d&apos;un code existant n&apos;est pas modifiable côté Stripe : pour changer un montant,
                    dupliquez le code puis désactivez l&apos;ancien.
                </p>
            </Card>

            {/* ── Formulaire de création ──────────────────────────────────── */}
            <Modal isOpen={isFormOpen} onClose={() => setFormOpen(false)} title="Nouveau code promo">
                <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label htmlFor="promo-form-code" className={LABEL_CLASS}>Code client *</label>
                            <input
                                id="promo-form-code"
                                value={form.code}
                                maxLength={40}
                                onChange={(e) => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                                placeholder="CLUB-TRI-2026"
                                className={`${INPUT_CLASS} font-mono`}
                            />
                        </div>
                        <div>
                            <label htmlFor="promo-form-name" className={LABEL_CLASS}>Libellé interne</label>
                            <input
                                id="promo-form-name"
                                value={form.name}
                                maxLength={40}
                                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                                placeholder="Club Tri Nantes"
                                className={INPUT_CLASS}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label htmlFor="promo-form-type" className={LABEL_CLASS}>Type de remise</label>
                            <select
                                id="promo-form-type"
                                value={form.discountType}
                                onChange={(e) => setForm(f => ({ ...f, discountType: e.target.value as 'percent' | 'amount' }))}
                                className={INPUT_CLASS}
                            >
                                <option value="percent">Pourcentage (%)</option>
                                <option value="amount">Montant fixe (€)</option>
                            </select>
                        </div>
                        <div>
                            <label htmlFor="promo-form-value" className={LABEL_CLASS}>
                                {form.discountType === 'percent' ? 'Remise (%)' : 'Remise (€)'}
                            </label>
                            <input
                                id="promo-form-value"
                                type="number"
                                min={0}
                                step={form.discountType === 'percent' ? 1 : 0.5}
                                value={form.value}
                                onChange={(e) => setForm(f => ({ ...f, value: Number(e.target.value) }))}
                                className={INPUT_CLASS}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label htmlFor="promo-form-duration" className={LABEL_CLASS}>Appliquée pendant</label>
                            <select
                                id="promo-form-duration"
                                value={form.duration}
                                onChange={(e) => setForm(f => ({ ...f, duration: e.target.value as PromotionInput['duration'] }))}
                                className={INPUT_CLASS}
                            >
                                <option value="once">Le 1er mois seulement</option>
                                <option value="repeating">Plusieurs mois</option>
                                <option value="forever">Toute la durée de l&apos;abonnement</option>
                            </select>
                        </div>
                        {form.duration === 'repeating' && (
                            <div>
                                <label htmlFor="promo-form-months" className={LABEL_CLASS}>Nombre de mois</label>
                                <input
                                    id="promo-form-months"
                                    type="number"
                                    min={1}
                                    max={36}
                                    value={form.durationInMonths ?? 1}
                                    onChange={(e) => setForm(f => ({ ...f, durationInMonths: Number(e.target.value) }))}
                                    className={INPUT_CLASS}
                                />
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label htmlFor="promo-form-max" className={LABEL_CLASS}>Nombre max d&apos;utilisations</label>
                            <input
                                id="promo-form-max"
                                type="number"
                                min={1}
                                value={form.maxRedemptions ?? ''}
                                onChange={(e) => setForm(f => ({ ...f, maxRedemptions: e.target.value ? Number(e.target.value) : null }))}
                                placeholder="Illimité"
                                className={INPUT_CLASS}
                            />
                        </div>
                        <div>
                            <label htmlFor="promo-form-expires" className={LABEL_CLASS}>Date d&apos;expiration</label>
                            <input
                                id="promo-form-expires"
                                type="date"
                                value={form.expiresAt ?? ''}
                                onChange={(e) => setForm(f => ({ ...f, expiresAt: e.target.value || null }))}
                                className={INPUT_CLASS}
                            />
                        </div>
                    </div>

                    <label className="flex items-start gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={form.firstTimeOnly}
                            onChange={(e) => setForm(f => ({ ...f, firstTimeOnly: e.target.checked }))}
                            className="mt-0.5 w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-400"
                        />
                        <span className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                            Réserver aux nouveaux clients
                            <span className="block text-slate-400 dark:text-slate-500">
                                Le code est refusé si le compte a déjà réglé une facture.
                            </span>
                        </span>
                    </label>

                    {visibleFormError && (
                        <p className="text-red-500 text-xs">{visibleFormError}</p>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-2">
                        <Button variant="outline" size="sm" onClick={() => setFormOpen(false)}>
                            Annuler
                        </Button>
                        <Button
                            size="sm"
                            icon={Plus}
                            onClick={handleCreate}
                            isLoading={isSubmitting}
                            disabled={isSubmitting || formError !== null}
                        >
                            Créer le code
                        </Button>
                    </div>
                </div>
            </Modal>
        </>
    );
};
