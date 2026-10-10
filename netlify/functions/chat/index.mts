// Función del chat de AiCarlo. Se sirve en /api/chat.
// Habla con Gemini usando la clave guardada en Netlify como GEMINI_API_KEY:
// la clave nunca viaja al navegador.

import type { Config, Context } from "@netlify/functions";
import { SYSTEM_PROMPT } from "./instrucciones.mts";

const DEFAULT_MODEL = "gemini-3.8-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_MESSAGES = 16; // mensajes de historial que se aceptan
const MAX_CHARS = 800; // caracteres por mensaje
const MAX_USER_TURNS = 8; // mensajes del visitante por conversación
const MAX_OUTPUT_TOKENS = 1200; // techo de cada respuesta (la brevedad la piden las instrucciones)
const CARD_KEYS = ["web", "marca", "mensual", "auto"];
const CARD_TAG = /\[\[\s*paquete\s*:\s*([a-z]+)\s*\]\]/gi;

type Msg = { role: "user" | "assistant"; content: string };

function sanitize(raw: unknown): Msg[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) return null;
  const out: Msg[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") return null;
    const { role, content } = m as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") return null;
    if (typeof content !== "string") return null;
    const text = content.trim().slice(0, MAX_CHARS);
    if (!text) return null;
    out.push({ role, content: text });
  }
  // La conversación tiene que empezar y terminar con el visitante.
  while (out.length && out[0].role !== "user") out.shift();
  if (!out.length || out[out.length - 1].role !== "user") return null;
  return out;
}

async function askGemini(apiKey: string, model: string, messages: Msg[]): Promise<string> {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.7 },
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`Gemini respondió ${res.status}: ${detail}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("")
    .trim();
}

export default async (req: Request, _context: Context) => {
  const apiKey = Netlify.env.get("GEMINI_API_KEY");
  const model = Netlify.env.get("AICARLO_MODEL") || DEFAULT_MODEL;

  // Comprobación rápida: abrir /api/chat en el navegador dice si el modelo está
  // configurado, sin enseñar ninguna clave.
  if (req.method === "GET") {
    return Response.json(
      { ok: true, configurado: Boolean(apiKey), proveedor: "gemini", modelo: model },
      { headers: { "cache-control": "no-store" } },
    );
  }

  let body: { messages?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad-json" }, { status: 400 });
  }

  const messages = sanitize(body?.messages);
  if (!messages) return Response.json({ error: "bad-request" }, { status: 400 });

  const userTurns = messages.filter((m) => m.role === "user").length;
  if (userTurns > MAX_USER_TURNS) {
    return Response.json({
      reply: "Hasta aquí llego yo: para seguir hace falta la Carlo de verdad. Escríbele por correo y te contesta ella.",
      cards: [],
      limit: true,
    });
  }

  if (!apiKey) return Response.json({ error: "not-configured" }, { status: 503 });

  try {
    const raw = await askGemini(apiKey, model, messages);

    const cards: string[] = [];
    for (const match of raw.matchAll(CARD_TAG)) {
      const key = match[1].toLowerCase();
      if (CARD_KEYS.includes(key) && !cards.includes(key)) cards.push(key);
    }
    const reply = raw.replace(CARD_TAG, "").replace(/\n{3,}/g, "\n\n").trim();

    if (!reply) return Response.json({ error: "empty" }, { status: 502 });
    return Response.json({ reply, cards: cards.slice(0, 1) });
  } catch (err) {
    console.error("AiCarlo: fallo al llamar al modelo", err);
    return Response.json({ error: "upstream" }, { status: 502 });
  }
};

export const config: Config = {
  path: "/api/chat",
  method: ["GET", "POST"],
  // Freno contra abusos: 10 mensajes por minuto desde una misma IP.
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["ip", "domain"],
    windowSize: 60,
    windowLimit: 10,
  },
};
