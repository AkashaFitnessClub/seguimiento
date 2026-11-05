/* Prueba de punta a punta en un navegador real (Chromium), con dos
   aparatos conectados a un Supabase simulado.
   Uso: node pruebas/navegador.test.js   (sirve app/ en un puerto local) */
const {chromium} = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const APP = path.join(__dirname, '..', 'app');
const CAPTURAS = path.join(__dirname, 'capturas');
fs.mkdirSync(CAPTURAS, {recursive: true});

/* ---------- Supabase simulado (vive en Node, lo comparten las páginas) ---------- */
const db = {akasha_datos: new Map(), akasha_miembros: new Map()};
const paginas = new Set();
function filasDatos(){ return [...db.akasha_datos.values()]; }
async function difundir(ev){
  for(const p of paginas){ await p.evaluate(e => window.__rt && window.__rt(e), ev).catch(() => {}); }
}
async function ejecutar(q){
  if(q.tabla === 'akasha_miembros'){
    const uid = (q.filtros.find(f => f[0] === 'user_id') || [])[1];
    return {data: db.akasha_miembros.get(uid) || null, error: null};
  }
  if(q.op === 'select'){
    const ord = filasDatos().sort((a, b) => a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : (a.subclave < b.subclave ? -1 : a.subclave > b.subclave ? 1 : 0));
    const [d, h] = q.rango || [0, 999];
    return {data: ord.slice(d, h + 1), error: null};
  }
  if(q.op === 'upsert'){
    for(const r of q.filas){
      db.akasha_datos.set(r.clave + '|' + r.subclave, r);
      await difundir({eventType: 'UPDATE', new: r, old: {}});
    }
    return {data: null, error: null};
  }
  if(q.op === 'delete'){
    const c = q.filtros.find(f => f[0] === 'clave')[1];
    const subs = q.filtroIn[1];
    for(const s of subs){
      db.akasha_datos.delete(c + '|' + s);
      await difundir({eventType: 'DELETE', new: null, old: {clave: c, subclave: s}});
    }
    return {data: null, error: null};
  }
  return {data: null, error: {message: 'op no simulada'}};
}

const FAKE_SUPABASE = `
window.supabase = {createClient(){
  function qb(tabla){
    const q = {tabla, op:'select', filtros:[], filtroIn:null, rango:null, filas:null};
    const b = {
      select(){ return b; }, order(){ return b; },
      eq(k, v){ q.filtros.push([k, v]); return b; },
      in(k, v){ q.filtroIn = [k, v]; return b; },
      range(d, h){ q.rango = [d, h]; return b; },
      maybeSingle(){ return b; },
      upsert(filas){ q.op = 'upsert'; q.filas = filas; return b; },
      delete(){ q.op = 'delete'; return b; },
      then(ok, mal){ return window.__srv(q).then(ok, mal); },
    };
    return b;
  }
  return {
    auth: {
      async getSession(){ const s = localStorage.getItem('fake-sesion'); return {data:{session: s ? JSON.parse(s) : null}}; },
      async signInWithPassword({email, password}){
        if(password !== 'clave123') return {data:null, error:{message:'Invalid login credentials'}};
        const session = {user:{id:'u-' + email, email}};
        localStorage.setItem('fake-sesion', JSON.stringify(session));
        return {data:{session}, error:null};
      },
      async signOut(){ localStorage.removeItem('fake-sesion'); },
      async resetPasswordForEmail(){ return {error:null}; },
      async updateUser(){ return {error:null}; },
    },
    from: qb,
    channel(){ const ch = {on(_a, _b, fn){ window.__rt = fn; return ch; }, subscribe(){ return ch; }}; return ch; },
  };
}};`;

