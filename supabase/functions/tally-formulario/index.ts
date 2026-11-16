// Recibe cada respuesta del formulario de Tally (webhook) y la guarda en
// public.akasha_formularios. Sólo acepta pedidos firmados por Tally con el
// secreto TALLY_SIGNING_SECRET (el mismo que se carga en el webhook de Tally).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { convertir } from "./convertir.ts";

const SECRETO = Deno.env.get("TALLY_SIGNING_SECRET") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const enc = new TextEncoder();
async function firmar(texto: string): Promise<string> {
  const clave = await crypto.subtle.importKey("raw", enc.encode(SECRETO), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", clave, enc.encode(texto)));
  let bin = "";
  firma.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}
function iguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Usar POST", { status: 405 });
  if (!SECRETO) return new Response("Falta configurar TALLY_SIGNING_SECRET", { status: 500 });
  const cuerpo = await req.text();
  const recibida = req.headers.get("tally-signature") ?? "";
  let payload: any;
  try {
    payload = JSON.parse(cuerpo);
  } catch {
    return new Response("JSON inválido", { status: 400 });
  }
  const ok = iguales(await firmar(cuerpo), recibida) || iguales(await firmar(JSON.stringify(payload)), recibida);
  if (!ok) return new Response("Firma inválida", { status: 401 });
  if (payload?.eventType && payload.eventType !== "FORM_RESPONSE") return new Response("Ignorado", { status: 200 });

  const fila = convertir(payload);
  const { error } = await db.from("akasha_formularios").upsert(fila, { onConflict: "id" });
  if (error) {
    console.error("No se pudo guardar", error.message);
    return new Response("Error al guardar", { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true, id: fila.id }), { headers: { "content-type": "application/json" } });
});
