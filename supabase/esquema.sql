-- =====================================================================
-- Akasha Seguimiento — base de datos en Supabase
--
-- Cómo usarlo: en Supabase, abrí "SQL Editor", pegá TODO este archivo y
-- tocá "Run". Se puede correr más de una vez sin romper nada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Datos de la app
--
-- Cada "caja" de datos de la app (fichas, cargas, novedades, rutinas…)
-- se guarda partida en filas: una fila por alumno, por fecha o por
-- registro. Así, si dos profes cargan cosas al mismo tiempo, cada uno
-- toca sólo sus filas y no se pisan.
-- ---------------------------------------------------------------------
create table if not exists public.akasha_datos (
  clave           text        not null,            -- la caja: 'akasha-fichas', 'akasha-cargas'…
  subclave        text        not null,            -- la parte: un alumno, una fecha, un registro
  valor           text,                            -- el dato, como texto JSON (tal cual lo arma la app)
  valor_json      jsonb generated always as (valor::jsonb) stored,  -- el mismo dato, para hacer consultas
  pos             double precision,                -- orden, para las listas
  actualizado     timestamptz not null default now(),
  actualizado_por uuid        default auth.uid(),
  primary key (clave, subclave)
);

-- ---------------------------------------------------------------------
-- 2. Historial: cada cambio y cada borrado queda guardado acá.
-- Si algo se pisa o se borra por error, se puede recuperar.
-- ---------------------------------------------------------------------
create table if not exists public.akasha_historial (
  id              bigint generated always as identity primary key,
  clave           text        not null,
  subclave        text        not null,
  valor_anterior  text,
  operacion       text        not null,            -- 'UPDATE' o 'DELETE'
  cuando          timestamptz not null default now(),
  quien           uuid        default auth.uid()
);
create index if not exists akasha_historial_clave on public.akasha_historial (clave, subclave, cuando desc);

create or replace function public.akasha_guardar_historial() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'UPDATE' and old.valor is not distinct from new.valor) then
    return new;  -- sólo cambió el orden: no hace falta guardarlo
  end if;
  insert into public.akasha_historial (clave, subclave, valor_anterior, operacion)
  values (old.clave, old.subclave, old.valor, tg_op);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists akasha_datos_historial on public.akasha_datos;
create trigger akasha_datos_historial
  before update or delete on public.akasha_datos
  for each row execute function public.akasha_guardar_historial();

-- Marca la hora del último cambio en cada fila.
create or replace function public.akasha_marcar_actualizado() returns trigger
language plpgsql as $$
begin
  new.actualizado := now();
  new.actualizado_por := auth.uid();
  return new;
end $$;

drop trigger if exists akasha_datos_actualizado on public.akasha_datos;
create trigger akasha_datos_actualizado
  before insert or update on public.akasha_datos
  for each row execute function public.akasha_marcar_actualizado();

-- ---------------------------------------------------------------------
-- 3. Quién puede entrar: el equipo de Akasha
--
-- Cada persona que se registra queda en esta tabla. La PRIMERA cuenta
-- (la tuya) queda activa y como administradora. Las siguientes quedan
-- INACTIVAS hasta que las actives vos: en Supabase, "Table Editor" →
-- akasha_miembros → marcá "activo" en la fila del profe.
-- ---------------------------------------------------------------------
create table if not exists public.akasha_miembros (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  email    text,
  nombre   text,
  rol      text    not null default 'profe',        -- 'admin' o 'profe'
  activo   boolean not null default false,
  creado   timestamptz not null default now()
);

create or replace function public.akasha_nuevo_miembro() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  es_el_primero boolean;
begin
  select not exists (select 1 from public.akasha_miembros) into es_el_primero;
  insert into public.akasha_miembros (user_id, email, rol, activo)
  values (new.id, new.email,
          case when es_el_primero then 'admin' else 'profe' end,
          es_el_primero)
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists akasha_al_crear_usuario on auth.users;
create trigger akasha_al_crear_usuario
  after insert on auth.users
  for each row execute function public.akasha_nuevo_miembro();

-- Por si ya había usuarios creados antes de correr este archivo.
insert into public.akasha_miembros (user_id, email, rol, activo)
select u.id, u.email, 'profe', false from auth.users u
on conflict (user_id) do nothing;

create or replace function public.akasha_es_miembro_activo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.akasha_miembros
    where user_id = auth.uid() and activo
  );
$$;

-- ---------------------------------------------------------------------
-- 4. Seguridad: sólo los miembros activos leen y escriben.
-- Sin esto, cualquiera con el link podría ver los datos de los alumnos.
-- ---------------------------------------------------------------------
alter table public.akasha_datos     enable row level security;
alter table public.akasha_historial enable row level security;
alter table public.akasha_miembros  enable row level security;

drop policy if exists "miembros leen datos"      on public.akasha_datos;
drop policy if exists "miembros escriben datos"  on public.akasha_datos;
drop policy if exists "miembros editan datos"    on public.akasha_datos;
drop policy if exists "miembros borran datos"    on public.akasha_datos;
create policy "miembros leen datos"     on public.akasha_datos for select using (public.akasha_es_miembro_activo());
create policy "miembros escriben datos" on public.akasha_datos for insert with check (public.akasha_es_miembro_activo());
create policy "miembros editan datos"   on public.akasha_datos for update using (public.akasha_es_miembro_activo()) with check (public.akasha_es_miembro_activo());
create policy "miembros borran datos"   on public.akasha_datos for delete using (public.akasha_es_miembro_activo());

drop policy if exists "miembros leen historial" on public.akasha_historial;
create policy "miembros leen historial" on public.akasha_historial for select using (public.akasha_es_miembro_activo());

drop policy if exists "cada uno ve su fila" on public.akasha_miembros;
create policy "cada uno ve su fila" on public.akasha_miembros for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 5. Tiempo real: que los cambios de un profe les lleguen a los demás.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'akasha_datos'
  ) then
    alter publication supabase_realtime add table public.akasha_datos;
  end if;
end $$;
