-- Etapa automática de los prospectos en Notion.
-- Cruza cada respuesta del formulario (por email) con los usuarios y
-- compras de Crossfy que hay en la app:
--   * registrado en Crossfy más de 7 días antes de completar el formulario → "Ya es alumno"
--   * primera compra desde 7 días antes del formulario en adelante        → "Se inscribió"
--   * sin cuenta o sin compras                                            → no se informa (lo maneja el equipo)
-- Sólo la usa la función sync-notion (service_role): devuelve emails.
create or replace function public.akasha_prospectos_etapa()
returns table(email text, etapa text)
language sql stable security definer set search_path = public, akasha_privado as $$
  with e as (
    select lower(substr(subclave, 3)) em, (coalesce(valor, valor_json::text))::bigint id
    from akasha_datos where clave = 'akasha-indice-emails' and subclave like 'o:%'
  ), i as (
    select substr(subclave, 3)::bigint id, nullif(valor_json->>'reg', '')::date reg
    from akasha_datos where clave = 'akasha-crossfy-info' and subclave like 'o:%'
  ), c as (
    select alumno, min(fecha) primera from akasha_privado.compras group by alumno
  ), f as (
    select distinct on (lower(trim(email))) lower(trim(email)) em, recibido::date dia
    from akasha_formularios where coalesce(email, '') <> '' order by lower(trim(email)), recibido desc
  )
  select f.em,
    case when i.reg < f.dia - 7 then 'Ya es alumno'
         when c.primera >= f.dia - 7 then 'Se inscribió' end
  from f join e on e.em = f.em left join i on i.id = e.id left join c on c.alumno = e.id
  where (i.reg < f.dia - 7) or (c.primera >= f.dia - 7);
$$;
revoke all on function public.akasha_prospectos_etapa() from public, anon, authenticated;
grant execute on function public.akasha_prospectos_etapa() to service_role;
