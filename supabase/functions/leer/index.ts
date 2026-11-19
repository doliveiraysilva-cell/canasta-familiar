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
      const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": gemini, "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ inline_data: { mime_type: "image/jpeg", data: image } }, { text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0 },
        }),
      });
      const j = await r.json();
      if (!r.ok) return json({ error: "ia", detail: j?.error?.message ?? r.status }, 502);
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
