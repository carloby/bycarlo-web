// Función del chat de AiCarlo. Se sirve en /api/chat.
// Habla con Gemini usando la clave guardada en Netlify como GEMINI_API_KEY:
// la clave nunca viaja al navegador.

import type { Config, Context } from "@netlify/functions";
import { SYSTEM_PROMPT } from "./instrucciones.mts";
import { findUrl, inspectWeb } from "./web.mts";

// Se prueban en orden: si el primero está saturado o sin cupo, se pasa al siguiente.
const MODELS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"];
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const TRY_TIMEOUT_MS = 15000; // espera máxima por intento
const MAX_MESSAGES = 16; // mensajes de historial que se aceptan
const MAX_CHARS = 800; // caracteres por mensaje
const MAX_USER_TURNS = 8; // mensajes del visitante por conversación
const MAX_OUTPUT_TOKENS = 1200; // techo de cada respuesta (la brevedad la piden las instrucciones)
const CARD_KEYS = ["web", "marca", "mensual", "auto"];
const CARD_TAG = /\[\[\s*paquete\s*:\s*([a-z]+)\s*\]\]/gi;

type Msg = { role: "user" | "assistant"; content: string };
type Attempt = { modelo: string; estado: number; detalle: string; texto: string };

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

function modelList(): string[] {
  const preferred = Netlify.env.get("AICARLO_MODEL");
  return Array.from(new Set([preferred, ...MODELS].filter(Boolean) as string[]));
}

function systemText(): string {
  const hoy = new Intl.DateTimeFormat("es-ES", { dateStyle: "full", timeZone: "Europe/Madrid" }).format(new Date());
  return `${SYSTEM_PROMPT}\n\n# Hoy\nHoy es ${hoy}.`;
}

/** Una llamada a un modelo concreto. No lanza errores: devuelve qué pasó. */
async function callModel(apiKey: string, model: string, payload: unknown): Promise<Attempt> {
  try {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TRY_TIMEOUT_MS),
    });
    const raw = await res.text();
    let data: {
      error?: { status?: string; message?: string };
      candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
    } = {};
    try {
      data = JSON.parse(raw);
    } catch {
      return { modelo: model, estado: res.status, detalle: raw.slice(0, 200), texto: "" };
    }
    if (!res.ok || data.error) {
      const detalle = `${data.error?.status ?? ""}: ${String(data.error?.message ?? "").slice(0, 200)}`;
      return { modelo: model, estado: res.status, detalle, texto: "" };
    }
    const candidate = data.candidates?.[0];
    const texto = (candidate?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    return { modelo: model, estado: res.status, detalle: candidate?.finishReason ?? "", texto };
  } catch (err) {
    return { modelo: model, estado: 0, detalle: String(err).slice(0, 200), texto: "" };
  }
}

/** Prueba los modelos en orden hasta que uno conteste con texto. */
async function ask(apiKey: string, payload: unknown): Promise<{ texto: string; intentos: Attempt[] }> {
  const intentos: Attempt[] = [];
  for (const model of modelList()) {
    const attempt = await callModel(apiKey, model, payload);
    intentos.push(attempt);
    if (attempt.texto) return { texto: attempt.texto, intentos };
    // Una clave mala o una petición mal formada fallarán igual en todos: no se insiste.
    if (attempt.estado === 400 || attempt.estado === 401 || attempt.estado === 403) break;
  }
  return { texto: "", intentos };
}

export default async (req: Request, _context: Context) => {
  const apiKey = Netlify.env.get("GEMINI_API_KEY");

  if (req.method === "GET") {
    const headers = { "cache-control": "no-store" };
    // /api/chat?diagnostico=1 hace una llamada mínima y dice qué responde cada modelo.
    if (apiKey && new URL(req.url).searchParams.has("diagnostico")) {
      const { intentos } = await ask(apiKey, {
        contents: [{ role: "user", parts: [{ text: "Di hola en dos palabras." }] }],
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
      });
      return Response.json({ intentos: intentos.map((i) => ({ ...i, texto: i.texto.slice(0, 60) })) }, { headers });
    }
    // /api/chat a secas dice si hay clave configurada, sin enseñarla.
    return Response.json({ ok: true, configurado: Boolean(apiKey), proveedor: "gemini", modelos: modelList() }, { headers });
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

  // Si el visitante ha pegado una dirección web, se lee y se le pasa al modelo como datos.
  const last = messages[messages.length - 1];
  const url = findUrl(last.content);
  if (url) {
    const ficha = await inspectWeb(url);
    last.content += `\n\n[DATOS DE LA WEB DEL VISITANTE]\n${ficha}\n[FIN DE LOS DATOS]`;
  }

  const { texto, intentos } = await ask(apiKey, {
    systemInstruction: { parts: [{ text: systemText() }] },
    contents: messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.7 },
  });

  if (!texto) {
    console.error("AiCarlo: ningún modelo contestó", JSON.stringify(intentos));
    return Response.json({ error: "upstream" }, { status: 502 });
  }

  const cards: string[] = [];
  for (const match of texto.matchAll(CARD_TAG)) {
    const key = match[1].toLowerCase();
    if (CARD_KEYS.includes(key) && !cards.includes(key)) cards.push(key);
  }
  const reply = texto.replace(CARD_TAG, "").replace(/\n{3,}/g, "\n\n").trim();

  if (!reply) return Response.json({ error: "empty" }, { status: 502 });
  return Response.json({ reply, cards: cards.slice(0, 1) });
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
