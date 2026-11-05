/* Genera datos-privados/cargar-alumnos.sql: la lista base de alumnos
   lista para pegar en el SQL Editor de Supabase (una sola vez).
   Uso: node herramientas/sql-alumnos.js */
const fs = require('fs'), path = require('path');
const {akStore} = require(path.join(__dirname, '..', 'app', 'akasha-store.js'));
const dir = path.join(__dirname, '..', 'datos-privados');
const txt = fs.readFileSync(path.join(dir, 'alumnos-base.json'), 'utf8');
const {tipo, filas} = akStore._interno.codificar(JSON.stringify(JSON.parse(txt)));
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
const valores = [`(${q('akasha-alumnos-base')}, '~', ${q(JSON.stringify({t: tipo}))}, 0)`]
  .concat(filas.map((f, i) => `(${q('akasha-alumnos-base')}, ${q(f.s)}, ${q(f.v)}, ${i})`));
const sql = `-- Lista base de alumnos (${filas.length}). Pegar en Supabase > SQL Editor > Run. Se puede correr de nuevo sin duplicar.
insert into public.akasha_datos (clave, subclave, valor, pos) values
${valores.join(',\n')}
on conflict (clave, subclave) do update set valor = excluded.valor, pos = excluded.pos;
`;
fs.writeFileSync(path.join(dir, 'cargar-alumnos.sql'), sql);
console.log('OK datos-privados/cargar-alumnos.sql', filas.length, 'alumnos,', Math.round(sql.length / 1024), 'KB');
