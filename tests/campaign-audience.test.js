const test = require('node:test');
const assert = require('node:assert/strict');
const { CampaignAudience, normalizeNumber } = require('../src/renderer/js/modules/campaign/campaign-audience');

test('Audience: normalizeNumber extrae solo dígitos válidos', () => {
  assert.equal(normalizeNumber('+591 (7) 444-7830'), '59174447830');
  assert.equal(normalizeNumber('59171112233'), '59171112233');
  assert.equal(normalizeNumber(''), '');
  assert.equal(normalizeNumber(null), '');
});

test('Audience: selecciona contactos y calcula el conteo', () => {
  const audience = new CampaignAudience();
  assert.equal(audience.getContactsCount(), 0);

  audience.setSelectedContacts([
    { id: '1@c.us', name: 'Wilson', number: '59174447830' },
    { id: '2@c.us', name: 'Maria', number: '59171112233' }
  ]);

  assert.equal(audience.getContactsCount(), 2);
  assert.equal(audience.getActiveRecipientsCount(), 2);
  assert.ok(audience.isValid());
});

test('Audience: deduplica contactos con el mismo número telefónico', () => {
  const audience = new CampaignAudience();

  audience.setSelectedContacts([
    { id: '1@c.us', name: 'Wilson', number: '+591 7444 7830' },
    { id: '1_dup@c.us', name: 'Wilson Duplicado', number: '59174447830' },
    { id: '2@c.us', name: 'Maria', number: '59171112233' }
  ]);

  assert.equal(audience.getContactsCount(), 2, 'Debe descartar el contacto duplicado por número');
  assert.equal(audience.selectedContacts[0].name, 'Wilson');
  assert.equal(audience.selectedContacts[1].name, 'Maria');
});

test('Audience: añade y remueve contactos individuales conservando el resto', () => {
  const audience = new CampaignAudience();

  audience.addContact({ id: '1@c.us', name: 'Carlos', number: '59170001122' });
  assert.equal(audience.getContactsCount(), 1);

  // Intentar agregar duplicado no altera la lista
  const addedAgain = audience.addContact({ id: '1b@c.us', name: 'Carlos Copia', number: '59170001122' });
  assert.equal(addedAgain, false);
  assert.equal(audience.getContactsCount(), 1);

  // Remover por ID
  const removed = audience.removeContact('1@c.us');
  assert.equal(removed, true);
  assert.equal(audience.getContactsCount(), 0);
});

test('Audience: selecciona grupos y gestiona catálogo', () => {
  const audience = new CampaignAudience();
  audience.setSource('groups');

  assert.equal(audience.getSource(), 'groups');
  assert.equal(audience.getGroupsCount(), 0);

  audience.setSelectedGroupIds(['12036301@g.us', '12036302@g.us']);
  assert.equal(audience.getGroupsCount(), 2);
  assert.equal(audience.getActiveRecipientsCount(), 2);

  // Toggle grupo
  audience.toggleGroup('12036301@g.us');
  assert.equal(audience.getGroupsCount(), 1);

  audience.toggleGroup('12036303@g.us');
  assert.equal(audience.getGroupsCount(), 2);
});

test('Audience: permite alternar fuentes sin perder la selección previa', () => {
  const audience = new CampaignAudience();

  // Seleccionar contactos
  audience.setSelectedContacts([{ id: '1@c.us', number: '59174447830' }]);
  assert.equal(audience.getActiveRecipientsCount(), 1);

  // Cambiar a grupos y seleccionar grupos
  audience.setSource('groups');
  audience.setSelectedGroupIds(['group1@g.us', 'group2@g.us']);
  assert.equal(audience.getActiveRecipientsCount(), 2);
  assert.equal(audience.getTotalRecipientsCount(), 3);

  // Volver a contactos: los contactos siguen seleccionados
  audience.setSource('contacts');
  assert.equal(audience.getActiveRecipientsCount(), 1);
  assert.equal(audience.getContactsCount(), 1);
  assert.equal(audience.getGroupsCount(), 2);
});

test('Audience: audiencia vacía es inválida', () => {
  const audience = new CampaignAudience();
  assert.equal(audience.isValid(), false);

  const summary = audience.getRecipientsSummary();
  assert.equal(summary.isValid, false);
  assert.equal(summary.activeCount, 0);
  assert.equal(summary.totalCount, 0);
});
