const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexPath = path.resolve(__dirname, '../src/renderer/index.html');

test('CSP: meta Content-Security-Policy existe y es válida en index.html', () => {
  const html = fs.readFileSync(indexPath, 'utf8');
  assert.match(html, /<meta\s+http-equiv=["']Content-Security-Policy["']/i, 'Debe existir la directiva meta CSP');
  assert.match(html, /content="[^"]*style-src\s+'self'\s+https:\/\/fonts\.googleapis\.com[^"]*"/i, 'CSP debe definir style-src seguro');
});

test('CSP: no contiene unsafe-inline en ninguna directiva de la CSP', () => {
  const html = fs.readFileSync(indexPath, 'utf8');
  const cspMatch = html.match(/<meta\s+http-equiv=["']Content-Security-Policy["']\s+content=["']([^"']+)["']/i);
  assert.ok(cspMatch, 'Debe encontrar la meta tag de CSP');
  const cspContent = cspMatch[1];
  assert.equal(cspContent.includes("'unsafe-inline'"), false, 'CSP no debe permitir unsafe-inline');
  assert.equal(cspContent.includes('unsafe-inline'), false, 'CSP no debe mencionar unsafe-inline');
});

test('CSP: index.html no contiene atributos style="..." inline en ningún elemento', () => {
  const html = fs.readFileSync(indexPath, 'utf8');
  // Buscar cualquier atributo style="..." o style='...'
  const inlineStyleMatches = html.match(/\bstyle\s*=\s*["'][^"']*["']/gi);
  assert.equal(inlineStyleMatches, null, `No deben existir estilos inline en el HTML. Encontrados: ${inlineStyleMatches ? inlineStyleMatches.join(', ') : 'ninguno'}`);
});

test('CSP: los estilos principales se cargan exclusivamente desde archivos CSS externos', () => {
  const html = fs.readFileSync(indexPath, 'utf8');
  assert.match(html, /<link\s+rel=["']stylesheet["']\s+href=["']styles\.css["']>/i, 'Debe cargar styles.css como enlace externo');
  // Verificar que no hay bloques <style> inline en index.html
  assert.equal(/<style\b[^>]*>/i.test(html), false, 'No deben existir bloques <style> inline en index.html');
});

test('CSP: no existen scripts inline ni event handlers inline en index.html', () => {
  const html = fs.readFileSync(indexPath, 'utf8');

  // Verificar que todos los tags <script> tengan atributo src
  const scriptTags = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const tag of scriptTags) {
    assert.match(tag, /\bsrc\s*=/i, `Todos los scripts deben ser externos: ${tag}`);
  }

  // Verificar que no hay atributos inline de eventos (onclick, onchange, etc.)
  const eventHandlerMatches = html.match(/\bon[a-z]+\s*=\s*["'][^"']*["']/gi);
  assert.equal(eventHandlerMatches, null, `No deben existir inline event handlers. Encontrados: ${eventHandlerMatches ? eventHandlerMatches.join(', ') : 'ninguno'}`);
});
