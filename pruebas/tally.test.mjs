// Prueba de la conversión de una respuesta de Tally (formato del webhook).
// Uso: node --experimental-strip-types pruebas/tally.test.mjs
import assert from 'node:assert';
import { convertir } from '../supabase/functions/tally-formulario/convertir.ts';

const payload = {
  eventId: 'ev1', eventType: 'FORM_RESPONSE', createdAt: '2026-11-16T15:00:00.000Z',
  data: {
    responseId: 'r1', submissionId: 'sub1', formId: 'obLK8P', createdAt: '2026-11-16T15:00:00.000Z',
    fields: [
      {key: 'q1', label: '¿Qué te gustaría conseguir entrenando?', type: 'MULTIPLE_CHOICE', value: ['o2'],
       options: [{id: 'o1', text: 'Mejorar mi estado físico'}, {id: 'o2', text: 'Ganar fuerza'}]},
      {key: 'q2', label: '¿Qué sentís que te cuesta más para empezar o mantener un entrenamiento?', type: 'CHECKBOXES', value: ['c1', 'c3'],
       options: [{id: 'c1', text: 'Me cuesta ser constante'}, {id: 'c2', text: 'Me falta motivación'}, {id: 'c3', text: 'Los horarios'}]},
      {key: 'q2_c1', label: '¿Qué sentís que te cuesta más para empezar o mantener un entrenamiento? (Me cuesta ser constante)', type: 'CHECKBOXES', value: true},
      {key: 'q2_c2', label: '¿Qué sentís que te cuesta más para empezar o mantener un entrenamiento? (Me falta motivación)', type: 'CHECKBOXES', value: false},
      {key: 'q3', label: '¿Hay algo que deberíamos saber para poder orientarte mejor?', type: 'TEXTAREA', value: 'Me operaron la rodilla derecha'},
      {key: 'q4', label: 'Si encontramos una forma de entrenamiento que se adapte a vos, ¿qué tan cerca estás de empezar?', type: 'MULTIPLE_CHOICE', value: ['x1'],
       options: [{id: 'x1', text: 'Quiero empezar cuanto antes'}]},
      {key: 'q5', label: 'Nombre', type: 'INPUT_TEXT', value: 'Lucía'},
      {key: 'q6', label: 'WhatsApp', type: 'INPUT_PHONE_NUMBER', value: '+5491112345678'},
      {key: 'q7', label: 'Datos de contacto', type: 'INPUT_EMAIL', value: 'Lucia@Mail.com'},
      {key: 'q8', label: '¿En que momento del día preferís que te contactemos?', type: 'MULTIPLE_CHOICE', value: ['h3'],
       options: [{id: 'h3', text: 'Tarde'}]},
      {key: 'q9', label: '¿Cómo fueron tus experiencias anteriores entrenando?', type: 'TEXTAREA', value: null},
    ],
  },
};
const f = convertir(payload);
assert.strictEqual(f.id, 'sub1');
assert.strictEqual(f.nombre, 'Lucía');
assert.strictEqual(f.email, 'lucia@mail.com');
assert.strictEqual(f.whatsapp, '+5491112345678');
assert.strictEqual(f.horario_contacto, 'Tarde');
assert.strictEqual(f.cercania, 'Quiero empezar cuanto antes');
assert.strictEqual(f.objetivo, 'Ganar fuerza');
const cuesta = f.respuestas.find(r => r.pregunta.startsWith('¿Qué sentís'));
assert.strictEqual(cuesta.respuesta, 'Me cuesta ser constante, Los horarios');
assert.strictEqual(f.respuestas.filter(r => r.pregunta.includes('(Me')).length, 0, 'sin las filas sueltas por casilla');
console.log('  ok  convierte una respuesta de Tally a una fila de la base');
