/* =====================================================================
   Akasha Seguimiento — arranque
   1. Si hay Supabase configurado: pide iniciar sesión, verifica que la
      cuenta esté activada y trae los datos de la nube.
   2. Si no (config.js vacío): modo local, como la app original.
   3. Recién entonces arranca la app (su código está guardado en
      <script type="text/plain" id="akasha-app-code">).
   ===================================================================== */
(function(){
  'use strict';
  const cfg = window.AKASHA_CONFIG || {};
  const conNube = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  /* Hay que leerlo antes de crear el cliente: el cliente limpia la URL. */
  const tipoLink = (/[#&?]type=(invite|recovery|signup)/.exec(location.hash + location.search) || [])[1] || null;

  /* ---------- Descargas fuera de Claude ----------
     La app pide "downloads" a Claude para bajar respaldos. Fuera de
     claude.ai lo resolvemos con una descarga común del navegador. */
  if(!(window.claude && window.claude.use)){
    window.claude = {
      use: async function(nombre){
        if(nombre !== 'downloads') return null;
        return {
          save: async function(o){
            const blob = o.data instanceof Blob ? o.data : new Blob([o.data], {type: o.mimeType || 'application/octet-stream'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = o.filename || 'archivo';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
            return {ok: true};
          },
        };
      },
    };
  }

  /* ---------- Pantallas propias (acceso, espera, errores) ---------- */
  const css = `
    #ak-acceso{position:fixed; inset:0; z-index:500; background:var(--bg,#0C0C0C); color:var(--text,#F2F2F2);
      display:flex; align-items:center; justify-content:center; padding:20px; overflow:auto;}
    #ak-acceso .ak-caja{width:100%; max-width:380px;}
    #ak-acceso h1{font-family:var(--font-display,sans-serif); font-style:italic; font-weight:800; font-size:30px; margin:0 0 4px;}
    #ak-acceso .ak-sub{color:var(--text-soft,#A6A6A6); font-size:15px; margin:0 0 22px;}
    #ak-acceso label{display:block; font-size:13.5px; color:var(--text-soft,#A6A6A6); margin:14px 0 6px; font-weight:600;}
    #ak-acceso input{width:100%; box-sizing:border-box; border:1.5px solid var(--border,#2B2B2B); border-radius:9px; background:var(--surface,#161616);
      color:var(--text,#F2F2F2); font-size:16px; padding:12px 14px; font-family:inherit;}
    #ak-acceso input:focus{outline:none; border-color:var(--accent,#C6FC00);}
    #ak-acceso .btn{margin-top:20px;}
    #ak-acceso .ak-link{background:none; border:none; color:var(--text-soft,#A6A6A6); text-decoration:underline; font-size:14px; margin-top:16px; padding:8px 0; cursor:pointer;}
    #ak-acceso .ak-msg{margin-top:14px; font-size:14.5px; line-height:1.45; min-height:1em;}
    #ak-acceso .ak-msg.error{color:var(--red,#FF6B5E);} #ak-acceso .ak-msg.ok{color:var(--accent,#C6FC00);}
    #ak-estado{position:fixed; left:10px; bottom:10px; z-index:150; display:flex; align-items:center; gap:7px;
      background:var(--surface,#161616); border:1px solid var(--border,#2B2B2B); color:var(--text-soft,#A6A6A6);
      border-radius:999px; padding:6px 12px 6px 10px; font-size:12.5px; font-weight:600; cursor:pointer; opacity:.92;}
    #ak-estado .pt{width:8px; height:8px; border-radius:50%; background:var(--accent,#C6FC00);}
    #ak-estado.subiendo .pt{background:var(--amber,#F5B83D);}
    #ak-estado.error .pt{background:var(--red,#FF6B5E);}
    #ak-menu{position:fixed; left:10px; bottom:50px; z-index:160; background:var(--surface,#161616); border:1px solid var(--border,#2B2B2B);
      border-radius:14px; padding:14px; width:270px; max-width:calc(100vw - 20px); box-shadow:0 8px 24px rgba(0,0,0,.5); font-size:14px;}
    #ak-menu .q{color:var(--text-faint,#6F6F6F); font-size:12.5px; margin-bottom:10px; word-break:break-all;}
    #ak-menu .d{color:var(--text-soft,#A6A6A6); margin-bottom:12px; line-height:1.45;}
    #ak-menu button{display:block; width:100%; text-align:left; background:none; border:none; border-top:1px solid var(--border,#2B2B2B);
      color:var(--text,#F2F2F2); padding:11px 2px; font-size:14.5px; font-weight:600; cursor:pointer;}
    #ak-nuevo{position:fixed; left:12px; right:12px; bottom:56px; z-index:170; background:var(--accent,#C6FC00); color:#0C0C0C; border:none;
      border-radius:9px; padding:14px 16px; font-weight:700; font-size:15px; box-shadow:0 6px 24px rgba(0,0,0,.5); cursor:pointer;}
    #ak-local{background:#2B2210; color:#F5B83D; font-size:13.5px; padding:8px 14px; text-align:center;}
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function esc(t){ return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function pantalla(html){
    let el = document.getElementById('ak-acceso');
    if(!el){ el = document.createElement('div'); el.id = 'ak-acceso'; document.body.appendChild(el); }
    el.innerHTML = '<div class="ak-caja">' + html + '</div>';
    return el;
  }
  function cerrarPantalla(){ const el = document.getElementById('ak-acceso'); if(el) el.remove(); }
  function msg(texto, tipo){ const m = document.querySelector('#ak-acceso .ak-msg'); if(m){ m.textContent = texto || ''; m.className = 'ak-msg ' + (tipo || ''); } }
  function traducirError(e){
    const t = String((e && (e.message || e.error_description)) || e || '');
    if(/Invalid login credentials/i.test(t)) return 'El email o la contraseña no coinciden.';
    if(/Email not confirmed/i.test(t)) return 'Falta confirmar el email: revisá tu casilla.';
    if(/Password should be at least/i.test(t)) return 'La contraseña tiene que tener al menos 6 caracteres.';
    if(/rate limit|too many/i.test(t)) return 'Demasiados intentos. Esperá un minuto y probá de nuevo.';
    if(/fetch|network|Failed to/i.test(t)) return 'No hay conexión a internet.';
    return t || 'Algo salió mal.';
  }

  function pedirIngreso(sb){
    return new Promise(resolve => {
      const el = pantalla(`
        <h1>AKASHA</h1><p class="ak-sub">Seguimiento · Ingresá con tu cuenta del equipo</p>
        <form id="ak-f">
          <label for="ak-email">Email</label><input id="ak-email" type="email" autocomplete="username" required>
          <label for="ak-pass">Contraseña</label><input id="ak-pass" type="password" autocomplete="current-password" required>
          <button class="btn btn-primary btn-block" type="submit">Entrar</button>
        </form>
        <button class="ak-link" id="ak-olvide" type="button">Me olvidé la contraseña</button>
        <div class="ak-msg"></div>`);
      el.querySelector('#ak-f').onsubmit = async ev => {
        ev.preventDefault();
        msg('Entrando…');
        const {data, error} = await sb.auth.signInWithPassword({
          email: el.querySelector('#ak-email').value.trim(), password: el.querySelector('#ak-pass').value,
        });
        if(error) return msg(traducirError(error), 'error');
        resolve(data.session);
      };
      el.querySelector('#ak-olvide').onclick = async () => {
        const email = el.querySelector('#ak-email').value.trim();
        if(!email) return msg('Escribí tu email arriba y volvé a tocar.', 'error');
        const {error} = await sb.auth.resetPasswordForEmail(email, {redirectTo: location.origin + location.pathname});
        if(error) return msg(traducirError(error), 'error');
        msg('Listo: te mandamos un email con un link para elegir una contraseña nueva.', 'ok');
      };
    });
  }

  function pedirContrasenaNueva(sb, esInvitacion){
    return new Promise(resolve => {
      const el = pantalla(`
        <h1>${esInvitacion ? '¡Bienvenido/a!' : 'Contraseña nueva'}</h1>
        <p class="ak-sub">${esInvitacion ? 'Elegí la contraseña con la que vas a entrar a la app.' : 'Elegí tu contraseña nueva.'}</p>
        <form id="ak-f">
          <label for="ak-pass">Contraseña (mínimo 8 caracteres)</label><input id="ak-pass" type="password" autocomplete="new-password" minlength="8" required>
          <label for="ak-pass2">Repetila</label><input id="ak-pass2" type="password" autocomplete="new-password" minlength="8" required>
          <button class="btn btn-primary btn-block" type="submit">Guardar y entrar</button>
        </form><div class="ak-msg"></div>`);
      el.querySelector('#ak-f').onsubmit = async ev => {
        ev.preventDefault();
        const p1 = el.querySelector('#ak-pass').value, p2 = el.querySelector('#ak-pass2').value;
        if(p1 !== p2) return msg('Las dos contraseñas no coinciden.', 'error');
        msg('Guardando…');
        const {error} = await sb.auth.updateUser({password: p1});
        if(error) return msg(traducirError(error), 'error');
        resolve();
      };
    });
  }

  function esperarActivacion(sb, email){
    pantalla(`
      <h1>Casi listo</h1>
      <p class="ak-sub">Tu cuenta (${esc(email)}) ya está creada, pero falta que la persona que administra la app la active.</p>
      <p class="ak-sub">Avisale, y cuando te confirme tocá "Probar de nuevo".</p>
      <button class="btn btn-primary btn-block" onclick="location.reload()">Probar de nuevo</button>
      <button class="ak-link" id="ak-salir" type="button">Entrar con otra cuenta</button>`);
    document.getElementById('ak-salir').onclick = async () => { await sb.auth.signOut(); location.reload(); };
  }

  /* ---------- Conexión con Supabase ---------- */
  function backendSupabase(sb){
    const TABLA = 'akasha_datos';
    return {
      async leerTodo(){
        const todo = [];
        const PAG = 1000;
        for(let desde = 0; ; desde += PAG){
          const {data, error} = await sb.from(TABLA).select('clave,subclave,valor,pos')
            .order('clave').order('subclave').range(desde, desde + PAG - 1);
          if(error) throw error;
          data.forEach(r => todo.push([r.clave, r.subclave, r.valor, r.pos]));
          if(data.length < PAG) break;
        }
        return todo;
      },
      async aplicar(ops){
        const ups = ops.filter(o => o.op === 'up').map(o => ({clave: o.c, subclave: o.s, valor: o.v, pos: o.p}));
        for(let i = 0; i < ups.length; i += 500){
          const {error} = await sb.from(TABLA).upsert(ups.slice(i, i + 500), {onConflict: 'clave,subclave'});
          if(error) throw error;
        }
        const porClave = {};
        ops.filter(o => o.op === 'del').forEach(o => { (porClave[o.c] = porClave[o.c] || []).push(o.s); });
        for(const c of Object.keys(porClave)){
          const subs = porClave[c];
          for(let i = 0; i < subs.length; i += 150){
            const {error} = await sb.from(TABLA).delete().eq('clave', c).in('subclave', subs.slice(i, i + 150));
            if(error) throw error;
          }
        }
      },
      escuchar(fn){
        sb.channel('akasha-datos')
          .on('postgres_changes', {event: '*', schema: 'public', table: TABLA}, p => {
            const fila = (p.eventType === 'DELETE' ? p.old : p.new) || {};
            if(!fila.clave) return;
            fn({tipo: p.eventType, c: fila.clave, s: fila.subclave, v: p.new ? p.new.valor : null});
          })
          .subscribe();
      },
    };
  }

  /* ---------- Indicador de guardado y aviso de cambios ---------- */
  function montarIndicador(sb, email){
    const pill = document.createElement('button');
    pill.id = 'ak-estado'; pill.type = 'button';
    pill.innerHTML = '<span class="pt"></span><span class="tx">Guardado</span>';
    document.body.appendChild(pill);

    function pintar(e){
      let tx = 'Guardado', cls = '';
      if(e.pendientes && (!e.enLinea || e.error)){ tx = 'Sin conexión · ' + e.pendientes + ' sin subir'; cls = 'error'; }
      else if(e.pendientes || e.subiendo){ tx = 'Guardando…'; cls = 'subiendo'; }
      else if(e.error){ tx = 'Sin conexión'; cls = 'error'; }
      pill.className = cls; pill.querySelector('.tx').textContent = tx;
      let aviso = document.getElementById('ak-nuevo');
      if(e.cambiosRemotos && !aviso){
        aviso = document.createElement('button');
        aviso.id = 'ak-nuevo'; aviso.type = 'button';
        aviso.textContent = 'Otro profe cargó datos nuevos · Tocá para actualizar';
        aviso.onclick = actualizar;
        document.body.appendChild(aviso);
      }
    }
    akStore.alCambiar(pintar); pintar(akStore.estado());

    pill.onclick = () => {
      let m = document.getElementById('ak-menu');
      if(m){ m.remove(); return; }
      const e = akStore.estado();
      m = document.createElement('div'); m.id = 'ak-menu';
      m.innerHTML = `<div class="q">${esc(email || '')}</div>
        <div class="d">${e.pendientes ? 'Hay ' + e.pendientes + ' cambio(s) guardados en este aparato que se suben solos cuando haya conexión.' : 'Todo lo cargado está guardado en la nube.'}</div>
        <button type="button" id="ak-act">↻ Actualizar datos</button>
        <button type="button" id="ak-salir">Cerrar sesión</button>`;
      document.body.appendChild(m);
      m.querySelector('#ak-act').onclick = actualizar;
      m.querySelector('#ak-salir').onclick = async () => {
        const ok = await akStore.subirTodoYEsperar(8000);
        if(!ok && !confirm('Hay cambios que todavía no se subieron (falta conexión). Si cerrás sesión se pierden. ¿Cerrar igual?')) return;
        await sb.auth.signOut();
        try{ localStorage.removeItem('__akasha_cache_v1'); localStorage.removeItem('__akasha_cola_v1'); }catch(err){}
        location.reload();
      };
    };

    /* Al volver a la app (por ejemplo, desbloquear la tablet) se
       actualiza sola si hay datos nuevos y no hay nada a medio cargar. */
    document.addEventListener('visibilitychange', () => {
      if(document.visibilityState !== 'visible') return;
      if(!akStore.estado().cambiosRemotos) return;
      const ocupado = document.querySelector('.modal-overlay') ||
        (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName));
      if(!ocupado) actualizar();
    });
  }

  async function actualizar(){
    const b = document.getElementById('ak-nuevo'); if(b) b.textContent = 'Actualizando…';
    await akStore.subirTodoYEsperar(8000);
    location.reload();
  }

  /* ---------- Lanzar la app ---------- */
  function lanzarApp(){
    cerrarPantalla();
    const codigo = document.getElementById('akasha-app-code');
    const s = document.createElement('script');
    s.textContent = codigo.textContent;
    document.body.appendChild(s);
  }

  async function principal(){
    if(!conNube){
      await akStore.iniciar(null);
      const b = document.createElement('div'); b.id = 'ak-local';
      b.textContent = 'Modo local de prueba: los datos quedan sólo en este aparato.';
      document.body.insertBefore(b, document.body.firstChild);
      lanzarApp();
      return;
    }
    if(!window.supabase || !window.supabase.createClient){
      pantalla('<h1>Sin conexión</h1><p class="ak-sub">No se pudo cargar la app. Revisá internet y recargá.</p>');
      return;
    }
    pantalla('<p class="ak-sub">Cargando…</p>');
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true},
    });
    let {data: {session}} = await sb.auth.getSession();
    if(session && (tipoLink === 'invite' || tipoLink === 'recovery')){
      await pedirContrasenaNueva(sb, tipoLink === 'invite');
      history.replaceState(null, '', location.pathname);
    }
    if(!session) session = await pedirIngreso(sb);
    const email = session.user && session.user.email;

    pantalla('<p class="ak-sub">Trayendo los datos del equipo…</p>');
    const {data: yo, error: errMiembro} = await sb.from('akasha_miembros')
      .select('activo,rol').eq('user_id', session.user.id).maybeSingle();
    /* Sin conexión no se puede verificar: se sigue con lo guardado en el
       aparato (la nube igual rechaza cualquier escritura no permitida). */
    if(!errMiembro && !(yo && yo.activo)) return esperarActivacion(sb, email);

    await akStore.iniciar(backendSupabase(sb));
    montarIndicador(sb, email);
    lanzarApp();
  }

  principal().catch(e => {
    console.error(e);
    pantalla('<h1>Uy</h1><p class="ak-sub">No se pudo abrir la app: ' + esc(traducirError(e)) + '</p><button class="btn btn-primary btn-block" onclick="location.reload()">Reintentar</button>');
  });
})();
