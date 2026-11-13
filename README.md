# Akasha Seguimiento — versión con base de datos compartida

Es la misma app de seguimiento que se armó como artifact en Claude, pero
guardando los datos en una base propia (Supabase). Así todos los profes
ven lo mismo, desde cualquier aparato, y no se pierde nada.

## Qué cambia para los profes

- Entran con **email y contraseña** (cada profe con su cuenta).
- Lo que carga uno **les aparece a los demás**. Si hay datos nuevos de
  otro profe, aparece un aviso verde: "Tocá para actualizar".
- Abajo a la izquierda un punto muestra si está todo **Guardado**. Si se
  corta internet, la app sigue funcionando y sube los cambios sola
  cuando vuelve la conexión.
- Todo lo demás (pantallas, botones, niveles, fichas…) es igual.

## Qué hay en esta carpeta

| Carpeta / archivo | Qué es |
|---|---|
| `app/` | La app lista para publicar en internet. |
| `app/index.html` | La app (generada automáticamente desde la versión del artifact). |
| `app/akasha-store.js` | La pieza que guarda y sincroniza los datos con Supabase. |
| `app/arranque.js` | Inicio de sesión y arranque de la app. |
| `app/config.js` | La dirección de tu Supabase (se completa en el paso 2). |
| `supabase/esquema.sql` | Crea la base de datos con sus reglas de seguridad. |
| `herramientas/convertir.py` | Pasa una versión nueva del artifact a esta versión. |
| `pruebas/` | Pruebas automáticas (sincronización y navegador). |
| `original/` | Copia exacta de la app original. **No se sube a GitHub.** |

## Puesta en marcha (una sola vez)

### 1 y 2. Proyecto y base de datos ✅ (hecho)
Proyecto **Akasha FC** en Supabase, con las tablas, las reglas de
seguridad y el historial ya creados (`supabase/esquema.sql`). La lista
de alumnos **no** se precarga: se arma y se actualiza importando el
listado de usuarios de Crossfy desde "Importar datos".

### 3. Ajustes de acceso
En **Authentication**:
1. **Sign In / Providers** → Email: dejá activado. Desactivá
   **"Allow new users to sign up"** (así nadie de afuera puede crearse
   una cuenta: sólo entran las personas que invites).
2. **URL Configuration** → **Site URL**: poné la dirección donde quede
   publicada la app (paso 5).

### 4. Conectar la app con tu Supabase ✅ (hecho)
`app/config.js` ya tiene la dirección del proyecto y la clave **pública**
(anon). Es pública a propósito: la seguridad la dan las reglas de la
base. **Nunca** pongas ahí la clave `service_role`.

### 5. Publicar la app
Se publica desde GitHub en **Netlify** o **Cloudflare Pages** (gratis,
con repositorio privado). Cada cambio que se sube a GitHub se publica solo.

### 6. Sumar a los profes
1. Vos entrás primero: tu cuenta queda como **administradora**.
   (Authentication → Users → **Invite user** con tu email, abrís el
   link del email y elegís tu contraseña.)
2. Para cada profe: **Invite user** con su email. Le llega un link para
   elegir su contraseña.
3. Activalo: **Table Editor → akasha_miembros** → marcá **activo** en su
   fila. Hasta que no lo actives no ve ningún dato.
4. Escribí su nombre en la columna **nombre** (es el que aparece arriba
   en la app y queda en las novedades, cargas y notas que registre).
5. Para sacarle el acceso a alguien: desmarcá **activo**.

### 7. Pasar los datos que ya tienen cargados
Los datos de la app original están guardados en cada aparato. En cada
celular o tablet donde se usó:
1. Abrir la app **original** → Importar datos → **"Pasar todo a otro
   dispositivo" → Descargar resumen completo** (o "Copiar" si no deja
   descargar).
2. Abrir la app **nueva** → Importar datos → subir ese archivo.

Se suman: no se borra lo que ya estaba.

## Seguir mejorando la app

Se puede seguir trabajando la app en el chat de Claude (artifact) como
hasta ahora. Para pasar una versión nueva a esta:

```bash
python3 herramientas/convertir.py original/akasha-seguimiento-AAAA-MM-DD.html
node pruebas/sincronizacion.test.js
node pruebas/navegador.test.js
```

## Si algo sale mal

- **Se borró o se pisó algo:** cada cambio queda en la tabla
  `akasha_historial` (qué había antes, cuándo y quién lo cambió), así que
  se puede recuperar.
- **Volver a la app original:** sigue publicada en Claude y hay una copia
  exacta en `original/`.
