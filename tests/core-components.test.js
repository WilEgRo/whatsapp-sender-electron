const test = require('node:test');
const assert = require('node:assert/strict');
const { TaskDock, TASK_DOCK_STATES } = require('../src/renderer/js/modules/ui/task-dock');
const { getIconSvg, ICONS } = require('../src/renderer/js/modules/ui/icons');

// Mock DOM elements for TaskDock testing
function createMockDockElement() {
  const elements = {};

  const el = {
    attributes: {},
    classList: {
      classes: new Set(['hidden']),
      add(c) { this.classes.add(c); },
      remove(c) { this.classes.delete(c); },
      contains(c) { return this.classes.has(c); }
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name]; },
    querySelector(selector) {
      if (!elements[selector]) {
        elements[selector] = {
          textContent: '',
          innerHTML: '',
          className: '',
          classList: {
            classes: new Set(),
            add(c) { this.classes.add(c); },
            remove(c) { this.classes.delete(c); },
            contains(c) { return this.classes.has(c); }
          },
          style: {},
          listeners: {},
          addEventListener(event, fn) {
            this.listeners[event] = this.listeners[event] || [];
            this.listeners[event].push(fn);
          },
          click() {
            if (this.listeners.click) {
              this.listeners.click.forEach((fn) => fn());
            }
          }
        };
      }
      return elements[selector];
    }
  };

  return { el, elements };
}

test('Icon System: genera SVGs válidos sin emojis para todos los iconos requeridos', () => {
  const requiredIcons = [
    'send', 'contacts', 'groups', 'group-import', 'scheduler', 'analytics',
    'admin', 'settings', 'help', 'whatsapp', 'check', 'warning', 'danger',
    'info', 'play', 'pause', 'stop', 'upload', 'download', 'search',
    'filter', 'refresh', 'close', 'logout'
  ];

  requiredIcons.forEach((name) => {
    assert.ok(ICONS[name], `Icono '${name}' debe estar definido en la tabla de iconos`);
    const svg = getIconSvg(name, { size: 18, className: 'test-icon' });
    assert.ok(svg.startsWith('<svg'), `getIconSvg('${name}') debe comenzar con <svg`);
    assert.ok(svg.includes('width="18"'), `Debe aplicar tamaño width="18"`);
    assert.ok(svg.includes('class="icon test-icon"'), `Debe aplicar clases CSS`);
    assert.ok(svg.endsWith('</svg>'), `Debe cerrar con </svg>`);
    assert.doesNotMatch(svg, /[\u{1F300}-\u{1F9FF}]/u, `Icono '${name}' no debe contener emojis`);
  });
});

test('TaskDock: ciclo de vida de estados (hidden, idle, running, paused, completed, error)', () => {
  const { el, elements } = createMockDockElement();
  const dock = new TaskDock(el);

  assert.equal(dock.getState(), TASK_DOCK_STATES.HIDDEN);
  assert.ok(el.classList.contains('hidden'), 'Debe iniciar con clase hidden');

  // Transición a RUNNING
  dock.setState(TASK_DOCK_STATES.RUNNING, {
    title: 'Campaña Primavera 2026',
    current: 'Enviando a +59174447830 (12/50)',
    percent: 24,
    timer: 'Pausa: 15s'
  });

  assert.equal(dock.getState(), TASK_DOCK_STATES.RUNNING);
  assert.ok(!el.classList.contains('hidden'), 'No debe tener hidden en estado running');
  assert.equal(el.getAttribute('data-state'), 'running');
  assert.equal(elements['[data-dock-title]'].textContent, 'Campaña Primavera 2026');
  assert.equal(elements['[data-dock-current]'].textContent, 'Enviando a +59174447830 (12/50)');
  assert.equal(elements['[data-dock-percent]'].textContent, '24%');
  assert.equal(elements['[data-dock-fill]'].style.width, '24%');
  assert.ok(elements['[data-dock-status]'].classList.contains('status-badge--info'));

  // Transición a PAUSED
  dock.setState(TASK_DOCK_STATES.PAUSED);
  assert.equal(dock.getState(), TASK_DOCK_STATES.PAUSED);
  assert.ok(elements['[data-dock-status]'].classList.contains('status-badge--warning'));

  // Transición a COMPLETED
  dock.setState(TASK_DOCK_STATES.COMPLETED, { percent: 100 });
  assert.equal(dock.getState(), TASK_DOCK_STATES.COMPLETED);
  assert.equal(elements['[data-dock-percent]'].textContent, '100%');
  assert.ok(elements['[data-dock-status]'].classList.contains('status-badge--success'));

  // Transición a ERROR
  dock.setState(TASK_DOCK_STATES.ERROR);
  assert.equal(dock.getState(), TASK_DOCK_STATES.ERROR);
  assert.ok(elements['[data-dock-status]'].classList.contains('status-badge--danger'));

  // Transición de vuelta a HIDDEN
  dock.setState(TASK_DOCK_STATES.HIDDEN);
  assert.equal(dock.getState(), TASK_DOCK_STATES.HIDDEN);
  assert.ok(el.classList.contains('hidden'));
});

test('TaskDock: eventos internos de interacción (pause, resume, cancel, close)', () => {
  const { el, elements } = createMockDockElement();
  const dock = new TaskDock(el);

  let pauseCalled = false;
  let resumeCalled = false;
  let cancelCalled = false;
  let closeCalled = false;

  dock.on('pause', () => { pauseCalled = true; });
  dock.on('resume', () => { resumeCalled = true; });
  dock.on('cancel', () => { cancelCalled = true; });
  dock.on('close', () => { closeCalled = true; });

  // Poner en marcha y pulsar botón pausa
  dock.setState(TASK_DOCK_STATES.RUNNING);
  elements['[data-dock-action="pause"]'].click();
  assert.ok(pauseCalled, 'Debe emitir evento pause al hacer click en botón de pausa');
  assert.equal(dock.getState(), TASK_DOCK_STATES.PAUSED);

  // Pulsar reanudar
  elements['[data-dock-action="pause"]'].click();
  assert.ok(resumeCalled, 'Debe emitir evento resume al hacer click en reanudar');
  assert.equal(dock.getState(), TASK_DOCK_STATES.RUNNING);

  // Pulsar cancelar
  elements['[data-dock-action="cancel"]'].click();
  assert.ok(cancelCalled, 'Debe emitir evento cancel al hacer click en cancelar');

  // Pulsar cerrar
  elements['[data-dock-action="close"]'].click();
  assert.ok(closeCalled, 'Debe emitir evento close al hacer click en cerrar');
  assert.equal(dock.getState(), TASK_DOCK_STATES.HIDDEN);
});
