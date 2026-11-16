/* Prueba de punta a punta de "Notas de la clase" con dictado por voz.
   Corre la app en modo local con un micrófono simulado.
   Uso: node pruebas/dictado-navegador.test.js */
const {chromium} = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const APP = path.join(__dirname, '..', 'app');
const CAPTURAS = path.join(__dirname, 'capturas');
fs.mkdirSync(CAPTURAS, {recursive: true});

/* Micrófono simulado: cuando se toca "dictar", "escucha" estas frases,
   con cortes por silencio como hace Chrome en Android. */
const MIC_FALSO = `
window.__frases = [];
window.SpeechRecognition = class {
  start(){
    const f = window.__frases.shift();
    setTimeout(() => {
      if(f !== undefined){
        const res = [Object.assign([{transcript: f}], {isFinal: true})];
        this.onresult && this.onresult({resultIndex: 0, results: res});
      }
      setTimeout(() => this.onend && this.onend(), 30);
    }, 30);
  }
  stop(){}
};`;

function servir(){
  return new Promise(res => {
    const srv = http.createServer((req, resp) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if(p === '/') p = '/index.html';
      if(p === '/config.js'){ resp.writeHead(200, {'content-type': 'text/javascript'}); return resp.end("window.AKASHA_CONFIG={supabaseUrl:'',supabaseAnonKey:''};"); }
      const f = path.join(APP, p);
      if(!f.startsWith(APP) || !fs.existsSync(f)){ resp.writeHead(404); return resp.end(); }
      resp.writeHead(200, {'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8'});
      fs.createReadStream(f).pipe(resp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

let ok = 0;
const paso = t => { ok++; console.log('  ok  ' + t); };

(async () => {
  const srv = await servir();
  const browser = await chromium.launch();
  const errores = [];
  try{
    const ctx = await browser.newContext({viewport: {width: 820, height: 1180}});
    await ctx.route(/cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({status: 200, body: ''}));
    await ctx.addInitScript(MIC_FALSO);
    const page = await ctx.newPage();
    page.on('pageerror', e => errores.push(e.message));
    await page.goto('http://127.0.0.1:' + srv.address().port + '/');
    await page.waitForSelector('#app .topbar');
    await page.waitForFunction(() => window.akDictado);

    /* Una clase de hoy con 4 alumnos y un bloque con dos ejercicios. */
    const claseId = await page.evaluate(() => {
      aplicarHoja({nombre: 'u.xlsx', tipo: 'usuarios', headersNorm: ['id socio', 'nombre', 'apellido', 'estado'],
        dataRows: [[1, 'Juan', 'Pérez', 'Activo'], [2, 'Martina', 'Sosa', 'Activo'], [3, 'Ana', 'Gómez', 'Activo'], [4, 'Ana Laura', 'Ruiz', 'Activo']]});
      const hoy = claveActiva();
      clasesManuales[hoy] = [{id: 'm1', hora: '09:00', disciplina: 'Método Akasha'}];
      persistClasesManuales();
      location.reload();
      return null;
    });
    await page.waitForSelector('#app .topbar');
    await page.waitForFunction(() => window.akDictado && typeof CLASES !== 'undefined' && CLASES.length > 0, null, {timeout: 10000});
    const id = await page.evaluate(() => {
      const c = CLASES[0];
      c.alumnosIds = [1, 2, 3, 4];
      (c.agregadosMano = c.agregadosMano || []).push(1, 2, 3, 4);
      /* Rutina simulada: dos ejercicios en el bloque actual. */
      window.itemsCargaModal = () => [{bloque: 'Fuerza', ejercicio: 'Sentadilla goblet'}, {bloque: 'Fuerza', ejercicio: 'Peso muerto rumano'}];
      window.presentesDe = cl => cl.alumnosIds.slice();
      nav('clase', {claseId: c.id});
      return c.id;
    });
    const boton = await page.textContent('.finalizar-bar button');
    assert.match(boton, /🎤 Notas/);
    paso('el botón de abajo de la clase ahora es "🎤 Notas"');

    await page.click('.finalizar-bar button');
    await page.waitForSelector('#ak-dictado .ak-mic');
    await page.screenshot({path: path.join(CAPTURAS, '7-notas-clase.png')});
    paso('abre "Notas de la clase" con el botón de micrófono');

    /* Dicta: dos cortes por silencio y después toca "terminar". */
    await page.evaluate(() => { window.__frases.push(
      'Clase llena faltaron discos de 10',
      'Juan sentadilla 40 peso muerto 60 Martina 32 kilos le molesta la rodilla derecha',
      'Ana 25 Juan hoy vino con muy buena energía'); });
    await page.click('.ak-mic');
    await page.waitForTimeout(400);
    await page.click('.ak-mic');
    await page.waitForFunction(() => document.getElementById('ak-dict-texto') && document.getElementById('ak-dict-texto').value.includes('energía'), null, {timeout: 5000});
    const texto = await page.inputValue('#ak-dict-texto');
    assert.ok(texto.includes('Juan sentadilla 40') && texto.includes('Clase llena'), texto);
    paso('el dictado (con cortes por silencio) queda escrito y guardado');

    await page.click('text=✨ Reconocer datos');
    await page.waitForSelector('.ak-item');
    await page.screenshot({path: path.join(CAPTURAS, '8-revision.png'), fullPage: false});
    const resumen = await page.$$eval('.ak-item', els => els.map(e => e.querySelector('.ak-cab').textContent.replace(/\s+/g, ' ').trim()));
    assert.ok(resumen.some(t => /Carga Juan Pérez/.test(t)), resumen.join(' | '));
    assert.ok(resumen.some(t => /Alerta Martina Sosa/.test(t)), resumen.join(' | '));
    assert.ok(resumen.some(t => /Nota de la clase/.test(t)), resumen.join(' | '));
    paso('reconoce cargas, alerta, nota del alumno y nota de la clase: ' + resumen.length + ' datos');

    /* "Ana" es ambigua (Ana Gómez / Ana Laura Ruiz): no deja guardar sin elegir. */
    await page.click('text=Guardar todo');
    assert.ok(await page.isVisible('.ak-item.ak-revisar'));
    const sel = await page.$('.ak-item.ak-revisar select[data-k="alumnoId"]');
    assert.ok(sel, 'tiene que pedir elegir a quién');
    await sel.selectOption('3');
    /* La carga de Martina quedó sin ejercicio nombrado: elegir el primero. */
    for(let n = 0; n < 5; n++){
      const s = await page.$('.ak-item.ak-revisar select[data-k="ejercicio"]');
      if(!s) break;
      await s.selectOption('Sentadilla goblet');
    }
    paso('lo dudoso queda en amarillo y se completa con un toque');

    await page.click('text=Guardar todo');
    await page.waitForFunction(() => !document.querySelector('.ak-item'));
    const r = await page.evaluate(cid => ({
      cargas: Object.keys(cargasPendientes).filter(k => k.startsWith(cid + '|')).map(k => k.split('|').slice(1).join('|') + '=' + cargasPendientes[k]).sort(),
      nov: novedades.filter(n => n.dictado).map(n => [n.alumnoId, n.tipo, n.zonaCuerpo || '', n.lado || '', n.nota]),
      nota: getClase(cid).obsFinal,
      quedaSinReconocer: document.getElementById('ak-dict-texto').value,
    }), id);
    assert.deepStrictEqual(r.cargas, ['1|Peso muerto rumano=60', '1|Sentadilla goblet=40', '2|Sentadilla goblet=32', '3|Sentadilla goblet=25']);
    assert.deepStrictEqual(r.nov.map(n => n.slice(0, 4)).sort(), [[1, 'observacion', '', ''], [2, 'molestia', 'Rodilla', 'der']]);
    assert.match(r.nota, /Clase llena faltaron discos de 10/);
    assert.strictEqual(r.quedaSinReconocer, '');
    paso('guarda las cargas (como pendientes de la clase), las novedades y la nota de la clase');

    /* Las cargas aparecen en la lista de la clase y "Finalizar" abre el cierre de siempre. */
    await page.click('#ak-dictado .modal-actions .btn-primary');
    await page.waitForSelector('text=Notas de la clase — referencias para el staff');
    assert.match(await page.inputValue('#obs-final'), /Clase llena/);
    await page.click('.modal-actions >> text=Finalizar clase');
    await page.waitForFunction(() => cargas.length >= 4);
    paso('"Finalizar clase" sigue funcionando y pasa las cargas a la ficha de cada alumno');

    if(errores.length) throw new Error('Errores de JavaScript: ' + errores.join(' | '));
  }finally{
    await browser.close(); srv.close();
  }
  console.log(`\n${ok} pasos OK`);
})().catch(e => { console.error('FALLÓ:', e.message); process.exit(1); });
