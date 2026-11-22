-- =====================================================================
-- Cuenta de la pantalla del salón (rol 'pantalla')
--
-- Es la cuenta con la que la tele o el proyector abre la app. Sólo
-- muestra la pared, así que en la base:
--   - lee los datos de la app (los necesita para mostrar la clase),
--   - sólo escribe el control de la pantalla ('akasha-pantalla': el
--     código de vinculación),
--   - no ve los formularios de ingreso ni el historial de cambios.
-- Para las demás cuentas (admin, profe, cm) no cambia nada.
--
-- Para crear una: Authentication → Users → Add user → Create new user
-- (con "Auto Confirm User"), y en akasha_miembros ponerle activo = true,
-- rol = 'pantalla' y nombre = 'Pantalla salón'.
-- =====================================================================

-- Miembro activo que NO es la pantalla.
create or replace function akasha_privado.es_profe_activo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.akasha_miembros
    where user_id = auth.uid() and activo and rol <> 'pantalla'
  );
$$;
revoke execute on function akasha_privado.es_profe_activo() from public, anon;
grant  execute on function akasha_privado.es_profe_activo() to authenticated;

-- Puede escribir esa clave: cualquier miembro activo, salvo la pantalla,
-- que sólo escribe su propio control.
create or replace function akasha_privado.puede_escribir(c text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.akasha_miembros
    where user_id = auth.uid() and activo and (rol <> 'pantalla' or c = 'akasha-pantalla')
  );
$$;
revoke execute on function akasha_privado.puede_escribir(text) from public, anon;
grant  execute on function akasha_privado.puede_escribir(text) to authenticated;

drop policy if exists "miembros escriben datos" on public.akasha_datos;
drop policy if exists "miembros editan datos"   on public.akasha_datos;
drop policy if exists "miembros borran datos"   on public.akasha_datos;
create policy "miembros escriben datos" on public.akasha_datos for insert to authenticated
  with check (akasha_privado.puede_escribir(clave));
create policy "miembros editan datos"   on public.akasha_datos for update to authenticated
  using (akasha_privado.puede_escribir(clave)) with check (akasha_privado.puede_escribir(clave));
create policy "miembros borran datos"   on public.akasha_datos for delete to authenticated
  using (akasha_privado.puede_escribir(clave));

drop policy if exists "miembros leen formularios" on public.akasha_formularios;
create policy "miembros leen formularios" on public.akasha_formularios for select to authenticated
  using (akasha_privado.es_profe_activo());

drop policy if exists "miembros leen historial" on public.akasha_historial;
create policy "miembros leen historial" on public.akasha_historial for select to authenticated
  using (akasha_privado.es_profe_activo());
