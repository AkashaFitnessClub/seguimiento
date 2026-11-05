/* Pruebas de la capa de datos compartida, sin navegador.
   Simula dos aparatos (dos profes) contra un mismo "servidor".
   Uso: node pruebas/sincronizacion.test.js */
const assert = require('assert');
const path = require('path');

/* Cada aparato necesita su propia copia del módulo y su propio localStorage. */
function nuevoAparato(servidor){
  const memoria = new Map();
  global.window = {localStorage: {
    getItem: k => memoria.has(k) ? memoria.get(k) : null,
    setItem: (k, v) => memoria.set(k, String(v)),
    removeItem: k => memoria.delete(k),
  }, addEventListener(){}};
  const ruta = path.join(__dirname, '..', 'app', 'akasha-store.js');
  delete require.cache[require.resolve(ruta)];
  require(ruta);
  const store = global.window.akStore;
  delete global.window;
  return {store, memoria, backend: servidor.backend()};
}

function nuevoServidor(){
  const filas = new Map(); // "c|s" -> {c,s,v,p}
  const oyentes = [];
  let caido = false;
  return {
    filas,
    set caido(x){ caido = x; },
    backend(){
      return {
        async leerTodo(){
          if(caido) throw new Error('sin red');
          return [...filas.values()].map(f => [f.c, f.s, f.v, f.p]);
        },
        async aplicar(ops){
          if(caido) throw new Error('sin red');
          for(const o of ops){
            const k = o.c + '|' + o.s;
            if(o.op === 'up'){ filas.set(k, {c:o.c, s:o.s, v:o.v, p:o.p}); oyentes.forEach(fn => fn({tipo:'UPDATE', c:o.c, s:o.s, v:o.v})); }
            else { filas.delete(k); oyentes.forEach(fn => fn({tipo:'DELETE', c:o.c, s:o.s})); }
          }
        },
        escuchar(fn){ oyentes.push(fn); },
      };
    },
  };
}

const esperar = ms => new Promise(r => setTimeout(r, ms));
let n = 0;
async function prueba(nombre, fn){
  try{ await fn(); n++; console.log('  ok  ' + nombre); }
  catch(e){ console.log('  FALLÓ  ' + nombre); console.log(e); process.exitCode = 1; }
}

