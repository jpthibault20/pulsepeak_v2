'use client';

import React, { useState } from 'react';
import { Eye, EyeOff, Lock, LogOut, CheckCircle2, AlertCircle, Loader2, BookOpen } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { logout } from '@/app/actions/auth';
import { clearSessionBackup } from '@/lib/supabase/session-backup';
import { resetTutorial } from '@/components/features/tutorial/TutorialOverlay';

interface AccountSettingsProps {
    stravaWriteBack?: boolean;
    onStravaWriteBackChange?: (value: boolean) => void;
    isPro?: boolean;
    hasStrava?: boolean;
}

export function AccountSettings({ stravaWriteBack = true, onStravaWriteBackChange, isPro = false, hasStrava = false }: AccountSettingsProps) {
    const supabase = createClient();

    const [newPassword, setNewPassword]       = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showNew, setShowNew]               = useState(false);
    const [showConfirm, setShowConfirm]       = useState(false);
    const [isChanging, setIsChanging]         = useState(false);
    const [isLoggingOut, setIsLoggingOut]     = useState(false);
    const [error, setError]                   = useState<string | null>(null);
    const [success, setSuccess]               = useState<string | null>(null);

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        if (newPassword.length < 6) {
            setError('Le mot de passe doit contenir au moins 6 caractères.');
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('Les mots de passe ne correspondent pas.');
            return;
        }

        setIsChanging(true);
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) {
            setError(error.message);
        } else {
            setSuccess('Mot de passe mis à jour avec succès.');
            setNewPassword('');
            setConfirmPassword('');
        }
        setIsChanging(false);
    };

    const handleLogout = async () => {
        setIsLoggingOut(true);
        // Effacer la sauvegarde locale AVANT la déconnexion, sinon le filet de
        // sécurité (AuthSessionGuard) ressusciterait la session sur /auth.
        clearSessionBackup();
        // Déconnexion via Server Action : supprime les cookies posés côté serveur
        await logout();
        window.location.assign('/auth');
    };

    return (
        <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-xl p-4 md:p-6 space-y-6">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Lock size={18} className="text-slate-500 dark:text-slate-400" />
                Compte &amp; Sécurité
            </h2>

            {/* ── Changement de mot de passe ── */}
            <form onSubmit={handleChangePassword} className="space-y-4">
                <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300">Changer le mot de passe</h3>

                {error && (
                    <div className="flex items-center gap-2 bg-red-100 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2.5 text-red-600 dark:text-red-400 text-sm">
                        <AlertCircle size={13} className="shrink-0" />
                        {error}
                    </div>
                )}
                {success && (
                    <div className="flex items-center gap-2 bg-emerald-100 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-lg px-3 py-2.5 text-emerald-600 dark:text-emerald-400 text-sm">
                        <CheckCircle2 size={13} className="shrink-0" />
                        {success}
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                            Nouveau mot de passe
                        </label>
                        <div className="relative">
                            <input
                                type={showNew ? 'text' : 'password'}
                                value={newPassword}
                                onChange={e => setNewPassword(e.target.value)}
                                placeholder="6 caractères minimum"
                                className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/30 transition-colors pr-9"
                            />
                            <button
                                type="button"
                                onClick={() => setShowNew(s => !s)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                            >
                                {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                            Confirmer le mot de passe
                        </label>
                        <div className="relative">
                            <input
                                type={showConfirm ? 'text' : 'password'}
                                value={confirmPassword}
                                onChange={e => setConfirmPassword(e.target.value)}
                                placeholder="••••••••"
                                className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/30 transition-colors pr-9"
                            />
                            <button
                                type="button"
                                onClick={() => setShowConfirm(s => !s)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                            >
                                {showConfirm ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                        </div>
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={isChanging || !newPassword || !confirmPassword}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                >
                    {isChanging ? (
                        <><Loader2 size={14} className="animate-spin" /> Mise à jour...</>
                    ) : (
                        <><Lock size={14} /> Mettre à jour le mot de passe</>
                    )}
                </button>
            </form>

            {/* ── Strava write-back ── */}
            {hasStrava && (
                <>
                    <div className="border-t border-slate-200 dark:border-slate-800" />
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                                Écrire le TSS sur Strava
                                {!isPro && <Lock size={12} className="text-slate-400" />}
                            </p>
                            <p className="text-xs text-slate-500 mt-0.5">
                                {isPro ? 'Ajoute le TSS calculé dans la description de vos activités Strava' : 'Disponible avec le plan Pro'}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                if (!isPro) return;
                                onStravaWriteBackChange?.(!stravaWriteBack);
                            }}
                            className={`shrink-0 ${!isPro ? 'cursor-not-allowed' : ''}`}
                        >
                            <div className={`
                                w-11 h-6 rounded-full transition-all relative
                                ${stravaWriteBack ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700'}
                                ${!isPro ? 'opacity-50' : ''}
                            `}>
                                <div className={`
                                    absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all
                                    ${stravaWriteBack ? 'left-[22px]' : 'left-0.5'}
                                `} />
                            </div>
                        </button>
                    </div>
                </>
            )}

            <div className="border-t border-slate-200 dark:border-slate-800" />

            {/* ── Revoir le tutoriel ── */}
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Tutoriel</p>
                    <p className="text-xs text-slate-500 mt-0.5">Revoir la présentation des fonctionnalités</p>
                </div>
                <button
                    onClick={() => {
                        resetTutorial();
                        window.dispatchEvent(new CustomEvent('pulsepeak:show-tutorial'));
                    }}
                    className="flex items-center gap-2 bg-blue-100 dark:bg-blue-500/10 hover:bg-blue-200 dark:hover:bg-blue-500/20 border border-blue-200 dark:border-blue-500/20 text-blue-600 dark:text-blue-400 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                >
                    <BookOpen size={14} />
                    Revoir le tutoriel
                </button>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-800" />

            {/* ── Déconnexion ── */}
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Se déconnecter</p>
                    <p className="text-xs text-slate-500 mt-0.5">Terminer la session en cours</p>
                </div>
                <button
                    onClick={handleLogout}
                    disabled={isLoggingOut}
                    className="flex items-center gap-2 bg-red-100 dark:bg-red-500/10 hover:bg-red-200 dark:hover:bg-red-500/20 border border-red-200 dark:border-red-500/20 disabled:opacity-50 text-red-600 dark:text-red-400 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                >
                    {isLoggingOut ? (
                        <Loader2 size={14} className="animate-spin" />
                    ) : (
                        <LogOut size={14} />
                    )}
                    {isLoggingOut ? 'Déconnexion...' : 'Se déconnecter'}
                </button>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-800" />

            {/* ── Version ── */}
            <p className="text-center text-xs text-slate-400 dark:text-slate-500">
                PulsePeak v{process.env.NEXT_PUBLIC_APP_VERSION}
            </p>
        </div>
    );
}
