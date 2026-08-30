const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const fs = require('node:fs');
const XLSX = require('xlsx');
const { WhatsAppGroupImportService } = require('../src/main/services/whatsapp-group-import-service');
const { parseExcelParticipants } = require('../src/main/utils/excel-group-parser');
const FileService = require('../src/main/services/file-service');

function excelBuffer(rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Participantes');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function mockWhatsApp({ eligible }) {
  let createCalls = 0;
  const chat = {
    id: { _serialized: '1@g.us' },
    participants: eligible ? [{ id: { _serialized: '59179903823@c.us' } }] : [],
    addParticipants: async () => ({}),
    getInviteCode: async () => 'test-code'
  };

  return {
    service: {
      client: {
        getNumberId: async () => (eligible ? { _serialized: '59179903823@c.us' } : null),
        isRegisteredUser: async () => false,
        createGroup: async () => {
          createCalls += 1;
          return { gid: { _serialized: '1@g.us' } };
        },
        getChatById: async () => chat
      },
      ensureReady() {},
      sendToContacts: async () => []
    },
    getCreateCalls: () => createCalls
  };
}

test('no crea grupo cuando no hay participantes elegibles', async () => {
  const mock = mockWhatsApp({ eligible: false });
  const result = await new WhatsAppGroupImportService({ whatsappService: mock.service }).process(
    excelBuffer([['Numero'], ['59179903823']]),
    'Grupo de prueba'
  );

  assert.equal(mock.getCreateCalls(), 0);
  assert.equal(result.groupCreated, false);
  assert.equal(result.status, 'validation_error');
});

