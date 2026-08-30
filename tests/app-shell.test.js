const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexPath = path.resolve(__dirname, '../src/renderer/index.html');
const appShellCssPath = path.resolve(__dirname, '../src/renderer/styles/app-shell.css');

test('AppShell: index.html contiene la arquitectura estructural Desktop AppShell', () => {
  const html = fs.readFileSync(indexPath, 'utf8');

  // AppShell root
  assert.ok(html.includes('class="app-shell"'), 'Debe existir el contenedor raíz .app-shell');

  // Sidebar
  assert.ok(html.includes('<aside class="app-sidebar">'), 'Debe existir el sidebar');
  assert.ok(html.includes('class="sidebar-brand"'), 'Sidebar debe contener branding');
  assert.ok(html.includes('class="sidebar-nav"'), 'Sidebar debe contener navegación');

  // Main area
  assert.ok(html.includes('class="app-main"'), 'Debe existir el área principal .app-main');
  assert.ok(html.includes('class="app-topbar"'), 'Debe existir la barra superior .app-topbar');
  assert.ok(html.includes('id="appCanvas"'), 'Debe existir el lienzo desplazable #appCanvas');

  // Task dock
  assert.ok(html.includes('id="taskDock"'), 'Debe existir el componente #taskDock');
});

test('AppShell: Sidebar preserva todos los botones de navegación con sus IDs y data-tab', () => {
  const html = fs.readFileSync(indexPath, 'utf8');

  // Navigation items mapping
  const expectedNav = [
    { id: 'mensajesTab', tab: 'contacts' },
    { id: 'gruposTab', tab: 'groups' },
    { id: 'importarGruposTab', tab: 'group-import' },
    { id: 'programacionTab', tab: 'scheduling' },
    { id: 'estadisticasTab', tab: 'statistics' },
    { id: 'adminTab', tab: 'admin' }
  ];

  expectedNav.forEach(({ id, tab }) => {
    const pattern = new RegExp(`id="${id}"[^>]*data-tab="${tab}"|data-tab="${tab}"[^>]*id="${id}"`);
    assert.match(html, pattern, `Debe existir el botón #${id} con data-tab="${tab}"`);
  });
});

test('AppShell: Canvas contiene todos los paneles de sección con sus IDs y data-panel', () => {
  const html = fs.readFileSync(indexPath, 'utf8');

  const expectedPanels = [
    { id: 'mensajesContent', panel: 'contacts' },
    { id: 'gruposContent', panel: 'groups' },
    { id: 'importarGruposContent', panel: 'group-import' },
    { id: 'programacionContent', panel: 'scheduling' },
    { id: 'estadisticasContent', panel: 'statistics' },
    { id: 'adminContent', panel: 'admin' }
  ];

  expectedPanels.forEach(({ id, panel }) => {
    const pattern = new RegExp(`id="${id}"[^>]*data-panel="${panel}"|data-panel="${panel}"[^>]*id="${id}"`);
    assert.match(html, pattern, `Debe existir el panel #${id} con data-panel="${panel}"`);
  });
});

test('AppShell: Topbar contiene el monitor de estado de WhatsApp y métricas globales', () => {
  const html = fs.readFileSync(indexPath, 'utf8');

  assert.ok(html.includes('id="statusDot"'), 'Topbar debe contener #statusDot');
  assert.ok(html.includes('id="statusText"'), 'Topbar debe contener #statusText');
  assert.ok(html.includes('id="totalContacts"'), 'Topbar debe contener #totalContacts');
  assert.ok(html.includes('id="totalGroups"'), 'Topbar debe contener #totalGroups');
  assert.ok(html.includes('id="currentSectionTitle"'), 'Topbar debe contener #currentSectionTitle');
});

test('AppShell: Orbes flotantes de fondo eliminados completamente del HTML', () => {
  const html = fs.readFileSync(indexPath, 'utf8');

  assert.doesNotMatch(html, /background-orb/i, 'No debe haber orbes flotantes de fondo en el HTML');
});

test('AppShell: CSS define layout de 240px fijo, topbar de 52px y scroll independiente', () => {
  const css = fs.readFileSync(appShellCssPath, 'utf8');

  assert.match(css, /grid-template-columns:\s*240px\s+1fr/i, 'Sidebar debe tener 240px de ancho fijo');
  assert.match(css, /height:\s*52px/i, 'Topbar debe tener 52px de altura fija');
  assert.match(css, /overflow-y:\s*auto/i, 'Canvas debe tener overflow-y auto para scroll independiente');
});
