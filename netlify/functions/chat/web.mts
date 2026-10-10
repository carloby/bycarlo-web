// Lectura de la web que pega un visitante, para que AiCarlo pueda opinar con datos.
// Solo se leen páginas públicas: se bloquean direcciones internas y se limita
// el tamaño y el tiempo. Lo que se extrae se le pasa al modelo como datos.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_BYTES = 400_000;
const TIMEOUT_MS = 7000;
const MAX_REDIRECTS = 3;
const TLDS =
  "es|com|net|org|io|co|app|dev|eu|cat|gal|eus|me|shop|store|online|site|info|biz|studio|design|art|blog|mx|ar|cl|pe|pt|fr|it|de|uk|us";
const URL_RE = new RegExp(
  `(https?:\\/\\/[^\\s<>"']+|(?:www\\.)?(?:[a-z0-9-]+\\.)+(?:${TLDS})\\b(?:\\/[^\\s<>"']*)?)`,
  "gi",
);

/** Devuelve la primera dirección web que aparezca en el texto, o null. */
export function findUrl(text: string): string | null {
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    if (start > 0 && text[start - 1] === "@") continue; // es un correo, no una web
    let candidate = match[0].replace(/[.,;:!?)\]]+$/, "");
    if (!/^https?:\/\//i.test(candidate)) candidate = "https://" + candidate;
    try {
      const url = new URL(candidate);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      if (!url.hostname.includes(".")) continue;
      return url.toString();
    } catch {
      continue;
    }
  }
  return null;
}

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (kind === 6) {
    const v = ip.toLowerCase();
    return v.startsWith("::") || v.startsWith("fc") || v.startsWith("fd") || /^fe[89ab]/.test(v) || v.includes("::ffff:");
  }
  return true;
}

async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocolo no permitido");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("puerto no permitido");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("host interno");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw new Error("dirección interna");
}

async function fetchHtml(startUrl: string): Promise<{ url: string; html: string; truncated: boolean }> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let current = new URL(startUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(current);
    const res = await fetch(current, {
      redirect: "manual",
      signal,
      headers: {
        "user-agent": "AiCarloBot/1.0 (+https://bycarlo.es)",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "es,en;q=0.8",
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) throw new Error("redirección sin destino");
      current = new URL(next, current);
      continue;
    }
    if (!res.ok) throw new Error(`la web respondió ${res.status}`);
    const type = res.headers.get("content-type") || "";
    if (type && !/html|xml/i.test(type)) throw new Error("no es una página web");

    const reader = res.body?.getReader();
    if (!reader) return { url: current.toString(), html: await res.text(), truncated: false };
    const chunks: Uint8Array[] = [];
    let size = 0;
    let truncated = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
      if (size >= MAX_BYTES) {
        truncated = true;
        await reader.cancel();
        break;
      }
    }
    const html = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
    return { url: current.toString(), html, truncated };
  }
  throw new Error("demasiadas redirecciones");
}

function decode(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

const clean = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function all(html: string, re: RegExp, max: number, maxLen = 120): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(re)) {
    const text = clean(m[1] ?? "").slice(0, maxLen);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function attr(html: string, tagRe: RegExp, name: string): string {
  const tag = html.match(tagRe)?.[0] ?? "";
  const m = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return decode(m?.[2] ?? m?.[3] ?? "").trim();
}

/** Convierte el HTML en una ficha corta de señales que afectan a la venta. */
export function summarize(html: string, url: string, truncated = false): string {
  const body = html.replace(/<(head|script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ");
  const text = clean(body);
  const words = text ? text.split(" ").length : 0;

  const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").slice(0, 140);
  const description = attr(html, /<meta[^>]+name\s*=\s*["']description["'][^>]*>/i, "content").slice(0, 220);
  const h1 = all(body, /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, 3);
  const h2 = all(body, /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, 8);
  const buttons = all(body, /<(?:a|button)\b[^>]*>([\s\S]*?)<\/(?:a|button)>/gi, 40, 60).filter((t) => t.length <= 40).slice(0, 15);
  const prices = Array.from(new Set(text.match(/\d[\d.,]*\s?(?:€|eur\b)/gi) ?? [])).slice(0, 5);
  const images = body.match(/<img\b[^>]*>/gi) ?? [];
  const noAlt = images.filter((tag) => !/\balt\s*=\s*["'][^"']+["']/i.test(tag)).length;
  const scripts = (html.match(/<script\b/gi) ?? []).length;

  const yes = (v: boolean) => (v ? "sí" : "no");
  const lines = [
    `Dirección: ${url}`,
    `Título de la pestaña: ${title || "(vacío)"}`,
    `Descripción para Google: ${description || "(no tiene)"}`,
    `Titular principal (H1): ${h1.length ? h1.join(" | ") : "(no tiene)"}${h1.length > 1 ? "  [hay más de un H1]" : ""}`,
    `Subtítulos (H2): ${h2.length ? h2.join(" | ") : "(no tiene)"}`,
    `Textos de botones y enlaces: ${buttons.length ? buttons.join(" | ") : "(no se ven)"}`,
    `Precios visibles: ${prices.length ? prices.join(", ") : "ninguno"}`,
    `Formularios: ${(body.match(/<form\b/gi) ?? []).length}`,
    `Contacto directo: teléfono ${yes(/href\s*=\s*["']tel:/i.test(body))}, correo ${yes(/href\s*=\s*["']mailto:/i.test(body))}, WhatsApp ${yes(/wa\.me|api\.whatsapp\.com/i.test(body))}`,
    `Adaptada a móvil (etiqueta viewport): ${yes(/<meta[^>]+name\s*=\s*["']viewport["']/i.test(html))}`,
    `Imagen para compartir en redes: ${yes(/<meta[^>]+property\s*=\s*["']og:image["']/i.test(html))}`,
    `Imágenes: ${images.length} (${noAlt} sin texto alternativo)`,
    `Peso del HTML: ${Math.round(html.length / 1024)} KB${truncated ? " o más (cortado)" : ""}, ${scripts} scripts`,
    `Palabras de texto visible: ${words}`,
    `Principio del texto: ${text.slice(0, 1200) || "(vacío)"}`,
  ];
  if (words < 60) {
    lines.push(
      "AVISO: casi no hay texto en el HTML. Probablemente la página carga su contenido con JavaScript y no se ha podido leer entera: dilo y no inventes lo que no ves.",
    );
  }
  return lines.join("\n");
}

/** Lee la web y devuelve la ficha, o una nota explicando por qué no se pudo. */
export async function inspectWeb(url: string): Promise<string> {
  try {
    const page = await fetchHtml(url);
    return summarize(page.html, page.url, page.truncated);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "error desconocido";
    return `Dirección: ${url}\nNO SE HA PODIDO LEER LA WEB (${reason}). Dilo con naturalidad y pide que te cuenten qué venden y qué titular tienen.`;
  }
}