(async () => {
  const {akStore} = require(path.join(__dirname, '..', 'app', 'akasha-store.js'));
  const {codificar, decodificar} = akStore._interno;

  await prueba('ida y vuelta: objeto, lista, texto (mismo orden de claves)', async () => {
    for(const txt of [
      '{"b":1,"a":{"z":1,"y":[1,2]},"c":"x"}',
      '[{"id":1,"t":"a"},{"id":2,"t":"b"},{"id":1,"t":"a"}]',
      'Agus', '3', '[]', '{}', 'null',
    ]){
      const {tipo, filas} = codificar(txt);
      const m = new Map([['~', {v: JSON.stringify({t: tipo}), p: 0}]]);
      filas.forEach((f, i) => m.set(f.s, {v: f.v, p: i}));
      const vuelta = decodificar(m);
      if(txt === 'null') assert.strictEqual(vuelta, 'null');
      else assert.strictEqual(vuelta, txt);
    }
  });

  await prueba('modo local (sin nube) se comporta como localStorage', async () => {
    const srv = nuevoServidor();
    const a = nuevoAparato(srv);
    await a.store.iniciar(null);
    a.store.setItem('akasha-fichas', '{"1":{"n":2}}');
    assert.strictEqual(a.memoria.get('akasha-fichas'), '{"1":{"n":2}}');
    assert.strictEqual(a.store.getItem('akasha-fichas'), '{"1":{"n":2}}');
  });

  await prueba('dos profes editan fichas distintas al mismo tiempo: no se pisan', async () => {
    const srv = nuevoServidor();
    const A = nuevoAparato(srv), B = nuevoAparato(srv);
    await A.store.iniciar(A.backend);
    A.store.setItem('akasha-fichas', JSON.stringify({ana: {nivel: 1}, beto: {nivel: 2}}));
    await A.store.subirTodoYEsperar();
    await B.store.iniciar(B.backend);
    // Los dos abrieron con la misma foto. A cambia a Ana, B cambia a Beto.
    A.store.setItem('akasha-fichas', JSON.stringify({ana: {nivel: 3}, beto: {nivel: 2}}));
    B.store.setItem('akasha-fichas', JSON.stringify({ana: {nivel: 1}, beto: {nivel: 1}}));
    await A.store.subirTodoYEsperar(); await B.store.subirTodoYEsperar();
    const C = nuevoAparato(srv); await C.store.iniciar(C.backend);
    assert.deepStrictEqual(JSON.parse(C.store.getItem('akasha-fichas')), {ana: {nivel: 3}, beto: {nivel: 1}});
  });

  await prueba('dos profes agregan novedades a la vez: quedan las dos', async () => {
    const srv = nuevoServidor();
    const A = nuevoAparato(srv), B = nuevoAparato(srv);
    await A.store.iniciar(A.backend);
    A.store.setItem('akasha-novedades', JSON.stringify([{id: 'n1'}]));
    await A.store.subirTodoYEsperar();
    await B.store.iniciar(B.backend);
    A.store.setItem('akasha-novedades', JSON.stringify([{id: 'n1'}, {id: 'deA'}]));
    B.store.setItem('akasha-novedades', JSON.stringify([{id: 'n1'}, {id: 'deB'}]));
    await A.store.subirTodoYEsperar(); await B.store.subirTodoYEsperar();
    const C = nuevoAparato(srv); await C.store.iniciar(C.backend);
    const ids = JSON.parse(C.store.getItem('akasha-novedades')).map(x => x.id).sort();
    assert.deepStrictEqual(ids, ['deA', 'deB', 'n1']);
  });

  await prueba('borrar un elemento borra sólo ese', async () => {
    const srv = nuevoServidor();
    const A = nuevoAparato(srv), B = nuevoAparato(srv);
    await A.store.iniciar(A.backend);
    A.store.setItem('akasha-cargas', JSON.stringify([{k: 1}, {k: 2}, {k: 3}]));
    await A.store.subirTodoYEsperar();
    await B.store.iniciar(B.backend);
    B.store.setItem('akasha-cargas', JSON.stringify([{k: 1}, {k: 2}, {k: 3}, {k: 4}]));
    A.store.setItem('akasha-cargas', JSON.stringify([{k: 1}, {k: 3}]));
    await A.store.subirTodoYEsperar(); await B.store.subirTodoYEsperar();
    const C = nuevoAparato(srv); await C.store.iniciar(C.backend);
    assert.deepStrictEqual(JSON.parse(C.store.getItem('akasha-cargas')).map(x => x.k), [1, 3, 4]);
  });

  await prueba('el orden de las listas se respeta (agregar adelante, en el medio y al final)', async () => {
    const srv = nuevoServidor();
    const A = nuevoAparato(srv);
    await A.store.iniciar(A.backend);
    A.store.setItem('l', JSON.stringify(['b', 'd']));
    A.store.setItem('l', JSON.stringify(['a', 'b', 'c', 'd', 'e']));
    await A.store.subirTodoYEsperar();
    const C = nuevoAparato(srv); await C.store.iniciar(C.backend);
    assert.strictEqual(C.store.getItem('l'), '["a","b","c","d","e"]');
    C.store.setItem('l', JSON.stringify(['e', 'd', 'c', 'b', 'a'])); // reordenada
    await C.store.subirTodoYEsperar();
    const D = nuevoAparato(srv); await D.store.iniciar(D.backend);
    assert.strictEqual(D.store.getItem('l'), '["e","d","c","b","a"]');
  });

  await prueba('sin internet: se guarda en el aparato y se sube al volver', async () => {
    const srv = nuevoServidor();
    const A = nuevoAparato(srv);
    await A.store.iniciar(A.backend);
    srv.caido = true;
    A.store.setItem('akasha-notas-clase', JSON.stringify({'2026-11-05|9|X': {texto: 'hola'}}));
    await esperar(600);
    assert.ok(A.store.estado().pendientes > 0, 'debería haber pendientes');
    assert.strictEqual(srv.filas.size, 0);
    // Se cierra la app sin conexión y se vuelve a abrir más tarde, ya con conexión.
    const memoriaGuardada = A.memoria;
    srv.caido = false;
    const A2 = nuevoAparato(srv);
    memoriaGuardada.forEach((v, k) => A2.memoria.set(k, v));
    await A2.store.iniciar(A2.backend);
    assert.ok(JSON.parse(A2.store.getItem('akasha-notas-clase'))['2026-11-05|9|X']);
    await A2.store.subirTodoYEsperar();
    const C = nuevoAparato(srv); await C.store.iniciar(C.backend);
    assert.strictEqual(JSON.parse(C.store.getItem('akasha-notas-clase'))['2026-11-05|9|X'].texto, 'hola');
  });

  await prueba('arranca sin internet mostrando lo último que vio el aparato', async () => {
    const srv = nuevoServidor();
    const A = nuevoAparato(srv);
    await A.store.iniciar(A.backend);
    A.store.setItem('akasha-nivel', JSON.stringify({ana: 3}));
    await A.store.subirTodoYEsperar();
    srv.caido = true;
    const A2 = nuevoAparato(srv);
    A.memoria.forEach((v, k) => A2.memoria.set(k, v));
    await A2.store.iniciar(A2.backend);
    assert.deepStrictEqual(JSON.parse(A2.store.getItem('akasha-nivel')), {ana: 3});
  });

  await prueba('avisa cuando otro profe cambió algo (y no por los cambios propios)', async () => {
    const srv = nuevoServidor();
    const A = nuevoAparato(srv), B = nuevoAparato(srv);
    await A.store.iniciar(A.backend); await B.store.iniciar(B.backend);
    A.store.setItem('akasha-fichas', JSON.stringify({ana: 1}));
    await A.store.subirTodoYEsperar();
    assert.strictEqual(A.store.estado().cambiosRemotos, false, 'A no debería avisarse a sí mismo');
    assert.strictEqual(B.store.estado().cambiosRemotos, true, 'B debería enterarse');
  });

  await prueba('preferencias del aparato (profe elegido) no se comparten', async () => {
    const srv = nuevoServidor();
    const A = nuevoAparato(srv);
    await A.store.iniciar(A.backend);
    A.store.setItem('akasha-profesor', 'Lucas');
    await A.store.subirTodoYEsperar();
    assert.strictEqual(srv.filas.size, 0);
    assert.strictEqual(A.store.getItem('akasha-profesor'), 'Lucas');
  });

  await prueba('removeItem borra la caja en la nube', async () => {
    const srv = nuevoServidor();
    const A = nuevoAparato(srv);
    await A.store.iniciar(A.backend);
    A.store.setItem('akasha-crono-x', JSON.stringify({a: 1}));
    await A.store.subirTodoYEsperar();
    A.store.removeItem('akasha-crono-x');
    await A.store.subirTodoYEsperar();
    assert.strictEqual(srv.filas.size, 0);
    assert.strictEqual(A.store.getItem('akasha-crono-x'), null);
  });

  console.log(`\n${n} pruebas pasaron` + (process.exitCode ? ' (HAY FALLAS)' : ''));
})();
