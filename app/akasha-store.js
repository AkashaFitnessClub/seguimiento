/* =====================================================================
   Akasha Seguimiento — capa de datos compartida (Supabase)

   La app original guardaba todo con localStorage (sólo en ese aparato).
   Esta capa ofrece la MISMA forma de uso (getItem / setItem /
   removeItem, sincrónico) pero guarda en Supabase, así todos los profes
   ven los mismos datos.

   Cómo evita que dos profes se pisen:
   - Cada "caja" (por ejemplo 'akasha-fichas', que es un objeto con un
     alumno por clave) se guarda partida: una fila por alumno, por fecha
     o por elemento de una lista.
   - Cuando la app guarda, se compara contra lo que ESTA pantalla había
     leído, y se mandan sólo las filas que cambió esta persona. Si otro
     profe cambió otra fila mientras tanto, queda intacta.
   - Los cambios se guardan primero en el aparato (cola) y se suben en
     segundo plano: si se corta el wifi del gimnasio no se pierde nada;
     se sube cuando vuelve la conexión.
   ===================================================================== */
(function(){
  'use strict';

  /* Preferencias de cada aparato: no se comparten. */
  const SOLO_ESTE_APARATO = new Set([
    'akasha-profesor', 'akasha-pantalla-escala', 'akasha-carpeta-vistos', 'akasha-crono',
  ]);
  const CACHE_KEY = '__akasha_cache_v1';
  const COLA_KEY  = '__akasha_cola_v1';
  const TABLA = 'akasha_datos';

  const ls = (function(){ try{ return window.localStorage; }catch(e){ return null; } })();
  function lsGet(k){ try{ return ls ? ls.getItem(k) : null; }catch(e){ return null; } }
  function lsSet(k, v){ try{ if(ls) ls.setItem(k, v); return true; }catch(e){ return false; } }
  function lsDel(k){ try{ if(ls) ls.removeItem(k); }catch(e){} }

  /* ---------- Codificación: un valor de la app <-> filas ---------- */

  /* Hash corto y estable de un texto (FNV-1a). Sirve para identificar
     cada elemento de una lista por su contenido. */
  function hash(str){
    let h = 0x811c9dc5;
    for(let i = 0; i < str.length; i++){
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
  }

  /* Devuelve {tipo, filas:[{s, v}]} en el orden de la app. `v` es el
     texto JSON tal cual lo produjo la app (se respeta el orden). */
  function codificar(texto){
    let dato, esJson = true;
    try{ dato = JSON.parse(texto); }catch(e){ esJson = false; }
    if(esJson && Array.isArray(dato)){
      const vistos = {};
      return {tipo:'a', filas: dato.map(el => {
        const v = JSON.stringify(el === undefined ? null : el);
        const h = hash(v);
        vistos[h] = (vistos[h] || 0) + 1;
        return {s: 'a:' + h + ':' + vistos[h], v};
      })};
    }
    if(esJson && dato && typeof dato === 'object'){
      return {tipo:'o', filas: Object.keys(dato).map(k => ({
        s: 'o:' + k, v: JSON.stringify(dato[k] === undefined ? null : dato[k]),
      }))};
    }
    return {tipo:'s', filas: [{s:'s', v: JSON.stringify(String(texto))}]};
  }

  /* filas: Map subclave -> {v, p}. Devuelve el texto que espera la app. */
  function decodificar(filas){
    if(!filas) return null;
    const marca = filas.get('~');
    if(!marca) return null;
    let tipo;
    try{ tipo = JSON.parse(marca.v).t; }catch(e){ return null; }
    if(tipo === 's'){
      const f = filas.get('s');
      if(!f) return null;
      try{ return String(JSON.parse(f.v)); }catch(e){ return null; }
    }
    const lista = [];
    filas.forEach((f, s) => { if(s !== '~' && s.charAt(0) === tipo) lista.push([s, f]); });
    lista.sort((x, y) => (x[1].p - y[1].p) || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
    if(tipo === 'a') return '[' + lista.map(x => x[1].v).join(',') + ']';
    return '{' + lista.map(x => JSON.stringify(x[0].slice(2)) + ':' + x[1].v).join(',') + '}';
  }

  /* Asigna posiciones: las filas que ya existían conservan la suya (así
     no se reescriben), las nuevas se intercalan entre sus vecinas. Si la
     app reordenó la lista, se renumera todo. */
  function asignarPosiciones(filas, base){
    const conocidas = filas.map(f => (base && base.has(f.s)) ? base.get(f.s).p : null);
    let ultima = -Infinity, ordenada = true;
    for(const p of conocidas){
      if(p == null) continue;
      if(!(p > ultima)){ ordenada = false; break; }
      ultima = p;
    }
    if(!ordenada) return filas.map((f, i) => i);
    const pos = conocidas.slice();
    let i = 0;
    while(i < pos.length){
      if(pos[i] != null){ i++; continue; }
      let j = i;
      while(j < pos.length && pos[j] == null) j++;
      const lo = i > 0 ? pos[i - 1] : null;
      const hi = j < pos.length ? pos[j] : null;
      const n = j - i;
      for(let k = 0; k < n; k++){
        if(lo == null && hi == null) pos[i + k] = i + k;
        else if(lo == null) pos[i + k] = hi - (n - k);
        else if(hi == null) pos[i + k] = lo + k + 1;
        else pos[i + k] = lo + (hi - lo) * (k + 1) / (n + 1);
      }
      i = j;
    }
    return pos;
  }

  /* ---------- Estado ---------- */

  /* base: lo que ESTA pantalla sabe que hay guardado (lo que leyó al
     abrir más lo que escribió desde entonces). Map clave -> Map subclave -> {v, p}. */
  let base = new Map();
  let cola = [];            // cambios sin subir: {op:'up'|'del', c, s, v?, p?}
  let backend = null;       // null = modo local (sin nube)
  let subiendo = false, reintento = null, errorUltimo = null;
  let cambiosRemotos = false;
  const oyentes = new Set();

  function avisar(){ oyentes.forEach(fn => { try{ fn(estado()); }catch(e){} }); }
  function estado(){
    return {
      enLaNube: !!backend, pendientes: cola.length, subiendo,
      error: errorUltimo, cambiosRemotos,
      enLinea: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
    };
  }

  function guardarCache(){
    if(!backend) return;
    const plano = [];
    base.forEach((filas, c) => filas.forEach((f, s) => plano.push([c, s, f.v, f.p])));
    lsSet(CACHE_KEY, JSON.stringify(plano));
  }
  function guardarCola(){
    if(!backend) return;
    if(cola.length) lsSet(COLA_KEY, JSON.stringify(cola)); else lsDel(COLA_KEY);
  }
  function cargarDesdePlano(plano){
    const m = new Map();
    (plano || []).forEach(([c, s, v, p]) => {
      if(!m.has(c)) m.set(c, new Map());
      m.get(c).set(s, {v, p: p == null ? 0 : Number(p)});
    });
    return m;
  }
  function aplicarOp(m, op){
    if(!m.has(op.c)) m.set(op.c, new Map());
    const filas = m.get(op.c);
    if(op.op === 'up') filas.set(op.s, {v: op.v, p: op.p});
    else filas.delete(op.s);
    if(!filas.size) m.delete(op.c);
  }
  function encolar(op){
    /* Si ya había un cambio pendiente para la misma fila, gana el último. */
    cola = cola.filter(o => !(o.c === op.c && o.s === op.s));
    cola.push(op);
  }

  /* ---------- API que usa la app (igual que localStorage) ---------- */

  function getItem(clave){
    clave = String(clave);
    if(!backend || SOLO_ESTE_APARATO.has(clave)) return lsGet(clave);
    return decodificar(base.get(clave));
  }

  function setItem(clave, valor){
    clave = String(clave); valor = String(valor);
    if(!backend || SOLO_ESTE_APARATO.has(clave)){
      if(!lsSet(clave, valor)) throw new Error('No hay espacio en este aparato');
      return;
    }
    const anterior = base.get(clave) || new Map();
    const {tipo, filas} = codificar(valor);
    const pos = asignarPosiciones(filas, anterior);
    const nuevas = new Map();
    nuevas.set('~', {v: JSON.stringify({t: tipo}), p: 0});
    filas.forEach((f, i) => nuevas.set(f.s, {v: f.v, p: pos[i]}));

    let hubo = false;
    nuevas.forEach((f, s) => {
      const a = anterior.get(s);
      if(!a || a.v !== f.v || a.p !== f.p){ encolar({op:'up', c: clave, s, v: f.v, p: f.p}); hubo = true; }
    });
    anterior.forEach((f, s) => {
      if(!nuevas.has(s)){ encolar({op:'del', c: clave, s}); hubo = true; }
    });
    base.set(clave, nuevas);
    if(hubo){ guardarCola(); guardarCache(); programarSubida(); avisar(); }
  }

  function removeItem(clave){
    clave = String(clave);
    if(!backend || SOLO_ESTE_APARATO.has(clave)){ lsDel(clave); return; }
    const anterior = base.get(clave);
    if(!anterior) return;
    anterior.forEach((f, s) => encolar({op:'del', c: clave, s}));
    base.delete(clave);
    guardarCola(); guardarCache(); programarSubida(); avisar();
  }

  /* ---------- Subida a la nube ---------- */

  function programarSubida(demora){
    if(!backend) return;
    clearTimeout(reintento);
    reintento = setTimeout(subir, demora == null ? 400 : demora);
  }

  let esperaReintento = 2000;
  async function subir(){
    if(!backend || subiendo || !cola.length) return;
    subiendo = true; avisar();
    const lote = cola.slice();
    try{
      await backend.aplicar(lote);
      /* Se sacan de la cola sólo los que se subieron y no cambiaron de
         nuevo mientras tanto. */
      cola = cola.filter(o => !lote.includes(o));
      errorUltimo = null; esperaReintento = 2000;
      guardarCola();
    }catch(e){
      errorUltimo = (e && (e.message || e.code)) || 'error';
      esperaReintento = Math.min(esperaReintento * 2, 60000);
      programarSubida(esperaReintento);
    }finally{
      subiendo = false; avisar();
      if(cola.length && !errorUltimo) programarSubida(50);
    }
  }

  async function subirTodoYEsperar(maxMs){
    const limite = Date.now() + (maxMs || 8000);
    while(cola.length && Date.now() < limite){
      if(!subiendo) await subir();
      if(!cola.length) break;
      await new Promise(r => setTimeout(r, 250));
    }
    return !cola.length;
  }

  /* ---------- Arranque ---------- */

  /* backendImpl: {leerTodo(): Promise<[[c,s,v,p]]>, aplicar(ops): Promise,
     escuchar(fn(evento)): void}. Sin backend = modo local. */
  async function iniciar(backendImpl){
    backend = backendImpl || null;
    if(!backend) return estado();
    /* 1) Lo último que este aparato vio (sirve si arranca sin internet). */
    try{ base = cargarDesdePlano(JSON.parse(lsGet(CACHE_KEY) || '[]')); }catch(e){ base = new Map(); }
    try{ cola = JSON.parse(lsGet(COLA_KEY) || '[]') || []; }catch(e){ cola = []; }
    /* 2) Lo que hay en la nube, si hay conexión. */
    let desdeNube = false;
    try{
      base = cargarDesdePlano(await backend.leerTodo());
      desdeNube = true;
    }catch(e){ errorUltimo = 'Sin conexión: mostrando lo último guardado en este aparato'; }
    /* 3) Lo que quedó sin subir de la vez anterior va encima. */
    cola.forEach(op => aplicarOp(base, op));
    guardarCache();
    if(cola.length) programarSubida(100);
    backend.escuchar && backend.escuchar(alCambiarEnLaNube);
    if(typeof window !== 'undefined'){
      window.addEventListener('online', () => { errorUltimo = null; programarSubida(0); avisar(); });
      window.addEventListener('offline', avisar);
    }
    avisar();
    return Object.assign(estado(), {desdeNube});
  }

  /* Llega un cambio hecho por otro aparato. No se mete en la pantalla
     abierta (la app tiene los datos en memoria y se podrían mezclar);
     se avisa para que se actualice cuando no haya nada a medio cargar. */
  function alCambiarEnLaNube(ev){
    const filas = base.get(ev.c);
    const actual = filas && filas.get(ev.s);
    if(ev.tipo === 'DELETE'){
      if(!actual) return;                      // ya lo sabíamos (o lo borramos nosotros)
    }else if(actual && actual.v === ev.v){
      return;                                  // es nuestro propio cambio que vuelve
    }
    if(cola.some(o => o.c === ev.c && o.s === ev.s)) return;
    cambiosRemotos = true;
    avisar();
  }

  const akStore = {
    getItem, setItem, removeItem,
    key(){ return null; }, get length(){ return 0; },
    iniciar, subirTodoYEsperar,
    estado, alCambiar(fn){ oyentes.add(fn); return () => oyentes.delete(fn); },
    get enLaNube(){ return !!backend; },
    leerJSON(clave, porDefecto){
      try{ const t = getItem(clave); return t == null ? porDefecto : JSON.parse(t); }catch(e){ return porDefecto; }
    },
    /* Para pruebas y para la migración. */
    _interno: {codificar, decodificar, asignarPosiciones, hash, get base(){ return base; }, get cola(){ return cola; }},
  };

  if(typeof module !== 'undefined' && module.exports) module.exports = {akStore};
  if(typeof window !== 'undefined') window.akStore = akStore;
})();
