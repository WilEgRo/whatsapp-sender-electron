const { Client, LocalAuth } = require('whatsapp-web.js');
const EventEmitter = require('events');
const path = require('path');
const sendOperations = require('./whatsapp/send-operations');
const MessageLogRepository = require('./message-log-repository');
const MessageAnalyticsService = require('./message-analytics-service');
const MessageStatsExportService = require('./message-stats-export-service');

class WhatsAppService extends EventEmitter {
    constructor() {
      super();
      this.client = null;
      this.groups = [];
      this.contacts = [];
      this.isReady = false;
      this.isReconnecting = false;
      this.isAuthenticated = false;
      this.isSyncingGroups = false;
      this.isCancelRequested = false;

      // Estado consultable del ciclo de vida de la sesión
      this.sessionState = 'disconnected'; // 'disconnected' | 'starting' | 'qr' | 'authenticated' | 'loading' | 'ready'
      this.lastLoadingPercent = 0;
      this.lastLoadingMessage = '';
      this.lastQrCode = null;
      this.isStarting = false;

      this.messageLogRepository = new MessageLogRepository();
      this.messageAnalyticsService = new MessageAnalyticsService(this.messageLogRepository);
      this.analyticsReady = this.messageLogRepository.initialize().catch((error) => {
        console.error('[WhatsAppService] No se pudo inicializar SQLite para logs:', error);
        throw error;
      });
    }

    start(onStarted) {
      if (this.isStarting || this.isReady) {
        console.log('[WhatsAppService] start() ignorado: el servicio ya está en proceso de inicio o ya está listo.');
        return;
      }
      this.isStarting = true;
      this.sessionState = 'starting';
      this.client = this.createClient();
      this.registerClientEvents(onStarted);
      this.client.initialize();
    }

