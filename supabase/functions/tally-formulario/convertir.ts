// Pasa una respuesta de Tally (webhook) a una fila de akasha_formularios.
const norm = (s: string) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

type Campo = { key: string; label: string; type: string; value: unknown; options?: { id: string; text: string }[] };

/* Pasa cada campo de Tally a texto legible: las opciones elegidas llegan
   como ids y se cambian por su texto. */
export function textoDe(c: Campo): string {
  const v = c.value;
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) {
    const opciones = c.options ?? [];
    return v.map((x) => {
      if (typeof x === "string") return opciones.find((o) => o.id === x)?.text ?? x;
      if (x && typeof x === "object" && "name" in x) return String((x as { name: string }).name);
      return String(x);
    }).join(", ");
  }
  return String(v);
}

export function convertir(payload: any) {
  const d = payload?.data ?? {};
  const campos: Campo[] = (d.fields ?? []).filter((c: Campo) =>
    // Las casillas también llegan como un campo por opción (true/false): se omiten.
    !(typeof c.value === "boolean")
  );
  const respuestas = campos
    .map((c) => ({ pregunta: String(c.label ?? "").trim(), respuesta: textoDe(c).trim() }))
    .filter((r) => r.pregunta);
  const buscar = (prueba: (c: Campo) => boolean) => {
    const c = campos.find(prueba);
    return c ? textoDe(c).trim() || null : null;
  };
  return {
    id: String(d.submissionId ?? d.responseId ?? payload?.eventId),
    formulario: d.formId ?? null,
    recibido: d.createdAt ?? payload?.createdAt ?? new Date().toISOString(),
    nombre: buscar((c) => norm(c.label) === "nombre"),
    email: (buscar((c) => c.type === "INPUT_EMAIL") ?? "").toLowerCase() || null,
    whatsapp: buscar((c) => c.type === "INPUT_PHONE_NUMBER"),
    horario_contacto: buscar((c) => norm(c.label).includes("momento del dia")),
    cercania: buscar((c) => norm(c.label).includes("que tan cerca")),
    objetivo: buscar((c) => norm(c.label).includes("conseguir entrenando")),
    respuestas,
  };
}

