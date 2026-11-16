/* Pruebas del reconocimiento de notas dictadas (sin navegador).
   Uso: node pruebas/dictado.test.js */
const assert = require('assert');
const {analizar, _leerNumero} = require('../app/dictado.js');

const roster = [
  {id: 1, nombre: 'Juan', apellido: 'Pérez'},
  {id: 2, nombre: 'Ana', apellido: 'Gómez'},
  {id: 3, nombre: 'Ana Laura', apellido: 'Ruiz'},
  {id: 4, nombre: 'Agustina', apellido: 'Ibañez'},
  {id: 5, nombre: 'Martina', apellido: 'Sosa'},
  {id: 6, nombre: 'Beto', apellido: 'Díaz'},
];
const unEj = () => ['Sentadilla goblet'];
const dosEj = () => ['Sentadilla goblet', 'Peso muerto rumano'];

let ok = 0;
function prueba(nombre, fn){
  try{ fn(); ok++; console.log('  ok  ' + nombre); }
  catch(e){ console.log('  FALLÓ  ' + nombre); console.log(e.message); process.exitCode = 1; }
}
const de = (r, id, tipo) => r.items.filter(x => x.alumnoId === id && (!tipo || x.tipo === tipo));

prueba('números: dígitos, decimales, palabras y "y medio"', () => {
  assert.strictEqual(_leerNumero('40'), 40);
  assert.strictEqual(_leerNumero('32,5'), 32.5);
  assert.strictEqual(_leerNumero('cuarenta'), 40);
  assert.strictEqual(_leerNumero('treinta y cinco'), 35);
  assert.strictEqual(_leerNumero('ciento diez'), 110);
  assert.strictEqual(_leerNumero('35 y medio'), 35.5);
  assert.strictEqual(_leerNumero('doce kilos'), 12);
});

prueba('cargas de varios alumnos seguidos (un ejercicio en el bloque)', () => {
  const r = analizar('Juan 40 Martina 32 Beto treinta y cinco y medio', roster, unEj);
  assert.deepStrictEqual(r.items.map(x => [x.alumnoId, x.tipo, x.valor, x.ejercicio]),
    [[1, 'carga', 40, 'Sentadilla goblet'], [5, 'carga', 32, 'Sentadilla goblet'], [6, 'carga', 35.5, 'Sentadilla goblet']]);
  assert.ok(r.items.every(x => !x.revisar));
});

prueba('carga + alerta en la misma frase', () => {
  const r = analizar('Martina 32 kilos le molesta la rodilla derecha', roster, unEj);
  assert.strictEqual(de(r, 5, 'carga')[0].valor, 32);
  const al = de(r, 5, 'alerta')[0];
  assert.deepStrictEqual([al.sub, al.zona, al.lado, al.revisar], ['molestia', 'Rodilla', 'der', false]);
});

prueba('dolor sin número no inventa carga ("hace 2 días")', () => {
  const r = analizar('Beto dice que le duele el hombro izquierdo hace 2 días', roster, unEj);
  assert.strictEqual(de(r, 6, 'carga').length, 0);
  const al = de(r, 6, 'alerta')[0];
  assert.deepStrictEqual([al.sub, al.zona, al.lado], ['dolor', 'Hombro', 'izq']);
});

prueba('alerta sin zona queda para revisar', () => {
  const r = analizar('Juan molestia en la espalda', roster, unEj);
  const al = de(r, 1, 'alerta')[0];
  assert.strictEqual(al.zona, null);
  assert.strictEqual(al.revisar, true);
});

prueba('cambio de ejercicio', () => {
  const r = analizar('Beto cambio peso muerto por hip thrust', roster, dosEj);
  const c = de(r, 6, 'cambio')[0];
  assert.strictEqual(c.ejercicio, 'Peso muerto rumano');
  assert.strictEqual(c.nuevo, 'hip thrust');
  assert.strictEqual(c.revisar, false);
});

prueba('dos ejercicios: el número va al que se nombra', () => {
  const r = analizar('Juan sentadilla 40 peso muerto 60', roster, dosEj);
  assert.deepStrictEqual(de(r, 1, 'carga').map(x => [x.ejercicio, x.valor]),
    [['Sentadilla goblet', 40], ['Peso muerto rumano', 60]]);
});

prueba('dos ejercicios sin nombrarlos: se asignan pero se marcan para revisar', () => {
  const r = analizar('Juan 40', roster, dosEj);
  const c = de(r, 1, 'carga')[0];
  assert.strictEqual(c.revisar, true);
});

prueba('nombre repetido se desempata con apellido; si no, pide elegir', () => {
  let r = analizar('Ana Gómez 20', roster, unEj);
  assert.strictEqual(r.items[0].alumnoId, 2);
  r = analizar('Ana Laura 22', roster, unEj);
  assert.strictEqual(r.items[0].alumnoId, 3);
  r = analizar('Ana 20', roster, unEj);
  assert.strictEqual(r.items[0].alumnoId, null, 'con "Ana" y "Ana Laura" en la clase, pregunta');
  assert.deepStrictEqual(r.items[0].candidatos, [2, 3]);
  assert.strictEqual(r.items[0].revisar, true);
});

prueba('apodo y error de transcripción del nombre', () => {
  let r = analizar('Agus 25', roster, unEj);
  assert.strictEqual(r.items[0].alumnoId, 4);
  r = analizar('Martna 30', roster, unEj);
  assert.strictEqual(r.items[0].alumnoId, 5);
});

prueba('cualquier otra cosa queda como nota del alumno', () => {
  const r = analizar('Juan hoy vino con muy buena energía', roster, unEj);
  assert.deepStrictEqual([r.items[0].tipo, r.items[0].alumnoId, r.items[0].nota], ['nota', 1, 'hoy vino con muy buena energía']);
});

prueba('lo que no empieza con un nombre de la clase va a la nota de la clase', () => {
  const r = analizar('Clase con mucha gente, faltaron discos de 10. Juan 40', roster, unEj);
  assert.strictEqual(r.notaClase, 'Clase con mucha gente, faltaron discos de 10');
  assert.strictEqual(r.items.length, 1);
});

prueba('un nombre que no está en la clase no se confunde con otro', () => {
  const r = analizar('Rodrigo 50', roster, unEj);
  assert.strictEqual(r.items.length, 0);
  assert.strictEqual(r.notaClase, 'Rodrigo 50');
});

console.log(`\n${ok} pruebas pasaron` + (process.exitCode ? ' (HAY FALLAS)' : ''));
