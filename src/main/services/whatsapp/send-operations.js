const fs = require('fs');
const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');

const COMPLIANCE_PROFILES = {
  new: {
    minDelayFloor: 16,
    recommendedMaxDelay: 24,
    unitDelayMinFloor: 2,
    recommendedMaxUnitDelay: 4,
    cooldownEvery: 5,
    cooldownMinSeconds: 60,
    cooldownMaxSeconds: 95
  },
  medium: {
    minDelayFloor: 12,
    recommendedMaxDelay: 22,
    unitDelayMinFloor: 1,
    recommendedMaxUnitDelay: 3,
    cooldownEvery: 8,
    cooldownMinSeconds: 45,
    cooldownMaxSeconds: 75
  },
  mature: {
    minDelayFloor: 10,
    recommendedMaxDelay: 20,
    unitDelayMinFloor: 1,
    recommendedMaxUnitDelay: 2,
    cooldownEvery: 12,
    cooldownMinSeconds: 30,
    cooldownMaxSeconds: 55
  }
};

function normalizePhoneForSend(value) {
  if (!value) {
    return '';
  }

  return String(value).replace(/[^0-9]/g, '');
}

function normalizeContactIds(numbers) {
  if (!numbers) {
    return [];
  }

  return numbers
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => normalizePhoneForSend(value))
    .filter(Boolean)
    .map((value) => (value.includes('@') ? value : `${value}@c.us`));
}

function normalizeGroupIds(groupIds) {
  if (Array.isArray(groupIds)) {
    return groupIds.filter(Boolean);
  }

  if (!groupIds) {
    return [];
  }

  return groupIds
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeFiles(files = []) {
  return files.filter((filePath) => fs.existsSync(filePath));
}

function sanitizeMessageList(payload) {
  const fromList = Array.isArray(payload && payload.messageList) ? payload.messageList : [];
  const cleaned = fromList
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 3);

  if (cleaned.length > 0) {
    return cleaned;
  }

  const fallback = String(payload && payload.message ? payload.message : '').trim();
  return fallback ? [fallback] : [];
}

function buildContextMap(list, keyName) {
  const map = new Map();
  if (!Array.isArray(list)) {
    return map;
  }

  list.forEach((item) => {
    if (!item || typeof item !== 'object') {
      return;
    }

    const key = String(item[keyName] || '').trim();
    if (!key) {
      return;
    }

    map.set(key, item);
  });

  return map;
}

function pickRandomFrom(list = []) {
  if (!Array.isArray(list) || list.length === 0) {
    return '';
  }

  const index = Math.floor(Math.random() * list.length);
  return String(list[index] || '');
}

