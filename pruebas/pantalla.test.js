/* Prueba de punta a punta de la pantalla del salón: una tele que abre el
   link directo (#pantalla) y un celular que la vincula con el código, la
   maneja y le manda las cargas confirmadas. Con un Supabase simulado que
   comparten las dos páginas, igual que navegador.test.js.
   Uso: node pruebas/pantalla.test.js */
const {chromium} = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const APP = path.join(__dirname, '..', 'app');
const CAPTURAS = path.join(__dirname, 'capturas');
fs.mkdirSync(CAPTURAS, {recursive: true});

/* ---------- Supabase simulado ---------- */
const db = {akasha_datos: new Map(), akasha_miembros: new Map()};
const paginas = new Set();
async function difundir(ev){
  for(const p of paginas){ await p.evaluate(e => window.__rt && window.__rt(e), ev).catch(() => {}); }
}
async function ejecutar(q){
  if(q.tabla === 'akasha_miembros'){
    const uid = (q.filtros.find(f => f[0] === 'user_id') || [])[1];
    return {data: db.akasha_miembros.get(uid) || null, error: null};
  }
  if(q.tabla !== 'akasha_datos') return {data: [], error: null};
  if(q.op === 'select'){
    const clave = (q.filtros.find(f => f[0] === 'clave') || [])[1];
    const ord = [...db.akasha_datos.values()].filter(r => clave === undefined || r.clave === clave)
      .sort((a, b) => a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : (a.subclave < b.subclave ? -1 : a.subclave > b.subclave ? 1 : 0));
    const [d, h] = q.rango || [0, 99999];
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
    for(const s of q.filtroIn[1]){
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

function servir(){
  return new Promise(res => {
    const srv = http.createServer((req, resp) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if(p === '/') p = '/index.html';
      if(p === '/config.js'){ resp.writeHead(200, {'content-type': 'text/javascript'}); return resp.end("window.AKASHA_CONFIG = {supabaseUrl:'https://x.supabase.co', supabaseAnonKey:'publica'};"); }
      if(p.startsWith('/vendor/supabase')){ resp.writeHead(200, {'content-type': 'text/javascript'}); return resp.end(FAKE_SUPABASE); }
      const f = path.join(APP, p);
      if(!f.startsWith(APP) || !fs.existsSync(f)){ resp.writeHead(404); return resp.end(); }
      resp.writeHead(200, {'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8'});
      fs.createReadStream(f).pipe(resp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

async function nuevaPagina(browser, url, errores, viewport){
  const ctx = await browser.newContext({viewport});
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
  await page.waitForSelector('#app .topbar, #app .pantalla', {timeout: 15000});
}
const subido = page => page.waitForFunction(() => akStore.estado().pendientes === 0, null, {timeout: 10000});

let ok = 0;
const paso = t => { ok++; console.log('  ok  ' + t); };

(async () => {
  const srv = await servir();
  const url = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();
  const errores = [];
  db.akasha_miembros.set('u-agus@akasha.test', {activo: true, rol: 'admin', nombre: 'Agus'});
  db.akasha_miembros.set('u-lucas@akasha.test', {activo: true, rol: 'profe', nombre: 'Lucas'});
  db.akasha_miembros.set('u-pared@akasha.test', {activo: true, rol: 'profe', nombre: 'Pantalla salón'});
  try{
    /* ---- El celular de Agus arma el día: alumnos, clase, rutina con niveles ---- */
    const P = await nuevaPagina(browser, url, errores, {width: 400, height: 860});
    await ingresar(P, 'agus@akasha.test');
    await P.evaluate(() => {
      aplicarHoja({nombre: 'u.xlsx', tipo: 'usuarios', headersNorm: ['id socio', 'nombre', 'apellido', 'estado'],
        dataRows: [[1, 'Juan', 'Pérez', 'Activo'], [2, 'Juan', 'Vega', 'Activo'], [3, 'Sofía', 'López', 'Activo'],
                   [4, 'Lucía', 'Morales', 'Activo'], [5, 'Ana', 'Gómez', 'Activo'], [6, 'Pedro', 'Ruiz', 'Activo']]});
      clasesManuales[HOY_CLAVE] = [{id: 'm1', hora: '00:01', disciplina: 'Método Akasha'}];
      persistClasesManuales();
      const f = new Date(), lunes = lunesDe(f), dom = sumarDias(lunes, 6);
      const HEAD = ['Disciplina','Hora','Bloque','Nivel','Formato','Tiempo','Reps/Series','Ejercicios','Notas','Notas ej.'];
      const D = 'Método Akasha', H = '00:01';
      const filas = [
        [D, H, 'Fuerza', '1', '3 x 10', '20', '10\n12', 'Sentadilla goblet\nRemo con mancuerna', '', ''],
        [D, H, 'Fuerza', '2', '4 x 8', '20', '8\n10', 'Sentadilla trasera\nRemo con barra', '', ''],
        [D, H, 'Fuerza', '3', '5 x 5', '20', '5\n8', 'Sentadilla trasera\nRemo Pendlay', '', ''],
        [D, H, 'Movilidad', '', '2 vueltas', '10', '', '90/90 de cadera\nRotaciones torácicas', '', ''],
      ];
      aplicarHoja({tipo: 'rutinas', nombre: 'prueba', archivo: '__app__', diaHoja: DIAS_SEMANA[f.getDay()],
        headersNorm: HEAD.map(normHeader), dataRows: filas, previas: [['Semana del:', lunes, dom]]});
      const e = esperaRutinas.pop();
      guardarClasesEnSemana(e.clases, lunes, dom, false, false);
      location.reload();
    });
    await P.waitForSelector('#app .topbar', {timeout: 15000});
    await P.evaluate(() => {
      const c = CLASES[0];
      [1, 2, 3, 4, 5, 6].forEach(id => agregarAClase(c.id, id));
      cambiarNivel(5, 1); cambiarNivel(6, 1); cambiarNivel(4, 3);
      /* Historial: Juan Pérez ya hizo sentadilla trasera con 55 kg. */
      cargas.push({id: 'k1-1', alumnoId: 1, claseId: 'x', bloque: 'Fuerza', ejercicio: 'Sentadilla trasera', kg: 55, fecha: '01/01', ts: 1});
      persistCargas();
    });
    await subido(P);
    assert.strictEqual(await P.evaluate(() => RUTINA_HOY.bloques.length), 2);
    paso('día armado: 6 presentes en una clase con rutina de 3 niveles');

    /* ---- La tele abre el link directo ---- */
    const T = await nuevaPagina(browser, url + '#pantalla', errores, {width: 1280, height: 720});
    await ingresar(T, 'pared@akasha.test');
    await T.waitForSelector('.pantalla-pared .pv-cuerpo');
    const tele = await T.evaluate(() => ({
      modo: document.body.classList.contains('modo-pared'),
      niveles: [...document.querySelectorAll('.pv-nivel h4')].map(h => h.textContent),
      nombres: [...document.querySelectorAll('.pv-nom')].map(n => n.textContent),
      codigo: document.querySelector('.pared-codigo b') && document.querySelector('.pared-codigo b').textContent,
      botones: document.querySelectorAll('.pantalla-pared .pantalla-btn').length,
    }));
    assert.ok(tele.modo);
    assert.deepStrictEqual(tele.niveles, ['Nivel 1', 'Nivel 2', 'Nivel 3']);
    assert.deepStrictEqual(tele.nombres.slice().sort(), ['Ana G.', 'Juan Pé.', 'Juan Ve.', 'Lucía M.', 'Pedro R.', 'Sofía L.']);
    assert.match(tele.codigo || '', /^\d{4}$/);
    assert.strictEqual(tele.botones, 0);
    await subido(T);
    await T.screenshot({path: path.join(CAPTURAS, 'pantalla-1-tele-sin-vincular.png')});
    paso('la tele con el link directo entra sola a la pared: niveles, presentes y código ' + tele.codigo);

    /* ---- El celular se vincula con el código ---- */
    await P.evaluate(() => abrirPantallaCtl());
    await P.fill('#pc-codigo', '0000');
    await P.click('button:has-text("Vincular")');
    assert.match(await P.textContent('.pc-msg'), /no es el de la pantalla/);
    await P.fill('#pc-codigo', tele.codigo);
    await P.click('button:has-text("Vincular")');
    await P.waitForSelector('.pc-bloques');
    await subido(P);
    await T.waitForFunction(() => !document.querySelector('.pared-codigo') && document.querySelector('.pared-estado'));
    assert.match(await T.textContent('.pared-estado'), /Agus/);
    paso('código equivocado: avisa; código correcto: vincula y la tele muestra quién la maneja');

    /* ---- Fija el bloque Movilidad desde el celular ---- */
    await P.click('.pc-bloque >> nth=1');
    await P.click('text=Fija');
    await subido(P);
    await T.waitForFunction(() => /Movilidad/.test(document.querySelector('.pantalla-dia').textContent) && !document.getElementById('pv-barra'));
    const mov = await T.evaluate(() => ({cols: document.querySelectorAll('.pv-nivel').length, nombres: document.querySelectorAll('.pv-nom').length}));
    assert.deepStrictEqual(mov, {cols: 1, nombres: 6});
    await P.screenshot({path: path.join(CAPTURAS, 'pantalla-2-celular-control.png')});
    paso('elegir bloque y "Fija" desde el celular cambia la tele al instante (bloque para todos: una columna)');

    /* ---- Cargas del bloque Fuerza: confirmar sin mostrar ---- */
    await P.evaluate(() => { const c = CLASES[0]; nav('clase', {claseId: c.id}); });
    await P.waitForSelector('.cb-abrir');
    assert.strictEqual(await P.$$eval('.alumno-actions button', bs => bs.filter(b => /Carga$/.test(b.textContent.trim())).length), 0);
    await P.click('.cb-abrir');
    await P.waitForSelector('.cb-lista');
    const lista = await P.$$eval('.cb-fila', fs => fs.map(f => f.textContent.replace(/\s+/g, ' ').trim()));
    assert.ok(lista.some(t => /Juan Pérez.*Sentadilla trasera 55 kg.*Remo con barra —/.test(t)), lista.join(' | '));
    assert.strictEqual(await P.isChecked('#cb-mostrar'), false);
    await P.screenshot({path: path.join(CAPTURAS, 'pantalla-4-cargas-celular.png')});
    paso('un solo botón de cargas: lista de presentes con la sugerida (55 kg) y la casilla sin tildar');

    /* Tocar a Sofía y ponerle cargas */
    await P.click('.cb-fila:has-text("Sofía López")');
    await P.waitForSelector('#carga-input-0');
    await P.fill('#carga-input-0', '40');
    await P.fill('#carga-input-1', '30');
    await P.click('.modal-actions >> text=Guardar');
    await P.waitForSelector('.cb-lista');
    assert.match(await P.textContent('.cb-fila:has-text("Sofía López")'), /Sentadilla trasera 40 kg.*Remo con barra 30 kg/);
    await P.click('.modal-actions >> text=Confirmar');
    await subido(P);
    const fichas = await P.evaluate(() => cargas.filter(c => c.fecha === fechaCorta()).map(c => c.alumnoId + ':' + c.ejercicio + '=' + c.kg).sort());
    assert.deepStrictEqual(fichas, ['1:Sentadilla trasera=55', '3:Remo con barra=30', '3:Sentadilla trasera=40']);
    assert.strictEqual(await P.evaluate(() => Object.keys(pantCargas).length), 0);
    paso('al tocar un nombre se cambian sus cargas; "Confirmar" las pasa a la ficha (sugeridas incluidas) sin mostrarlas');

    /* Volver a abrir, tildar sin cambiar nada y confirmar: van a la tele */
    await P.evaluate(() => abrirPantallaCtl());
    await P.click('.pc-bloque >> nth=0');
    await subido(P);
    await P.evaluate(() => { nav('clase', {claseId: CLASES[0].id}); });
    await P.click('.cb-abrir');
    await P.check('#cb-mostrar');
    await P.click('.modal-actions >> text=Confirmar');
    await subido(P);
    await T.waitForFunction(() => document.querySelectorAll('.pv-cargas').length === 2, null, {timeout: 5000});
    const conCargas = await T.$$eval('.pv-al', as => as.map(a => a.textContent.replace(/\s+/g, ' ').trim()).filter(t => /\d/.test(t)).sort());
    assert.deepStrictEqual(conCargas, ['Juan Pé.Sentadilla T 55', 'Sofía L.Sentadilla T 40·Remo CB 30']);
    assert.match(await P.textContent('.cb-abrir'), /en la pantalla/);
    paso('se reabre, se tilda "Mostrar" sin cambiar nada y las cargas aparecen en la tele, abreviadas');

    /* Abreviatura propia en el banco */
    await P.evaluate(() => {
      if(!buscarEnBanco('Remo con barra')){ banco.push({id: idDesdeNombre('Remo con barra'), nombre: 'Remo con barra', alias: [], notas: ''}); construirIndiceBanco(); }
      const i = banco.findIndex(e => e.nombre === 'Remo con barra');
      nav('banco'); state.bancoAbierto = banco[i].id; pintarListaBanco();
      document.getElementById('ej-abrev-' + i).value = 'Remo';
      guardarAbrevEj(i);
    });
    await subido(P);
    await T.waitForFunction(() => [...document.querySelectorAll('.pv-cargas')].some(c => /Remo 30/.test(c.textContent)), null, {timeout: 15000});
    paso('la abreviatura cargada en el banco se usa en la tele (la tele se recarga sola)');
    await T.waitForSelector('.pantalla-pared .pv-cuerpo');
    await T.screenshot({path: path.join(CAPTURAS, 'pantalla-3-tele-con-cargas.png')});

    /* ---- Otro profe toma el control sin borrar lo de la pared ---- */
    const L = await nuevaPagina(browser, url, errores, {width: 400, height: 860});
    await ingresar(L, 'lucas@akasha.test');
    await L.evaluate(() => abrirPantallaCtl());
    assert.match(await L.textContent('.pc-sub'), /Ahora la maneja Agus/);
    await L.fill('#pc-codigo', tele.codigo);
    await L.click('button:has-text("Vincular")');
    await subido(L);
    await T.waitForFunction(() => /Lucas/.test(document.querySelector('.pared-estado').textContent));
    assert.strictEqual(await T.evaluate(() => document.querySelectorAll('.pv-cargas').length), 2);
    await P.waitForFunction(() => !!document.querySelector('#pc-codigo') || state.screen !== 'pantallaCtl');
    paso('otro profe se vincula: pasa a manejarla él y la pared sigue mostrando lo mismo');

    /* ---- Ausente: deja de verse en la tele ---- */
    await L.evaluate(() => { marcarNoVino(CLASES[0].id, 2); });
    await subido(L);
    await T.waitForFunction(() => ![...document.querySelectorAll('.pv-nom')].some(n => /Juan/.test(n.textContent) && /Ve/.test(n.textContent)), null, {timeout: 15000});
    await T.waitForSelector('.pantalla-pared .pv-cuerpo');
    assert.ok(await T.evaluate(() => [...document.querySelectorAll('.pv-nom')].some(n => n.textContent === 'Juan P.')));
    paso('si un alumno no vino, sale de la tele sola, y el otro Juan pasa a "Juan P."');

    /* ---- Clase llena: 20 presentes en la pared de 720p ---- */
    await L.evaluate(() => {
      const nombres = ['Rocío Paz','Diego Sosa','Carla Méndez','Tomás Ibarra','Valentina Ríos','Lucas Herrera','Camila Torres',
        'Nicolás Vega','Florencia Bustos','Federico Álvarez','Agustina Castro','Matías Romero','Julieta Navarro','Gonzalo Funes','Martín Díaz'];
      aplicarHoja({nombre: 'u2.xlsx', tipo: 'usuarios', headersNorm: ['id socio', 'nombre', 'apellido', 'estado'],
        dataRows: nombres.map((n, i) => [20 + i, n.split(' ')[0], n.split(' ')[1], 'Activo'])});
      nombres.forEach((n, i) => { agregarAClase(CLASES[0].id, 20 + i); cambiarNivel(20 + i, 1 + (i % 3)); });
    });
    await subido(L);
    await T.waitForFunction(() => document.querySelectorAll('.pv-nom').length === 20, null, {timeout: 20000});
    await T.waitForTimeout(300);
    const entra = await T.evaluate(() => { const c = document.querySelector('.pv-cuerpo'); return {alto: c.scrollHeight <= c.clientHeight + 1, k: getComputedStyle(c).getPropertyValue('--k')}; });
    assert.ok(entra.alto, 'no entra en la pantalla');
    await T.screenshot({path: path.join(CAPTURAS, 'pantalla-5-tele-20-presentes.png')});
    paso('con 20 presentes la pared achica la letra pareja y entra todo (k=' + entra.k.trim() + ')');

    if(errores.length) throw new Error('Errores de JavaScript: ' + errores.join(' | '));
  }finally{
    await browser.close(); srv.close();
  }
  console.log(`\n${ok} pasos OK`);
})().catch(e => { console.error('FALLÓ:', e.message); process.exit(1); });
