// Lleva las métricas de ocupación, conversión y retención a Notion.
// La llama pg_cron todos los lunes (y se puede llamar a mano).
// Sólo acepta pedidos con la clave interna x-sync-key (guardada en la base).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const NOTION_TOKEN = Deno.env.get("NOTION_TOKEN") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

// Bases de Notion (dentro de Akasha Fitness Club → Ocupación, conversión y retención).
const BASES = {
  horario: "41b3a66a70b581b6ab30d44260be60e7",
  dia: "41b3a66a70b5813cb5c5fe20718a6f7b",
  retencion: "41b3a66a70b581c8b693d96dcaee9d3c",
};
const TITULO = { horario: "Clave", dia: "Clave", retencion: "Mes (clave)" } as const;

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function notion(metodo: string, ruta: string, cuerpo?: unknown): Promise<any> {
  for (let intento = 0; intento < 5; intento++) {
    const r = await fetch("https://api.notion.com/v1" + ruta, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    if (r.status === 429 || r.status >= 500) {
      await esperar(Number(r.headers.get("retry-after") ?? 1) * 1000 + 300);
      continue;
    }
    const j = await r.json();
    if (!r.ok) throw new Error(`Notion ${r.status}: ${j.message ?? JSON.stringify(j)}`);
    return j;
  }
  throw new Error("Notion no respondió después de varios intentos");
}

const num = (v: unknown) => ({ number: v === null || v === undefined ? null : Number(v) });
const sel = (v: unknown) => ({ select: v ? { name: String(v) } : null });
const fecha = (v: unknown) => ({ date: v ? { start: String(v).slice(0, 10) } : null });
const titulo = (v: string) => ({ title: [{ text: { content: v } }] });

function propiedades(tipo: keyof typeof BASES, f: any): Record<string, unknown> {
  if (tipo === "horario") return {
    Clave: titulo(f.clave), Mes: fecha(f.mes), Horario: sel(f.hora), Disciplina: sel(f.disciplina),
    Clases: num(f.clases), Reservas: num(f.reservas), Presentes: num(f.presentes), "Promedio por clase": num(f.promedio),
    Cupo: num(f.cupo), "Ocupación %": num(f.ocupacion), "Ausentismo %": num(f.ausentismo),
    // La conversión de pruebas se mide en "Prospectos" (Crossfy no registra a los que no compran).
  };
  if (tipo === "dia") return {
    Clave: titulo(f.clave), Mes: fecha(f.mes), "Día": sel(f.dia), Clases: num(f.clases), Reservas: num(f.reservas),
    Presentes: num(f.presentes), "Promedio por clase": num(f.promedio), "Ocupación %": num(f.ocupacion),
  };
  return {
    "Mes (clave)": titulo(f.clave), Mes: fecha(f.mes), "Alumnos activos": num(f.activos), "Altas nuevas": num(f.altas),
    "Paquetes que vencieron": num(f.vencieron), Renovaron: num(f.renovaron),
  };
}

// Valor comparable de una propiedad tal como la devuelve Notion.
function valorNotion(p: any): string {
  if (!p) return "";
  switch (p.type) {
    case "title": return (p.title ?? []).map((t: any) => t.plain_text).join("");
    case "number": return p.number === null ? "" : String(p.number);
    case "select": return p.select?.name ?? "";
    case "date": return p.date?.start?.slice(0, 10) ?? "";
    default: return "";
  }
}
function valorNuevo(p: any): string {
  if ("title" in p) return p.title.map((t: any) => t.text.content).join("");
  if ("number" in p) return p.number === null ? "" : String(p.number);
  if ("select" in p) return p.select?.name ?? "";
  if ("date" in p) return p.date?.start ?? "";
  return "";
}

async function existentes(base: string, prop: string) {
  const mapa = new Map<string, any>();
  let cursor: string | undefined;
  do {
    const r = await notion("POST", `/databases/${base}/query`, { page_size: 100, start_cursor: cursor });
    for (const p of r.results) mapa.set(valorNotion(p.properties[prop]), p);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return mapa;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Usar POST", { status: 405 });
  if (!NOTION_TOKEN) return new Response("Falta configurar NOTION_TOKEN", { status: 500 });
  const clave = req.headers.get("x-sync-key") ?? "";
  const { data: ok } = await db.rpc("akasha_sync_autorizado", { k: clave });
  if (!ok) return new Response("No autorizado", { status: 401 });

  const { data: m, error } = await db.rpc("akasha_metricas");
  if (error) return new Response("Error leyendo métricas: " + error.message, { status: 500 });

  const resumen: Record<string, { creadas: number; actualizadas: number; iguales: number }> = {};
  try {
    for (const tipo of ["retencion", "dia", "horario"] as const) {
      const base = BASES[tipo];
      const ya = await existentes(base, TITULO[tipo]);
      const r = (resumen[tipo] = { creadas: 0, actualizadas: 0, iguales: 0 });
      for (const fila of m[tipo] ?? []) {
        const props = propiedades(tipo, fila);
        const pagina = ya.get(fila.clave);
        if (!pagina) {
          await notion("POST", "/pages", { parent: { database_id: base }, properties: props });
          r.creadas++;
        } else {
          const cambio = Object.entries(props).some(([k, v]) => valorNotion(pagina.properties[k]) !== valorNuevo(v));
          if (!cambio) { r.iguales++; continue; }
          await notion("PATCH", `/pages/${pagina.id}`, { properties: props });
          r.actualizadas++;
        }
        await esperar(340); // Notion admite ~3 pedidos por segundo
      }
    }
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e), resumen }), { status: 502, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({ ok: true, resumen }), { headers: { "content-type": "application/json" } });
});