function applyTemplate(text, context = {}) {
  const raw = String(text || '');
  if (!raw) {
    return '';
  }

  const normalizedContext = {};
  if (context && typeof context === 'object') {
    Object.keys(context).forEach((k) => {
      normalizedContext[String(k).toLowerCase()] = context[k];
    });
  }

  return raw.replace(/\{{1,2}\s*([a-zA-Z0-9_]+)\s*\}{1,2}/g, (match, variableName) => {
    const key = String(variableName || '').trim().toLowerCase();
    if (!key) {
      return match;
    }

    if (Object.prototype.hasOwnProperty.call(normalizedContext, key)) {
      const val = normalizedContext[key];
      return String(val !== undefined && val !== null ? val : '');
    }

    return match;
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function simulateTyping(service, chatId, minSeconds, maxSeconds, options = {}) {
  const lower = Number.isFinite(Number(minSeconds)) ? Number(minSeconds) : 3;
  const upper = Number.isFinite(Number(maxSeconds)) ? Number(maxSeconds) : 6;
  const safeMin = clamp(Math.floor(lower), 1, 30);
  const safeMax = clamp(Math.floor(upper), safeMin, 30);
  const duration = calculateDelay(safeMin, safeMax);

  try {
    let targetChatId = chatId;
    if (chatId && chatId.endsWith('@lid') && options.reverseIdMap && options.reverseIdMap.get(chatId)) {
      targetChatId = options.reverseIdMap.get(chatId);
    }

    let chat = null;
    try {
      chat = await service.client.getChatById(targetChatId);
    } catch (_e) {
      if (targetChatId !== chatId) {
        try {
          chat = await service.client.getChatById(chatId);
        } catch (_e2) {
          chat = null;
        }
      }
    }

    if (chat && typeof chat.sendStateTyping === 'function') {
      await chat.sendStateTyping();
    }

    if (service.cancellableSleep) {
      await service.cancellableSleep(duration * 1000);
    } else {
      await service.sleep(duration * 1000);
    }

    if (chat && typeof chat.clearState === 'function') {
      await chat.clearState();
    }
  } catch (error) {
    console.warn(`[Typing] No se pudo simular escritura para ${chatId}:`, error.message || error);
  }

  return duration;
}

async function sendText(service, chatId, message, label, options = {}) {
  if (!message) {
    return 0;
  }

  const typingBudgetSeconds = Number(options.typingBudgetSeconds || 0);
  const minTyping = typingBudgetSeconds > 0 ? Math.min(3, typingBudgetSeconds) : 3;
  const maxTyping = typingBudgetSeconds > 0 ? Math.max(minTyping, Math.min(6, typingBudgetSeconds)) : 6;
  const typingDuration = await simulateTyping(service, chatId, minTyping, maxTyping, options);

  await service.client.sendMessage(chatId, message);
  console.log(`Mensaje enviado a ${label}`);
  return typingDuration;
}

async function waitBetweenUnits(service, label, delayMin, delayMax, onBeforeWait) {
  const delay = calculateDelay(delayMin, delayMax);

  if (delay <= 0) {
    return 0;
  }

  console.log(`[Units] Esperando ${delay} segundos entre unidades para ${label}...`);

  if (typeof onBeforeWait === 'function') {
    onBeforeWait(delay);
  }

  if (service.cancellableSleep) {
    await service.cancellableSleep(delay * 1000);
  } else {
    await service.sleep(delay * 1000);
  }
  return delay;
}

async function sendFiles(service, chatId, files, label, unitDelayMin, unitDelayMax, onBeforeWait) {
  let unitDelaySpent = 0;

  for (let index = 0; index < files.length; index += 1) {
    const filePath = files[index];
    const media = MessageMedia.fromFilePath(filePath);
    await service.client.sendMessage(chatId, media);
    console.log(`Archivo enviado a ${label}: ${path.basename(filePath)}`);

    if (index < files.length - 1) {
      unitDelaySpent += await waitBetweenUnits(service, label, unitDelayMin, unitDelayMax, onBeforeWait);
    }
  }

  return unitDelaySpent;
}

function calculateDelay(delayMin, delayMax) {
  const min = Number.isFinite(Number(delayMin)) ? Number(delayMin) : 2;
  const max = Number.isFinite(Number(delayMax)) ? Number(delayMax) : 8;

  if (max <= min) {
    return min;
  }

  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function waitBetweenSends(service, index, total, delayMin, delayMax, onBeforeWait, fixedDelaySeconds = null) {
  if (index >= total - 1) {
    return null;
  }

  const delay = Number.isFinite(Number(fixedDelaySeconds))
    ? Math.max(0, Number(fixedDelaySeconds))
    : calculateDelay(delayMin, delayMax);

  if (delay <= 0) {
    return 0;
  }

  console.log(`Esperando ${delay} segundos antes del siguiente envio...`);

  if (typeof onBeforeWait === 'function') {
    onBeforeWait(delay);
  }

  if (service.cancellableSleep) {
    await service.cancellableSleep(delay * 1000);
  } else {
    await service.sleep(delay * 1000);
  }
  return delay;
}

async function waitComplianceCooldown(service, index, complianceMode, profileSettings, onBeforeWait) {
  if (!complianceMode) {
    return null;
  }

  const batchSize = index + 1;
  if (batchSize % profileSettings.cooldownEvery !== 0) {
    return null;
  }

  const cooldownSeconds = calculateDelay(profileSettings.cooldownMinSeconds, profileSettings.cooldownMaxSeconds);
  console.log(`[Compliance] Pausa de seguridad tras ${batchSize} envios: ${cooldownSeconds}s`);

  if (typeof onBeforeWait === 'function') {
    onBeforeWait(cooldownSeconds);
  }

  if (service.cancellableSleep) {
    await service.cancellableSleep(cooldownSeconds * 1000);
  } else {
    await service.sleep(cooldownSeconds * 1000);
  }
  return cooldownSeconds;
}

async function filterRegisteredContactIds(service, contactIds = []) {
  const validIds = [];
  const invalidResults = [];
  const idMap = new Map();
  const reverseIdMap = new Map();

  for (const chatId of contactIds) {
    const label = chatId.replace('@c.us', '');

    if (label.length < 8 || label.length > 15) {
      invalidResults.push({
        status: 'error',
        label,
        number: chatId,
        error: 'Numero invalido por longitud'
      });
      continue;
    }

    try {
      let registeredId = null;
      if (typeof service.client.getNumberId === 'function') {
        const numberId = await service.client.getNumberId(label);
        if (numberId && numberId._serialized) {
          registeredId = numberId._serialized;
        }
      }

      if (!registeredId) {
        const isRegistered = await service.client.isRegisteredUser(chatId);
        if (isRegistered) {
          registeredId = chatId;
        }
      }

      if (registeredId) {
        validIds.push(registeredId);
        idMap.set(chatId, registeredId);
        idMap.set(label, registeredId);
        reverseIdMap.set(registeredId, chatId);
        reverseIdMap.set(registeredId, label);
      } else {
        invalidResults.push({
          status: 'error',
          label,
          number: chatId,
          error: 'Numero no registrado en WhatsApp'
        });
      }
    } catch (_error) {
      invalidResults.push({
        status: 'error',
        label,
        number: chatId,
        error: 'No se pudo validar el numero antes del envio'
      });
    }
  }

  return {
    validIds,
    invalidResults,
    idMap,
    reverseIdMap
  };
}

function emitSendProgress({ onProgress, status, targetType, total, results, currentLabel, currentResult, extra = {} }) {
  if (typeof onProgress !== 'function') {
    return;
  }

  const processed = results.length;
  const success = results.filter((item) => item.status === 'success').length;
  const failed = results.filter((item) => item.status === 'error').length;
  const percent = total > 0 ? Math.round((processed / total) * 100) : 100;

  onProgress({
    status,
    targetType,
    total,
    processed,
    success,
    failed,
    percent,
    currentLabel,
    currentResult,
    ...extra
  });
}

async function sendToTargets(service, {
  targetIds,
  message,
  messageList = [],
  files = [],
  delayMin = 2,
  delayMax = 8,
  unitDelayMin = 0,
  unitDelayMax = 0,
  getLabel,
  resultKey,
  sendFilesFirst,
  sendOrderMode,
  targetType,
  onProgress,
  complianceMode = true,
  initialResults = [],
  riskProfile = 'medium',
  customVariables = {},
  randomTags = [],
  targetContextById = new Map(),
  reverseIdMap = new Map()
}) {
  service.ensureReady();
  if (typeof service.resetCancelSend === 'function') {
    service.resetCancelSend();
  }

  const sanitizedFiles = normalizeFiles(files);
  const profileSettings = COMPLIANCE_PROFILES[riskProfile] || COMPLIANCE_PROFILES.medium;
  const safeDelayMin = Math.min(Number(delayMin) || 2, 24);
  const safeDelayMax = Math.min(Number(delayMax) || 8, 25);
  const safeUnitDelayMin = Math.min(Math.max(Number(unitDelayMin) || 0, 0), 30);
  const safeUnitDelayMax = Math.min(Math.max(Number(unitDelayMax) || 0, 0), 30);
  const delayMinApplied = complianceMode ? Math.max(safeDelayMin, profileSettings.minDelayFloor) : safeDelayMin;
  const delayMaxApplied = complianceMode
    ? Math.max(Math.min(safeDelayMax, 25), Math.max(profileSettings.recommendedMaxDelay, delayMinApplied + 2))
    : Math.max(safeDelayMax, delayMinApplied + 1);
  const unitDelayMinApplied = complianceMode ? Math.max(safeUnitDelayMin, profileSettings.unitDelayMinFloor) : safeUnitDelayMin;
  const unitDelayMaxApplied = complianceMode
    ? Math.max(Math.min(safeUnitDelayMax, 30), Math.max(profileSettings.recommendedMaxUnitDelay, unitDelayMinApplied))
    : Math.max(safeUnitDelayMax, unitDelayMinApplied);

  const results = Array.isArray(initialResults) ? initialResults.slice() : [];
  const total = targetIds.length + results.length;

  if (typeof onProgress === 'function') {
    onProgress({
      status: 'started',
      targetType,
      total,
      processed: 0,
      success: 0,
      failed: 0,
      percent: 0,
      currentLabel: null,
      delayMinApplied,
      delayMaxApplied,
      unitDelayMinApplied,
      unitDelayMaxApplied,
      complianceMode,
      riskProfile,
      cooldownEvery: profileSettings.cooldownEvery,
      cooldownMinSeconds: profileSettings.cooldownMinSeconds,
      cooldownMaxSeconds: profileSettings.cooldownMaxSeconds
    });
  }

  for (let index = 0; index < targetIds.length; index += 1) {
    if (service.isCancelRequested) {
      console.log('[sendToTargets] Proceso cancelado por el usuario antes de procesar el lote restante.');
      emitSendProgress({
        onProgress,
        status: 'cancelled',
        targetType,
        total,
        results,
        currentLabel: null,
        currentResult: null
      });
      return { results, cancelled: true };
    }

    const chatId = targetIds[index];
    const label = getLabel(chatId);
    let baseContext = targetContextById && typeof targetContextById.get === 'function'
      ? (targetContextById.get(chatId) || null)
      : null;

    if (!baseContext && reverseIdMap && typeof reverseIdMap.get === 'function' && targetContextById) {
      const originalId = reverseIdMap.get(chatId);
      if (originalId) {
        baseContext = targetContextById.get(originalId) || targetContextById.get(originalId.replace('@c.us', ''));
      }
    }

    if (!baseContext && targetContextById && typeof targetContextById.get === 'function') {
      baseContext = targetContextById.get(chatId.replace(/@.*$/, '')) || {};
    }

    baseContext = baseContext || {};

    const resolvedContext = {
      ...Object.fromEntries(Object.entries(customVariables || {}).map(([key, value]) => [String(key).toLowerCase(), String(value || '')])),
      ...Object.fromEntries(Object.entries(baseContext || {}).map(([key, value]) => [String(key).toLowerCase(), String(value || '')])),
      etiqueta_aleatoria: pickRandomFrom(randomTags)
    };

    const resolvedMessages = (Array.isArray(messageList) && messageList.length > 0 ? messageList : [message])
      .map((item) => applyTemplate(item, resolvedContext))
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    const effectiveOrder = typeof sendOrderMode === 'string' && sendOrderMode
      ? sendOrderMode
      : (sendFilesFirst ? 'files-first' : 'text-first');

    try {
      const cycleDelaySeconds = calculateDelay(delayMinApplied, delayMaxApplied);
      let typingSpent = 0;
      let unitDelaySpent = 0;

      const waitForUnitDelay = async (waitKind) => {
        const delay = await waitBetweenUnits(service, label, unitDelayMinApplied, unitDelayMaxApplied, (delayWait) => {
          emitSendProgress({
            onProgress,
            status: 'unit-wait',
            targetType,
            total,
            results,
            currentLabel: label,
            currentResult: 'success',
            extra: {
              waitSeconds: delayWait,
              waitKind,
              delayMinApplied,
              delayMaxApplied,
              unitDelayMinApplied,
              unitDelayMaxApplied,
              complianceMode,
              riskProfile,
              cooldownEvery: profileSettings.cooldownEvery,
              cooldownMinSeconds: profileSettings.cooldownMinSeconds,
              cooldownMaxSeconds: profileSettings.cooldownMaxSeconds
            }
          });
        });

        unitDelaySpent += delay;
        return delay;
      };

      const sendFilesWithDelays = async () => {
        for (let index = 0; index < sanitizedFiles.length; index += 1) {
          const filePath = sanitizedFiles[index];
          const media = MessageMedia.fromFilePath(filePath);
          await service.client.sendMessage(chatId, media);
          console.log(`Archivo enviado a ${label}: ${path.basename(filePath)}`);

          if (index < sanitizedFiles.length - 1) {
            await waitForUnitDelay('file-gap');
          }
        }
      };

      const sendMessagesWithDelays = async (messages) => {
        for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
          typingSpent += await sendText(service, chatId, messages[messageIndex], label, {
            typingBudgetSeconds: cycleDelaySeconds,
            reverseIdMap
          });

          if (messageIndex < messages.length - 1) {
            await waitForUnitDelay('message-gap');
          }
        }
      };

      if (effectiveOrder === 'files-first') {
        if (sanitizedFiles.length > 0) {
          await sendFilesWithDelays();
        }

        if (sanitizedFiles.length > 0 && resolvedMessages.length > 0) {
          await waitForUnitDelay('file-to-message');
        }

        await sendMessagesWithDelays(resolvedMessages);
      } else if (effectiveOrder === 'message-split') {
        if (resolvedMessages.length > 0) {
          typingSpent += await sendText(service, chatId, resolvedMessages[0], label, {
            typingBudgetSeconds: cycleDelaySeconds
          });
        }

        if (sanitizedFiles.length > 0) {
          if (resolvedMessages.length > 0) {
            await waitForUnitDelay('message-to-file');
          }

          await sendFilesWithDelays();
        }

        if (sanitizedFiles.length > 0 && resolvedMessages.length > 1) {
          await waitForUnitDelay('file-to-message');
        }

        await sendMessagesWithDelays(resolvedMessages.slice(1));
      } else {
        if (resolvedMessages.length > 0) {
          await sendMessagesWithDelays([resolvedMessages[0]]);
        }

        if (resolvedMessages.length > 0 && sanitizedFiles.length > 0) {
          await waitForUnitDelay('message-to-file');
        }

        if (sanitizedFiles.length > 0) {
          await sendFilesWithDelays();
        }

        if (sanitizedFiles.length > 0 && resolvedMessages.length > 1) {
          await waitForUnitDelay('file-to-message');
        }

        await sendMessagesWithDelays(resolvedMessages.slice(1));
      }

      try {
        await service.logMessageInteraction({
          destinationType: targetType,
          destinationId: chatId,
          message: resolvedMessages.join('\n\n'),
          files: sanitizedFiles
        });
      } catch (logError) {
        console.warn(`[MessageLogs] No se pudo registrar el envio para ${label}:`, logError.message || logError);
      }

      const successResult = { status: 'success', label };
      successResult[resultKey] = chatId;
      results.push(successResult);

      emitSendProgress({
        onProgress,
        status: 'running',
        targetType,
        total,
        results,
        currentLabel: label,
        currentResult: 'success',
        extra: {
          delayMinApplied,
          delayMaxApplied,
          unitDelayMinApplied,
          unitDelayMaxApplied,
          complianceMode,
          riskProfile,
          cooldownEvery: profileSettings.cooldownEvery,
          cooldownMinSeconds: profileSettings.cooldownMinSeconds,
          cooldownMaxSeconds: profileSettings.cooldownMaxSeconds
        }
      });

      const remainingDelay = Math.max(0, cycleDelaySeconds - typingSpent - unitDelaySpent);

      await waitBetweenSends(service, index, targetIds.length, delayMinApplied, delayMaxApplied, (delayWait) => {
        emitSendProgress({
          onProgress,
          status: 'waiting',
          targetType,
          total,
          results,
          currentLabel: label,
          currentResult: 'success',
          extra: {
            waitSeconds: delayWait,
            waitKind: 'delay',
            delayMinApplied,
            delayMaxApplied,
              unitDelayMinApplied,
              unitDelayMaxApplied,
            complianceMode,
            riskProfile,
            cooldownEvery: profileSettings.cooldownEvery,
            cooldownMinSeconds: profileSettings.cooldownMinSeconds,
            cooldownMaxSeconds: profileSettings.cooldownMaxSeconds
          }
        });
      }, remainingDelay);

      await waitComplianceCooldown(service, index, complianceMode, profileSettings, (cooldownWait) => {
        emitSendProgress({
          onProgress,
          status: 'cooldown',
          targetType,
          total,
          results,
          currentLabel: label,
          currentResult: 'success',
          extra: {
            waitSeconds: cooldownWait,
            waitKind: 'security-cooldown',
            delayMinApplied,
            delayMaxApplied,
              unitDelayMinApplied,
              unitDelayMaxApplied,
            complianceMode,
            riskProfile,
            cooldownEvery: profileSettings.cooldownEvery,
            cooldownMinSeconds: profileSettings.cooldownMinSeconds,
            cooldownMaxSeconds: profileSettings.cooldownMaxSeconds
          }
        });
      });
    } catch (error) {
      if (error.isCancelled || error.message === 'CANCELLED_BY_USER' || service.isCancelRequested) {
        console.log(`[sendToTargets] Envío cancelado por el usuario durante el envío a ${label}`);
        emitSendProgress({
          onProgress,
          status: 'cancelled',
          targetType,
          total,
          results,
          currentLabel: label,
          currentResult: null
        });
        return { results, cancelled: true };
      }

      const failureResult = {
        status: 'error',
        error: error.message,
        label
      };
      failureResult[resultKey] = chatId;
      results.push(failureResult);
      console.error(`Error enviando a ${label}:`, error);

      emitSendProgress({
        onProgress,
        status: 'running',
        targetType,
        total,
        results,
        currentLabel: label,
        currentResult: 'error',
        extra: {
          delayMinApplied,
          delayMaxApplied,
          unitDelayMinApplied,
          unitDelayMaxApplied,
          complianceMode,
          riskProfile,
          cooldownEvery: profileSettings.cooldownEvery,
          cooldownMinSeconds: profileSettings.cooldownMinSeconds,
          cooldownMaxSeconds: profileSettings.cooldownMaxSeconds
        }
      });
    }
  }

  emitSendProgress({
    onProgress,
    status: 'completed',
    targetType,
    total,
    results,
    currentLabel: null,
    currentResult: null,
    extra: {
      delayMinApplied,
      delayMaxApplied,
      complianceMode,
      riskProfile,
      cooldownEvery: profileSettings.cooldownEvery,
      cooldownMinSeconds: profileSettings.cooldownMinSeconds,
      cooldownMaxSeconds: profileSettings.cooldownMaxSeconds
    }
  });

  return results;
}

async function sendToContacts(service, payload, onProgress) {
  const contactIds = normalizeContactIds(payload.numbers);
  const { validIds, invalidResults, idMap, reverseIdMap } = await filterRegisteredContactIds(service, contactIds);
  const messageList = sanitizeMessageList(payload);

  const contactContextById = new Map();

  const registerContextKey = (key, context) => {
    if (!key) {
      return;
    }
    const strKey = String(key).trim();
    if (strKey && !contactContextById.has(strKey)) {
      contactContextById.set(strKey, context);
    }
  };

  if (Array.isArray(payload.contactContexts)) {
    payload.contactContexts.forEach((context) => {
      if (!context || typeof context !== 'object') {
        return;
      }

      const num = normalizePhoneForSend(context.number || context.numero || '');
      const id = context.id ? String(context.id).trim() : '';

      registerContextKey(id, context);
      if (num) {
        registerContextKey(num, context);
        registerContextKey(`${num}@c.us`, context);
        registerContextKey(`${num}@lid`, context);
      }
    });
  }

  if (idMap && idMap.size > 0) {
    idMap.forEach((registeredId, originalId) => {
      const context = contactContextById.get(originalId)
        || contactContextById.get(String(originalId).replace('@c.us', ''));
      if (context) {
        registerContextKey(registeredId, context);
        const userPart = String(registeredId).replace(/@.*$/, '');
        if (userPart) {
          registerContextKey(userPart, context);
        }
      }
    });
  }

  return sendToTargets(service, {
    targetIds: validIds,
    message: payload.message,
    messageList,
    files: payload.files,
    delayMin: payload.delayMin,
    delayMax: payload.delayMax,
    unitDelayMin: payload.unitDelayMin,
    unitDelayMax: payload.unitDelayMax,
    complianceMode: payload.complianceMode !== false,
    riskProfile: payload.riskProfile || 'medium',
    customVariables: payload.customVariables || {},
    randomTags: Array.isArray(payload.randomTags) ? payload.randomTags : [],
    targetContextById: contactContextById,
    reverseIdMap,
    initialResults: invalidResults,
    getLabel: (chatId) => {
      const context = contactContextById.get(chatId)
        || (reverseIdMap && contactContextById.get(reverseIdMap.get(chatId)))
        || null;
      if (context) {
        const name = context.nombre || context.nombre_completo || context.name || '';
        const number = context.number || context.numero || String(chatId).replace(/@.*$/, '');
        if (name && name !== number) {
          return `${name} (${number})`;
        }
        return number;
      }
      const original = reverseIdMap ? reverseIdMap.get(chatId) : null;
      if (original) {
        return String(original).replace('@c.us', '');
      }
      return String(chatId).replace(/@.*$/, '');
    },
    resultKey: 'number',
    sendFilesFirst: payload.sendFilesFirst !== false,
    sendOrderMode: payload.sendOrderMode,
    targetType: 'contacts',
    onProgress
  });
}

async function sendToGroups(service, payload, onProgress) {
  const groupIds = normalizeGroupIds(payload.groupIds);
  const messageList = sanitizeMessageList(payload);
  const groupContextById = buildContextMap(payload.groupContexts, 'id');

  return sendToTargets(service, {
    targetIds: groupIds,
    message: payload.message,
    messageList,
    files: payload.files,
    delayMin: payload.delayMin,
    delayMax: payload.delayMax,
    unitDelayMin: payload.unitDelayMin,
    unitDelayMax: payload.unitDelayMax,
    complianceMode: payload.complianceMode !== false,
    riskProfile: payload.riskProfile || 'medium',
    customVariables: payload.customVariables || {},
    randomTags: Array.isArray(payload.randomTags) ? payload.randomTags : [],
    targetContextById: groupContextById,
    getLabel: (groupId) => {
      const group = service.groups.find((item) => item.id === groupId);
      return group ? group.name : groupId;
    },
    resultKey: 'groupId',
    sendFilesFirst: payload.sendFilesFirst !== false,
    sendOrderMode: payload.sendOrderMode,
    targetType: 'groups',
    onProgress
  });
}

module.exports = {
  sendToContacts,
  sendToGroups,
  normalizePhoneForSend
};
