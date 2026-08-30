const { parseExcelParticipants } = require('../utils/excel-group-parser');

const INVITE_MESSAGE = 'Hola, te compartimos el enlace para que puedas unirte al grupo:\n\n{inviteLink}\n\nTe esperamos.';

function participantNumber(id) {
  const serialized = id && id.id && id.id._serialized ? id.id._serialized : (id && id._serialized ? id._serialized : id || '');
  const value = String(serialized);
  if (value.includes('@') && !value.endsWith('@c.us')) {
    return '';
  }
  return value.replace(/@c\.us$/, '').replace(/[^0-9]/g, '');
}

function participantId(id) {
  const serialized = id && id.id && id.id._serialized ? id.id._serialized : (id && id._serialized ? id._serialized : id || '');
  return String(serialized).trim();
}

function diagnosticParticipantId(id) {
  const serialized = participantId(id);
  return {
    serialized,
    user: id && id.id && id.id.user !== undefined ? id.id.user : (id && id.user !== undefined ? id.user : null),
    server: id && id.id && id.id.server !== undefined ? id.id.server : (id && id.server !== undefined ? id.server : null)
  };
}

function diagnosticParticipants(participants) {
  return (Array.isArray(participants) ? participants : []).map(diagnosticParticipantId);
}

function resultNumber(result) {
  return String(result && (result.number || result.label) || '').replace(/@.*$/, '').replace(/[^0-9]/g, '');
}

function resultGroupId(result) {
  const gid = result && result.gid;
  return gid && gid._serialized ? gid._serialized : String(gid || '');
}

function creationParticipantEntries(result) {
  const participants = result && result.participants;
  if (!participants || typeof participants !== 'object') {
    return [];
  }
  return Object.entries(participants).map(([id, data]) => ({ id, data: data || {} }));
}

function isCreationAddConfirmed(data) {
  return Number(data && data.statusCode) === 200
    && /participant was added successfully/i.test(String(data && data.message || ''));
}

function isValidGroupChat(chat) {
  return Boolean(chat && chat.id && chat.id._serialized && chat.isGroup !== false && Array.isArray(chat.participants)
    && chat.participants.length > 0);
}

function updateReconciliation(outcome, actualWhatsAppCount = null) {
  const counts = outcome.participants.reduce((result, participant) => {
    result[participant.status] = (result[participant.status] || 0) + 1;
    return result;
  }, {});
  const missingParticipants = outcome.participants
    .filter((participant) => participant.status !== 'added' && participant.status !== 'invalid')
    .map((participant) => ({
      originalIndex: participant.originalIndex,
      originalRow: participant.originalRow,
      name: participant.name,
      phone: participant.number,
      status: participant.status
    }));
  const counted = ['added', 'pending', 'invalid', 'invitation_sent', 'invitation_failed', 'unknown']
    .reduce((total, status) => total + (counts[status] || 0), 0);
  outcome.reconciliation = {
    originalCount: outcome.participants.length,
    actualWhatsAppCount,
    addedCount: counts.added || 0,
    pendingCount: counts.pending || 0,
    invalidCount: counts.invalid || 0,
    invitationSentCount: counts.invitation_sent || 0,
    invitationFailedCount: counts.invitation_failed || 0,
    unknownCount: counts.unknown || 0,
    missingCount: missingParticipants.length,
    isConsistent: counted === outcome.participants.length
  };
  outcome.missingParticipants = missingParticipants;
  outcome.diagnostics.reconciliation = outcome.reconciliation;
  outcome.diagnostics.missingParticipants = missingParticipants;
  if (!outcome.reconciliation.isConsistent) outcome.status = 'reconciliation_error';
}

function normalizedIdNumber(id) {
  const value = String(id || '');
  return value.endsWith('@c.us') ? value.replace(/@c\.us$/, '') : '';
}

async function findGroupWithRetries(whatsappService, groupId, diagnostics, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const chat = await whatsappService.client.getChatById(groupId);
      diagnostics.push({ attempt, found: Boolean(chat), id: chat && chat.id && chat.id._serialized ? chat.id._serialized : null });
      if (chat) {
        return chat;
      }
    } catch (error) {
      diagnostics.push({ attempt, found: false, error: error.message || String(error) });
    }

    if (attempt < maxAttempts) {
      await whatsappService.sleep(2500);
    }
  }

  return null;
}

