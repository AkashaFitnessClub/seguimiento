/* =====================================================================
   Akasha Seguimiento — Notas por voz de la clase

   El profe dicta durante la clase ("Juan 40, Ana 32 le molesta la
   rodilla derecha, Beto cambio sentadilla por prensa"). Después toca
   "Reconocer datos" y la app arma, por alumno:
     - Carga        nombre + número (kilos)
     - Alerta       nombre + molestia/dolor + zona (+ lado)
     - Cambio       nombre + cambio/en vez de + ejercicio + "por" + otro
     - Nota         nombre + cualquier otra cosa
   Lo que no empieza con un nombre de la clase queda en la nota de la
   clase. Nada se guarda hasta que el profe revisa y confirma.

   No usa IA ni servicios pagos: el paso de voz a texto lo hace el
   navegador (Chrome en Android, Safari en iPhone) y el reconocimiento
   se hace acá, con reglas, contra los alumnos de ESA clase.
   ===================================================================== */
(function(){
  'use strict';

  /* ---------------- Texto ---------------- */

  function norm(s){
    return String(s == null ? '' : s).toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/(\d)[,.](\d)/g, '$1d$2')          // 40,5 -> 40d5 (se recupera después)
      .replace(/[^a-z0-9ñ\s]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  /* Palabras normalizadas + la palabra original (para guardar notas tal como se dijeron). */
  function palabras(texto){
    const orig = String(texto || '').split(/\s+/).filter(Boolean);
    const out = [];
    orig.forEach(w => { norm(w).split(' ').filter(Boolean).forEach(n => out.push({n, o: w})); });
    return out;
  }
  function distancia(a, b){
    if(Math.abs(a.length - b.length) > 2) return 9;
    const d = Array.from({length: a.length + 1}, (_, i) => [i]);
    for(let j = 1; j <= b.length; j++) d[0][j] = j;
    for(let i = 1; i <= a.length; i++) for(let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
    return d[a.length][b.length];
  }
  /* ¿La palabra dicha es este nombre? Exacto, un error de transcripción
     en nombres largos, o el apodo como comienzo ("Agus" -> Agustina). */
  function pareceNombre(dicho, nombre){
    if(!dicho || !nombre) return false;
    if(dicho === nombre) return true;
    if(dicho.length >= 4 && nombre.startsWith(dicho)) return true;
    if(nombre.length >= 5 && dicho.length >= 4 && distancia(dicho, nombre) <= 1) return true;
    return false;
  }

  /* ---------------- Números ---------------- */

  const UNID = {cero:0, un:1, uno:1, una:1, dos:2, tres:3, cuatro:4, cinco:5, seis:6, siete:7, ocho:8, nueve:9,
    diez:10, once:11, doce:12, trece:13, catorce:14, quince:15, dieciseis:16, diecisiete:17, dieciocho:18, diecinueve:19,
    veinte:20, veintiuno:21, veintiun:21, veintidos:22, veintitres:23, veinticuatro:24, veinticinco:25, veintiseis:26,
    veintisiete:27, veintiocho:28, veintinueve:29};
  const DECENAS = {treinta:30, cuarenta:40, cincuenta:50, sesenta:60, setenta:70, ochenta:80, noventa:90};
  const CENTENAS = {cien:100, ciento:100, doscientos:200, trescientos:300};

  /* Lee un número desde la posición i. Devuelve {valor, fin} o null.
     Entiende "40", "40,5", "cuarenta", "treinta y cinco", "ciento diez",
     y "y medio" al final. */
  function leerNumero(ws, i){
    let valor = null, j = i;
    const w = ws[j] && ws[j].n;
    if(!w) return null;
    if(/^\d+(d\d+)?$/.test(w)){ valor = parseFloat(w.replace('d', '.')); j++; }
    else{
      let total = 0, algo = false;
      if(CENTENAS[ws[j] && ws[j].n] !== undefined){ total += CENTENAS[ws[j].n]; j++; algo = true; }
      if(ws[j] && DECENAS[ws[j].n] !== undefined){
        total += DECENAS[ws[j].n]; j++; algo = true;
        if(ws[j] && ws[j].n === 'y' && ws[j+1] && UNID[ws[j+1].n] !== undefined && UNID[ws[j+1].n] < 10){ total += UNID[ws[j+1].n]; j += 2; }
      }else if(ws[j] && UNID[ws[j].n] !== undefined && ws[j].n !== 'un' && ws[j].n !== 'una'){ total += UNID[ws[j].n]; j++; algo = true; }
      if(!algo) return null;
      valor = total;
    }
    if(ws[j] && ws[j].n === 'y' && ws[j+1] && /^medi[oa]$/.test(ws[j+1].n)){ valor += 0.5; j += 2; }
    else if(ws[j] && ws[j].n === 'medio'){ valor += 0.5; j++; }
    if(ws[j] && /^(kg|kilo|kilos|k)$/.test(ws[j].n)) j++;
    return {valor, fin: j};
  }

  /* ---------------- Vocabulario de novedades ---------------- */

  const ZONAS = [
    ['Espalda alta', /\b(espalda alta|dorsal(es)?|omoplato)\b/],
    ['Lumbar', /\b(lumbar(es)?|espalda baja|cintura|zona lumbar)\b/],
    ['Hombro', /\bhombros?\b/], ['Codo', /\bcodos?\b/], ['Muñeca', /\bmunecas?\b/],
    ['Cuello', /\b(cuello|cervical(es)?)\b/], ['Cadera', /\bcaderas?\b/],
    ['Rodilla', /\brodillas?\b/], ['Tobillo', /\btobillos?\b/],
  ];
  const RE_ALERTA = /\b(dolor(es)?|duele|duelen|dolio|molest\w*|lesion\w*|pincha\w*|tirante|contractura)\b/;
  const RE_DOLOR = /\b(dolor(es)?|duele|duelen|dolio)\b/;
  const RE_CAMBIO = /\b(cambi\w*|reemplaz\w*|en vez de|en lugar de)\b/;
  const VACIAS = new Set(['con','sin','de','del','la','el','los','las','en','y','a','por','para','al','un','una','x','kg','kilos','kilo']);

  function ladoDe(t){
    if(/\b(ambos|ambas|los dos|las dos)\b/.test(t)) return 'ambos';
    if(/\bizquierd[oa]s?\b/.test(t)) return 'izq';
    if(/\bderech[oa]s?\b/.test(t)) return 'der';
    return '';
  }

  /* Ejercicio mencionado en un tramo de palabras, entre los posibles. */
  function ejercicioMencionado(ws, ejercicios){
    let mejor = null, mejorPuntos = 0;
    ejercicios.forEach(ej => {
      const claves = norm(ej).split(' ').filter(w => w.length >= 3 && !VACIAS.has(w));
      let pts = 0;
      claves.forEach(k => { if(ws.some(w => w.n.length >= 3 && (w.n === k || (k.length >= 5 && w.n.slice(0, 5) === k.slice(0, 5))))) pts++; });
      if(pts > mejorPuntos){ mejor = ej; mejorPuntos = pts; }
    });
    return mejor;
  }

  /* ---------------- Análisis ----------------
     roster: [{id, nombre, apellido}] (los alumnos de la clase)
     ejerciciosDe(id): ejercicios del bloque actual para ese alumno
     Devuelve {items, notaClase} */
  function analizar(texto, roster, ejerciciosDe){
    const ws = palabras(texto);
    const gente = roster.map(a => ({
      a, nom: norm(a.nombre).split(' ').filter(Boolean), ape: norm(a.apellido).split(' ').filter(Boolean),
    }));

    /* 1) Encontrar dónde arranca cada alumno. */
    const marcas = [];
    for(let i = 0; i < ws.length; i++){
      let cands = gente.filter(g => pareceNombre(ws[i].n, g.nom[0]));
      let largo = 1;
      if(!cands.length){
        /* También por apellido solo ("Pérez 40"), si es un apellido largo. */
        cands = gente.filter(g => ws[i].n.length >= 5 && g.ape[0] === ws[i].n);
      }
      if(!cands.length) continue;
      /* Desempatar (y consumir) con el apellido o el segundo nombre. */
      const sig = ws[i+1] && ws[i+1].n;
      if(sig){
        const conApe = cands.filter(g => g.ape.some(p => pareceNombre(sig, p)) || (g.nom[1] && pareceNombre(sig, g.nom[1])));
        if(conApe.length){ cands = conApe; largo = 2; }
      }
      /* Si coincide exacto con alguno, se descartan los parecidos. */
      const exactos = cands.filter(g => g.nom[0] === ws[i].n);
      if(exactos.length && exactos.length < cands.length) cands = exactos;
      marcas.push({i, fin: i + largo, cands: cands.map(g => g.a)});
      i += largo - 1;
    }

    const items = [];
    const textoDe = (d, h) => ws.slice(d, h).map(w => w.o).join(' ').replace(/^[,.;:\s]+|[,.;:\s]+$/g, '');
    const notaClase = textoDe(0, marcas.length ? marcas[0].i : ws.length);

    /* 2) Interpretar lo que se dijo de cada alumno. */
    marcas.forEach((m, k) => {
      const hasta = k + 1 < marcas.length ? marcas[k+1].i : ws.length;
      const tramo = ws.slice(m.fin, hasta);
      const t = tramo.map(w => w.n).join(' ');
      const dicho = textoDe(m.i, hasta);
      const resto = textoDe(m.fin, hasta);
      const alumnoId = m.cands.length === 1 ? m.cands[0].id : null;
      const base = {alumnoId, candidatos: m.cands.map(a => a.id), texto: dicho};
      const ejercicios = alumnoId ? (ejerciciosDe(alumnoId) || []) : [];
      let algo = false;

      const esAlerta = RE_ALERTA.test(t), esCambio = RE_CAMBIO.test(t) && /\bpor\b/.test(t);

      if(esAlerta){
        const zona = (ZONAS.find(z => z[1].test(t)) || [null])[0];
        items.push(Object.assign({}, base, {tipo: 'alerta', sub: RE_DOLOR.test(t) ? 'dolor' : 'molestia',
          zona, lado: ladoDe(t), nota: resto, revisar: !zona || !alumnoId}));
        algo = true;
      }
      if(esCambio){
        const iPor = tramo.findIndex(w => w.n === 'por');
        const antes = tramo.slice(0, iPor), despues = tramo.slice(iPor + 1);
        const ej = ejercicioMencionado(antes, ejercicios) || (ejercicios.length === 1 ? ejercicios[0] : null);
        const nuevo = despues.map(w => w.o).join(' ').replace(/[,.;:\s]+$/, '');
        items.push(Object.assign({}, base, {tipo: 'cambio', ejercicio: ej, opcionesEj: ejercicios, nuevo,
          nota: resto, revisar: !ej || !nuevo || !alumnoId}));
        algo = true;
      }

      /* Cargas: números del tramo. Si además hay alerta o cambio, sólo
         cuentan los que dicen "kilos" o van pegados a un ejercicio, para
         no tomar "hace 2 días" como 2 kg. */
      const numeros = [];
      for(let j = 0; j < tramo.length; j++){
        const r = leerNumero(tramo, j);
        if(!r) continue;
        const conKilos = tramo.slice(j, r.fin).some(w => /^(kg|kilo|kilos|k)$/.test(w.n));
        const prevEj = ejercicioMencionado(tramo.slice(Math.max(0, j - 3), j), ejercicios);
        if(r.valor > 0 && r.valor <= 400 && (!(esAlerta || esCambio) || conKilos || prevEj)){
          numeros.push({valor: r.valor, j, ej: ejercicioMencionado(tramo.slice(numeros.length ? numeros[numeros.length-1].fin : 0, j), ejercicios), fin: r.fin});
        }
        j = r.fin - 1;
      }
      if(numeros.length){
        const usados = new Set(numeros.map(n => n.ej).filter(Boolean));
        const libres = ejercicios.filter(e => !usados.has(e));
        numeros.forEach(n => {
          let ej = n.ej, revisar = !alumnoId;
          if(!ej){
            if(ejercicios.length === 1) ej = ejercicios[0];
            else if(libres.length){ ej = libres.shift(); revisar = true; }
            else revisar = true;
          }
          items.push(Object.assign({}, base, {tipo: 'carga', ejercicio: ej, opcionesEj: ejercicios, valor: n.valor, revisar}));
        });
        algo = true;
      }

      if(!algo){
        items.push(Object.assign({}, base, {tipo: 'nota', nota: resto || dicho, revisar: !alumnoId}));
      }
    });
    return {items, notaClase};
  }

  const api = {analizar, _norm: norm, _leerNumero: (t) => { const ws = palabras(t); const r = leerNumero(ws, 0); return r && r.valor; }};
  if(typeof module !== 'undefined' && module.exports){ module.exports = api; return; }
  window.akReconocer = api;
})();

/* =====================================================================
   Pantalla "Notas de la clase" (sólo en el navegador)
   Usa las funciones y datos de la app (CLASES, novedades,
   cargasPendientes, etc.), que están en el ámbito global.
   ===================================================================== */
(function(){
  'use strict';
  if(typeof window === 'undefined' || typeof document === 'undefined') return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const CLAVE = 'akasha-dictados';
  const st = {claseId: null, grabando: false, interim: '', previo: '', sesion: '', items: null, notaClaseRec: ''};
  let rec = null, timerNota = null;

  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const aviso = t => { try{ showToast(t); }catch(e){ alert(t); } };
  const clase = () => getClase(st.claseId);
  const claveClase = c => claveNotaClase(claveActiva(), c.hora, c.disciplina);

  /* ---------- Dictados guardados (compartidos, uno por fila) ---------- */
  function leerDictados(){ try{ return JSON.parse(akStore.getItem(CLAVE) || '{}') || {}; }catch(e){ return {}; } }
  function guardarDictados(d){ akStore.setItem(CLAVE, JSON.stringify(d)); }
  function pendientes(c){
    const d = leerDictados(), k = claveClase(c);
    return Object.keys(d).filter(id => d[id].clave === k && !d[id].procesado).sort((a, b) => d[a].ts - d[b].ts).map(id => Object.assign({id}, d[id]));
  }
  function textoPendiente(c){ return pendientes(c).map(x => x.texto).join('\n'); }
  function sumarDictado(texto){
    texto = String(texto || '').trim();
    const c = clase(); if(!texto || !c) return;
    const d = leerDictados();
    d['d' + Date.now()] = {clave: claveClase(c), ts: Date.now(), texto, profesor: profesorActivo, procesado: false};
    guardarDictados(d);
  }
  /* Si el profe corrigió el texto a mano, queda un solo dictado con lo corregido. */
  function reemplazarPendientes(texto){
    const c = clase(); if(!c) return;
    const d = leerDictados();
    pendientes(c).forEach(p => { delete d[p.id]; });
    texto = String(texto || '').trim();
    if(texto) d['d' + Date.now()] = {clave: claveClase(c), ts: Date.now(), texto, profesor: profesorActivo, procesado: false};
    guardarDictados(d);
  }
  function marcarProcesados(c){
    const d = leerDictados(), ts = Date.now();
    pendientes(c).forEach(p => { d[p.id].procesado = ts; d[p.id].por = profesorActivo; });
    guardarDictados(d);
  }

  /* ---------- Micrófono ---------- */
  function textoSesion(e){
    /* Algunos Android devuelven el texto acumulado en cada resultado
       ("Juan", "Juan 40", "Juan 40 Ana"): se reemplaza en vez de sumar. */
    const finales = []; let interim = '';
    for(let i = 0; i < e.results.length; i++){
      const r = e.results[i], t = r[0].transcript.trim();
      if(!r.isFinal){ interim += ' ' + t; continue; }
      const ult = finales[finales.length - 1];
      if(ult && t.toLowerCase().startsWith(ult.toLowerCase())) finales[finales.length - 1] = t;
      else if(t) finales.push(t);
    }
    return {final: finales.join(' '), interim: interim.trim()};
  }
  function empezar(){
    if(!SR) return;
    rec = new SR();
    rec.lang = 'es-AR'; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 1;
    st.previo = ''; st.sesion = ''; st.interim = '';
    rec.onresult = e => { const t = textoSesion(e); st.sesion = t.final; st.interim = t.interim; pintarMic(); };
    rec.onerror = e => {
      if(e.error === 'not-allowed' || e.error === 'service-not-allowed'){
        st.grabando = false;
        aviso('Hay que permitir el micrófono: tocá el candado de la barra de direcciones → Micrófono → Permitir.');
      }else if(e.error === 'network'){
        st.grabando = false; aviso('Para dictar hace falta internet.');
      }
    };
    /* El navegador corta solo después de un silencio: si el profe no
       tocó "terminar", se vuelve a encender. */
    rec.onend = () => {
      st.previo = [st.previo, st.sesion].filter(Boolean).join(' '); st.sesion = '';
      if(st.grabando){ try{ rec.start(); return; }catch(err){} }
      const dicho = st.previo; st.previo = ''; st.interim = ''; st.grabando = false;
      if(dicho) sumarDictado(dicho);
      pintar();
    };
    st.grabando = true;
    try{ rec.start(); }catch(err){ st.grabando = false; aviso('No se pudo usar el micrófono.'); }
    pintar();
  }
  function parar(){ st.grabando = false; if(rec){ try{ rec.stop(); }catch(e){} } pintarMic(); }

  /* ---------- Reconocer ---------- */
  function rosterDe(c){
    return presentesDe(c).map(alumnoDeClase).filter(Boolean).map(a => ({id: a.id, nombre: a.nombre || '', apellido: a.apellido || ''}));
  }
  function ejerciciosDe(c){
    return id => { try{ return itemsCargaModal({alumnoId: id, claseId: c.id}).map(x => x.ejercicio); }catch(e){ return []; } };
  }
  function reconocer(){
    const c = clase(); if(!c) return;
    const ta = document.getElementById('ak-dict-texto');
    if(ta && ta.value.trim() !== textoPendiente(c).trim()) reemplazarPendientes(ta.value);
    const texto = textoPendiente(c);
    if(!texto.trim()){ aviso('No hay nada dictado para reconocer'); return; }
    const r = window.akReconocer.analizar(texto, rosterDe(c), ejerciciosDe(c));
    st.items = r.items.map(x => Object.assign({incluir: true}, x));
    /* Lo que quedó sin nombre de la clase va a la nota de la clase. */
    if(r.notaClase) st.items.push({tipo: 'nota-clase', nota: r.notaClase, incluir: true, texto: r.notaClase});
    if(!st.items.length) aviso('No se reconoció nada');
    pintar();
  }

  /* ---------- Guardar lo confirmado ---------- */
  function valido(x){
    if(x.tipo === 'nota-clase') return !!String(x.nota || '').trim();
    if(!x.alumnoId) return false;
    if(x.tipo === 'carga') return !!x.ejercicio && x.valor > 0;
    if(x.tipo === 'alerta') return !!x.zona;
    if(x.tipo === 'cambio') return !!x.ejercicio && !!String(x.nuevo || '').trim();
    return !!String(x.nota || '').trim();
  }
  function bloqueActual(c){
    try{ const rut = rutinaDeClase(c); const i = bloqueIdxClase(c, rut); return tituloBloque(rut.bloques[i], i); }catch(e){ return ''; }
  }
  function guardarTodo(){
    const c = clase(); if(!c || !st.items) return;
    const elegidos = st.items.filter(x => x.incluir);
    const malos = elegidos.filter(x => !valido(x));
    if(malos.length){ malos.forEach(x => { x.revisar = true; }); pintar(); aviso('Completá lo marcado en amarillo (o destildalo)'); return; }
    let nCargas = 0, nNov = 0, ts = Date.now();
    const bloque = bloqueActual(c);
    const notasExtra = [];
    elegidos.forEach((x, i) => {
      if(x.tipo === 'carga'){
        cargasPendientes[pendienteKey(c.id, x.alumnoId, x.ejercicio)] = Number(x.valor);
        nCargas++; return;
      }
      if(x.tipo === 'nota-clase'){ notasExtra.push(String(x.nota).trim()); return; }
      const m = x.tipo === 'alerta' ? {grupo: 'alerta', sub: x.sub || 'molestia'}
              : x.tipo === 'cambio' ? {grupo: 'cambiar', sub: 'ejercicio'} : {grupo: 'obs', sub: ''};
      const dato = {id: 'n' + (ts + i), alumnoId: x.alumnoId, claseId: c.id, dia: claveActiva(), claseHora: c.hora, claseDisc: c.disciplina,
        profesor: profesorActivo, fecha: fechaCorta(), hora: nowHora(), tipo: tipoDeNov(m), nota: String(x.nota || '').trim(),
        grupo: m.grupo, sub: m.sub, bloque, dictado: true};
      if(x.tipo === 'alerta'){ dato.zonaCuerpo = x.zona; dato.lado = x.lado || ''; dato.ej = ''; }
      if(x.tipo === 'cambio'){ dato.ej = x.ejercicio; dato.nuevo = String(x.nuevo).trim(); }
      if(x.tipo === 'nota') dato.frases = [];
      novedades.unshift(dato);
      nNov++;
    });
    if(nCargas) persistPendientes();
    if(nNov) persistNovedades();
    if(notasExtra.length){
      c.obsFinal = [c.obsFinal, ...notasExtra].filter(Boolean).join('\n');
      guardarNotaClase(c);
    }
    marcarProcesados(c);
    st.items = null;
    const partes = [];
    if(nCargas) partes.push(nCargas + ' carga' + (nCargas === 1 ? '' : 's'));
    if(nNov) partes.push(nNov + ' novedad' + (nNov === 1 ? '' : 'es'));
    if(notasExtra.length) partes.push('nota de la clase');
    aviso('Guardado: ' + (partes.join(', ') || 'nada'));
    try{ render(); }catch(e){}
    pintar();
  }
  function guardarNotaClase(c){
    const kn = claveClase(c);
    notasClase[kn] = {texto: c.obsFinal || '', profesor: profesorActivo, ts: Date.now()};
    persistNotasClase();
  }

  /* ---------- Pantalla ---------- */
  const ICONO = {carga: '🏋️ Carga', alerta: '⚠️ Alerta', cambio: '🔁 Cambio de ejercicio', nota: '📝 Nota del alumno', 'nota-clase': '🗒️ Nota de la clase'};
  function opciones(lista, actual, vacio){
    return (vacio !== undefined ? `<option value="">${esc(vacio)}</option>` : '') +
      lista.map(o => { const [v, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${String(v) === String(actual == null ? '' : actual) ? ' selected' : ''}>${esc(t)}</option>`; }).join('');
  }
  function itemHtml(x, i, c){
    const roster = rosterDe(c);
    const cands = x.candidatos && x.candidatos.length > 1 ? roster.filter(a => x.candidatos.indexOf(a.id) !== -1) : roster;
    const quien = x.tipo === 'nota-clase' ? '' : (x.alumnoId && !(x.candidatos && x.candidatos.length > 1 && !x.elegido)
      ? `<b>${esc(nombreCompleto(alumnoDeClase(x.alumnoId)))}</b>`
      : `<select data-i="${i}" data-k="alumnoId" class="ak-sel">${opciones(cands.map(a => [a.id, a.nombre + ' ' + a.apellido]), x.alumnoId, '¿Quién?')}</select>`);
    let det = '';
    if(x.tipo === 'carga'){
      det = `${x.opcionesEj && x.opcionesEj.length ? `<select data-i="${i}" data-k="ejercicio" class="ak-sel">${opciones(x.opcionesEj, x.ejercicio, '¿Qué ejercicio?')}</select>` : '<span class="ak-falta">La clase no tiene rutina con ejercicios</span>'}
        <input data-i="${i}" data-k="valor" type="number" step="0.5" inputmode="decimal" class="ak-num" value="${esc(x.valor)}"> kg`;
    }else if(x.tipo === 'alerta'){
      det = `<select data-i="${i}" data-k="sub" class="ak-sel">${opciones([['molestia', 'Molestia'], ['dolor', 'Dolor']], x.sub)}</select>
        <select data-i="${i}" data-k="zona" class="ak-sel">${opciones(NOV_CUERPO, x.zona, '¿Dónde?')}</select>
        <select data-i="${i}" data-k="lado" class="ak-sel">${opciones([['izq', 'Izquierdo'], ['der', 'Derecho'], ['ambos', 'Los dos']], x.lado, 'Lado')}</select>
        <input data-i="${i}" data-k="nota" class="ak-txt" value="${esc(x.nota)}" placeholder="Nota">`;
    }else if(x.tipo === 'cambio'){
      det = `<select data-i="${i}" data-k="ejercicio" class="ak-sel">${opciones(x.opcionesEj || [], x.ejercicio, '¿Qué ejercicio?')}</select> por
        <input data-i="${i}" data-k="nuevo" class="ak-txt" value="${esc(x.nuevo)}" placeholder="Nuevo ejercicio">`;
    }else{
      det = `<input data-i="${i}" data-k="nota" class="ak-txt" value="${esc(x.nota)}">`;
    }
    return `<div class="ak-item${x.revisar && x.incluir ? ' ak-revisar' : ''}${x.incluir ? '' : ' ak-fuera'}">
      <label class="ak-cab"><input type="checkbox" data-i="${i}" data-k="incluir"${x.incluir ? ' checked' : ''}> ${ICONO[x.tipo]} ${quien}</label>
      <div class="ak-det">${det}</div>
      ${x.revisar && x.incluir ? '<div class="ak-aviso">Revisá este dato</div>' : ''}
      ${x.tipo !== 'nota-clase' ? `<div class="ak-dicho">“${esc(x.texto)}”</div>` : ''}
    </div>`;
  }
  function micHtml(){
    if(!SR) return `<div class="ak-sin-mic">Este navegador no deja dictar desde la app. Tocá el cuadro de abajo y usá el 🎤 del teclado. (En la tablet, abrí la app con <b>Chrome</b>.)</div>`;
    const vivo = [st.previo, st.sesion].filter(Boolean).join(' ');
    return `<button type="button" class="ak-mic${st.grabando ? ' on' : ''}" onclick="akDictado.${st.grabando ? 'parar' : 'empezar'}()">
        <span class="ak-mic-ic">${st.grabando ? '■' : '🎤'}</span>
        <span>${st.grabando ? 'Escuchando… tocá para terminar' : 'Tocá para dictar'}</span></button>
      ${st.grabando ? `<div class="ak-vivo">${esc(vivo)} <i>${esc(st.interim)}</i></div>` : ''}`;
  }
  function pintarMic(){ const el = document.getElementById('ak-mic-zona'); if(el) el.innerHTML = micHtml(); }
  function pintar(){
    let cont = document.getElementById('ak-dictado');
    const c = clase();
    if(!st.claseId || !c){ if(cont) cont.remove(); return; }
    if(!cont){ cont = document.createElement('div'); cont.id = 'ak-dictado'; document.body.appendChild(cont); }
    const pend = textoPendiente(c);
    cont.innerHTML = `<div class="modal-overlay" style="z-index:300" onclick="if(event.target===this) akDictado.cerrar()">
      <div class="modal-sheet ak-hoja">
        <h2>Notas de la clase</h2>
        <div class="modal-sub">${esc(c.hora)} · ${esc(c.disciplina)} — empezá cada nota con el nombre: “Juan 40”, “Ana le molesta la rodilla derecha”, “Beto cambio sentadilla por prensa”.</div>
        <div id="ak-mic-zona">${micHtml()}</div>
        <div class="medicion-sub">Dictado sin reconocer${pend ? '' : ' (vacío)'}</div>
        <textarea id="ak-dict-texto" rows="4" placeholder="Lo que dictes aparece acá. También podés escribir o corregir.">${esc(pend)}</textarea>
        <button type="button" class="btn btn-primary btn-block" style="margin-top:10px" onclick="akDictado.reconocer()">✨ Reconocer datos</button>
        ${st.items ? `<div class="ak-lista">
            <div class="medicion-sub">Revisá y confirmá (${st.items.filter(x => x.incluir).length} para guardar)</div>
            ${st.items.map((x, i) => itemHtml(x, i, c)).join('') || '<p class="empty-hist">No se reconoció nada.</p>'}
            ${st.items.length ? `<button type="button" class="btn btn-primary btn-block" onclick="akDictado.guardarTodo()">Guardar todo</button>
            <p class="ak-nota-pie">Las cargas se aplican a la ficha de cada alumno al finalizar la clase, como siempre.</p>` : ''}
          </div>` : ''}
        <div class="medicion-sub" style="margin-top:18px">Nota de la clase — referencias para el staff</div>
        <textarea id="ak-nota-clase" rows="3" placeholder="Cómo salió la clase, qué tener en cuenta la próxima…">${esc(c.obsFinal || '')}</textarea>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" onclick="akDictado.cerrar()">Cerrar</button>
          <button type="button" class="btn btn-primary" onclick="akDictado.finalizar()">${c.finalizada ? 'Editar cierre' : 'Finalizar clase'}</button>
        </div>
      </div></div>`;
  }

  /* Cambios en la revisión (selects, números, textos, tildes). */
  document.addEventListener('change', ev => {
    const el = ev.target; if(!el.closest || !el.closest('#ak-dictado')) return;
    if(el.id === 'ak-dict-texto'){ reemplazarPendientes(el.value); return; }
    const i = el.dataset && el.dataset.i; if(i === undefined || !st.items) return;
    const x = st.items[Number(i)], k = el.dataset.k;
    if(k === 'incluir') x.incluir = el.checked;
    else if(k === 'alumnoId'){
      x.alumnoId = el.value ? Number(el.value) : null; x.elegido = true;
      const c = clase();
      if(c && x.alumnoId && (x.tipo === 'carga' || x.tipo === 'cambio')){ x.opcionesEj = ejerciciosDe(c)(x.alumnoId); if(x.opcionesEj.length === 1 && !x.ejercicio) x.ejercicio = x.opcionesEj[0]; }
    }
    else if(k === 'valor') x.valor = parseFloat(String(el.value).replace(',', '.'));
    else x[k] = el.value;
    if(valido(x)) x.revisar = false;
    pintar();
  });
  document.addEventListener('input', ev => {
    if(ev.target && ev.target.id === 'ak-nota-clase'){
      const c = clase(); if(!c) return;
      c.obsFinal = ev.target.value;
      clearTimeout(timerNota);
      timerNota = setTimeout(() => guardarNotaClase(c), 600);
    }
  });

  window.akDictado = {
    abrir(claseId){ st.claseId = claseId; st.items = null; pintar(); },
    cerrar(){
      if(st.grabando) parar();
      const c = clase();
      const ta = document.getElementById('ak-dict-texto');
      if(c && ta && ta.value.trim() !== textoPendiente(c).trim()) reemplazarPendientes(ta.value);
      if(c){ clearTimeout(timerNota); const n = document.getElementById('ak-nota-clase'); if(n){ c.obsFinal = n.value; guardarNotaClase(c); } }
      st.claseId = null; st.items = null; pintar();
      try{ render(); }catch(e){}
    },
    finalizar(){
      const id = st.claseId;
      const c = clase();
      if(c && textoPendiente(c).trim() && !confirm('Hay dictado sin reconocer. ¿Finalizar igual? (queda guardado para reconocerlo después)')) return;
      this.cerrar();
      abrirFinalizar(id);
    },
    empezar, parar, reconocer, guardarTodo,
    hayMicrofono: !!SR,
  };

  const css = document.createElement('style');
  css.textContent = `
    .ak-hoja{max-width:640px;}
    .ak-mic{width:100%; display:flex; align-items:center; justify-content:center; gap:12px; min-height:84px; margin:6px 0 14px;
      border-radius:18px; border:2px solid var(--accent); background:var(--accent-soft); color:var(--accent-hover); font-size:18px; font-weight:700;}
    .ak-mic.on{background:var(--red-soft); border-color:var(--red); color:var(--red); animation:akpulso 1.4s ease-in-out infinite;}
    .ak-mic-ic{font-size:30px;}
    @keyframes akpulso{0%,100%{box-shadow:0 0 0 0 rgba(255,107,94,.35);}50%{box-shadow:0 0 0 10px rgba(255,107,94,0);}}
    .ak-vivo{font-size:15px; color:var(--text); margin:-6px 0 12px; min-height:1.4em;} .ak-vivo i{color:var(--text-faint);}
    .ak-sin-mic{background:var(--amber-soft); color:var(--amber); border-radius:var(--radius-sm); padding:12px 14px; font-size:14px; margin:6px 0 14px;}
    .ak-lista{margin-top:16px;}
    .ak-item{border:1.5px solid var(--border); border-radius:var(--radius-sm); padding:10px 12px; margin-bottom:8px;}
    .ak-item.ak-revisar{border-color:var(--amber);} .ak-item.ak-fuera{opacity:.45;}
    .ak-cab{display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:14.5px; cursor:pointer;}
    .ak-cab input{width:20px; height:20px; accent-color:var(--accent);}
    .ak-det{display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-top:8px; font-size:14px;}
    .ak-sel, .ak-num, .ak-txt{background:var(--surface-alt); color:var(--text); border:1.5px solid var(--border); border-radius:8px; padding:8px 9px; font:inherit; font-size:14px;}
    .ak-num{width:80px;} .ak-txt{flex:1 1 180px; min-width:0;}
    .ak-aviso{color:var(--amber); font-size:12.5px; font-weight:600; margin-top:6px;}
    .ak-falta{color:var(--amber); font-size:13px;}
    .ak-dicho{color:var(--text-faint); font-size:12.5px; margin-top:6px;}
    .ak-nota-pie{color:var(--text-faint); font-size:12.5px; margin:8px 0 0;}
  `;
  document.head.appendChild(css);
})();
