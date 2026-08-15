export const runtime = 'nodejs';

import { createClient } from '@/lib/supabase/server';
import { buildChatSystemPrompt, type ChatContext } from '@/lib/ai/chat-prompt';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const STREAM_URL =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
    role: 'user' | 'ai';
    text: string;
}

// ─── Messages formatter (format Gemini contents[]) ───────────────────────────

function toGeminiContents(messages: ChatMessage[]) {
    // Gemini : rôles "user" et "model", alternance stricte, commence par "user"
    const filtered = messages
        .filter(m => m.text.trim().length > 0)
        .map(m => ({
            role:  m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.text }],
        }));

    // Commence par le 1er message "user"
    const firstUserIdx = filtered.findIndex(m => m.role === 'user');
    if (firstUserIdx < 0) return [];
    const trimmed = filtered.slice(firstUserIdx);

    // Dédoublonne les rôles consécutifs identiques
    const deduped: { role: string; parts: { text: string }[] }[] = [];
    for (const msg of trimmed) {
        if (deduped.length === 0 || deduped[deduped.length - 1].role !== msg.role) {
            deduped.push(msg);
        }
    }

    return deduped;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return new Response('Non authentifié.', { status: 401 });
        }

        const { messages, context }: { messages: ChatMessage[]; context: ChatContext } =
            await req.json();

        if (!GEMINI_API_KEY) {
            return new Response('GEMINI_API_KEY non configurée.', { status: 500 });
        }

        const contents = toGeminiContents(messages);
        if (contents.length === 0) {
            return new Response('Aucun message valide.', { status: 400 });
        }

        const payload = {
            system_instruction: { parts: [{ text: buildChatSystemPrompt(context) }] },
            contents,
            generationConfig: { maxOutputTokens: 1024, temperature: 0.7 },
        };

        // Appel Gemini streaming — l'erreur éventuelle est levée ICI (avant de retourner la Response)
        const geminiRes = await fetch(`${STREAM_URL}&key=${GEMINI_API_KEY}`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload),
        });

        if (!geminiRes.ok || !geminiRes.body) {
            const err = await geminiRes.text();
            return new Response(`Erreur Gemini ${geminiRes.status}: ${err}`, { status: 502 });
        }

        // Parse le SSE Gemini et re-stream uniquement le texte vers le client
        const readable = new ReadableStream({
            async start(controller) {
                const encoder  = new TextEncoder();
                const reader   = geminiRes.body!.getReader();
                const decoder  = new TextDecoder();
                let   buffer   = '';

                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() ?? '';   // garde la ligne incomplète

                        for (const line of lines) {
                            if (!line.startsWith('data: ')) continue;
                            const jsonStr = line.slice(6).trim();
                            if (!jsonStr || jsonStr === '[DONE]') continue;

                            try {
                                const chunk = JSON.parse(jsonStr);
                                const text: string =
                                    chunk?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
                                if (text) {
                                    controller.enqueue(encoder.encode(text));
                                }
                            } catch {
                                // ligne SSE mal formée, on ignore
                            }
                        }
                    }
                } catch {
                    controller.enqueue(encoder.encode('⚠️ Erreur pendant la génération.'));
                } finally {
                    controller.close();
                }
            },
        });

        return new Response(readable, {
            status:  200,
            headers: {
                'Content-Type':      'text/plain; charset=utf-8',
                'Cache-Control':     'no-cache',
                'X-Accel-Buffering': 'no',
            },
        });

    } catch (err) {
        console.error('[/api/chat]', err);
        const msg = err instanceof Error ? err.message : 'Erreur inconnue';
        return new Response(msg, { status: 500 });
    }
}
