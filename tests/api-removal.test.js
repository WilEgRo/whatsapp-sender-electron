const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const appsPath = path.join(rootDir, 'apps');
const appsApiPath = path.join(rootDir, 'apps', 'api');
const packageJsonPath = path.join(rootDir, 'package.json');
const mainJsPath = path.join(rootDir, 'src', 'main', 'main.js');

test('API Removal: el directorio /apps/api y /apps no existen', () => {
  assert.equal(fs.existsSync(appsApiPath), false, '/apps/api no debe existir');
  assert.equal(fs.existsSync(appsPath), false, '/apps no debe existir');
});

test('API Removal: package.json no contiene scripts que apunten a apps/api', () => {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const scripts = pkg.scripts || {};

  for (const [name, command] of Object.entries(scripts)) {
    assert.equal(command.includes('apps/api'), false, `Script "${name}" no debe referenciar apps/api: ${command}`);
    assert.equal(command.includes('apps\\api'), false, `Script "${name}" no debe referenciar apps\\api: ${command}`);
  }
});

test('API Removal: el código fuente (src) no importa módulos desde apps/api', () => {
  function scanDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.html'))) {
        const content = fs.readFileSync(fullPath, 'utf8');
        assert.equal(content.includes('apps/api'), false, `Archivo ${entry.name} importa o referencia apps/api`);
        assert.equal(content.includes('apps\\api'), false, `Archivo ${entry.name} importa o referencia apps\\api`);
      }
    }
  }

  scanDir(path.join(rootDir, 'src'));
});

test('API Removal: src/main/main.js no arranca el servidor de licencias legacy', () => {
  const mainContent = fs.readFileSync(mainJsPath, 'utf8');
  assert.equal(mainContent.includes('startLicenseApiServer'), false, 'main.js no debe contener startLicenseApiServer');
  assert.equal(mainContent.includes('licenseApiServer'), false, 'main.js no debe declarar licenseApiServer');
});

test('API Removal: tests no dependen de apps/api', () => {
  const testFiles = fs.readdirSync(path.join(rootDir, 'tests'));
  for (const file of testFiles) {
    if (file.endsWith('.test.js') && file !== 'api-removal.test.js') {
      const content = fs.readFileSync(path.join(rootDir, 'tests', file), 'utf8');
      assert.equal(content.includes('apps/api'), false, `Test ${file} no debe depender de apps/api`);
    }
  }
});

test('API Removal: configuración de packaging (build en package.json) no empaqueta apps/api', () => {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const buildFiles = (pkg.build && pkg.build.files) || [];
  for (const pattern of buildFiles) {
    assert.equal(pattern.includes('apps'), false, `Pattern de build no debe empaquetar apps: ${pattern}`);
  }
});
