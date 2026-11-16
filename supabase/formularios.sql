-- =====================================================================
-- Formularios de ingreso (Tally) — correr DESPUÉS de esquema.sql.
-- Las respuestas llegan solas por webhook a la función tally-formulario.
-- Las leen sólo los miembros activos; nadie las escribe desde la app.
-- =====================================================================
create table if not exists public.akasha_formularios (
  id                text primary key,              -- submissionId de Tally
  formulario        text,                          -- formId de Tally
  recibido          timestamptz not null,
  nombre            text,
  email             text,
  whatsapp          text,
  horario_contacto  text,
  cercania          text,                          -- "¿qué tan cerca estás de empezar?"
  objetivo          text,
  origen            text,                          -- campo oculto ?origen=...
  campana           text,                          -- campo oculto ?campana=...
  respuestas        jsonb not null default '[]',   -- [{pregunta, respuesta}]
  creado            timestamptz not null default now()
);
alter table public.akasha_formularios add column if not exists origen text;
alter table public.akasha_formularios add column if not exists campana text;
create index if not exists akasha_formularios_email on public.akasha_formularios (lower(email));
create index if not exists akasha_formularios_recibido on public.akasha_formularios (recibido desc);

alter table public.akasha_formularios enable row level security;
drop policy if exists "miembros leen formularios" on public.akasha_formularios;
create policy "miembros leen formularios" on public.akasha_formularios
  for select to authenticated using (akasha_privado.es_miembro_activo());
