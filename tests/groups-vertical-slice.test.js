const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const groupRules = require('../src/features/groups/domain/group-rules');
const {
  filterAndDecorateGroups,
  prepareGroupExportOptions
} = require('../src/features/groups/application/normalize-groups');
const {
  toggleGroupSelection,
  removeGroupSelection,
  clearAllSelectedGroups,
  syncExportSelectionState
} = require('../src/features/groups/application/select-groups');
const {
  GroupsIpcGateway
} = require('../src/features/groups/infrastructure/groups-ipc-gateway');
const {
  GroupsController
} = require('../src/features/groups/presentation/groups-controller');
const groupActions = require('../src/renderer/js/modules/app/groups');

// ==========================================
// 1. DOMAIN: GROUP-RULES
// ==========================================
test('Domain Groups: getGroupName obtiene nombres legibles y provee fallback', () => {
  assert.equal(groupRules.getGroupName({ name: 'Comunidad Dev' }), 'Comunidad Dev');
  assert.equal(groupRules.getGroupName({ title: 'Ventas La Paz' }), 'Ventas La Paz');
  assert.equal(groupRules.getGroupName({ formattedTitle: 'Clientes VIP' }), 'Clientes VIP');
  assert.equal(groupRules.getGroupName(null), 'Grupo sin nombre');
  assert.equal(groupRules.getGroupName({}), 'Grupo sin nombre');
  assert.equal(groupRules.getGroupName({ name: '   ' }), 'Grupo sin nombre');
});

test('Domain Groups: getGroupId extrae el ID limpio en strings y objetos', () => {
  assert.equal(groupRules.getGroupId('12036302@g.us'), '12036302@g.us');
  assert.equal(groupRules.getGroupId({ id: '12036302@g.us' }), '12036302@g.us');
  assert.equal(groupRules.getGroupId(null), '');
});

test('Domain Groups: isValidGroup valida objetos de grupo', () => {
  assert.equal(groupRules.isValidGroup({ id: '12036302@g.us', name: 'Devs' }), true);
  assert.equal(groupRules.isValidGroup({ id: '' }), false);
  assert.equal(groupRules.isValidGroup(null), false);
  assert.equal(groupRules.isValidGroup('solo-string'), false);
});

test('Domain Groups: matchesGroupSearch evalúa coincidencia insensible a mayúsculas', () => {
  const group = { id: 'g1@g.us', name: 'Equipo de Operaciones' };
  assert.equal(groupRules.matchesGroupSearch(group, 'equipo'), true);
  assert.equal(groupRules.matchesGroupSearch(group, 'OPERACIONES'), true);
  assert.equal(groupRules.matchesGroupSearch(group, 'marketing'), false);
  assert.equal(groupRules.matchesGroupSearch(group, ''), true);
});

test('Domain Groups: sortGroupsByName ordena alfabéticamente sin mutar', () => {
  const groups = [
    { id: '1', name: 'Zulma Team' },
    { id: '2', name: 'Alpha Group' },
    { id: '3', name: 'Beta Community' }
  ];

  const sorted = groupRules.sortGroupsByName(groups);
  assert.equal(sorted[0].name, 'Alpha Group');
  assert.equal(sorted[1].name, 'Beta Community');
  assert.equal(sorted[2].name, 'Zulma Team');
  assert.equal(groups[0].name, 'Zulma Team', 'El arreglo original no debe mutarse');
});

test('Domain Groups: deduplicateGroups elimina duplicados por ID preservando orden', () => {
  const groups = [
    { id: 'g1', name: 'Original' },
    { id: 'g1', name: 'Duplicado' },
    { id: 'g2', name: 'Segundo' },
    { id: 'g2', name: 'Segundo Duplicado' }
  ];

  const deduped = groupRules.deduplicateGroups(groups);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].name, 'Original');
  assert.equal(deduped[1].name, 'Segundo');
});

