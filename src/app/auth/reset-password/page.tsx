'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import Image from 'next/image';

export default function ResetPasswordPage() {
    const router = useRouter();
    const supabase = createClient();

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    const [isLoading, setIsLoading] = useState(false);
    const [isVerifying, setIsVerifying] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    // Vérifie que l'utilisateur a bien une session valide (issue du lien email)
    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            if (!user) {
                // Lien invalide ou expiré → renvoyer vers forgot-password
                router.replace('/auth/forgot-password?error=link_expired');
            }
            setIsVerifying(false);
        });
    }, [router, supabase]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (password.length < 6) {
            setError('Le mot de passe doit contenir au moins 6 caractères.');
            return;
        }
        if (password !== confirmPassword) {
            setError('Les mots de passe ne correspondent pas.');
            return;
        }

        setIsLoading(true);

        const { error } = await supabase.auth.updateUser({ password });

        if (error) {
            setError(error.message);
            setIsLoading(false);
            return;
        }

        setSuccess(true);
        // Redirection automatique vers l'app après 2 secondes.
        // Navigation complète : la session issue du lien email a été posée via
        // document.cookie ; le passage par le proxy la ré-émet en Set-Cookie.
        setTimeout(() => window.location.assign('/'), 2000);
    };

    if (isVerifying) {
        return (
            <div className="min-h-screen bg-white dark:bg-slate-950 flex items-center justify-center">
                <Loader2 size={32} className="text-blue-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-white dark:bg-slate-950 flex items-center justify-center p-4">

            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-40 -right-40 w-96 h-96 bg-blue-600/5 rounded-full blur-3xl" />
                <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-blue-800/5 rounded-full blur-3xl" />
            </div>

            <div className="relative w-full max-w-md">

                {/* Branding */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 shadow-lg shadow-blue-900/40 mb-4">
                        <Image
                            src="/logoWhite.png"
                            alt="Logo"
                            width={40}
                            height={40}
                            className="invert dark:invert-0"
                        />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">PulsePeak</h1>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Nouveau mot de passe</p>
                </div>

                <div className="bg-white/90 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-6">

                    {success ? (
                        <div className="text-center py-4">
                            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 mb-4">
                                <CheckCircle2 size={28} className="text-emerald-600 dark:text-emerald-400" />
                            </div>
                            <h2 className="text-slate-900 dark:text-white font-semibold text-lg mb-2">Mot de passe mis à jour !</h2>
                            <p className="text-slate-500 dark:text-slate-400 text-sm">
                                Redirection en cours...
                            </p>
                        </div>
                    ) : (
                        <>
                            <div className="flex items-center gap-3 mb-6">
                                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 shrink-0">
                                    <ShieldCheck size={18} className="text-blue-600 dark:text-blue-400" />
                                </div>
                                <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">
                                    Choisissez un nouveau mot de passe sécurisé pour votre compte.
                                </p>
                            </div>

                            {error && (
                                <div className="flex items-start gap-2 bg-red-100 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl px-4 py-3 mb-5 text-red-600 dark:text-red-400 text-sm">
                                    <AlertCircle size={15} className="shrink-0 mt-0.5" />
                                    {error}
                                </div>
                            )}

                            <form onSubmit={handleSubmit} className="space-y-4">
                                {/* Nouveau mot de passe */}
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                                        Nouveau mot de passe
                                    </label>
                                    <div className="relative">
                                        <input
                                            type={showPassword ? 'text' : 'password'}
                                            value={password}
                                            onChange={e => setPassword(e.target.value)}
                                            placeholder="6 caractères minimum"
                                            autoFocus
                                            className="w-full bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/30 transition-colors pr-10"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(s => !s)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                                        >
                                            {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                                        </button>
                                    </div>

                                    {/* Indicateur de force */}
                                    {password.length > 0 && (
                                        <div className="mt-2 flex gap-1">
                                            {[1, 2, 3, 4].map((level) => {
                                                const strength = password.length >= 12 ? 4
                                                    : password.length >= 8 ? 3
                                                        : password.length >= 6 ? 2
                                                            : 1;
                                                return (
                                                    <div
                                                        key={level}
                                                        className={`h-1 flex-1 rounded-full transition-colors ${level <= strength
                                                                ? strength === 4 ? 'bg-emerald-500'
                                                                    : strength === 3 ? 'bg-blue-500'
                                                                        : strength === 2 ? 'bg-yellow-500'
                                                                            : 'bg-red-500'
                                                                : 'bg-slate-200 dark:bg-slate-700'
                                                            }`}
                                                    />
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                {/* Confirmation */}
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
                                            className="w-full bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/30 transition-colors pr-10"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowConfirm(s => !s)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                                        >
                                            {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                                        </button>
                                    </div>

                                    {/* Indicateur de correspondance */}
                                    {confirmPassword.length > 0 && (
                                        <p className={`text-xs mt-1.5 ${password === confirmPassword ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                            {password === confirmPassword ? '✓ Les mots de passe correspondent' : '✗ Les mots de passe ne correspondent pas'}
                                        </p>
                                    )}
                                </div>

                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors text-sm shadow-lg shadow-blue-900/30 mt-2"
                                >
                                    {isLoading ? (
                                        <><Loader2 size={16} className="animate-spin" /> Mise à jour...</>
                                    ) : (
                                        'Mettre à jour le mot de passe'
                                    )}
                                </button>
                            </form>
                        </>
                    )}
                </div>

                <p className="text-center text-xs text-slate-500 dark:text-slate-600 mt-6">
                    PulsePeak · Triathlon Training Intelligence
                </p>
            </div>
        </div>
    );
}
