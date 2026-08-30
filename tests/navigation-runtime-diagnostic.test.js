const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const harnessPath = path.resolve(__dirname, 'helpers/electron-navigation-diagnostic-harness.js');
const electronBin = process.platform === 'win32'
  ? path.resolve(__dirname, '../node_modules/.bin/electron.cmd')
  : path.resolve(__dirname, '../node_modules/.bin/electron');

test('Diagnóstico Runtime de Navegación y Visibilidad Real en Electron', (t, done) => {
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
    assert.equal(code, 0, `Electron finalizó con código ${code}. Stderr: ${stderr}`);

    const match = stdout.match(/NAVIGATION_DIAGNOSTIC_RESULT:(\{.*\})/);
    assert.ok(match, `Debe emitir NAVIGATION_DIAGNOSTIC_RESULT. Stdout recibido:\n${stdout}`);

    const payload = JSON.parse(match[1]);
    const { diagnostic, consoleErrors, cspErrors } = payload;

    console.log('\n======================================================');
    console.log('       INVENTARIO INICIAL DE PANELES EN EL DOM        ');
    console.log('======================================================');
    console.table(diagnostic.panels.map(p => ({
      ID: p.id,
      Panel: p.panel,
      Clases: p.classes.join(' '),
      Display: p.display,
      Visibility: p.visibility,
      Opacity: p.opacity,
      Dimensiones: `${Math.round(p.width)}x${Math.round(p.height)}`,
      Visible: p.visible ? 'YES' : 'NO'
    })));

    console.log('\n======================================================');
    console.log('       SIMULACIÓN DE CLIC EN CADA PESTAÑA (RUNTIME)   ');
    console.log('======================================================');
    const resultsTable = diagnostic.clickResults.map(r => {
      const p = r.panelAudit;
      return {
        'Sección/Tab': r.tab,
        'Botón': r.buttonId,
        'Panel': p ? p.id : 'N/A',
        'Click': r.clickDispatched ? 'YES' : 'NO',
        'Activo': (p && p.isActiveClass) ? 'YES' : 'NO',
        'Display': p ? p.display : 'N/A',
        'Visibility': p ? p.visibility : 'N/A',
        'Rect (X, Y, W, H)': p ? `x:${Math.round(p.rect.x)}, y:${Math.round(p.rect.y)}, w:${Math.round(p.rect.width)}, h:${Math.round(p.rect.height)}` : '0x0',
        'Visible': (p && p.visible) ? 'YES' : 'NO',
        'Padres': p && p.parentChain ? p.parentChain.map(pc => `${pc.tag}#${pc.id || ''}.${pc.className || ''}`).join(' < ') : 'N/A'
      };
    });
    console.table(resultsTable);

    console.log('\n======================================================');
    console.log('               AUDITORÍA PADRE CANVAS                ');
    console.log('======================================================');
    console.log(JSON.stringify(diagnostic.canvasComputed, null, 2));

    console.log('\n======================================================');
    console.log('            DETALLE DE ERRORES CAPTURADOS            ');
    console.log('======================================================');
    console.log('Console Errors:', consoleErrors);
    console.log('CSP Errors:', cspErrors);
    console.log('Renderer Errors after navigation:', diagnostic.errorsAfterNavigation);

    assert.equal(consoleErrors.length, 0, `No deben existir console errors. Encontrados: ${JSON.stringify(consoleErrors)}`);
    assert.equal(cspErrors.length, 0, `No deben existir CSP errors. Encontrados: ${JSON.stringify(cspErrors)}`);
    assert.equal(diagnostic.errorsAfterNavigation.length, 0, `No deben existir errores tras navegar. Encontrados: ${JSON.stringify(diagnostic.errorsAfterNavigation)}`);

    // Validar que todos los paneles existen y pertenecen estrictamente a #appCanvas
    assert.ok(diagnostic.tabButtons.length >= 5, 'Deben existir botones de navegación en el Sidebar');
    assert.ok(diagnostic.panels.length >= 5, 'Deben existir paneles de contenido');

    diagnostic.clickResults.forEach((res) => {
      const p = res.panelAudit;
      if (!p) return;

      // Todo panel debe estar contenido dentro de main#appCanvas
      const hasAppCanvasParent = p.parentChain.some(parent => parent.id === 'appCanvas' || parent.tag === 'main');
      assert.ok(hasAppCanvasParent, `El panel ${p.id} (${res.tab}) DEBE estar contenido dentro de #appCanvas. Cadena: ${JSON.stringify(p.parentChain)}`);

      // Si no es la pestaña oculta de admin, debe ser visible al seleccionarse
      if (res.tab !== 'admin') {
        assert.equal(p.isActiveClass, true, `El panel ${p.id} debe tener la clase .active tras hacer clic`);
        assert.equal(p.visible, true, `El panel ${p.id} debe ser visible en pantalla tras hacer clic`);
        assert.equal(p.display, 'block', `El panel ${p.id} debe tener display: block`);
        assert.equal(p.visibility, 'visible', `El panel ${p.id} debe tener visibility: visible`);
        assert.ok(p.width >= 800, `El panel ${p.id} debe tener un ancho completo de canvas (>= 800px, actual: ${p.width}px)`);
        assert.ok(p.height >= 300, `El panel ${p.id} debe tener altura renderizada (>= 300px, actual: ${p.height}px)`);
        assert.ok(p.rect.x >= 240, `El panel ${p.id} debe estar a la derecha del sidebar (x >= 240px, actual: ${p.rect.x}px)`);
        assert.ok(p.rect.y >= 50, `El panel ${p.id} debe estar debajo del topbar (y >= 50px, actual: ${p.rect.y}px)`);
      }
    });

    done();
  });
});