    createClient() {
      return new Client({
        authStrategy: new LocalAuth({
          dataPath: path.join(__dirname, '../../../.wwebjs_auth')
        }),
        webVersionCache: {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1040404884-alpha.html'
        },
        puppeteer: {
          headless: true,
          timeout: 60000,
          protocolTimeout: 0, // Desactiva el timeout del protocolo para evitar errores con listas largas de contactos
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--disable-software-rasterizer',
            '--disable-extensions',
            '--no-first-run',
            '--no-zygote',
            '--disable-accelerated-2d-canvas'
          ]
        }
      });
    }

    registerClientEvents(onStarted) {
      this.client.on('qr', (qr) => {
        this.sessionState = 'qr';
        this.lastQrCode = qr;
        this.isAuthenticated = false;
        this.emit('qr', qr);
      });

      this.client.on('ready', async () => {
        this.isReady = true;
        this.isStarting = false;
        this.sessionState = 'ready';
        this.lastLoadingPercent = 100;
        await this.patchSendSeen();

        // Emite ready INMEDIATAMENTE para desbloquear la aplicación sin esperar la sincronización secundaria de grupos
        console.log('[WhatsAppService] WhatsApp Web listo para operar. Emitiendo evento ready...');
        this.emit('ready');
        if (onStarted) {
          onStarted();
        }

        // Sincronización secundaria en segundo plano
        this.loadGroups().catch((error) => {
          console.error('[WhatsAppService] La sincronizacion de grupos no pudo completarse al iniciar:', error);
        });
      });

      this.client.on('authenticated', () => {
        if (!this.isAuthenticated) {
          this.isAuthenticated = true;
          this.sessionState = 'authenticated';
          this.lastQrCode = null;
          console.log('WhatsApp autenticado correctamente');
          this.emit('authenticated');
        }
      });

      this.client.on('loading_screen', (percent, message) => {
        this.sessionState = 'loading';
        this.lastLoadingPercent = Number(percent) || 0;
        this.lastLoadingMessage = message || '';
        console.log(`[WhatsAppService] Cargando sesion: ${percent}% - ${message}`);
        this.emit('loading_screen', { percent, message });
      });

      this.client.on('auth_failure', (message) => {
        console.error('Error de autenticacion:', message);
        this.sessionState = 'disconnected';
        this.isAuthenticated = false;
        this.isReady = false;
        this.isStarting = false;
        this.emit('disconnected', message);
      });

      this.client.on('disconnected', (reason) => {
        this.sessionState = 'disconnected';
        this.isReady = false;
        this.isAuthenticated = false;
        this.isStarting = false;
        this.emit('disconnected', reason);
        this.scheduleReconnect();
      });
    }

    async safeEvaluate(evalFn, fallback = null, maxRetries = 4, delayMs = 1200) {
      for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        try {
          if (!this.client || !this.client.pupPage || this.client.pupPage.isClosed()) {
            return fallback;
          }
          return await this.client.pupPage.evaluate(evalFn);
        } catch (err) {
          const msg = String(err && err.message ? err.message : err).toLowerCase();
          const isDetachedOrDestroyed =
            msg.includes('detached frame') ||
            msg.includes('execution context was destroyed') ||
            msg.includes('target closed') ||
            msg.includes('navigating');

          if (isDetachedOrDestroyed && attempt < maxRetries) {
            console.warn(`[WhatsAppService] Contexto o frame de navegación en cambio (intento ${attempt}/${maxRetries}), reintentando en ${delayMs}ms...`);
            await this.sleep(delayMs);
          } else {
            console.warn('[WhatsAppService] Error en evaluación:', err.message || err);
            return fallback;
          }
        }
      }
      return fallback;
    }

    async patchSendSeen() {
      await this.safeEvaluate(() => {
        if (window.WWebJS && window.WWebJS.sendSeen) {
          window.WWebJS.sendSeen = async () => {};
        }
      });
    }

    async loadGroups() {
      if (this.isSyncingGroups) {
        return this.groups;
      }
      this.isSyncingGroups = true;

      console.log('[WhatsAppService] Iniciando sincronización profunda de grupos (orden por actividad reciente)...');
      this.emit('groups-sync-status', { state: 'loading' });

      try {
        let groupList = await this.getGroupsDirectly();

        // Pases progresivos para capturar grupos adicionales preservando el orden de actividad de WhatsApp
        const maxPasses = 8;
        for (let pass = 1; pass <= maxPasses; pass += 1) {
          const freshList = await this.getGroupsDirectly();
          if (freshList.length > groupList.length) {
            console.log(`[WhatsAppService] Pase de sincronización ${pass}/${maxPasses}: encontrados ${freshList.length} grupos (+${freshList.length - groupList.length}).`);
            groupList = freshList;
            this.groups = groupList;
            this.emit('groups-sync-status', { state: 'loading', total: this.groups.length });
            this.emit('groups-loaded', this.groups);
          }

          if (pass < maxPasses) {
            await this.sleep(2500);
          }
        }

        try {
          if (this.client && typeof this.client.getChats === 'function') {
            const rawChats = await this.client.getChats().catch(() => []);
            if (Array.isArray(rawChats) && rawChats.length > 0) {
              const mapById = new Map();
              groupList.forEach((g) => mapById.set(g.id, g));

              rawChats.forEach((chat, idx) => {
                if (chat && chat.isGroup && chat.id && chat.id._serialized) {
                  const id = chat.id._serialized;
                  const name = chat.name || chat.formattedTitle || 'Grupo sin nombre';
                  const ts = chat.timestamp || chat.t || 0;
                  if (!mapById.has(id)) {
                    mapById.set(id, { id, name, t: ts, chatIndex: idx });
                  } else if (mapById.get(id).name === 'Grupo sin nombre') {
                    mapById.get(id).name = name;
                  }
                }
              });

              groupList = Array.from(mapById.values()).map(({ id, name }) => ({ id, name }));
            }
          }
        } catch (_fallbackError) {
          // Omitir silenciosamente
        }

        this.groups = groupList;

        console.log(`[WhatsAppService] Sincronización de grupos completada: ${this.groups.length} grupos ordenados por actividad reciente.`);
        this.emit('groups-sync-status', { state: 'completed', total: this.groups.length });
        this.emit('groups-loaded', this.groups);
        return this.groups;
      } catch (error) {
        console.error('[WhatsAppService] Error en sincronización de grupos:', error);
        this.emit('groups-sync-status', { state: 'failed', error: error.message || String(error) });
        return this.groups;
      } finally {
        this.isSyncingGroups = false;
      }
    }

    async getGroupsDirectly() {
      const groups = await this.safeEvaluate(() => {
        try {
          const groupMap = new Map();

          const helperAdd = (id, name, timestamp = 0, chatIndex = 999999, pinned = false) => {
            if (!id || typeof id !== 'string') {
              return;
            }
            const cleanId = id.trim();
            if (!cleanId.endsWith('@g.us')) {
              return;
            }
            const cleanName = (name || '').trim();
            const ts = Number(timestamp) || 0;
            const idx = Number(chatIndex) || 999999;
            const isPinned = Boolean(pinned);

            if (!groupMap.has(cleanId)) {
              groupMap.set(cleanId, {
                id: cleanId,
                name: cleanName || 'Grupo sin nombre',
                t: ts,
                chatIndex: idx,
                pinned: isPinned
              });
            } else {
              const existing = groupMap.get(cleanId);
              if (cleanName && existing.name === 'Grupo sin nombre') {
                existing.name = cleanName;
              }
              if (ts > existing.t) {
                existing.t = ts;
              }
              if (idx < existing.chatIndex) {
                existing.chatIndex = idx;
              }
              if (isPinned) {
                existing.pinned = true;
              }
            }
          };

          const extractModelsFromAnyCollection = (coll) => {
            if (!coll || typeof coll !== 'object') return [];
            const results = [];

            try {
              if (Array.isArray(coll)) {
                results.push(...coll);
              } else if (typeof coll.getModelsArray === 'function') {
                results.push(...coll.getModelsArray());
              } else if (Array.isArray(coll.models)) {
                results.push(...coll.models);
              } else if (Array.isArray(coll._models)) {
                results.push(...coll._models);
              }

              if (coll._index && typeof coll._index === 'object') {
                results.push(...Object.values(coll._index));
              }
              if (coll._map && typeof coll._map === 'object') {
                if (typeof coll._map.values === 'function') {
                  results.push(...Array.from(coll._map.values()));
                } else {
                  results.push(...Object.values(coll._map));
                }
              }
              if (coll._hash && typeof coll._hash === 'object') {
                results.push(...Object.values(coll._hash));
              }
              if (typeof coll.toArray === 'function') {
                results.push(...coll.toArray());
              }
            } catch (_e) {}

            return results;
          };

          const processItem = (item, idx = 999999) => {
            if (!item) return;
            let idStr = '';
            if (item.id) {
              idStr = item.id._serialized || (typeof item.id === 'string' ? item.id : '');
            } else if (typeof item === 'string') {
              idStr = item;
            }

            const isGroup = idStr.endsWith('@g.us') || item.isGroup || (item.id && item.id.server === 'g.us');
            if (isGroup) {
              const name = item.subject || item.name || item.formattedTitle || item.formattedName || item.title || (item.contact && (item.contact.name || item.contact.formattedName));
              const ts = item.t || item.timestamp || item.conversationTimestamp || (item.lastReceivedKey && item.lastReceivedKey.t) || (item.contact && item.contact.t) || 0;
              const isPinned = Boolean(item.pin || item.isPinned);
              helperAdd(idStr, name, ts, idx, isPinned);
            }
          };

          // 1. Escanear window.Store (Chat collection preserva el orden nativo de WhatsApp)
          if (window.Store && typeof window.Store === 'object') {
            if (window.Store.Chat) {
              const chatModels = extractModelsFromAnyCollection(window.Store.Chat);
              chatModels.forEach((item, idx) => processItem(item, idx));
            }

            Object.keys(window.Store).forEach((key) => {
              if (key === 'Chat') return;
              try {
                const sub = window.Store[key];
                if (sub && typeof sub === 'object') {
                  const models = extractModelsFromAnyCollection(sub);
                  models.forEach((item, idx) => processItem(item, idx + 1000));
                }
              } catch (_e) {}
            });
          }

          // 2. Escanear window.require('WAWebCollections')
          try {
            if (window.require) {
              const collections = window.require('WAWebCollections');
              if (collections && typeof collections === 'object') {
                Object.keys(collections).forEach((key) => {
                  try {
                    const coll = collections[key];
                    const models = extractModelsFromAnyCollection(coll);
                    models.forEach((item, idx) => processItem(item, idx + 5000));
                  } catch (_e) {}
                });
              }
            }
          } catch (_e) {}

          // 3. Fallback para nombrar grupos sin nombre
          groupMap.forEach((entry, id) => {
            if (entry.name === 'Grupo sin nombre') {
              try {
                if (window.Store && window.Store.Contact) {
                  const contactModels = extractModelsFromAnyCollection(window.Store.Contact);
                  const found = contactModels.find((c) => (c.id && c.id._serialized === id) || c.id === id);
                  if (found) {
                    const realName = found.name || found.formattedName || found.pushname || found.shortName;
                    if (realName) {
                      entry.name = realName;
                    }
                  }
                }
              } catch (_e) {}
            }
          });

          // 4. Ordenar por: 1) Pinados primero, 2) Fecha del último mensaje recibida/enviada (descendente), 3) Orden original de WhatsApp
          return Array.from(groupMap.values())
            .sort((a, b) => {
              if (a.pinned !== b.pinned) {
                return a.pinned ? -1 : 1;
              }
              if (a.t !== b.t && a.t > 0 && b.t > 0) {
                return b.t - a.t;
              }
              return a.chatIndex - b.chatIndex;
            })
            .map((entry) => ({ id: entry.id, name: entry.name }));
        } catch (_e) {
          return [];
        }
      }, []);

      return Array.isArray(groups) ? groups : [];
    }

    async getGroups() {
      this.ensureReady();
      return this.groups;
    }

    async getGroupMembers(groupId) {
      this.ensureReady();

      if (!groupId) {
        throw new Error('Debes seleccionar un grupo para exportar sus miembros');
      }

      const chat = await this.client.getChatById(groupId);
      if (!chat || !chat.id || !chat.id._serialized || !chat.id._serialized.endsWith('@g.us')) {
        throw new Error('El chat seleccionado no es un grupo valido');
      }

      const participants = Array.isArray(chat.participants) ? chat.participants : [];
      const members = await Promise.all(
        participants.map(async (participant) => {
          const participantId = participant && participant.id && participant.id._serialized ? participant.id._serialized : '';
          if (!participantId) {
            return null;
          }

          const number = this.normalizePhoneForSend(participantId.replace('@c.us', ''));

          try {
            const contact = await this.client.getContactById(participantId);
            const name =
              (contact && (contact.name || contact.pushname || contact.shortName)) ||
              number ||
              'Sin nombre';

            return {
              name,
              number
            };
          } catch (_error) {
            return {
              name: number || 'Sin nombre',
              number
            };
          }
        })
      );

      const cleanedMembers = members.filter((member) => member && member.number);
      const uniqueByNumber = new Map();
      cleanedMembers.forEach((member) => {
        if (!uniqueByNumber.has(member.number)) {
          uniqueByNumber.set(member.number, member);
        }
      });

      const normalizedMembers = Array.from(uniqueByNumber.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
      const groupName = chat.name || chat.formattedTitle || 'grupo';

      return {
        groupId,
        groupName,
        members: normalizedMembers
      };
    }

    async loadContacts() {
      console.log('[WhatsAppService] Iniciando sincronizacion de contactos y chats individuales...');
      this.emit('contacts-sync-status', { state: 'loading' });

      try {
        const contactMap = new Map();

        const extractValidPhoneNumber = (item) => {
          if (!item) return null;

          // Excluir grupos, difusiones, canales, newsletters y estados
          if (item.isGroup || item.isBroadcast || item.isNewsletter || item.isChannel) {
            return null;
          }

          const itemId = item.id ? (item.id._serialized || (typeof item.id === 'string' ? item.id : '')) : '';
          if (itemId.endsWith('@g.us') || itemId.endsWith('@newsletter') || itemId.endsWith('@broadcast') || itemId === 'status@broadcast') {
            return null;
          }

          let rawNumber = '';

          // 1. Intentar extraer número real desde _data.phoneNumber (objeto o string)
          if (item._data && item._data.phoneNumber) {
            if (typeof item._data.phoneNumber === 'object' && item._data.phoneNumber.user) {
              rawNumber = String(item._data.phoneNumber.user);
            } else if (typeof item._data.phoneNumber === 'string') {
              rawNumber = String(item._data.phoneNumber).replace(/@.*/, '');
            }
          }

          // 2. Intentar extraer desde _data.pnUser
          if (!rawNumber && item._data && item._data.pnUser) {
            rawNumber = String(item._data.pnUser).replace(/@.*/, '');
          }

          // 3. Intentar extraer desde id si el servidor es c.us
          if (!rawNumber && item.id && item.id.server === 'c.us' && item.id.user) {
            rawNumber = String(item.id.user);
          }

          // 4. Intentar extraer desde _data.id si el servidor es c.us
          if (!rawNumber && item._data && item._data.id && item._data.id.server === 'c.us' && item._data.id.user) {
            rawNumber = String(item._data.id.user);
          }

          // 5. Intentar extraer desde item.number si NO es un servidor lid
          if (!rawNumber && item.number && item.id && item.id.server !== 'lid') {
            rawNumber = String(item.number);
          }

          // Limpiar dejando solo dígitos
          const cleanDigits = String(rawNumber || '').replace(/[^0-9]/g, '');

          // Debe tener entre 7 y 15 dígitos
          if (!cleanDigits || cleanDigits.length < 7 || cleanDigits.length > 15) {
            return null;
          }

          // Filtrar LIDs de WhatsApp (IDs sintéticos de 15 dígitos asignados por Meta que empiezan con 100-109, 254-259, 999)
          if (cleanDigits.length === 15) {
            const prefix3 = cleanDigits.substring(0, 3);
            const lidPrefixes = ['100', '101', '102', '103', '104', '105', '106', '107', '108', '109', '254', '255', '256', '257', '258', '259', '999'];
            if (lidPrefixes.includes(prefix3)) {
              return null;
            }
          }

          // Filtrar números inválidos o fijos como '00000000'
          if (cleanDigits.startsWith('000') || /^0+$/.test(cleanDigits)) {
            return null;
          }

          return cleanDigits;
        };

        const addCandidate = (item) => {
          if (!item) return;
          const validNumber = extractValidPhoneNumber(item);
          if (!validNumber) {
            return;
          }

          const serializedId = `${validNumber}@c.us`;
          const displayName = String(
            item.name || item.pushname || item.shortName || item.formattedTitle || item.formattedName || ''
          ).trim();

          // Preferir nombres reales sobre mostrar únicamente el número si existe un nombre disponible
          const finalName = (displayName && displayName !== validNumber) ? displayName : validNumber;

          if (!contactMap.has(serializedId)) {
            contactMap.set(serializedId, {
              id: serializedId,
              name: finalName,
              number: validNumber
            });
          } else if (finalName && finalName !== validNumber && contactMap.get(serializedId).name === validNumber) {
            contactMap.get(serializedId).name = finalName;
          }
        };

        // 1. Obtener contactos mediante getContacts()
        try {
          const rawContacts = await this.client.getContacts();
          if (Array.isArray(rawContacts)) {
            rawContacts.forEach(addCandidate);
          }
        } catch (errContacts) {
          console.warn('[WhatsAppService] Error al obtener contactos mediante getContacts():', errContacts.message || errContacts);
        }

        // 2. Obtener chats 1 a 1 activos mediante getChats()
        try {
          if (typeof this.client.getChats === 'function') {
            const rawChats = await this.client.getChats();
            if (Array.isArray(rawChats)) {
              rawChats.forEach((chat) => {
                if (chat && !chat.isGroup) {
                  addCandidate(chat.contact || chat);
                }
              });
            }
          }
        } catch (errChats) {
          console.warn('[WhatsAppService] Error al obtener chats mediante getChats():', errChats.message || errChats);
        }

        // 3. Ordenar alfabéticamente por nombre
        this.contacts = Array.from(contactMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));

        console.log(`[WhatsAppService] Sincronizacion de contactos completada: ${this.contacts.length} numeros de telefono reales cargados.`);
        this.emit('contacts-sync-status', { state: 'completed', total: this.contacts.length });
        this.emit('contacts-loaded', this.contacts);

        return this.contacts;
      } catch (error) {
        console.error('[WhatsAppService] Error sincronizando contactos:', error);
        this.emit('contacts-sync-status', { state: 'failed', error: error.message || String(error) });
        throw error;
      }
    }

    async getContacts() {
      this.ensureReady();

      if (!Array.isArray(this.contacts) || this.contacts.length === 0) {
        await this.loadContacts();
      }

      return this.contacts;
    }

    async sendToContacts(payload, onProgress) {
      return sendOperations.sendToContacts(this, payload, onProgress);
    }

    async sendToGroups(payload, onProgress) {
      return sendOperations.sendToGroups(this, payload, onProgress);
    }

    normalizePhoneForSend(value) {
      return sendOperations.normalizePhoneForSend(value);
    }

    async ensureAnalyticsReady() {
      await this.analyticsReady;
    }

    async logMessageInteraction({ destinationType, destinationId, message, files }) {
      await this.ensureAnalyticsReady();
      return this.messageAnalyticsService.logInteraction({
        destinationType,
        destinationId,
        message,
        files
      });
    }

    async getMessageStatistics({ referenceDate, filter } = {}) {
      await this.ensureAnalyticsReady();
      const effectiveDate = referenceDate ? new Date(referenceDate) : new Date();
      const dashboard = await this.messageAnalyticsService.getDashboard(effectiveDate, filter || {});
      return this.decorateTopDestinationNames(dashboard);
    }

    async exportMessageStatistics({ dialog, mainWindow, referenceDate, filter } = {}) {
      await this.ensureAnalyticsReady();
      const effectiveDate = referenceDate ? new Date(referenceDate) : new Date();
      const decorateStats = (stats) => this.decorateTopDestinationNames(stats);
      return MessageStatsExportService.exportToExcel({
        dialog,
        mainWindow,
        analyticsService: this.messageAnalyticsService,
        referenceDate: effectiveDate,
        decorateStats,
        filter: filter || {}
      });
    }

    async getDestinationStatuses({ destinationType, destinationIds, referenceDate } = {}) {
      await this.ensureAnalyticsReady();

      const normalizedType = destinationType === 'groups' ? 'groups' : 'contacts';
      const ids = Array.isArray(destinationIds) ? destinationIds : [];
      const effectiveDate = referenceDate ? new Date(referenceDate) : new Date();

      const expandedIdsSet = new Set();
      ids.forEach((id) => {
        const safeId = String(id || '').trim();
        if (!safeId) return;
        expandedIdsSet.add(safeId);
        if (normalizedType === 'contacts') {
          const digits = safeId.replace(/[^0-9]/g, '');
          if (digits) {
            expandedIdsSet.add(digits);
            expandedIdsSet.add(`${digits}@c.us`);
            expandedIdsSet.add(`${digits}@lid`);
          }
        }
      });

      const raw = await this.messageAnalyticsService.getDestinationStatuses({
        destinationType: normalizedType,
        destinationIds: Array.from(expandedIdsSet),
        referenceDate: effectiveDate
      });

      const byId = Object.create(null);
      ids.forEach((id) => {
        const safeId = String(id || '').trim();
        if (!safeId) {
          return;
        }

        const digits = safeId.replace(/[^0-9]/g, '');
        const found = raw.byId[safeId]
          || (digits && (raw.byId[digits] || raw.byId[`${digits}@c.us`] || raw.byId[`${digits}@lid`]))
          || null;

        byId[safeId] = {
          sentToday: Boolean(found && found.sentToday),
          interactions: Number(found && found.interactions ? found.interactions : 0),
          lastSentAt: found && found.lastSentAt ? found.lastSentAt : null,
          displayName: this.resolveDestinationName(normalizedType, safeId)
        };
      });

      return {
        destinationType: normalizedType,
        referenceDay: raw.referenceDay,
        byId
      };
    }

    async getMessageLogsForBackup({ limit = 200000 } = {}) {
      await this.ensureAnalyticsReady();
      return this.messageLogRepository.getAllMessageLogs(Number(limit) || 200000);
    }

    async getChatHistoryPreview({ chatId, limit = 180 } = {}) {
      this.ensureReady();

      const safeChatId = String(chatId || '').trim();
      if (!safeChatId) {
        throw new Error('Debes seleccionar un chat para ver el historial');
      }

      const chat = await this.client.getChatById(safeChatId);
      if (!chat) {
        throw new Error('No se encontro el chat solicitado');
      }

      const safeLimit = Math.max(20, Math.min(500, Number(limit) || 180));
      const rawMessages = await chat.fetchMessages({ limit: safeLimit });

      const items = (Array.isArray(rawMessages) ? rawMessages : [])
        .map((message) => {
          const text = String(message && (message.body || message.caption || '') || '').trim();
          if (!text) {
            return null;
          }

          const rawTimestamp = Number(message && message.timestamp ? message.timestamp : 0);
          const timestampMs = rawTimestamp > 0 ? rawTimestamp * 1000 : Date.now();
          const timestampIso = new Date(timestampMs).toISOString();
          const fromMe = Boolean(message && message.fromMe);
          const sender = fromMe
            ? 'Yo'
            : String(
              (message && message._data && message._data.notifyName)
              || (message && message.author)
              || (message && message.from)
              || 'Contacto'
            );

          return {
            id: String(message && (message.id && message.id._serialized ? message.id._serialized : '') || `${timestampMs}-${Math.random()}`),
            fromMe,
            sender,
            text,
            timestampIso
          };
        })
        .filter(Boolean)
        .sort((a, b) => new Date(a.timestampIso).getTime() - new Date(b.timestampIso).getTime());

      return {
        chatId: safeChatId,
        chatName: chat.name || chat.formattedTitle || safeChatId,
        items
      };
    }

    async sendScheduledMessage(schedule) {
      this.ensureReady();

      const payload = {
        targetType: schedule.targetType,
        message: schedule.messageText || '',
        files: Array.isArray(schedule.files) ? schedule.files : [],
        sendFilesFirst: schedule.sendFilesFirst !== false,
        delayMin: Number(schedule.delayMin || 3),
        delayMax: Number(schedule.delayMax || 6),
        unitDelayMin: Number(schedule.unitDelayMin || 1),
        unitDelayMax: Number(schedule.unitDelayMax || 3),
        complianceMode: true,
        riskProfile: 'medium'
      };

      if (schedule.targetType === 'groups') {
        payload.groupIds = [schedule.targetId];
        return this.sendToGroups(payload);
      }

      payload.numbers = String(schedule.targetId || '').replace('@c.us', '');
      return this.sendToContacts(payload);
    }

    resolveDestinationName(destinationType, destinationId) {
      if (!destinationId) {
        return '-';
      }

      if (destinationType === 'groups') {
        const group = this.groups.find((item) => item.id === destinationId);
        return group ? group.name : destinationId;
      }

      const contact = this.contacts.find((item) => item.id === destinationId);
      if (contact) {
        return contact.name || contact.number || destinationId;
      }

      return String(destinationId).replace('@c.us', '');
    }

    decorateTopDestinationNames(stats) {
      if (!stats || !stats.topDestinations) {
        return stats;
      }

      const decorateItem = (type, item) => {
        if (!item) {
          return null;
        }

        return {
          ...item,
          display_name: this.resolveDestinationName(type, item.destination_id)
        };
      };

      const ranking = Array.isArray(stats.exportTables && stats.exportTables.topRanking)
        ? stats.exportTables.topRanking.map((item) => ({
            ...item,
            destination_label: this.resolveDestinationName(item.destination_type, item.destination_id)
          }))
        : [];

      return {
        ...stats,
        topDestinations: {
          contact: decorateItem('contacts', stats.topDestinations.contact),
          group: decorateItem('groups', stats.topDestinations.group)
        },
        exportTables: stats.exportTables
          ? {
              ...stats.exportTables,
              topRanking: ranking
            }
          : stats.exportTables
      };
    }

    ensureReady() {
      if (!this.isReady || !this.client) {
        throw new Error('WhatsApp no esta listo');
      }
    }

    scheduleReconnect() {
      if (this.isReconnecting) {
        return;
      }

      this.isReconnecting = true;

      setTimeout(async () => {
        try {
          if (this.client) {
            await this.client.destroy();
          }
        } catch (error) {
          console.warn('No se pudo destruir el cliente previo:', error.message || error);
        }

        this.isReconnecting = false;
        this.start();
      }, 5000);
    }

    async getClientState() {
      if (!this.client) {
        return 'NOT_STARTED';
      }

      try {
        return await this.client.getState();
      } catch (error) {
        return 'DISCONNECTED';
      }
    }

    requestCancelSend() {
      this.isCancelRequested = true;
      console.log('[WhatsAppService] Cancelación de envío solicitada por el usuario');
    }

    resetCancelSend() {
      this.isCancelRequested = false;
    }

    sleep(milliseconds) {
      return new Promise((resolve) => setTimeout(resolve, milliseconds));
    }

    async cancellableSleep(milliseconds) {
      const checkInterval = 200;
      let elapsed = 0;
      while (elapsed < milliseconds) {
        if (this.isCancelRequested) {
          const err = new Error('CANCELLED_BY_USER');
          err.isCancelled = true;
          throw err;
        }
        const waitTime = Math.min(checkInterval, milliseconds - elapsed);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        elapsed += waitTime;
      }
      if (this.isCancelRequested) {
        const err = new Error('CANCELLED_BY_USER');
        err.isCancelled = true;
        throw err;
      }
    }

    /**
     * Retorna el estado completo del ciclo de vida de la sesión para handshake consultable.
     */
    getSessionStatus() {
      return {
        status: this.sessionState || (this.isReady ? 'ready' : (this.isAuthenticated ? 'authenticated' : 'disconnected')),
        isAuthenticated: Boolean(this.isAuthenticated),
        isReady: Boolean(this.isReady),
        isSyncingGroups: Boolean(this.isSyncingGroups),
        loadingPercent: typeof this.lastLoadingPercent === 'number' ? this.lastLoadingPercent : 0,
        loadingMessage: this.lastLoadingMessage || '',
        qrCode: this.lastQrCode || null,
        groupsCount: Array.isArray(this.groups) ? this.groups.length : 0,
        groups: Array.isArray(this.groups) ? this.groups : []
      };
    }

    async close() {
      if (!this.client) {
        this.isReady = false;
        this.isAuthenticated = false;
        this.isStarting = false;
        this.sessionState = 'disconnected';
        return;
      }

      console.log('[WhatsAppService] Cerrando cliente WhatsApp y liberando procesos...');
      const clientRef = this.client;
      this.client = null;
      this.isReady = false;
      this.isAuthenticated = false;
      this.isStarting = false;
      this.sessionState = 'disconnected';

      try {
        if (clientRef.pupBrowser) {
          const browserProcess = typeof clientRef.pupBrowser.process === 'function' ? clientRef.pupBrowser.process() : null;
          await Promise.race([
            clientRef.destroy(),
            this.sleep(2500)
          ]);
          if (browserProcess && !browserProcess.killed) {
            try {
              browserProcess.kill('SIGKILL');
            } catch (_) {}
          }
        } else {
          await clientRef.destroy();
        }
      } catch (err) {
        console.warn('[WhatsAppService] Error cerrando cliente WhatsApp:', err.message || err);
      }
      console.log('[WhatsAppService] Cliente WhatsApp cerrado y recursos liberados');
    }
}

module.exports = WhatsAppService;