/* ---------- Servidor local de archivos ---------- */
function servir(config){
  return new Promise(res => {
    const srv = http.createServer((req, resp) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if(p === '/') p = '/index.html';
      if(p === '/config.js'){ resp.writeHead(200, {'content-type': 'text/javascript'}); return resp.end(config); }
      if(p.startsWith('/vendor/supabase')){ resp.writeHead(200, {'content-type': 'text/javascript'}); return resp.end(FAKE_SUPABASE); }
      const f = path.join(APP, p);
      if(!f.startsWith(APP) || !fs.existsSync(f)){ resp.writeHead(404); return resp.end(); }
      const tipo = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';
      resp.writeHead(200, {'content-type': tipo}); fs.createReadStream(f).pipe(resp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

async function nuevaPagina(browser, url, errores){
  const ctx = await browser.newContext({viewport: {width: 820, height: 1100}});
  /* El CDN de planillas (xlsx) no hace falta para esta prueba. */
  await ctx.route(/cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({status: 200, body: ''}));
  const page = await ctx.newPage();
  page.on('pageerror', e => errores.push(e.message));
  await page.exposeFunction('__srv', ejecutar);
  paginas.add(page);
  await page.goto(url);
  return page;
}

async function ingresar(page, email){
  await page.waitForSelector('#ak-email');
  await page.fill('#ak-email', email);
  await page.fill('#ak-pass', 'clave123');
  await page.click('#ak-f button[type=submit]');
}

let ok = 0;
function paso(t){ ok++; console.log('  ok  ' + t); }

(async () => {
  const browser = await chromium.launch();
  const errores = [];
  try{
    /* ===== 1) Modo local (sin Supabase configurado) ===== */
    const srvLocal = await servir("window.AKASHA_CONFIG = {supabaseUrl:'', supabaseAnonKey:''};");
    const urlLocal = 'http://127.0.0.1:' + srvLocal.address().port + '/';
    const pl = await nuevaPagina(browser, urlLocal, errores);
    await pl.waitForSelector('#app .topbar', {timeout: 15000});
    assert.ok(await pl.isVisible('#ak-local'));
    await pl.screenshot({path: path.join(CAPTURAS, '1-modo-local.png')});
    paginas.delete(pl); await pl.context().close(); srvLocal.close();
    paso('modo local: la app abre igual que la original');

    /* ===== 2) Con base compartida ===== */
    // La lista de alumnos cargada en la base, codificada igual que lo hace la app.
    const {akStore} = require(path.join(APP, 'akasha-store.js'));
    const alumnos = fs.readFileSync(path.join(__dirname, '..', 'datos-privados', 'alumnos-base.json'), 'utf8');
    const {tipo, filas} = akStore._interno.codificar(alumnos);
    db.akasha_datos.set('akasha-alumnos-base|~', {clave: 'akasha-alumnos-base', subclave: '~', valor: JSON.stringify({t: tipo}), pos: 0});
    filas.forEach((f, i) => db.akasha_datos.set('akasha-alumnos-base|' + f.s, {clave: 'akasha-alumnos-base', subclave: f.s, valor: f.v, pos: i}));
    db.akasha_miembros.set('u-agus@akasha.test', {activo: true, rol: 'admin'});
    db.akasha_miembros.set('u-lucas@akasha.test', {activo: true, rol: 'profe'});
    db.akasha_miembros.set('u-nuevo@akasha.test', {activo: false, rol: 'profe'});

    const srv = await servir("window.AKASHA_CONFIG = {supabaseUrl:'https://x.supabase.co', supabaseAnonKey:'publica'};");
    const url = 'http://127.0.0.1:' + srv.address().port + '/';

    const A = await nuevaPagina(browser, url, errores);
    await A.waitForSelector('#ak-email');
    await A.screenshot({path: path.join(CAPTURAS, '2-ingreso.png')});
    await A.fill('#ak-email', 'agus@akasha.test'); await A.fill('#ak-pass', 'mal');
    await A.click('#ak-f button[type=submit]');
    await A.waitForSelector('.ak-msg.error');
    assert.match(await A.textContent('.ak-msg'), /no coinciden/);
    paso('contraseña incorrecta: avisa y no entra');

    await A.fill('#ak-pass', 'clave123'); await A.click('#ak-f button[type=submit]');
    await A.waitForSelector('#app .topbar', {timeout: 15000});
    await A.waitForSelector('#ak-estado');
    const nA = await A.evaluate(() => ALUMNOS.length);
    assert.ok(nA >= 1195, 'alumnos cargados desde la base: ' + nA);
    paso(`entra y trae los ${nA} alumnos desde la base`);

    const B = await nuevaPagina(browser, url, errores);
    await ingresar(B, 'lucas@akasha.test');
    await B.waitForSelector('#app .topbar', {timeout: 15000});
    paso('segundo profe entra en otro aparato');

    // A cambia el nivel de un alumno y deja una nota de clase, como lo hace la app.
    const idAlumno = await A.evaluate(() => {
      const id = ALUMNOS[0].id;
      nivelOverrides[id] = 3; persistNivel();
      notasClase['2026-11-05|09:00|Prueba'] = {texto: 'Nota desde la tablet de Agus', profesor: 'Agus', ts: Date.now()};
      persistNotasClase();
      return id;
    });
    await A.waitForFunction(() => akStore.estado().pendientes === 0, null, {timeout: 10000});
    assert.ok(db.akasha_datos.has('akasha-nivel|~'), 'el nivel llegó a la base');
    assert.ok([...db.akasha_datos.keys()].some(k => k.startsWith('akasha-notas-clase|o:2026-11-05')), 'la nota llegó a la base');
    paso('lo que carga un profe se guarda en la base');

    await B.waitForSelector('#ak-nuevo', {timeout: 5000});
    await B.screenshot({path: path.join(CAPTURAS, '3-aviso-datos-nuevos.png')});
    // Mientras tanto B cambió OTRO alumno sin haber actualizado: no tiene que pisar lo de A.
    const otroId = await B.evaluate(() => { const id = ALUMNOS[1].id; nivelOverrides[id] = 1; persistNivel(); return id; });
    await B.waitForFunction(() => akStore.estado().pendientes === 0, null, {timeout: 10000});
    paso('al otro profe le aparece el aviso de datos nuevos');

    await B.click('#ak-nuevo');
    await B.waitForSelector('#app .topbar', {timeout: 15000});
    await B.waitForFunction(() => typeof nivelOverrides !== 'undefined', null, {timeout: 10000});
    const enB = await B.evaluate(([a, b]) => ({a: nivelOverrides[a], b: nivelOverrides[b], nota: (notasClase['2026-11-05|09:00|Prueba'] || {}).texto}), [idAlumno, otroId]);
    assert.deepStrictEqual(enB, {a: 3, b: 1, nota: 'Nota desde la tablet de Agus'});
    paso('después de actualizar ve los datos de los dos profes, sin que se pisen');

    // Reiniciar demo está desactivado con la base compartida.
    const reset = await B.evaluate(() => typeof reiniciarDemo === 'function' && (window.alert = () => {}, reiniciarDemo(), akStore.getItem('akasha-nivel') !== null));
    assert.ok(reset, 'reiniciarDemo no debe borrar datos compartidos');
    paso('"Reiniciar datos de demo" no puede borrar los datos del equipo');

    // Cuenta sin activar.
    const C = await nuevaPagina(browser, url, errores);
    await ingresar(C, 'nuevo@akasha.test');
    await C.waitForSelector('text=Casi listo', {timeout: 10000});
    assert.strictEqual(await C.evaluate(() => typeof ALUMNOS), 'undefined');
    await C.screenshot({path: path.join(CAPTURAS, '4-cuenta-sin-activar.png')});
    paso('una cuenta no activada no ve ningún dato');

    await A.screenshot({path: path.join(CAPTURAS, '5-app-con-nube.png')});
    srv.close();
  }finally{
    await browser.close();
  }
  const reales = errores.filter(e => !/XLSX/.test(e));
  if(reales.length){ console.log('\nErrores de JavaScript en la página:\n  ' + reales.join('\n  ')); process.exitCode = 1; }
  console.log(`\n${ok} pasos OK` + (process.exitCode ? ' (HAY FALLAS)' : ''));
})().catch(e => { console.error(e); process.exit(1); });