test('Domain Groups: resolveExportGroupSelection sincroniza la selección de exportación', () => {
  // Cuando se selecciona un grupo, pasa a ser el objetivo de exportación
  const s1 = groupRules.resolveExportGroupSelection('', { groupId: 'g1', isSelected: true });
  assert.equal(s1, 'g1');

  // Cuando se deselecciona el que estaba activo, retrocede al primer seleccionado disponible
  const s2 = groupRules.resolveExportGroupSelection('g1', {
    groupId: 'g1',
    isSelected: false,
    selectedIds: ['g2', 'g3']
  });
  assert.equal(s2, 'g2');

  // Cuando no quedan más seleccionados, queda vacío
  const s3 = groupRules.resolveExportGroupSelection('g1', {
    groupId: 'g1',
    isSelected: false,
    selectedIds: []
  });
  assert.equal(s3, '');
});

// ==========================================
// 2. APPLICATION: NORMALIZE & SELECT
// ==========================================
test('Application Groups: filterAndDecorateGroups filtra y decora el estado de envío diario', () => {
  const groups = [
    { id: 'g1@g.us', name: 'Ventas Santa Cruz' },
    { id: 'g2@g.us', name: 'Soporte Técnico' }
  ];

  const statusMock = (id) => (id === 'g1@g.us' ? { sentToday: true, lastSentAt: '2026-08-30T00:00:00.000Z' } : { sentToday: false, lastSentAt: null });

  const result = filterAndDecorateGroups({
    groups,
    searchTerm: 'ventas',
    getDestinationStatusFn: statusMock
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Ventas Santa Cruz');
  assert.equal(result[0].sentToday, true);
  assert.equal(result[0].lastSentAt, '2026-08-30T00:00:00.000Z');
});

test('Application Groups: prepareGroupExportOptions genera opciones para el select', () => {
  const groups = [
    { id: 'g1', name: 'Grupo A' },
    { id: 'g2', name: 'Grupo B' }
  ];

  const options = prepareGroupExportOptions(groups, 'g2');
  assert.equal(options.length, 2);
  assert.equal(options[0].isSelected, false);
  assert.equal(options[1].isSelected, true);
  assert.equal(options[1].value, 'g2');
});

test('Application Groups: toggleGroupSelection alterna selección y detecta estado', () => {
  // Agregar
  const step1 = toggleGroupSelection([], 'g1');
  assert.equal(step1.isSelected, true);
  assert.deepEqual(step1.selectedIds, ['g1']);

  // Quitar
  const step2 = toggleGroupSelection(step1.selectedIds, 'g1');
  assert.equal(step2.isSelected, false);
  assert.deepEqual(step2.selectedIds, []);
});

test('Application Groups: removeGroupSelection y clearAllSelectedGroups', () => {
  const selected = ['g1', 'g2', 'g3'];
  const afterRemove = removeGroupSelection(selected, 'g2');
  assert.deepEqual(afterRemove, ['g1', 'g3']);

  const cleared = clearAllSelectedGroups();
  assert.deepEqual(cleared, []);
});

test('Application Groups: syncExportSelectionState delega correctamente a domain rules', () => {
  const next = syncExportSelectionState('g1', { groupId: 'g2', isSelected: true });
  assert.equal(next, 'g2');
});

// ==========================================
// 3. INFRASTRUCTURE: GROUPS-IPC-GATEWAY
// ==========================================
test('Infrastructure Groups IPC Gateway: canaliza llamadas get-groups, get-group-members y export-group-members', async () => {
  const calls = [];
  const mockIpcClient = {
    invoke: async (channel, ...args) => {
      calls.push({ channel, args });
      if (channel === 'get-groups') {
        return { success: true, groups: [{ id: 'g1', name: 'Grupo 1' }] };
      }
      if (channel === 'get-group-members') {
        return { success: true, group: { groupId: 'g1', members: ['5917001'] } };
      }
      if (channel === 'export-group-members') {
        return { success: true, canceled: false, result: { filePath: 'test.xlsx', total: 10 } };
      }
      return null;
    }
  };

  const gateway = new GroupsIpcGateway(mockIpcClient);

  const getRes = await gateway.getGroups();
  assert.equal(getRes.success, true);
  assert.equal(calls[0].channel, 'get-groups');

  const membersRes = await gateway.getGroupMembers('g1');
  assert.equal(membersRes.success, true);
  assert.equal(calls[1].channel, 'get-group-members');

  const exportRes = await gateway.exportGroupMembers({ groupId: 'g1', format: 'xlsx' });
  assert.equal(exportRes.success, true);
  assert.equal(calls[2].channel, 'export-group-members');
});

// ==========================================
// 4. PRESENTATION: GROUPS-CONTROLLER
// ==========================================
test('Presentation GroupsController: coordina carga, filtrado y sincronización', async () => {
  const stateRef = {
    groups: [],
    groupSearchTerm: '',
    exportGroupId: '',
    ui: {
      renderGroups: () => {},
      renderGroupExportOptions: () => {}
    }
  };

  const mockIpc = {
    invoke: async (channel) => {
      if (channel === 'get-groups') {
        return {
          success: true,
          groups: [
            { id: 'g1', name: 'Equipo Ventas' },
            { id: 'g2', name: 'Equipo Soporte' }
          ]
        };
      }
      return null;
    }
  };

  const controller = new GroupsController({
    stateRef,
    ipcClient: mockIpc
  });

  await controller.loadGroups();
  assert.equal(controller.groups.length, 2);
  assert.equal(stateRef.groups.length, 2, 'stateRef.groups debe sincronizarse');

  controller.searchTerm = 'ventas';
  controller.applyGroupFilter();
  assert.equal(controller.filteredGroups.length, 1);
  assert.equal(controller.filteredGroups[0].name, 'Equipo Ventas');

  controller.syncExportSelection({ groupId: 'g1', isSelected: true });
  assert.equal(controller.exportGroupId, 'g1');
  assert.equal(stateRef.exportGroupId, 'g1');
});

// ==========================================
// 5. REGRESIÓN ARQUITECTÓNICA
// ==========================================
test('Arquitectura Groups: group-rules.js NO contiene referencias a DOM, Electron ni IPC', () => {
  const code = fs.readFileSync(
    path.resolve(__dirname, '../src/features/groups/domain/group-rules.js'),
    'utf8'
  );

  assert.ok(!code.includes('document.'), 'No debe referenciar document');
  assert.ok(!code.includes('window.'), 'No debe referenciar window');
  assert.ok(!code.includes("require('electron')"), 'No debe importar electron');
  assert.ok(!code.includes('ipcRenderer'), 'No debe referenciar ipcRenderer');
  assert.ok(!code.includes('AppController'), 'No debe referenciar AppController');
});

test('Arquitectura Groups: normalize-groups.js y select-groups.js son independientes del DOM', () => {
  const codeNorm = fs.readFileSync(
    path.resolve(__dirname, '../src/features/groups/application/normalize-groups.js'),
    'utf8'
  );
  const codeSelect = fs.readFileSync(
    path.resolve(__dirname, '../src/features/groups/application/select-groups.js'),
    'utf8'
  );

  assert.ok(!codeNorm.includes('document.'), 'normalize-groups no debe referenciar document');
  assert.ok(!codeNorm.includes('window.'), 'normalize-groups no debe referenciar window');
  assert.ok(!codeSelect.includes('document.'), 'select-groups no debe referenciar document');
  assert.ok(!codeSelect.includes('window.'), 'select-groups no debe referenciar window');
});

test('Arquitectura Groups: groups.js actúa como fachada delgada (< 100 líneas)', () => {
  const code = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/js/modules/app/groups.js'),
    'utf8'
  );

  const lines = code.split('\n').length;
  assert.ok(lines < 100, `groups.js debe tener menos de 100 líneas, tiene ${lines}`);
  assert.ok(code.includes('GroupsController'), 'groups.js debe delegar en GroupsController');
});

test('Compatibilidad Groups: groups.js exporta todas las funciones públicas esperadas', () => {
  assert.equal(typeof groupActions.applyGroupFilter, 'function');
  assert.equal(typeof groupActions.syncExportSelectionWithGroup, 'function');
  assert.equal(typeof groupActions.loadGroups, 'function');
  assert.equal(typeof groupActions.exportGroupMembers, 'function');
});
