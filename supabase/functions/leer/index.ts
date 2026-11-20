// Edge Function "leer": recibe una foto (ticket o lista) y devuelve los datos en JSON.
// Usa Gemini (gratis) si existe el secreto GEMINI_API_KEY, o Claude si existe ANTHROPIC_API_KEY.
import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Lista los modelos de Gemini y ordena: el pedido en GEMINI_MODEL, después flash-lite y flash más nuevos.
let cachedModels: string[] | null = null;
async function pickModels(key: string): Promise<string[]> {
  const wanted = Deno.env.get("GEMINI_MODEL");
  if (cachedModels) return cachedModels;
  let names: string[] = [];
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key } });
    const j = await r.json();
    names = (j.models ?? [])
      .filter((m: any) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m: any) => String(m.name).replace(/^models\//, ""))
      .filter((n: string) => /^gemini-\d/.test(n) && !/(preview|exp|tts|image|audio|live|embedding|thinking)/.test(n));
  } catch (_e) { /* sin lista: usa los nombres por defecto */ }
  const ver = (n: string) => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) ?? [])[1] ?? "0");
  const newest = (re: RegExp) => names.filter((n) => re.test(n)).sort((a, b) => ver(b) - ver(a) || a.length - b.length)[0];
  const lite = newest(/flash-lite/);
  const flash = newest(/flash(?!-lite)/);
  const list = [lite, wanted && wanted !== "auto" ? wanted : null, flash, "gemini-3.8-flash"].filter(Boolean) as string[];
  cachedModels = [...new Set(list)];
  return cachedModels;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // Solo miembros de la familia pueden usarla
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: ok, error } = await sb.rpc("is_member");
    if (error || !ok) return json({ error: "no_autorizado" }, 401);

    const { prompt, image } = await req.json();
    if (typeof prompt !== "string" || typeof image !== "string" || image.length > 8_000_000)
      return json({ error: "pedido_invalido" }, 400);

    let text = "";
    const gemini = Deno.env.get("GEMINI_API_KEY");
    const claude = Deno.env.get("ANTHROPIC_API_KEY");
    if (gemini) {
      // Elige solo el modelo más rápido disponible (flash-lite) salvo que GEMINI_MODEL diga otro.
      // Cada intento tiene un límite de tiempo; si Gemini está saturado, prueba el siguiente modelo.
      const models = await pickModels(gemini);
      const thinking = Deno.env.get("GEMINI_THINKING") ?? "minimal";
      const makeBody = (withThinking: boolean) => JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: "image/jpeg", data: image } }, { text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json", temperature: 0,
          ...(withThinking && thinking !== "off" ? { thinkingConfig: { thinkingLevel: thinking } } : {}),
        },
      });
      const deadline = Date.now() + 130_000; // la función tiene ~150 s en el plan gratis
      let r: Response | null = null, j: any = null, useThinking = true, lastErr = "";
      outer: for (const model of models) {
        for (let attempt = 0; attempt < 2; attempt++) {
          const left = deadline - Date.now();
          if (left < 8000) break outer;
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), Math.min(55_000, left - 3000));
          try {
            r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
              method: "POST", headers: { "x-goog-api-key": gemini, "content-type": "application/json" },
              body: makeBody(useThinking), signal: ctl.signal,
            });
            j = await r.json();
          } catch (_e) {
            lastErr = `${model}: tardó demasiado`; r = null; clearTimeout(timer); continue outer;
          }
          clearTimeout(timer);
          if (r.ok) break outer;
          lastErr = j?.error?.message ?? String(r.status);
          if (r.status === 400 && useThinking && /thinking/i.test(lastErr)) { useThinking = false; attempt--; continue; }
          if (r.status === 404 || r.status === 400) continue outer;
          if (r.status !== 429 && r.status !== 503 && r.status !== 500) break outer;
          await new Promise((res) => setTimeout(res, 1000 + Math.random() * 500));
        }
      }
      if (!r || !r.ok) return json({ error: "ia", detail: lastErr || "sin respuesta" }, 502);
      text = (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
    } else if (claude) {
      const client = new Anthropic({ apiKey: claude });
      const msg = await client.messages.create({
        model: Deno.env.get("CLAUDE_MODEL") ?? "claude-opus-5-5",
        max_tokens: 16000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
            { type: "text", text: prompt },
          ],
        }],
      });
      if (msg.stop_reason === "refusal") return json({ error: "rechazado" }, 502);
      text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    } else {
      return json({ error: "sin_clave" }, 500);
    }
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return json({ error: "sin_json" }, 502);
    return json(JSON.parse(m[0]));
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