class WhatsAppGroupImportService {
  constructor({ whatsappService }) {
    this.whatsappService = whatsappService;
  }

  async process(buffer, groupName) {
    const safeGroupName = String(groupName || '').trim();
    if (!safeGroupName) {
      throw new Error('Debes indicar el nombre del grupo');
    }

    const parsed = parseExcelParticipants(buffer);
    const outcome = {
      groupName: safeGroupName,
      totalParticipants: parsed.participants.length,
        reconciliation: null,
        missingParticipants: [],
      addedDirectly: 0,
      pendingInvitation: 0,
      invitationsSent: 0,
      invitationsFailed: 0,
      inviteLink: null,
      groupCreated: false,
      creationAddConfirmed: 0,
      confirmationSource: null,
      status: 'validation_error',
      pendingParticipants: [],
      participants: parsed.participants.map((participant) => ({
        originalIndex: participant.originalIndex,
        originalRow: participant.originalRow,
        name: participant.name,
        number: participant.number,
        eligible: false,
        creationAddConfirmed: false,
        presentInGroup: false,
        status: participant.invalid ? 'invalid' : 'unknown',
        statusSource: participant.invalid ? 'parser' : 'none',
        invitationStatus: 'not_sent',
        invitation: participant.invalid ? 'No enviada' : 'No procesada',
        detail: participant.invalid ? 'Numero invalido' : ''
      })),
      diagnostics: {
        groupName: safeGroupName,
        createGroup: { called: false, argument: safeGroupName, participantsArgument: [], result: null, groupId: null },
        groupAfterCreate: { id: null, name: null, isGroup: null, participants: [] },
        groupLookup: [],
        confirmation: { source: null, status: 'not_confirmed', postCreationChatAvailable: false },
        participants: parsed.participants.map((participant) => ({
          name: participant.name,
          number: participant.number,
          normalizedNumber: participant.number,
          getNumberId: { available: false, found: false, serialized: null, user: null, server: null },
          isRegisteredUser: { available: false, value: null },
          addParticipants: null,
          participantsAfterAdd: [],
          participantsAfterRefresh: [],
          comparison: 'no_elegible',
          inviteCode: { attempted: false, success: false, available: false },
          privateInvitation: { status: 'no_procesada', error: null }
        })),
        eligibleParticipants: 0,
        addedDirectly: 0,
        pendingInvitation: 0,
        invitationsSent: 0,
        invitationsFailed: 0
      },
      errors: parsed.errors.slice()
    };
    this.whatsappService.ensureReady();

    const eligibleParticipants = [];
    for (const participant of parsed.participants) {
      if (participant.invalid) continue;
      try {
        let registeredId = null;
        if (typeof this.whatsappService.client.getNumberId === 'function') {
          const diagnostic = outcome.diagnostics.participants.find((item) => item.number === participant.number);
          diagnostic.getNumberId.available = true;
          const numberId = await this.whatsappService.client.getNumberId(participant.number);
          registeredId = numberId && numberId._serialized ? numberId._serialized : null;
          diagnostic.getNumberId.found = Boolean(numberId);
          diagnostic.getNumberId.serialized = numberId && numberId._serialized ? numberId._serialized : null;
          diagnostic.getNumberId.user = numberId && numberId.user !== undefined ? numberId.user : null;
          diagnostic.getNumberId.server = numberId && numberId.server !== undefined ? numberId.server : null;
        }

        if (!registeredId && typeof this.whatsappService.client.isRegisteredUser === 'function') {
          const diagnostic = outcome.diagnostics.participants.find((item) => item.number === participant.number);
          diagnostic.isRegisteredUser.available = true;
          const registered = await this.whatsappService.client.isRegisteredUser(`${participant.number}@c.us`);
          diagnostic.isRegisteredUser.value = registered;
          if (registered) {
            registeredId = `${participant.number}@c.us`;
          }
        }

        if (registeredId) {
          const isLid = registeredId.endsWith('@lid');
          eligibleParticipants.push({
            ...participant,
            whatsappId: registeredId,
            addParticipantId: isLid ? participant.number : registeredId,
            eligible: true
          });
          outcome.participants = outcome.participants.map((item) => item.number === participant.number
            ? { ...item, eligible: true }
            : item);
          outcome.diagnostics.eligibleParticipants += 1;
          outcome.diagnostics.participants.find((item) => item.number === participant.number).comparison = 'elegible';
          continue;
        }

        outcome.errors.push({ grupo: safeGroupName, numero: participant.number, etapa: 'prevalidacion', error: 'Numero no registrado o no elegible en WhatsApp' });
        outcome.participants = outcome.participants.map((item) => item.number === participant.number
          ? { ...item, eligible: false, status: 'invalid', statusSource: 'eligibility', invitationStatus: 'not_sent', invitation: 'No enviada', detail: 'No registrado o no elegible' }
          : item);
      } catch (error) {
        outcome.errors.push({ grupo: safeGroupName, numero: participant.number, etapa: 'prevalidacion', error: error.message || 'Numero no verificable' });
        outcome.participants = outcome.participants.map((item) => item.number === participant.number
          ? { ...item, eligible: false, status: 'unknown', statusSource: 'eligibility', invitationStatus: 'not_sent', invitation: 'No enviada', detail: 'No se pudo verificar el numero' }
          : item);
      }
    }

    if (eligibleParticipants.length === 0) {
        updateReconciliation(outcome);
      outcome.errors.push({ grupo: safeGroupName, etapa: 'validacion', error: 'No existen participantes elegibles; no se creo el grupo' });
      return outcome;
    }

    let chat;
    try {
      const participantsArgument = eligibleParticipants.map((participant) => participant.whatsappId);
      const created = await this.whatsappService.client.createGroup(safeGroupName, participantsArgument);
      const creationEntries = creationParticipantEntries(created);
      const creationConfirmedNumbers = new Set(
        creationEntries
          .filter(({ data }) => Number(data.statusCode) === 200 && data.isGroupCreator !== true)
                    .filter(({ data }) => data.isGroupCreator !== true && isCreationAddConfirmed(data))
          .map(({ id }) => normalizedIdNumber(id))
          .filter(Boolean)
      );
      outcome.creationAddConfirmed = eligibleParticipants.filter((participant) => creationConfirmedNumbers.has(participant.number)).length;
      outcome.groupCreated = true;
      outcome.status = 'created_pending_confirmation';
      outcome.diagnostics.participants.forEach((diagnostic) => {
        const creationEntry = creationEntries.find(({ id }) => normalizedIdNumber(id) === diagnostic.number);
        diagnostic.creationResult = creationEntry ? creationEntry.data : null;
        diagnostic.creationAddConfirmed = creationConfirmedNumbers.has(diagnostic.number);
      });
      outcome.participants = outcome.participants.map((participant) => ({
        ...participant,
        creationAddConfirmed: creationConfirmedNumbers.has(participant.number)
      }));
      outcome.diagnostics.createGroup = {
        called: true,
        argument: safeGroupName,
        participantsArgument,
        result: created || null,
        groupId: resultGroupId(created) || null
      };
      const groupId = resultGroupId(created);
      if (!groupId) throw new Error('La API no devolvio el identificador del grupo');
      chat = await findGroupWithRetries(this.whatsappService, groupId, outcome.diagnostics.groupLookup);
      if (!isValidGroupChat(chat)) {
        chat = null;
        outcome.status = 'group_lookup_failed';
        if (outcome.creationAddConfirmed > 0) {
          outcome.status = 'created_pending_confirmation';
          outcome.confirmationSource = 'createGroup';
          outcome.diagnostics.confirmation = { source: 'createGroup', status: 'confirmed_during_creation', postCreationChatAvailable: false };
        }
        outcome.addedDirectly = outcome.creationAddConfirmed;
        outcome.diagnostics.addedDirectly = outcome.addedDirectly;
        outcome.participants = outcome.participants.map((participant) => {
            updateReconciliation(outcome);
          if (!participant.eligible) return participant;
          const added = Boolean(participant.creationAddConfirmed);
          return {
            ...participant,
            status: added ? 'added' : 'unknown',
            statusSource: added ? 'createGroup' : 'none',
            presentInGroup: false,
            invitationStatus: 'not_applicable',
            invitation: added ? 'No requerida' : 'No procesada',
            detail: added ? 'Confirmado durante creacion' : 'Estado no confirmado'
          };
        });
        outcome.errors.push({ grupo: safeGroupName, etapa: 'consulta_grupo', error: 'El grupo fue creado, pero no pudo obtenerse un GroupChat verificable despues de 3 intentos' });
        return outcome;
      }
      outcome.diagnostics.groupAfterCreate = {
        id: chat.id && chat.id._serialized ? chat.id._serialized : null,
        name: chat.name || null,
        isGroup: chat.isGroup === undefined ? null : Boolean(chat.isGroup),
        participants: diagnosticParticipants(chat.participants)
      };
      outcome.confirmationSource = 'chat.participants';
      outcome.diagnostics.confirmation = { source: 'chat.participants', status: 'pending_post_creation_confirmation', postCreationChatAvailable: true };
    } catch (error) {
      outcome.errors.push({ grupo: safeGroupName, etapa: 'creacion', error: error.message || String(error) });
      updateReconciliation(outcome);
      return outcome;
    }

    outcome.diagnostics.participants.forEach((diagnostic) => {
      diagnostic.addParticipants = { called: false, reason: 'Participantes proporcionados a createGroup()' };
      diagnostic.participantsAfterAdd = diagnosticParticipants(chat && chat.participants);
    });

    try {
      const inviteCode = await chat.getInviteCode();
      outcome.inviteLink = `https://chat.whatsapp.com/${inviteCode}`;
      outcome.diagnostics.inviteCode = { attempted: true, success: true, available: Boolean(inviteCode), code: inviteCode || null };
    } catch (error) {
      outcome.diagnostics.inviteCode = { attempted: true, success: false, available: false, code: null, error: error.message || String(error) };
      outcome.errors.push({ grupo: safeGroupName, etapa: 'invite_code', error: error.message || String(error) });
    }

    try {
      const refreshedChat = chat.id && chat.id._serialized
        ? await this.whatsappService.client.getChatById(chat.id._serialized)
        : chat;
      const actualParticipants = Array.isArray(refreshedChat && refreshedChat.participants) ? refreshedChat.participants : [];
      outcome.diagnostics.participantsAfterRefresh = diagnosticParticipants(actualParticipants);
      const actualIds = new Set(actualParticipants.map(participantId).filter(Boolean));
      const actualNumbers = new Set(actualParticipants.map(participantNumber).filter(Boolean));
      const isActuallyPresent = (participant) => {
        const expectedId = String(participant.whatsappId || '').trim();
        return (expectedId && actualIds.has(expectedId)) || actualNumbers.has(participant.number);
      };
      const added = eligibleParticipants.filter(isActuallyPresent);
      const groupChatIsValid = isValidGroupChat(refreshedChat);
      outcome.addedDirectly = added.length;
      outcome.pendingParticipants = eligibleParticipants
        .filter((participant) => !isActuallyPresent(participant))
        .map((participant) => ({ nombre: participant.name, numero: participant.number, groupName: safeGroupName, inviteLink: outcome.inviteLink, reason: 'no_agregado_directamente' }));
      outcome.pendingInvitation = outcome.pendingParticipants.length;
      outcome.diagnostics.addedDirectly = outcome.addedDirectly;
      outcome.diagnostics.pendingInvitation = outcome.pendingInvitation;
      outcome.diagnostics.participants.forEach((diagnostic) => {
        const participant = eligibleParticipants.find((item) => item.number === diagnostic.number);
        if (!participant) return;
        diagnostic.comparison = isActuallyPresent(participant) ? 'agregado_realmente' : 'pendiente';
      });
      if (outcome.addedDirectly === 0) {
        outcome.status = 'created_without_participants';
        outcome.errors.push({ grupo: safeGroupName, etapa: 'verificacion', error: 'El grupo fue creado, pero ningun participante pudo ser agregado' });
      } else if (outcome.pendingInvitation > 0) {
        outcome.status = 'partial';
      } else {
        outcome.status = 'completed';
      }
      outcome.diagnostics.confirmation = { source: 'chat.participants', status: outcome.status, postCreationChatAvailable: true };
      outcome.participants = outcome.participants.map((participant) => {
        if (!participant.eligible) return participant;
        const creationConfirmed = Boolean(participant.creationAddConfirmed);
        const present = isActuallyPresent(eligibleParticipants.find((item) => item.number === participant.number));
        const status = present ? 'added' : (groupChatIsValid ? (creationConfirmed ? 'unknown' : 'pending') : (creationConfirmed ? 'added' : 'unknown'));
        const statusSource = present ? 'chat.participants' : (groupChatIsValid ? (creationConfirmed ? 'contradiction' : 'chat.participants') : (creationConfirmed ? 'createGroup' : 'none'));
        return {
          ...participant,
          presentInGroup: present,
          status,
          statusSource,
          invitationStatus: status === 'pending' ? (outcome.inviteLink ? 'pending' : 'not_available') : 'not_applicable',
          invitation: status === 'added' ? 'No requerida' : status === 'pending' ? (outcome.inviteLink ? 'Pendiente' : 'No disponible') : 'No procesada',
          detail: status === 'added' ? (statusSource === 'createGroup' ? 'Confirmado durante creacion' : 'Agregado directamente')
            : status === 'pending' ? 'No pudo agregarse directamente'
              : status === 'unknown' && statusSource === 'contradiction' ? 'Estado requiere verificacion' : 'Estado no confirmado'
        };
      });
      outcome.pendingParticipants = outcome.participants
        .filter((participant) => participant.status === 'pending')
        .map((participant) => ({ nombre: participant.name, numero: participant.number, groupName: safeGroupName, inviteLink: outcome.inviteLink, reason: 'no_agregado_directamente' }));
      outcome.pendingInvitation = outcome.pendingParticipants.length;
      outcome.addedDirectly = outcome.participants.filter((participant) => participant.status === 'added').length;
    } catch (error) {
      outcome.errors.push({ grupo: safeGroupName, etapa: 'consulta_participantes', error: error.message || String(error) });
      return outcome;
    }

    if (outcome.pendingParticipants.length > 0 && outcome.inviteLink) {
      const pendingNumbers = outcome.pendingParticipants.map((item) => item.numero).join(',');
      try {
        const sendResult = await this.whatsappService.sendToContacts({
          numbers: pendingNumbers,
          message: INVITE_MESSAGE.replace('{inviteLink}', outcome.inviteLink),
          complianceMode: true,
          riskProfile: 'medium'
        });
        const sent = Array.isArray(sendResult) ? sendResult : [];
        outcome.invitationsSent = sent.filter((item) => item.status === 'success').length;
        outcome.invitationsFailed = sent.filter((item) => item.status === 'error').length;
        outcome.diagnostics.invitationsSent = outcome.invitationsSent;
        outcome.diagnostics.invitationsFailed = outcome.invitationsFailed;
        const sentByNumber = new Map(sent.map((item) => [resultNumber(item), item]));
        outcome.participants = outcome.participants.map((participant) => {
          const sendResult = sentByNumber.get(participant.number);
          if (!sendResult) return participant;
          return {
            ...participant,
            status: sendResult.status === 'success' ? 'invitation_sent' : 'invitation_failed',
            invitationStatus: sendResult.status === 'success' ? 'sent' : 'failed',
            invitation: sendResult.status === 'success' ? 'Enviada' : 'Fallida',
            detail: sendResult.error || (sendResult.status === 'success' ? 'Invitacion enviada' : 'Error al enviar')
          };
        });
      } catch (error) {
        outcome.invitationsFailed = outcome.pendingParticipants.length;
        outcome.participants = outcome.participants.map((participant) => participant.status === 'pending'
          ? { ...participant, status: 'invitation_failed', invitationStatus: 'failed', invitation: 'Fallida', detail: error.message || 'Error al enviar' }
          : participant);
        outcome.errors.push({ grupo: safeGroupName, etapa: 'mensaje_privado', error: error.message || String(error) });
      }
    }

    outcome.addedDirectly = outcome.participants.filter((participant) => participant.status === 'added').length;
    outcome.pendingInvitation = outcome.participants.filter((participant) => participant.status === 'pending').length;
    updateReconciliation(outcome, outcome.diagnostics.participantsAfterRefresh.length);
    outcome.diagnostics.addedDirectly = outcome.addedDirectly;
    outcome.diagnostics.pendingInvitation = outcome.pendingInvitation;

    outcome.diagnostics.participants.forEach((diagnostic) => {
      const participant = outcome.participants.find((item) => item.number === diagnostic.number);
      diagnostic.privateInvitation = {
        status: participant && participant.invitationStatus === 'sent' ? 'enviada'
          : participant && participant.invitationStatus === 'failed' ? 'fallida'
            : participant && participant.status === 'pending' ? 'no_procesada' : 'no_aplica',
        error: participant && participant.invitationStatus === 'failed' ? participant.detail : null
      };
      diagnostic.inviteCode = outcome.diagnostics.inviteCode || { attempted: false, success: false, available: false };
    });

    return outcome;
  }
}

module.exports = { WhatsAppGroupImportService, INVITE_MESSAGE };