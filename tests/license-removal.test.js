const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const indexPath = path.resolve(rootDir, 'src/renderer/index.html');
const appControllerPath = path.resolve(rootDir, 'src/renderer/js/modules/app-controller.js');
const mainPath = path.resolve(rootDir, 'src/main/main.js');
const stylesCssPath = path.resolve(rootDir, 'src/renderer/styles.css');
const licenseCssPath = path.resolve(rootDir, 'src/renderer/styles/license.css');

test('License Removal - Archivos: no existe directorio apps ni CSS de licencia', () => {
  const appsDir = path.resolve(rootDir, 'apps');

  assert.equal(fs.existsSync(appsDir), false, 'Directorio apps no debe existir en el sistema de archivos');
  assert.equal(fs.existsSync(licenseCssPath), false, 'src/renderer/styles/license.css debe haber sido eliminado');

  const stylesContent = fs.readFileSync(stylesCssPath, 'utf8');
  assert.equal(stylesContent.includes('license.css'), false, 'styles.css no debe importar license.css');
});

test('License Removal - Backend/Main: sin funciones ni bootstrap de licencia legacy', () => {
  const mainContent = fs.readFileSync(mainPath, 'utf8');
  assert.equal(mainContent.includes('startLicenseApiServer'), false, 'main.js no debe contener startLicenseApiServer');
  assert.equal(mainContent.includes('4010'), false, 'main.js no debe referenciar el puerto 4010');
  assert.equal(mainContent.includes('apps'), false, 'main.js no debe importar nada de apps');
});

test('License Removal - Renderer AppController: sin métodos ni endpoints de licencia', () => {
  const appControllerContent = fs.readFileSync(appControllerPath, 'utf8');

  assert.equal(appControllerContent.includes('validateLicense'), false, 'validateLicense debe estar completamente eliminado');
  assert.equal(appControllerContent.includes('initializeLicenseAccess'), false, 'initializeLicenseAccess debe estar completamente eliminado');
  assert.equal(appControllerContent.includes('handleLicenseLogin'), false, 'handleLicenseLogin debe estar eliminado');
  assert.equal(appControllerContent.includes('handleRegister'), false, 'handleRegister comercial debe estar eliminado');
  assert.equal(appControllerContent.includes('startPeriodicLicenseValidation'), false, 'startPeriodicLicenseValidation debe estar eliminado');
  assert.equal(appControllerContent.includes('setAppLocked'), false, 'setAppLocked debe estar eliminado');
  assert.equal(appControllerContent.includes('localhost:4010'), false, 'app-controller.js no debe contener localhost:4010');
  assert.equal(appControllerContent.includes('/license/validate'), false, 'app-controller.js no debe contener /license/validate');
  assert.equal(appControllerContent.includes('/license/activate'), false, 'app-controller.js no debe contener /license/activate');
});

test('License Removal - HTML: modal comercial, formularios de compra y textos de planes eliminados', () => {
  const html = fs.readFileSync(indexPath, 'utf8');

  // IDs comerciales eliminados
  assert.equal(html.includes('id="licenseModal"'), false, '#licenseModal no debe existir en index.html');
  assert.equal(html.includes('id="licenseForm"'), false, '#licenseForm no debe existir en index.html');
  assert.equal(html.includes('id="registerForm"'), false, '#registerForm no debe existir en index.html');
  assert.equal(html.includes('id="licenseEmail"'), false, '#licenseEmail no debe existir en index.html');
  assert.equal(html.includes('id="licensePassword"'), false, '#licensePassword no debe existir en index.html');
  assert.equal(html.includes('id="licenseLoginButton"'), false, '#licenseLoginButton no debe existir en index.html');
  assert.equal(html.includes('id="whatsappSalesButton"'), false, '#whatsappSalesButton no debe existir en index.html');

  // Textos y planes comerciales eliminados
  assert.equal(html.includes('Completa la validación de tu cuenta para acceder'), false);
  assert.equal(html.includes('Inicia sesion para activar tu licencia'), false);
  assert.equal(html.includes('Plan Pro: 99.99 BOB/mes'), false);
  assert.equal(html.includes('Plan Enterprise: 999.99 BOB/mes'), false);
  assert.equal(html.includes('Adquisicion comercial por atencion personalizada'), false);
  assert.equal(html.includes('sidebar-license-pill'), false, '.sidebar-license-pill no debe existir');

  // CSP no debe conectar a 4010
  assert.equal(html.includes(':4010'), false, 'CSP no debe incluir el puerto 4010');
});

test('License Removal - Conservación: WhatsApp QR, sesión y AppShell permanecen intactos', () => {
  const html = fs.readFileSync(indexPath, 'utf8');

  // WhatsApp QR modal y componentes críticos de sesión presentes
  assert.ok(html.includes('id="qrModal"'), '#qrModal debe permanecer intacto para autenticación WhatsApp');
  assert.ok(html.includes('id="qrContainer"'), '#qrContainer debe permanecer para renderizar código QR');
  assert.ok(html.includes('id="statusDot"'), '#statusDot debe permanecer para monitoreo de WhatsApp');
  assert.ok(html.includes('id="statusText"'), '#statusText debe permanecer para monitoreo de WhatsApp');
  assert.ok(html.includes('id="taskDock"'), '#taskDock debe permanecer intacto');
  assert.ok(html.includes('class="app-shell"'), '.app-shell debe permanecer intacto');
});
