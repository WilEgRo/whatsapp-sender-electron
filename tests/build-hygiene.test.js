const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const packageJsonPath = path.resolve(__dirname, '../package.json');

test('Build Hygiene: script de desarrollo ("dev" y "start") no invoca electron-builder ni packaging', () => {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const devScript = pkg.scripts.dev || '';
  const startScript = pkg.scripts.start || '';

  assert.equal(devScript.includes('electron-builder'), false, 'El script dev no debe invocar electron-builder');
  assert.equal(devScript.includes('build'), false, 'El script dev no debe invocar build');
  assert.equal(devScript.includes('dist'), false, 'El script dev no debe invocar dist');

  assert.equal(startScript.includes('electron-builder'), false, 'El script start no debe invocar electron-builder');
  assert.equal(startScript.includes('build'), false, 'El script start no debe invocar build');
});

test('Build Hygiene: script de test no invoca packaging ni genera binarios', () => {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const testScript = pkg.scripts.test || '';

  assert.equal(testScript.includes('electron-builder'), false, 'El script test no debe invocar electron-builder');
  assert.equal(testScript.includes('build'), false, 'El script test no debe invocar build');
  assert.equal(testScript.includes('dist'), false, 'El script test no debe invocar dist');
});

test('Build Hygiene: scripts de distribución ("build" y "dist") permanecen explícitos y separados', () => {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  assert.ok(pkg.scripts.build, 'Debe existir un comando explícito para packaging/build');
  assert.ok(pkg.scripts.dist, 'Debe existir un comando explícito para dist');
  assert.equal(pkg.scripts.build, 'electron-builder', 'El comando build debe apuntar directamente a electron-builder');
});

test('Build Hygiene: configuración de electron-builder permanece intacta para distribución futura', () => {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  assert.ok(pkg.build, 'Debe existir la configuración "build" para electron-builder');
  assert.equal(pkg.build.appId, 'com.CiberGuard.whatsapp-sender');
  assert.equal(pkg.build.productName, 'WhatsApp Sender');
  assert.ok(pkg.build.directories && pkg.build.directories.output === 'dist');
  assert.ok(pkg.build.win && pkg.build.win.target === 'nsis');
});
