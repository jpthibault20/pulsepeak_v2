'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Activity, Eye, EyeOff, Loader2, AlertCircle, CheckCircle2, ArrowRight, Mail, RefreshCw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { login, register } from '@/app/actions/auth';
import Image from 'next/image';


type Tab = 'login' | 'register';

interface FormInput {
    label: string;
    type: string;
    placeholder: string;
    value: string;
    onChange: (v: string) => void;
    isPassword?: boolean;
}

function InputField({ label, type, placeholder, value, onChange, isPassword }: FormInput) {
    const [show, setShow] = useState(false);
    return (
        <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">{label}</label>
            <div className="relative">
                <input
                    type={isPassword ? (show ? 'text' : 'password') : type}
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    placeholder={placeholder}
                    autoComplete={isPassword ? 'current-password' : undefined}
                    className="w-full bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/30 transition-colors pr-10"
                />
                {isPassword && (
                    <button
                        type="button"
                        onClick={() => setShow(s => !s)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                    >
                        {show ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                )}
            </div>
        </div>
    );
}

const RESEND_COOLDOWN = 60; // secondes

export default function AuthPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const supabase = createClient();

    const [tab, setTab] = useState<Tab>('login');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(
        searchParams.get('error') ? 'Une erreur est survenue. Veuillez réessayer.' : null
    );
    const [success, setSuccess] = useState<string | null>(null);

    // Login fields
    const [loginEmail, setLoginEmail] = useState('');
    const [loginPassword, setLoginPassword] = useState('');

    // Register fields
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [registerEmail, setRegisterEmail] = useState('');
    const [registerPassword, setRegisterPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    // Resend email state
    const [showResend, setShowResend] = useState(false);
    const [resendEmail, setResendEmail] = useState('');
    const [resendCooldown, setResendCooldown] = useState(0);
    const [isResending, setIsResending] = useState(false);

    // Countdown timer
    useEffect(() => {
        if (resendCooldown <= 0) return;
        const timer = setTimeout(() => setResendCooldown(c => c - 1), 1000);
        return () => clearTimeout(timer);
    }, [resendCooldown]);

    const resetMessages = () => {
        setError(null);
        setSuccess(null);
    };

    const handleResendEmail = useCallback(async (email: string) => {
        if (resendCooldown > 0 || !email) return;
        setIsResending(true);
        setError(null);
        const { error } = await supabase.auth.resend({ type: 'signup', email });
        setIsResending(false);
        if (error) {
            setError(error.message);
            return;
        }
        setResendCooldown(RESEND_COOLDOWN);
        setSuccess('Un nouveau mail de vérification a été envoyé ! Pensez à vérifier vos spams.');
    }, [resendCooldown, supabase.auth]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        resetMessages();
        setShowResend(false);
        if (!loginEmail || !loginPassword) {
            setError('Veuillez remplir tous les champs.');
            return;
        }
        setIsLoading(true);
        // Connexion via Server Action : les cookies de session sont posés par le
        // serveur (Set-Cookie), seule méthode fiable pour persister la session
        // sur iOS en mode app installée (PWA).
        const result = await login(loginEmail, loginPassword);
        if (result.error) {
            setError(result.error);
            if (result.needsEmailConfirmation) {
                setResendEmail(loginEmail);
                setShowResend(true);
            }
            setIsLoading(false);
            return;
        }
        // Navigation de document complète (pas router.push) : sur iOS en PWA
        // standalone, seuls les cookies posés sur une réponse de navigation
        // top-level sont persistés de façon fiable après un kill de l'app.
        // Le proxy ré-émet les cookies sb-* sur cette réponse (keepalive).
        window.location.assign('/');
    };

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        resetMessages();
        setShowResend(false);
        if (!firstName || !lastName || !registerEmail || !registerPassword || !confirmPassword) {
            setError('Veuillez remplir tous les champs.');
            return;
        }
        if (registerPassword.length < 6) {
            setError('Le mot de passe doit contenir au moins 6 caractères.');
            return;
        }
        if (registerPassword !== confirmPassword) {
            setError('Les mots de passe ne correspondent pas.');
            return;
        }
        setIsLoading(true);
        const result = await register(firstName, lastName, registerEmail, registerPassword);
        if (result.error) {
            setError(result.error);
            setIsLoading(false);
            return;
        }
        // Session immédiate (pas de confirmation email) : profil créé côté serveur.
        // Navigation complète pour persister les cookies (cf. handleLogin).
        if (!result.needsEmailConfirmation) {
            window.location.assign('/');
            return;
        }
        // Confirmation email requise → afficher le message + option de renvoi après le cooldown
        setResendEmail(registerEmail);
        setResendCooldown(RESEND_COOLDOWN);
        setShowResend(true);
        setSuccess('Compte créé ! Vérifiez votre boîte mail pour confirmer votre adresse.');
        setIsLoading(false);
    };

    return (
        <div className="min-h-screen bg-white dark:bg-slate-950 flex items-center justify-center p-4">

            {/* Fond décoratif */}
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
                    <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Votre coach triathlon intelligent</p>
                </div>

                {/* Card */}
                <div className="bg-white/90 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden">

                    {/* Onglets */}
                    <div className="flex border-b border-slate-200 dark:border-slate-800">
                        {(['login', 'register'] as Tab[]).map(t => (
                            <button
                                key={t}
                                onClick={() => { setTab(t); resetMessages(); setShowResend(false); }}
                                className={`flex-1 py-3.5 text-sm font-semibold transition-colors ${tab === t
                                    ? 'text-slate-900 dark:text-white border-b-2 border-blue-500 bg-blue-600/5'
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                    }`}
                            >
                                {t === 'login' ? 'Connexion' : 'Créer un compte'}
                            </button>
                        ))}
                    </div>

                    <div className="p-6">

                        {/* Message d'erreur */}
                        {error && (
                            <div className="flex items-start gap-2 bg-red-100 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl px-4 py-3 mb-5 text-red-600 dark:text-red-400 text-sm">
                                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                                {error}
                            </div>
                        )}

                        {/* Message de succès */}
                        {success && (
                            <div className="flex items-start gap-2 bg-emerald-100 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl px-4 py-3 mb-5 text-emerald-600 dark:text-emerald-400 text-sm">
                                <CheckCircle2 size={15} className="shrink-0 mt-0.5" />
                                {success}
                            </div>
                        )}

                        {/* Bloc renvoyer le mail de vérification */}
                        {showResend && (
                            <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl px-4 py-3.5 mb-5">
                                <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400 text-sm">
                                    <Mail size={15} className="shrink-0 mt-0.5" />
                                    <div>
                                        <p>Pensez à vérifier votre dossier <strong>spam / courrier indésirable</strong> avant de demander un nouveau mail.</p>
                                        <button
                                            type="button"
                                            disabled={resendCooldown > 0 || isResending}
                                            onClick={() => handleResendEmail(resendEmail)}
                                            className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:text-amber-800 dark:hover:text-amber-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                        >
                                            {isResending ? (
                                                <><Loader2 size={12} className="animate-spin" /> Envoi en cours...</>
                                            ) : resendCooldown > 0 ? (
                                                <><RefreshCw size={12} /> Renvoyer dans {resendCooldown}s</>
                                            ) : (
                                                <><RefreshCw size={12} /> Renvoyer le mail de vérification</>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ── Formulaire Connexion ── */}
                        {tab === 'login' && (
                            <form onSubmit={handleLogin} className="space-y-4">
                                <InputField
                                    label="Adresse email"
                                    type="email"
                                    placeholder="nom@exemple.com"
                                    value={loginEmail}
                                    onChange={setLoginEmail}
                                />
                                <InputField
                                    label="Mot de passe"
                                    type="password"
                                    placeholder="••••••••"
                                    value={loginPassword}
                                    onChange={setLoginPassword}
                                    isPassword
                                />

                                <div className="flex justify-end">
                                    <button
                                        type="button"
                                        className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 transition-colors"
                                        onClick={() => router.push('/auth/forgot-password')}
                                    >
                                        Mot de passe oublié ?
                                    </button>
                                </div>

                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors text-sm shadow-lg shadow-blue-900/30 mt-2"
                                >
                                    {isLoading ? (
                                        <><Loader2 size={16} className="animate-spin" /> Connexion...</>
                                    ) : (
                                        <><Activity size={16} /> Se connecter</>
                                    )}
                                </button>
                            </form>
                        )}

                        {/* ── Formulaire Inscription ── */}
                        {tab === 'register' && (
                            <form onSubmit={handleRegister} className="space-y-4">
                                <div className="grid grid-cols-2 gap-3">
                                    <InputField
                                        label="Prénom"
                                        type="text"
                                        placeholder="Jean"
                                        value={firstName}
                                        onChange={setFirstName}
                                    />
                                    <InputField
                                        label="Nom"
                                        type="text"
                                        placeholder="Dupont"
                                        value={lastName}
                                        onChange={setLastName}
                                    />
                                </div>
                                <InputField
                                    label="Adresse email"
                                    type="email"
                                    placeholder="nom@exemple.com"
                                    value={registerEmail}
                                    onChange={setRegisterEmail}
                                />
                                <InputField
                                    label="Mot de passe"
                                    type="password"
                                    placeholder="6 caractères minimum"
                                    value={registerPassword}
                                    onChange={setRegisterPassword}
                                    isPassword
                                />
                                <InputField
                                    label="Confirmer le mot de passe"
                                    type="password"
                                    placeholder="••••••••"
                                    value={confirmPassword}
                                    onChange={setConfirmPassword}
                                    isPassword
                                />

                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors text-sm shadow-lg shadow-blue-900/30 mt-2"
                                >
                                    {isLoading ? (
                                        <><Loader2 size={16} className="animate-spin" /> Création du compte...</>
                                    ) : (
                                        <><ArrowRight size={16} /> Créer mon compte</>
                                    )}
                                </button>

                                <p className="text-[11px] text-slate-500 dark:text-slate-500 text-center leading-relaxed">
                                    En créant un compte, vous acceptez nos conditions d&apos;utilisation.
                                </p>
                            </form>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <p className="text-center text-xs text-slate-500 dark:text-slate-600 mt-6">
                    PulsePeak · Triathlon Training Intelligence
                </p>
            </div>
        </div>
    );
}
