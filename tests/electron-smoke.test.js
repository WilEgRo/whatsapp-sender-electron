const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const harnessPath = path.resolve(__dirname, 'helpers/electron-smoke-harness.js');
const electronBin = process.platform === 'win32'
  ? path.resolve(__dirname, '../node_modules/.bin/electron.cmd')
  : path.resolve(__dirname, '../node_modules/.bin/electron');

test('Electron Smoke Test: renderer carga completamente sin SyntaxError, sin violaciones CSP y con AppShell activo', (t, done) => {
  const command = process.platform === 'win32' ? 'cmd.exe' : electronBin;
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', electronBin, harnessPath] : [harnessPath];

  const child = spawn(command, args, {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  child.on('close', (code) => {
    assert.equal(code, 0, `Electron debe finalizar con código 0. Stderr: ${stderr}`);

    const resultMatch = stdout.match(/SMOKE_RESULT:(\{.*\})/);
    assert.ok(resultMatch, `Debe emitir SMOKE_RESULT en stdout. Stdout recibido:\n${stdout}`);

    const result = JSON.parse(resultMatch[1]);

    // Verificar estado del DOM y arquitectura del Renderer
    assert.equal(result.state.hasApp, true, 'window.app debe estar instanciado');
    assert.equal(result.state.hasAppShell, true, '.app-shell debe existir en el DOM');
    assert.equal(result.state.hasCampaignDispatcher, true, 'CampaignDispatcherController debe estar activo');
    assert.equal(result.state.hasDispatcher, true, '.campaign-dispatcher debe estar renderizado');
    assert.equal(result.state.hasInspector, true, '.safety-inspector-card debe estar presente');
    assert.equal(result.state.hasTaskDock, true, 'TaskDock debe estar inicializado');
    assert.equal(result.state.hasQrModal, true, '#qrModal debe estar presente para login WhatsApp');
    assert.equal(result.state.hasLicenseModal, false, '#licenseModal NO debe existir en el DOM');
    assert.equal(result.state.hasLicensePill, false, '.sidebar-license-pill NO debe existir en el DOM');
    assert.equal(result.state.isAppLocked, false, 'La aplicación NO debe estar bloqueada por licencia');
    assert.equal(result.state.allPanelsInsideCanvas, true, 'Todos los paneles (.tab-panel) DEBEN estar contenidos dentro de #appCanvas');
    assert.equal(result.state.currentTitle, 'Despachador de Campañas');

    // Verificar cero llamadas de red a endpoints de licencia
    assert.equal(result.licenseRequests, 0, `No debe realizar peticiones a endpoints de licencias. Interceptadas: ${JSON.stringify(result.interceptedLicenseRequests)}`);
    assert.deepEqual(result.interceptedLicenseRequests, [], 'La lista de peticiones de licencia interceptadas debe estar vacía');

    // Verificar cero violaciones de CSP
    assert.deepEqual(result.cspErrors, [], `No deben existir errores de CSP en el renderer. Encontrados: ${JSON.stringify(result.cspErrors)}`);

    // Verificar cero errores de sintaxis o runtime fatal
    assert.deepEqual(result.consoleErrors, [], `No deben existir errores en la consola del renderer. Encontrados: ${JSON.stringify(result.consoleErrors)}`);

    done();
  });
});
