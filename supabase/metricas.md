# Métricas → Notion

- `public.akasha_metricas()` (sólo service_role): calcula ocupación y conversión por
  mes/horario/disciplina, ocupación por día y retención mensual, a partir de las
  reservas, compras y datos de Crossfy que la app guarda en `akasha_datos`.
- Cupos: tabla `akasha_privado.cupos` (`'*'` = 10, `POWER STEP` = 9). Para cambiarlos
  (por ejemplo al mudarse, 12):
  `update akasha_privado.cupos set cupo = 12 where disciplina = '*';`
- Función `sync-notion`: escribe esas filas en las bases de Notion de
  *Akasha Fitness Club → Ocupación, conversión y retención*. Necesita el secreto
  `NOTION_TOKEN` (integración interna "Akasha App" con acceso a esa página).
- Programada con pg_cron todos los lunes 06:17 (ARG): job `akasha-sync-notion`.
  Correrla a mano: `select akasha_privado.disparar_sync_notion();`
