const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const tokensPath = path.resolve(__dirname, '../src/renderer/styles/design-tokens.css');

test('Design Tokens: archivo design-tokens.css existe y es accesible', () => {
  assert.ok(fs.existsSync(tokensPath), 'design-tokens.css debe existir en src/renderer/styles/');
});

test('Design Tokens: define superficies de tema oscuro Deep Graphite / Slate', () => {
  const content = fs.readFileSync(tokensPath, 'utf8');

  // Background surfaces
  assert.match(content, /--bg-app:\s*#090d13/i, 'Debe definir --bg-app con el tono base #090d13');
  assert.match(content, /--bg-sidebar:\s*#0d121a/i, 'Debe definir --bg-sidebar');
  assert.match(content, /--bg-surface:\s*#141b26/i, 'Debe definir --bg-surface');
  assert.match(content, /--bg-surface-elevated:/, 'Debe definir --bg-surface-elevated');
  assert.match(content, /--bg-surface-hover:/, 'Debe definir --bg-surface-hover');
  assert.match(content, /--bg-surface-active:/, 'Debe definir --bg-surface-active');
  assert.match(content, /--bg-input:/, 'Debe definir --bg-input');
  assert.match(content, /--bg-overlay:/, 'Debe definir --bg-overlay');
});

test('Design Tokens: define tokens semánticos de estado (sin decoraciones arbitrarias)', () => {
  const content = fs.readFileSync(tokensPath, 'utf8');

  // Semantic statuses
  assert.match(content, /--status-success:\s*#10b981/i, 'Debe definir --status-success semántico');
  assert.match(content, /--status-warning:\s*#f59e0b/i, 'Debe definir --status-warning semántico');
  assert.match(content, /--status-danger:\s*#ef4444/i, 'Debe definir --status-danger semántico');
  assert.match(content, /--status-info:\s*#06b6d4/i, 'Debe definir --status-info semántico');
  assert.match(content, /--status-neutral:/, 'Debe definir --status-neutral');

  // Accent
  assert.match(content, /--accent-primary:/, 'Debe definir --accent-primary');
  assert.match(content, /--accent-hover:/, 'Debe definir --accent-hover');
});

test('Design Tokens: define tipografía profesional (Inter para UI, JetBrains Mono para datos técnicos)', () => {
  const content = fs.readFileSync(tokensPath, 'utf8');

  assert.match(content, /--font-sans:[^;]*Inter/i, '--font-sans debe incluir Inter');
  assert.match(content, /--font-mono:[^;]*JetBrains Mono/i, '--font-mono debe incluir JetBrains Mono');
});

test('Design Tokens: define escalas consistentes de espaciado, curvatura y capas z-index', () => {
  const content = fs.readFileSync(tokensPath, 'utf8');

  // Spacing
  assert.match(content, /--space-1:\s*4px/, 'Escala de espaciado base 4');
  assert.match(content, /--space-2:\s*8px/);
  assert.match(content, /--space-3:\s*12px/);
  assert.match(content, /--space-4:\s*16px/);

  // Radius
  assert.match(content, /--radius-sm:/);
  assert.match(content, /--radius-md:/);
  assert.match(content, /--radius-lg:/);

  // Z-index
  assert.match(content, /--z-dock:\s*20/);
  assert.match(content, /--z-modal:\s*100/);
});

test('Design Tokens: no contiene orbes decorativos ni efectos glow difusos', () => {
  const content = fs.readFileSync(tokensPath, 'utf8');

  assert.doesNotMatch(content, /--glow/i, 'No debe existir el token decorativo --glow');
  assert.doesNotMatch(content, /background-orb/i, 'No deben existir orbes decorativos');
});
