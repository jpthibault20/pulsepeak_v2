'use client';

import { Bot, Send, X, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Profile, Schedule } from "@/lib/data/DatabaseTypes";
import { FeatureGate } from "@/components/features/billing/FeatureGate";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
    role: 'user' | 'ai';
    text: string;
    streaming?: boolean;
}

interface ChatWidgetProps {
    isOpen: boolean;
    onClose: () => void;
    profile?: Profile;
    schedule?: Schedule;
}

// ─── Context builder (client-side, envoie uniquement ce qui est nécessaire) ──

function buildContext(profile?: Profile, schedule?: Schedule) {
    const recentWorkouts = (schedule?.workouts ?? [])
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 10)
        .map(w => ({
            date: w.date,
            sportType: w.sportType,
            title: w.title,
            duration: w.plannedData?.durationMinutes ?? 0,
            tss: w.plannedData?.plannedTSS ?? 0,
            status: w.status,
        }));

    return {
        firstName: profile?.firstName ?? 'Athlète',
        lastName: profile?.lastName ?? '',
        experience: profile?.experience ?? 'Inconnu',
        currentCTL: profile?.currentCTL ?? 0,
        activeSports: profile?.activeSports ?? { cycling: false, running: false, swimming: false },
        coachType: profile?.coachType ?? 'triathlon',
        goal: profile?.goal ?? 'Non défini',
        objectiveDate: profile?.objectiveDate ?? 'Non définie',
        recentWorkouts,
    };
}

// ─── Component ────────────────────────────────────────────────────────────────

export const ChatWidget = ({ isOpen, onClose, profile, schedule }: ChatWidgetProps) => {
    const [messages, setMessages] = useState<Message[]>([
        {
            role: 'ai',
            text: `Bonjour ${profile?.firstName ?? ''}\u00a0! Je suis votre Coach IA PulsePeak. Posez-moi vos questions sur l'entraînement, la récupération ou votre plan.`,
        },
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Mise à jour du message de bienvenue si le profil charge après
    useEffect(() => {
        if (profile?.firstName) {
            setMessages(prev => {
                if (prev.length === 1 && prev[0].role === 'ai') {
                    return [{
                        role: 'ai',
                        text: `Bonjour\u00a0${profile.firstName}\u00a0! Je suis votre Coach IA PulsePeak. Posez-moi vos questions sur l'entraînement, la récupération ou votre plan.`,
                    }];
                }
                return prev;
            });
        }
    }, [profile?.firstName]);

    // Auto-scroll
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    // Focus input à l'ouverture
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 150);
        }
    }, [isOpen]);

    const handleSend = async () => {
        const text = input.trim();
        if (!text || loading) return;

        const userMessage: Message = { role: 'user', text };
        const newMessages = [...messages, userMessage];
        setMessages(newMessages);
        setInput('');
        setLoading(true);

        // Placeholder streaming message
        const aiPlaceholder: Message = { role: 'ai', text: '', streaming: true };
        setMessages([...newMessages, aiPlaceholder]);

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: newMessages,
                    context: buildContext(profile, schedule),
                }),
            });

            if (!response.ok || !response.body) {
                const errText = await response.text().catch(() => '');
                throw new Error(errText || `Erreur ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let aiText = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                aiText += decoder.decode(value, { stream: true });

                setMessages(prev => {
                    const updated = [...prev];
                    updated[updated.length - 1] = { role: 'ai', text: aiText, streaming: true };
                    return updated;
                });
            }

            // Marque le message comme terminé
            setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'ai', text: aiText };
                return updated;
            });

        } catch (err) {
            console.error('Chat error:', err);
            const errMsg = err instanceof Error ? err.message : 'Erreur inconnue';
            setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                    role: 'ai',
                    text: `⚠️ ${errMsg}`,
                };
                return updated;
            });
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed bottom-20 right-3 md:bottom-6 md:right-6 w-[calc(100vw-24px)] max-w-sm h-[480px] md:h-[520px] bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700/80 rounded-2xl shadow-2xl shadow-black/40 z-60 flex flex-col animate-in slide-in-from-bottom-4 fade-in duration-200">

            {/* ── Header ── */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-t-2xl">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-600/20 flex items-center justify-center">
                        <Bot size={16} className="text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white leading-none">Coach IA</p>
                        <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                            En ligne
                        </p>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                >
                    <X size={18} />
                </button>
            </div>

            <FeatureGate feature="chat-ai" mode="blur" label="Coach IA">
                <>
                    {/* ── Messages ── */}
                    <div
                        ref={scrollRef}
                        className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
                    >
                        {messages.map((msg, i) => (
                            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`
                                    max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed
                                    ${msg.role === 'user'
                                        ? 'bg-blue-600 text-white rounded-br-sm'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-bl-sm border border-slate-200 dark:border-slate-700/60'
                                    }
                                `}>
                                    {msg.text}
                                    {msg.streaming && msg.text === '' && (
                                        <span className="flex gap-1 items-center h-4">
                                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0ms]" />
                                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]" />
                                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]" />
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* ── Input ── */}
                    <div className="px-3 pb-3 pt-2 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-b-2xl flex gap-2 items-center">
                        <input
                            ref={inputRef}
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                            placeholder="Posez votre question..."
                            disabled={loading}
                            className="flex-1 h-10 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 text-sm text-slate-900 dark:text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/50 disabled:opacity-60 transition-colors"
                        />
                        <button
                            onClick={handleSend}
                            disabled={loading || !input.trim()}
                            className="w-10 h-10 flex items-center justify-center bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-white transition-colors shrink-0"
                        >
                            {loading
                                ? <Loader2 size={16} className="animate-spin" />
                                : <Send size={16} />
                            }
                        </button>
                    </div>
                </>
            </FeatureGate>
        </div>
    );
};
