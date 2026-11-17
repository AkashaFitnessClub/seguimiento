/* =====================================================================
   Akasha Seguimiento — Formularios de ingreso (Tally → Supabase)

   - Trae las respuestas del formulario "Antes de empezar, queremos
     conocerte", que llegan solas a la base (función tally-formulario).
   - Completa la ficha de cada alumno (objetivo y observación de ingreso)
     usando la MISMA lógica que la importación manual de la app: cruza por
     email con el listado de usuarios de Crossfy y sólo llena lo vacío.
   - Muestra la lista de respuestas (prospectos y alumnos) con lo
     necesario para la clase de prueba y para el seguimiento.
   ===================================================================== */
(function(){
  'use strict';
  const CLAVE_EMAILS = 'akasha-indice-emails';
  const st = {abierto: false, filtro: 'todos', busca: '', abiertos: {}, lista: [], error: null, cargando: false};
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

  /* ---------- Emails de los socios (para cruzar con el formulario) ----------
     La importación de usuarios de Crossfy arma importIndex.byEmail sólo en
     memoria. Se guarda en la base (protegida) para poder cruzar siempre. */
  function restaurarEmails(){
    try{
      const guardado = JSON.parse(akStore.getItem(CLAVE_EMAILS) || '{}') || {};
      Object.keys(guardado).forEach(e => { if(importIndex.byEmail[e] === undefined) importIndex.byEmail[e] = guardado[e]; });
    }catch(e){}
  }
  function guardarEmails(){
    const m = {};
    Object.keys(importIndex.byEmail || {}).forEach(e => { const k = norm(e); if(k) m[k] = Number(importIndex.byEmail[e]); });
    akStore.setItem(CLAVE_EMAILS, JSON.stringify(m));
  }
  const aplicarHojaOriginal = window.aplicarHoja;
  window.aplicarHoja = function(hoja){
    const r = aplicarHojaOriginal.apply(this, arguments);
    try{ if(hoja && hoja.tipo === 'usuarios'){ guardarEmails(); setTimeout(cargar, 0); } }catch(e){}
    return r;
  };
  function idAlumnoDe(f){
    const id = f.email ? importIndex.byEmail[norm(f.email)] : undefined;
    return id === undefined ? null : Number(id);
  }

  /* ---------- Traer y aplicar ---------- */
  async function cargar(){
    const sb = window.akSupabase;
    if(!sb){ st.error = 'local'; return; }
    st.cargando = true;
    const {data, error} = await sb.from('akasha_formularios')
      .select('id,recibido,nombre,email,whatsapp,horario_contacto,cercania,objetivo,origen,campana,respuestas')
      .order('recibido', {ascending: true});
    st.cargando = false;
    if(error){ st.error = error.message; pintar(); return; }
    st.error = null;
    st.lista = data || [];
    aplicarAFichas(st.lista);
    pintar();
  }
  /* Arma una "hoja" igual a la que sale de exportar el formulario y se la
     pasa a la importación de la app: así se usa exactamente la misma regla
     (cruce por email, sólo completa campos vacíos, la respuesta más nueva gana). */
  function aplicarAFichas(lista){
    if(!lista.length) return;
    /* Las columnas se arman por NOMBRE de pregunta, no por posición: el
       formulario cambió con el tiempo (las primeras respuestas tienen una
       pregunta más) y por posición quedaba todo corrido y no cruzaba nadie.
       Si una pregunta aparece repetida en la misma respuesta (pasa con el
       objetivo), cada aparición va a su propia columna. */
    const conClave = f => {
      const vistas = {};
      return (f.respuestas || []).map(r => {
        const n = normHeader(r.pregunta);
        vistas[n] = (vistas[n] || 0) + 1;
        return {n, k: n + '#' + vistas[n], respuesta: r.respuesta};
      });
    };
    const filas = lista.map(conClave);
    const columnas = [];
    filas.forEach(fila => fila.forEach(r => { if(!columnas.some(c => c.k === r.k)) columnas.push({k: r.k, n: r.n}); }));
    const headersNorm = columnas.map(c => c.n);
    const dataRows = filas.map(fila => columnas.map(c => {
      const r = fila.find(x => x.k === c.k);
      return r ? r.respuesta : '';
    }));
    try{
      aplicarHojaOriginal({nombre: 'Formulario (automático)', tipo: 'formulario', headersNorm, dataRows});
      render();
    }catch(e){ console.warn('No se pudo aplicar el formulario', e); }
  }

  /* ---------- Pantalla ---------- */
  const NADA = /^(no|nop|ninguna?|nada|por ahora,? no|creo que no|no creo que no|\.|-)?\.?$/i;
  function respuesta(f, trozo){
    const r = (f.respuestas || []).find(x => norm(x.pregunta).includes(trozo));
    return r ? String(r.respuesta || '').trim() : '';
  }
  function cercaniaClase(c){
    const t = norm(c);
    if(t.includes('cuanto antes')) return 'cal';
    if(t.includes('pronto')) return 'tib';
    return 'fri';
  }
  function fecha(iso){ const d = new Date(iso); return d.toLocaleDateString('es-AR', {day: '2-digit', month: '2-digit', year: '2-digit'}); }
  function waLink(n){ const d = String(n || '').replace(/\D/g, ''); return d ? 'https://wa.me/' + d : ''; }

  function tarjeta(f){
    const id = idAlumnoDe(f);
    const a = id !== null ? getAlumno(id) : null;
    const tener = respuesta(f, 'deberiamos saber');
    const alerta = tener && !NADA.test(tener.trim());
    const abierto = !!st.abiertos[f.id];
    return `<div class="card fm-card">
      <button type="button" class="fm-top" onclick="akFormularios.alternar('${esc(f.id)}')">
        <span class="fm-nom">${esc(a ? nombreCompleto(a) : (f.nombre || 'Sin nombre'))}</span>
        <span class="fm-fecha">${esc(fecha(f.recibido))}</span>
      </button>
      <div class="fm-tags">
        ${a ? '<span class="fm-tag al">Alumno</span>' : '<span class="fm-tag pr">Prospecto</span>'}
        ${f.cercania ? `<span class="fm-tag ${cercaniaClase(f.cercania)}">${esc(f.cercania)}</span>` : ''}
        ${f.objetivo ? `<span class="fm-tag ob">${esc(f.objetivo)}</span>` : ''}
        ${f.origen ? `<span class="fm-tag ob">Vino por: ${esc(f.origen)}${f.campana ? ' · ' + esc(f.campana) : ''}</span>` : ''}
      </div>
      ${alerta ? `<div class="fm-alerta">⚠ ${esc(tener)}</div>` : ''}
      <div class="fm-acc">
        ${a ? `<button type="button" class="linkbtn" onclick="akFormularios.verFicha(${a.id})">Ver ficha</button>` : ''}
        ${f.whatsapp ? `<a class="linkbtn" href="${esc(waLink(f.whatsapp))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
        ${f.horario_contacto ? `<span class="fm-hor">Prefiere: ${esc(f.horario_contacto)}</span>` : ''}
        <button type="button" class="linkbtn" onclick="akFormularios.alternar('${esc(f.id)}')">${abierto ? 'Ocultar respuestas' : 'Ver todas las respuestas'}</button>
      </div>
      ${abierto ? `<div class="fm-resp">${(f.respuestas || []).filter(r => r.respuesta).map(r =>
        `<div class="fm-q">${esc(r.pregunta)}</div><div class="fm-r">${esc(r.respuesta)}</div>`).join('')}</div>` : ''}
    </div>`;
  }
  function pintar(){
    let cont = document.getElementById('ak-formularios');
    if(!st.abierto){ if(cont) cont.remove(); return; }
    if(!cont){ cont = document.createElement('div'); cont.id = 'ak-formularios'; document.body.appendChild(cont); }
    let cuerpo;
    if(st.error === 'local') cuerpo = '<p class="empty-hist">Los formularios se ven con la base compartida (iniciando sesión).</p>';
    else if(st.error) cuerpo = `<p class="empty-hist">No se pudieron traer los formularios: ${esc(st.error)}</p>`;
    else{
      const q = norm(st.busca);
      const lista = st.lista.slice().reverse().filter(f => {
        const esAlumno = idAlumnoDe(f) !== null;
        if(st.filtro === 'prospectos' && esAlumno) return false;
        if(st.filtro === 'alumnos' && !esAlumno) return false;
        if(st.filtro === 'calientes' && cercaniaClase(f.cercania) !== 'cal') return false;
        if(q && !norm([f.nombre, f.email, f.objetivo].join(' ')).includes(q)){
          const a = esAlumno ? getAlumno(idAlumnoDe(f)) : null;
          if(!(a && norm(nombreCompleto(a)).includes(q))) return false;
        }
        return true;
      });
      const nP = st.lista.filter(f => idAlumnoDe(f) === null).length;
      cuerpo = `
        <input class="search-input" id="fm-busca" placeholder="Buscar por nombre, email u objetivo…" value="${esc(st.busca)}" oninput="akFormularios.buscar(this.value)">
        <div class="filter-row" style="margin-top:12px">
          ${[['todos', 'Todos (' + st.lista.length + ')'], ['prospectos', 'Prospectos (' + nP + ')'], ['alumnos', 'Alumnos (' + (st.lista.length - nP) + ')'], ['calientes', '🔥 Quieren empezar ya']]
            .map(([k, t]) => `<button class="chip ${st.filtro === k ? 'active' : ''}" onclick="akFormularios.filtrar('${k}')">${t}</button>`).join('')}
        </div>
        ${Object.keys(importIndex.byEmail || {}).length ? '' : '<div class="aviso-ejemplo">Para saber quién ya es alumno, importá una vez el listado de usuarios de Crossfy (Importar datos).</div>'}
        ${lista.map(tarjeta).join('') || '<p class="empty-hist">No hay respuestas con ese filtro.</p>'}`;
    }
    const foco = document.activeElement && document.activeElement.id === 'fm-busca';
    cont.innerHTML = `<div class="modal-overlay" style="z-index:300; align-items:stretch" onclick="if(event.target===this) akFormularios.cerrar()">
      <div class="modal-sheet fm-hoja">
        <div class="fm-cab"><h2>Formularios de ingreso</h2><button type="button" class="backbtn" onclick="akFormularios.cerrar()" aria-label="Cerrar">✕</button></div>
        <div class="modal-sub">Respuestas de “Antes de empezar, queremos conocerte”. Llegan solas desde Tally.</div>
        ${st.cargando ? '<p class="empty-hist">Cargando…</p>' : cuerpo}
      </div></div>`;
    if(foco){ const i = document.getElementById('fm-busca'); if(i){ i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  }

  window.akFormularios = {
    abrir(){ st.abierto = true; pintar(); cargar(); },
    cerrar(){ st.abierto = false; pintar(); },
    alternar(id){ st.abiertos[id] = !st.abiertos[id]; pintar(); },
    filtrar(k){ st.filtro = k; pintar(); },
    buscar(t){ st.busca = t; pintar(); },
    verFicha(id){ st.abierto = false; pintar(); nav('alumno', {alumnoId: id}); },
    recargar: cargar,
    _estado: st,
  };

  const css = document.createElement('style');
  css.textContent = `
    .fm-hoja{max-width:720px; max-height:none; min-height:100%;}
    @media (min-width:640px){ .fm-hoja{max-height:92vh;} }
    .fm-cab{display:flex; align-items:center; justify-content:space-between; gap:10px;}
    .fm-card{padding:14px 16px; margin-bottom:10px;}
    .fm-top{display:flex; justify-content:space-between; align-items:baseline; gap:10px; width:100%; background:none; border:none; color:var(--text); padding:0; text-align:left;}
    .fm-nom{font-family:var(--font-display); font-weight:700; font-size:17px;}
    .fm-fecha{font-family:var(--font-mono); font-size:12.5px; color:var(--text-faint);}
    .fm-tags{display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;}
    .fm-tag{font-size:12px; font-weight:700; border-radius:999px; padding:3px 10px; background:var(--surface-alt); color:var(--text-soft);}
    .fm-tag.al{background:var(--accent-soft); color:var(--accent);} .fm-tag.pr{background:var(--amber-soft); color:var(--amber);}
    .fm-tag.cal{background:var(--accent); color:#0C0C0C;} .fm-tag.tib{background:var(--amber-soft); color:var(--amber);}
    .fm-alerta{margin-top:8px; background:var(--red-soft); color:var(--red); border-radius:var(--radius-sm); padding:8px 10px; font-size:14px;}
    .fm-acc{display:flex; flex-wrap:wrap; gap:14px; align-items:center; margin-top:10px; font-size:14px;}
    .fm-acc a.linkbtn{text-decoration:none;}
    .fm-hor{color:var(--text-faint); font-size:13px;}
    .fm-resp{margin-top:10px; border-top:1px solid var(--border); padding-top:8px;}
    .fm-q{font-size:12.5px; color:var(--text-faint); margin-top:8px;} .fm-r{font-size:14.5px; white-space:pre-line;}
  `;
  document.head.appendChild(css);

  restaurarEmails();
  cargar();
})();