test('rechaza la segunda solicitud concurrente con 409 y solo crea un grupo', async () => {
  const mock = mockWhatsApp({ eligible: true });
  const originalCreateGroup = mock.service.client.createGroup;
  mock.service.client.createGroup = async (...args) => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return originalCreateGroup(...args);
  };
  const app = express();
  app.use(express.json());
  app.use('/api/whatsapp/groups', require('../src/main/http/whatsapp-group-import.routes')({ whatsappService: mock.service }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const form = new FormData();
    form.append('groupName', 'Grupo concurrente');
    form.append('file', new Blob([excelBuffer([['Numero'], ['59179903823']])]), 'participantes.xlsx');
    const requestA = fetch(`http://127.0.0.1:${server.address().port}/api/whatsapp/groups/import-excel`, { method: 'POST', body: form });
    const requestB = fetch(`http://127.0.0.1:${server.address().port}/api/whatsapp/groups/import-excel`, { method: 'POST', body: form });
    const [responseA, responseB] = await Promise.all([requestA, requestB]);
    const statuses = [responseA.status, responseB.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const conflict = responseA.status === 409 ? await responseA.json() : await responseB.json();
    assert.equal(conflict.error, 'GROUP_CREATION_IN_PROGRESS');
    assert.equal(mock.getCreateCalls(), 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('libera el mutex cuando la primera ejecucion falla', async () => {
  const mock = mockWhatsApp({ eligible: true });
  let shouldFail = true;
  let createCalls = 0;
  mock.service.client.createGroup = async () => {
    createCalls += 1;
    if (shouldFail) {
      shouldFail = false;
      throw new Error('fallo controlado');
    }
    return { gid: { _serialized: '1@g.us' } };
  };
  const app = express();
  app.use('/api/whatsapp/groups', require('../src/main/http/whatsapp-group-import.routes')({ whatsappService: mock.service }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/whatsapp/groups/import-excel`;
    const makeRequest = () => {
      const form = new FormData();
      form.append('groupName', 'Grupo posterior');
      form.append('file', new Blob([excelBuffer([['Numero'], ['59179903823']])]), 'participantes.xlsx');
      return fetch(url, { method: 'POST', body: form });
    };
    const first = await makeRequest();
    const second = await makeRequest();
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(createCalls, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('libera el mutex cuando no hay participantes elegibles', async () => {
  const mock = mockWhatsApp({ eligible: false });
  let eligible = false;
  mock.service.client.getNumberId = async () => (eligible ? { _serialized: '59179903823@c.us' } : null);
  const app = express();
  app.use('/api/whatsapp/groups', require('../src/main/http/whatsapp-group-import.routes')({ whatsappService: mock.service }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/whatsapp/groups/import-excel`;
    const makeRequest = () => {
      const form = new FormData();
      form.append('groupName', 'Grupo validado');
      form.append('file', new Blob([excelBuffer([['Numero'], ['59179903823']])]), 'participantes.xlsx');
      return fetch(url, { method: 'POST', body: form });
    };
    const first = await makeRequest();
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.result.groupCreated, false);
    eligible = true;
    const second = await makeRequest();
    assert.equal(second.status, 200);
    assert.equal(mock.getCreateCalls(), 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('el mutex no bloquea otras rutas', async () => {
  const mock = mockWhatsApp({ eligible: true });
  let releaseCreate;
  mock.service.client.createGroup = () => new Promise((resolve) => {
    releaseCreate = () => resolve({ gid: { _serialized: '1@g.us' } });
  });
  const app = express();
  app.get('/api/other', (_req, res) => res.json({ success: true }));
  app.use('/api/whatsapp/groups', require('../src/main/http/whatsapp-group-import.routes')({ whatsappService: mock.service }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const port = server.address().port;
    const form = new FormData();
    form.append('groupName', 'Grupo aislado');
    form.append('file', new Blob([excelBuffer([['Numero'], ['59179903823']])]), 'participantes.xlsx');
    const groupRequest = fetch(`http://127.0.0.1:${port}/api/whatsapp/groups/import-excel`, { method: 'POST', body: form });
    const otherResponse = await fetch(`http://127.0.0.1:${port}/api/other`);
    assert.equal(otherResponse.status, 200);
    releaseCreate();
    await groupRequest;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('clasifica agregados y pendientes usando participantes reales, no addParticipants', async () => {
  const buffer = excelBuffer([
    ['Nombre', 'Numero'],
    ['Uno', '59179903823'],
    ['Dos', '59170000001']
  ]);
  const runScenario = async (actualIds, scenarioBuffer = buffer) => {
    let createCalls = 0;
    const chat = {
      id: { _serialized: '1@g.us' },
      participants: actualIds.map((serialized) => ({ id: { _serialized: serialized } })),
      addParticipants: async () => ({
        '59179903823@c.us': { code: 200 },
        '59170000001@c.us': { code: 200 }
      }),
      getInviteCode: async () => 'test-code'
    };
    const whatsappService = {
      client: {
        getNumberId: async (number) => ({ _serialized: `${number}@c.us` }),
        createGroup: async () => {
          createCalls += 1;
          return { gid: { _serialized: '1@g.us' } };
        },
        getChatById: async () => chat
      },
      ensureReady() {},
      sendToContacts: async (payload) => payload.numbers.split(',').map((number) => ({ status: 'success', number: `${number}@c.us` }))
    };
    const result = await new WhatsAppGroupImportService({ whatsappService }).process(scenarioBuffer, 'Grupo real');
    return { result, createCalls };
  };

  const oneAdded = await runScenario(['59179903823@c.us'], excelBuffer([['Numero'], ['59179903823']]));
  assert.equal(oneAdded.result.addedDirectly, 1);
  assert.equal(oneAdded.result.pendingInvitation, 0);
  assert.equal(oneAdded.result.status, 'completed');

  const onlyFirst = await runScenario(['59179903823@c.us']);
  assert.equal(onlyFirst.createCalls, 1);
  assert.equal(onlyFirst.result.addedDirectly, 1);
  assert.equal(onlyFirst.result.pendingInvitation, 0);
  assert.equal(onlyFirst.result.status, 'partial');

  const none = await runScenario(['99999999999@lid']);
  assert.equal(none.result.addedDirectly, 0);
  assert.equal(none.result.status, 'created_without_participants');

  const both = await runScenario(['59179903823@c.us', '59170000001@c.us']);
  assert.equal(both.result.addedDirectly, 2);
  assert.equal(both.result.pendingInvitation, 0);
  assert.equal(both.result.status, 'completed');
});

test('conserva codigos internacionales y rechaza numeros locales sin adivinarlos', () => {
  const buffer = excelBuffer([
    ['Nombre', 'Numero'],
    ['Bolivia', '59179903823'],
    ['Peru', '51999999999'],
    ['Chile', '56912345678'],
    ['Argentina', '549112345678'],
    ['Local', '79903823']
  ]);
  const parsed = parseExcelParticipants(buffer);
  assert.deepEqual(parsed.participants.map((item) => item.number), [
    '59179903823', '51999999999', '56912345678', '549112345678', '79903823'
  ]);
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.errors[0].numero, undefined);
});

test('conserva identificadores internos como fila invalida para no perderla', () => {
  const parsed = parseExcelParticipants(excelBuffer([['Numero'], ['59179903823@c.us']]));
  assert.equal(parsed.participants[0].invalid, true);
  assert.equal(parsed.participants[0].originalIndex, 1);
});

test('un pendiente recibe invitacion y un agregado real no la recibe', async () => {
  const buffer = excelBuffer([
    ['Nombre', 'Numero'],
    ['Wilson', '59179903823'],
    ['Juan', '51999999999']
  ]);
  const sentPayloads = [];
  const chat = {
    id: { _serialized: '1@g.us' },
    participants: [{ id: { _serialized: '59179903823@c.us' } }],
    addParticipants: async () => ({
      '59179903823@c.us': { code: 200 },
      '51999999999@c.us': { code: 200 }
    }),
    getInviteCode: async () => 'invite-code'
  };
  const whatsappService = {
    client: {
      getNumberId: async (number) => ({ _serialized: `${number}@c.us` }),
      createGroup: async () => ({ gid: { _serialized: '1@g.us' } }),
      getChatById: async () => chat
    },
    ensureReady() {},
    sendToContacts: async (payload) => {
      sentPayloads.push(payload);
      return [{ status: 'success', number: '51999999999@c.us' }];
    }
  };
  const result = await new WhatsAppGroupImportService({ whatsappService }).process(buffer, 'Grupo internacional');
  assert.equal(result.addedDirectly, 1);
  assert.equal(result.pendingInvitation, 0);
  assert.equal(result.invitationsSent, 1);
  assert.equal(result.invitationsFailed, 0);
  assert.deepEqual(sentPayloads.map((payload) => payload.numbers), ['51999999999']);
  assert.equal(result.participants.find((item) => item.number === '59179903823').invitation, 'No requerida');
  assert.equal(result.participants.find((item) => item.number === '51999999999').invitation, 'Enviada');
});

test('un pendiente con error de envio queda como invitacion fallida', async () => {
  const chat = {
    id: { _serialized: '1@g.us' },
    participants: [{ id: { _serialized: '99999999999@c.us' } }],
    addParticipants: async () => ({ '59179903823@c.us': { code: 200 } }),
    getInviteCode: async () => 'invite-code'
  };
  const whatsappService = {
    client: {
      getNumberId: async () => ({ _serialized: '59179903823@c.us' }),
      createGroup: async () => ({ gid: { _serialized: '1@g.us' } }),
      getChatById: async () => chat
    },
    ensureReady() {},
    sendToContacts: async () => { throw new Error('fallo de envio controlado'); }
  };
  const result = await new WhatsAppGroupImportService({ whatsappService }).process(
    excelBuffer([['Nombre', 'Numero'], ['Wilson', '59179903823']]),
    'Grupo con fallo'
  );
  assert.equal(result.pendingInvitation, 0);
  assert.equal(result.invitationsSent, 0);
  assert.equal(result.invitationsFailed, 1);
  assert.equal(result.participants[0].status, 'invitation_failed');
  assert.equal(result.participants[0].invitationStatus, 'failed');
  assert.equal(result.participants[0].invitation, 'Fallida');
  assert.match(result.participants[0].detail, /fallo de envio controlado/);
});

test('conserva el LID real y lo entrega a createGroup', async () => {
  const calls = [];
  const chat = {
    id: { _serialized: '1@g.us' },
    participants: [{ id: { _serialized: '242652901564623@lid' } }],
    addParticipants: async (ids) => {
      calls.push(ids);
      return { '59179903823@c.us': { code: 200, message: 'ok', isInviteV4Sent: false } };
    },
    getInviteCode: async () => 'invite-code'
  };
  const whatsappService = {
    client: {
      getNumberId: async () => ({ _serialized: '242652901564623@lid', user: '242652901564623', server: 'lid' }),
      createGroup: async (name, participants) => {
        calls.push([name, participants]);
        return { gid: { _serialized: '1@g.us' } };
      },
      getChatById: async () => chat
    },
    ensureReady() {},
    sendToContacts: async () => []
  };
  const result = await new WhatsAppGroupImportService({ whatsappService }).process(
    excelBuffer([['Nombre', 'Numero'], ['Wilson', '59179903823']]),
    'Grupo LID'
  );
  assert.deepEqual(calls, [['Grupo LID', ['242652901564623@lid']]]);
  assert.equal(result.diagnostics.participants[0].getNumberId.serialized, '242652901564623@lid');
  assert.equal(result.diagnostics.participants[0].comparison, 'agregado_realmente');
  assert.equal(result.addedDirectly, 1);
  assert.equal(result.pendingInvitation, 0);
});

test('LID elegible no agregado queda pendiente y recibe invitacion', async () => {
  let inviteCalls = 0;
  const chat = {
    id: { _serialized: '1@g.us' },
    participants: [{ id: { _serialized: '99999999999@c.us' } }],
    getInviteCode: async () => 'invite-code'
  };
  const whatsappService = {
    client: {
      getNumberId: async () => ({ _serialized: '242652901564623@lid', user: '242652901564623', server: 'lid' }),
      createGroup: async () => ({ gid: { _serialized: '1@g.us' } }),
      getChatById: async () => chat
    },
    ensureReady() {},
    sendToContacts: async () => {
      inviteCalls += 1;
      return [{ status: 'success', number: '59179903823@c.us' }];
    }
  };
  const result = await new WhatsAppGroupImportService({ whatsappService }).process(
    excelBuffer([['Nombre', 'Numero'], ['Wilson', '59179903823']]),
    'Grupo LID pendiente'
  );
  assert.equal(result.addedDirectly, 0);
  assert.equal(result.pendingInvitation, 0);
  assert.equal(result.invitationsSent, 1);
  assert.equal(inviteCalls, 1);
  assert.equal(result.participants[0].status, 'invitation_sent');
  assert.equal(result.participants[0].invitationStatus, 'sent');
  assert.equal(result.participants[0].invitation, 'Enviada');
  assert.equal(result.diagnostics.participants[0].getNumberId.server, 'lid');
  assert.equal(result.diagnostics.participants[0].addParticipants.called, false);
});

test('conserva confirmacion de createGroup cuando el chat no se materializa', async () => {
  let createCalls = 0;
  const whatsappService = {
    client: {
      getNumberId: async () => ({ _serialized: '59179903823@c.us' }),
      createGroup: async () => {
        createCalls += 1;
        return {
          title: 'Grupo confirmado',
          gid: { _serialized: '1@g.us' },
          participants: {
            '59179903823@c.us': {
              statusCode: 200,
              message: 'The participant was added successfully',
              isGroupCreator: false,
              isInviteV4Sent: false
            }
          }
        };
      },
      getChatById: async () => undefined
    },
    ensureReady() {},
    sleep: async () => {}
  };
  const result = await new WhatsAppGroupImportService({ whatsappService }).process(
    excelBuffer([['Numero'], ['59179903823']]),
    'Grupo confirmado'
  );
  assert.equal(createCalls, 1);
  assert.equal(result.groupCreated, true);
  assert.equal(result.creationAddConfirmed, 1);
  assert.equal(result.addedDirectly, 1);
  assert.equal(result.participants[0].status, 'added');
  assert.equal(result.participants[0].statusSource, 'createGroup');
  assert.equal(result.pendingInvitation, 0);
  assert.equal(result.status, 'created_pending_confirmation');
  assert.deepEqual(result.diagnostics.confirmation, {
    source: 'createGroup',
    status: 'confirmed_during_creation',
    postCreationChatAvailable: false
  });
  assert.equal(result.diagnostics.participants[0].creationResult.statusCode, 200);
});

test('reintenta getChatById sin repetir createGroup', async () => {
  let lookups = 0;
  let createCalls = 0;
  const chat = {
    id: { _serialized: '1@g.us' },
    participants: [{ id: { _serialized: '59179903823@c.us' } }],
    getInviteCode: async () => 'invite-code'
  };
  const whatsappService = {
    client: {
      getNumberId: async () => ({ _serialized: '59179903823@c.us' }),
      createGroup: async () => {
        createCalls += 1;
        return { gid: { _serialized: '1@g.us' } };
      },
      getChatById: async () => {
        lookups += 1;
        return lookups === 1 ? undefined : chat;
      }
    },
    ensureReady() {},
    sleep: async () => {},
    sendToContacts: async () => []
  };
  const result = await new WhatsAppGroupImportService({ whatsappService }).process(
    excelBuffer([['Numero'], ['59179903823']]),
    'Grupo con reintento'
  );
  assert.equal(createCalls, 1);
  assert.equal(lookups, 3);
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.diagnostics.groupLookup.map((item) => item.found), [false, true]);
});

test('devuelve group_lookup_failed si el chat no aparece', async () => {
  let createCalls = 0;
  let lookups = 0;
  const whatsappService = {
    client: {
      getNumberId: async () => ({ _serialized: '59179903823@c.us' }),
      createGroup: async () => {
        createCalls += 1;
        return { gid: { _serialized: '1@g.us' } };
      },
      getChatById: async () => {
        lookups += 1;
        return undefined;
      }
    },
    ensureReady() {},
    sleep: async () => {}
  };
  const result = await new WhatsAppGroupImportService({ whatsappService }).process(
    excelBuffer([['Numero'], ['59179903823']]),
    'Grupo no disponible'
  );
  assert.equal(createCalls, 1);
  assert.equal(lookups, 3);
  assert.equal(result.status, 'group_lookup_failed');
  assert.equal(result.groupCreated, true);
  assert.equal(result.pendingInvitation, 0);
  assert.equal(result.inviteLink, null);
});

test('createGroup confirmado sin GroupChat produce added y no invita', async () => {
  let invitations = 0;
  const whatsappService = {
    client: {
      getNumberId: async () => ({ _serialized: '59179903823@c.us' }),
      createGroup: async () => ({
        gid: { _serialized: '1@g.us' },
        participants: {
          '59179903823@c.us': { statusCode: 200, message: 'The participant was added successfully' }
        }
      }),
      getChatById: async () => ({ id: { _serialized: '1@g.us' }, participants: [] })
    },
    ensureReady() {},
    sleep: async () => {},
    sendToContacts: async () => { invitations += 1; return []; }
  };
  const result = await new WhatsAppGroupImportService({ whatsappService }).process(
    excelBuffer([['Nombre', 'Numero'], ['Wilson', '59179903823']]),
    'Grupo confirmado'
  );
  assert.equal(result.participants[0].status, 'added');
  assert.equal(result.participants[0].statusSource, 'createGroup');
  assert.equal(result.addedDirectly, 1);
  assert.equal(invitations, 0);
});

test('GroupChat valido ausente con confirmacion de createGroup requiere verificacion', async () => {
  const whatsappService = {
    client: {
      getNumberId: async () => ({ _serialized: '59179903823@c.us' }),
      createGroup: async () => ({
        gid: { _serialized: '1@g.us' },
        participants: {
          '59179903823@c.us': { statusCode: 200, message: 'The participant was added successfully' }
        }
      }),
      getChatById: async () => ({ id: { _serialized: '1@g.us' }, participants: [{ id: { _serialized: '99999999999@c.us' } }] })
    },
    ensureReady() {},
    sleep: async () => {}
  };
  const result = await new WhatsAppGroupImportService({ whatsappService }).process(
    excelBuffer([['Numero'], ['59179903823']]),
    'Grupo contradictorio'
  );
  assert.equal(result.participants[0].status, 'unknown');
  assert.equal(result.participants[0].detail, 'Estado requiere verificacion');
  assert.equal(result.pendingInvitation, 0);
});

test('conserva originalIndex y exporta resultados en orden de entrada', async () => {
  const parsed = parseExcelParticipants(excelBuffer([
    ['Nombre', 'Numero'],
    ['Wilson', '59179903823'],
    ['Juan', '51987654321'],
    ['Wilson repetido', '59179903823'],
    ['Pedro', '56912345678']
  ]));
  assert.deepEqual(parsed.participants.map((item) => item.originalIndex), [1, 2, 4]);

  const outputPath = require('node:path').join(process.cwd(), 'test-group-import-results.xlsx');
  await FileService.exportGroupImportResults(
    { showSaveDialog: async () => ({ canceled: false, filePath: outputPath }) },
    null,
    {
      groupName: 'Orden',
      participants: [
        { originalIndex: 4, name: 'Pedro', number: '56912345678', status: 'pending', invitation: 'Pendiente' },
        { originalIndex: 1, name: 'Wilson', number: '59179903823', status: 'added', invitation: 'No requerida' },
        { originalIndex: 2, name: 'Juan', number: '51987654321', status: 'unknown', invitation: 'No procesada' }
      ]
    }
  );
  const rows = XLSX.utils.sheet_to_json(XLSX.readFile(outputPath).Sheets.Resultados, { header: 1 });
  fs.unlinkSync(outputPath);
  assert.deepEqual(rows.slice(1).map((row) => row[0]), ['Wilson', 'Juan', 'Pedro']);
});

test('reconcilia 109 originales contra 103 participantes reales sin perder filas', async () => {
  const originalRows = [['Nombre', 'Numero']];
  const numbers = Array.from({ length: 109 }, (_value, index) => `591700${String(index).padStart(5, '0')}`);
  numbers.forEach((number, index) => originalRows.push([`Persona ${index + 1}`, number]));
  const actualParticipants = numbers.slice(0, 103).reverse().map((number) => ({ id: { _serialized: `${number}@c.us` } }));
  const chat = { id: { _serialized: '1@g.us' }, participants: actualParticipants };
  const whatsappService = {
    client: {
      getNumberId: async (number) => ({ _serialized: `${number}@c.us` }),
      createGroup: async () => ({ gid: { _serialized: '1@g.us' } }),
      getChatById: async () => chat
    },
    ensureReady() {},
    sleep: async () => {}
  };
  const result = await new WhatsAppGroupImportService({ whatsappService }).process(excelBuffer(originalRows), 'Grupo 109');
  assert.equal(result.participants.length, 109);
  assert.equal(result.totalParticipants, 109);
  assert.equal(result.reconciliation.originalCount, 109);
  assert.equal(result.reconciliation.actualWhatsAppCount, 103);
  assert.equal(result.reconciliation.addedCount, 103);
  assert.equal(result.reconciliation.pendingCount, 6);
  assert.equal(result.reconciliation.missingCount, 6);
  assert.equal(result.reconciliation.isConsistent, true);
  assert.deepEqual(result.missingParticipants.map((item) => item.originalIndex), [104, 105, 106, 107, 108, 109]);
  assert.deepEqual(result.participants.map((item) => item.originalIndex), numbers.map((_number, index) => index + 1));
});
