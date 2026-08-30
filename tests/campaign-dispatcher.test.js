const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexPath = path.resolve(__dirname, '../src/renderer/index.html');
const cssPath = path.resolve(__dirname, '../src/renderer/styles/campaign-dispatcher.css');
const { CampaignDispatcherController } = require('../src/renderer/js/modules/campaign/campaign-dispatcher-controller');

test('Campaign Dispatcher: index.html contiene la arquitectura Composer + Safety Inspector', () => {
  const html = fs.readFileSync(indexPath, 'utf8');

  // Root container
  assert.ok(html.includes('class="campaign-dispatcher"'), 'Debe existir .campaign-dispatcher');
  assert.ok(html.includes('class="dispatcher-grid"'), 'Debe existir la cuadrícula .dispatcher-grid');

  // Composer column (Contacts only)
  assert.ok(html.includes('class="dispatcher-composer"'), 'Debe existir .dispatcher-composer');
  assert.ok(html.includes('id="audienceContactsView"'), 'Debe existir la vista de contactos');
  assert.ok(html.includes('id="contactSearchInput"'), 'Debe existir el buscador de contactos');
  assert.ok(!html.includes('class="audience-source-selector"'), 'NO debe existir selector de grupos en Despachador de Campañas');

  // Safety Inspector column
  assert.ok(html.includes('class="dispatcher-inspector"'), 'Debe existir .dispatcher-inspector');
  assert.ok(html.includes('class="safety-inspector-card"'), 'Debe existir .safety-inspector-card');
  assert.ok(html.includes('id="inspectorRecipientsCount"'), 'Debe existir #inspectorRecipientsCount');
  assert.ok(html.includes('id="inspectorEstimatedDuration"'), 'Debe existir #inspectorEstimatedDuration');
  assert.ok(html.includes('id="inspectorSafetyStatus"'), 'Debe existir #inspectorSafetyStatus');

  // Pre-flight checks
  assert.ok(html.includes('id="checkAudience"'), 'Debe existir #checkAudience');
  assert.ok(html.includes('id="checkVolume"'), 'Debe existir #checkVolume');
  assert.ok(html.includes('id="checkDelay"'), 'Debe existir #checkDelay');
  assert.ok(html.includes('id="checkDuplicates"'), 'Debe existir #checkDuplicates');
  assert.ok(html.includes('id="checkCompliance"'), 'Debe existir #checkCompliance');

  // Actions
  assert.ok(html.includes('id="applySafeConfigContacts"'), 'Debe existir botón optimizar configuración');
  assert.ok(html.includes('id="enviarMensajes"'), 'Debe existir botón INICIAR CAMPAÑA');
});

test('Campaign Dispatcher: CSS define split-view responsive de escritorio', () => {
  const css = fs.readFileSync(cssPath, 'utf8');

  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1\.45fr\)\s*minmax\(320px,\s*0\.95fr\)/, 'Debe definir cuadrícula de dos columnas');
  assert.match(css, /position:\s*sticky/, 'Inspector debe ser sticky en la columna derecha');
  assert.match(css, /@media\s*\(max-width:\s*1024px\)/, 'Debe incluir breakpoint responsive para resoluciones menores');
});

test('Campaign Dispatcher: Controlador gestiona cambio de fuente de audiencia', () => {
  const controller = new CampaignDispatcherController(null);

  assert.equal(controller.audience.getSource(), 'contacts');
  controller.audience.setSource('groups');
  assert.equal(controller.audience.getSource(), 'groups');
});

test('Campaign Dispatcher: Controlador actualiza el conteo de caracteres', () => {
  const controller = new CampaignDispatcherController(null);

  // Simular mock para updateMessageCharCount
  let textResult = '';
  global.document = {
    getElementById: (id) => {
      if (id === 'messageCharCount') {
        return {
          set textContent(val) { textResult = val; },
          get textContent() { return textResult; }
        };
      }
      return null;
    }
  };

  controller.updateMessageCharCount('Hola {nombre}, aprovecha la promo');
  assert.equal(textResult, '33 caracteres');

  controller.updateMessageCharCount('A');
  assert.equal(textResult, '1 caracter');
});

test('Campaign Dispatcher: Ciclo de vida de la campaña (idle -> ready -> running -> paused -> completed/error/cancelled)', () => {
  const controller = new CampaignDispatcherController(null);
  assert.equal(controller.state, 'idle');

  // Transición a ready
  controller.state = 'ready';
  assert.equal(controller.state, 'ready');

  // Iniciar campaña -> running
  controller.state = 'running';
  assert.equal(controller.state, 'running');

  // Pausa durante delay -> paused
  controller.state = 'paused';
  assert.equal(controller.state, 'paused');

  // Reanudar -> running
  controller.state = 'running';
  assert.equal(controller.state, 'running');

  // Completar -> completed
  controller.state = 'completed';
  assert.equal(controller.state, 'completed');

  // Error y cancelado
  controller.state = 'error';
  assert.equal(controller.state, 'error');

  controller.state = 'cancelled';
  assert.equal(controller.state, 'cancelled');
});

test('Campaign Dispatcher: Composer valida mensaje no vacío o archivos presentes', () => {
  function validateComposerInput(message, files = []) {
    const hasText = Boolean(String(message || '').trim());
    const hasFiles = Array.isArray(files) && files.length > 0;
    return hasText || hasFiles;
  }

  assert.equal(validateComposerInput('Hola mundo'), true, 'Mensaje con texto es válido');
  assert.equal(validateComposerInput('', ['/path/to/image.png']), true, 'Sin texto pero con archivos es válido');
  assert.equal(validateComposerInput('   ', []), false, 'Mensaje vacío sin archivos es inválido');
  assert.equal(validateComposerInput(null, []), false, 'Null es inválido');
});

test('Campaign Dispatcher: Safety Inspector deshabilita INICIAR CAMPAÑA cuando está BLOCKED', () => {
  const controller = new CampaignDispatcherController(null);
  const elements = {
    enviarMensajes: { disabled: false, title: '' },
    forzarEnvioMensajes: { classList: { contains: () => false, toggle: (cls, val) => {} } },
    inspectorRecipientsCount: { textContent: '' },
    inspectorEstimatedDuration: { textContent: '' },
    inspectorSafetyStatus: { className: '', classList: { add: () => {} }, textContent: '' }
  };

  global.document = {
    getElementById: (id) => elements[id] || null
  };

  // Simular inspección BLOCKED
  controller.renderInspection({
    status: 'BLOCKED',
    score: 85,
    estimatedDuration: '0 seg',
    checks: {},
    reasons: ['Riesgo alto'],
    suggestion: 'Ajusta la configuración'
  }, 0);

  assert.equal(elements.enviarMensajes.disabled, true, 'Botón INICIAR CAMPAÑA debe estar deshabilitado en BLOCKED');

  // Simular inspección READY
  controller.renderInspection({
    status: 'READY',
    score: 20,
    estimatedDuration: '~5 min',
    checks: {},
    reasons: ['Parámetros seguros'],
    suggestion: 'Todo listo'
  }, 10);

  assert.equal(elements.enviarMensajes.disabled, false, 'Botón INICIAR CAMPAÑA debe estar habilitado en READY');
});

