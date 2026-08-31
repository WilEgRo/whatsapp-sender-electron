const { Client, LocalAuth } = require('whatsapp-web.js');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
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

      this.client.on('ready', () => {
        if (this._loadingFailsafeTimer) {
          clearTimeout(this._loadingFailsafeTimer);
          this._loadingFailsafeTimer = null;
        }

        const wasAlreadyReady = this.isReady;
        this.sessionState = 'ready';
        this.isReady = true;
        this.isStarting = false;
        this.isAuthenticated = true;
        this.lastQrCode = null;

        if (!wasAlreadyReady) {
          console.log('[WhatsAppService] WhatsApp Web listo para operar. Emitiendo evento ready...');
          this.emit('ready');
          if (onStarted) onStarted();
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
        // Si el cliente ya está en estado 'ready', NO retroceder el estado a 'loading'
        if (this.isReady || this.sessionState === 'ready') {
          console.log(`[WhatsAppService] Loading screen post-ready ignorado (${percent}% - ${message})`);
          return;
        }

        this.sessionState = 'loading';
        this.lastLoadingPercent = Number(percent) || 0;
        this.lastLoadingMessage = message || '';
        console.log(`[WhatsAppService] Cargando sesion: ${percent}% - ${message}`);
        this.emit('loading_screen', { percent, message });

        // Failsafe contra bloqueo al 99%: si alcanza >= 98% y tras 4 segundos 'ready' no ha disparado,
        // verificar el estado del cliente y forzar ready si ya está conectado
        if (Number(percent) >= 98 && !this._loadingFailsafeTimer) {
          this._loadingFailsafeTimer = setTimeout(async () => {
            if (!this.isReady && this.sessionState !== 'disconnected') {
              console.log('[WhatsAppService] Failsafe 99% activado: verificando operatividad del cliente...');
              try {
                const state = await this.client.getState().catch(() => null);
                if (state === 'CONNECTED' || state === null) {
                  console.log('[WhatsAppService] Cliente operativo detectado tras 99%. Forzando estado ready...');
                  this.isReady = true;
                  this.sessionState = 'ready';
                  this.emit('ready');
                  this.loadGroups().catch(() => {});
                }
              } catch (_) {}
            }
          }, 3500);
        }
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

    async safeEvaluate(evalFn, fallback = null, maxRetries = 4, delayMs = 1200, ...args) {
      for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        try {
          if (!this.client || !this.client.pupPage || this.client.pupPage.isClosed()) {
            return fallback;
          }
          return await this.client.pupPage.evaluate(evalFn, ...args);
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

    /**
     * Extrae mensajes directamente de la memoria de WhatsApp Web (Chat.msgs)
     * sin invocar librerías externas o métodos minificados que fallen con 'Error: r'.
     */
    async extractChatMessagesDirectly(targetChatId, limit = 200) {
      if (!this.client || !this.client.pupPage || this.client.pupPage.isClosed()) {
        return [];
      }

      return await this.safeEvaluate(
        async (chatId, maxLimit) => {
          try {
            let chatObj = null;

            // 1. Obtener el chat usando window.WWebJS.getChat sin getAsModel (evita WWebJS.getChatModel que lanza 'r' en grupos)
            if (window.WWebJS && typeof window.WWebJS.getChat === 'function') {
              try {
                chatObj = await window.WWebJS.getChat(chatId, { getAsModel: false });
              } catch (_) {}
            }

            // 2. Si no se obtuvo, buscar directamente en WAWebCollections
            if (!chatObj && window.require && typeof window.require === 'function') {
              try {
                const widFactory = window.require('WAWebWidFactory');
                const wid = widFactory ? widFactory.createWid(chatId) : null;
                const collections = window.require('WAWebCollections');
                if (collections && collections.Chat && wid) {
                  chatObj = collections.Chat.get(wid);
                }
              } catch (_) {}

              if (!chatObj) {
                try {
                  const collections = window.require('WAWebCollections');
                  if (collections && collections.Chat && typeof collections.Chat.getModelsArray === 'function') {
                    const chats = collections.Chat.getModelsArray();
                    chatObj = (chats || []).find((c) => c && c.id && c.id._serialized === chatId);
                  }
                } catch (_) {}
              }
            }

            let models = [];
            if (chatObj && chatObj.msgs) {
              if (typeof chatObj.msgs.getModelsArray === 'function') {
                models = chatObj.msgs.getModelsArray();
              } else if (Array.isArray(chatObj.msgs.models)) {
                models = chatObj.msgs.models;
              } else if (Array.isArray(chatObj.msgs._models)) {
                models = chatObj.msgs._models;
              }

              // Intentar paginar mensajes anteriores con protección try/catch contra 'r'
              if (chatObj && maxLimit > 0 && models.length < maxLimit && window.require) {
                try {
                  const loadModule = window.require('WAWebChatLoadMessages');
                  if (loadModule && typeof loadModule.loadEarlierMsgs === 'function') {
                    while (models.length < maxLimit) {
                      const earlier = await loadModule.loadEarlierMsgs({ chat: chatObj });
                      if (!earlier || !earlier.length) break;
                      models = [...earlier, ...models];
                    }
                  }
                } catch (_) {
                  // Si loadEarlierMsgs falla o arroja 'r', se preservan los modelos ya obtenidos
                }
              }
            }

            // Fallback a colección global Msg si no hay modelos en el chat
            if ((!Array.isArray(models) || models.length === 0) && window.require) {
              try {
                const collections = window.require('WAWebCollections');
                if (collections && collections.Msg && typeof collections.Msg.getModelsArray === 'function') {
                  models = collections.Msg.getModelsArray().filter((m) => {
                    if (!m || !m.id) return false;
                    const remote = m.id.remote ? (m.id.remote._serialized || m.id.remote) : '';
                    return remote === chatId;
                  });
                }
              } catch (_) {}
            }

            if (!Array.isArray(models) || models.length === 0) {
              return [];
            }

            // Helper para detectar cadenas base64 gigantes de imágenes
            const isBase64Image = (str) => {
              if (!str || typeof str !== 'string') return false;
              if (str.startsWith('data:image/') || str.startsWith('data:application/')) return true;
              if (str.startsWith('/9j/') && str.length > 40) return true;
              if (str.startsWith('iVBORw') && str.length > 40) return true;
              if (str.startsWith('UklGR') && str.length > 40) return true;
              if (str.length > 100 && !/\s/.test(str) && /^[A-Za-z0-9+/=_-]+$/.test(str)) return true;
              return false;
            };

            // Mapear de forma segura sin invocar librerías externas que lancen 'r' (como WALinkify)
            const extracted = [];
            for (let i = 0; i < models.length; i += 1) {
              const m = models[i];
              if (!m || m.isNotification) continue;

              const isFromMe = Boolean(m.id && m.id.fromMe !== undefined ? m.id.fromMe : m.fromMe);
              const mType = String(m.type || (m._data && m._data.type) || '').toLowerCase();
              const caption = String(m.caption || (m._data && m._data.caption) || '').trim();
              const rawBody = String(m.body || (m._data && m._data.body) || '').trim();

              let textContent = '';
              if (mType === 'image' || m.hasMedia && (!mType || mType === 'image') || isBase64Image(rawBody)) {
                textContent = caption ? `[📷 Imagen: ${caption}]` : '[📷 Imagen no disponible]';
              } else if (mType === 'sticker') {
                textContent = '[Sticker]';
              } else if (mType === 'video') {
                textContent = caption ? `[🎥 Video: ${caption}]` : '[🎥 Video no disponible]';
              } else if (mType === 'audio' || mType === 'ptt') {
                textContent = '[🎵 Audio]';
              } else if (mType === 'document') {
                const fname = m.filename || (m._data && m._data.filename) || caption || 'Documento adjunto';
                textContent = `[📄 Documento: ${fname}]`;
              } else {
                textContent = rawBody || caption;
                if (isBase64Image(textContent)) {
                  textContent = caption ? `[📷 Imagen: ${caption}]` : '[📷 Imagen no disponible]';
                }
              }

              if (!textContent) continue;

              const rawTime = Number(m.t || m.timestamp || (m._data && m._data.t) || 0);
              const author = m.author ? (m.author._serialized || String(m.author)) : (m.from || '');
              const senderName = m.notifyName
                || (m._data && m._data.notifyName)
                || (m.senderObj && (m.senderObj.name || m.senderObj.pushname))
                || author
                || '';

              const messageId = String(
                (m.id && m.id._serialized) || (m._data && m._data.id && m._data.id._serialized) || m.id || `${rawTime}-${i}`
              );

              extracted.push({
                id: messageId,
                fromMe: isFromMe,
                sender: isFromMe ? 'Yo' : senderName,
                text: textContent,
                timestamp: rawTime,
                author,
                notifyName: senderName
              });
            }

            extracted.sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0));

            if (maxLimit > 0 && extracted.length > maxLimit) {
              return extracted.slice(extracted.length - maxLimit);
            }

            return extracted;
          } catch (err) {
            return [];
          }
        },
        [],
        3,
        800,
        targetChatId,
        limit
      );
    }

    async getChatHistoryPreview({ chatId, limit = 180 } = {}) {
      this.ensureReady();

      const safeChatId = String(chatId || '').trim();
      if (!safeChatId) {
        throw new Error('Debes seleccionar un chat para ver el historial');
      }

      // Normalizar identificador para WhatsApp
      const targetChatId = (safeChatId.includes('@') || safeChatId.endsWith('@g.us') || safeChatId.endsWith('@c.us'))
        ? safeChatId
        : `${safeChatId}@c.us`;

      let chat = null;
      try {
        if (this.client && typeof this.client.getChatById === 'function') {
          chat = await this.client.getChatById(targetChatId).catch(() => null);
          if (!chat && targetChatId !== safeChatId) {
            chat = await this.client.getChatById(safeChatId).catch(() => null);
          }
        }
      } catch (err) {
        console.warn(`[WhatsAppService] Error en getChatById para ${targetChatId}:`, err.message || err);
      }

      const safeLimit = Math.max(20, Math.min(500, Number(limit) || 180));
      let rawMessages = [];

      // Intento 1: chat.fetchMessages() de whatsapp-web.js (protegido contra fallos minificados como 'r')
      if (chat && typeof chat.fetchMessages === 'function') {
        try {
          const fetched = await chat.fetchMessages({ limit: safeLimit });
          if (Array.isArray(fetched) && fetched.length > 0) {
            rawMessages = fetched;
          }
        } catch (fetchErr) {
          console.warn(`[WhatsAppService] chat.fetchMessages no disponible o falló (${fetchErr && (fetchErr.message || fetchErr)}), procediendo con extracción directa...`);
        }
      }

      // Intento 2: Si fetchMessages falló o devolvió vacío, extraer directamente de la memoria de WhatsApp Web
      if (!rawMessages || rawMessages.length === 0) {
        try {
          const directMsgs = await this.extractChatMessagesDirectly(targetChatId, safeLimit);
          if (Array.isArray(directMsgs) && directMsgs.length > 0) {
            rawMessages = directMsgs;
          }
        } catch (directErr) {
          console.warn(`[WhatsAppService] Extracción directa falló para ${targetChatId}:`, directErr && (directErr.message || directErr));
        }
      }

      // Resolver nombre del chat
      let chatName = (chat && (chat.name || chat.formattedTitle)) || '';
      if (!chatName) {
        if (this.groups && Array.isArray(this.groups)) {
          const foundG = this.groups.find((g) => g.id === targetChatId || g.id === safeChatId);
          if (foundG) chatName = foundG.name;
        }
        if (!chatName && this.contacts && Array.isArray(this.contacts)) {
          const foundC = this.contacts.find((c) => c.id === targetChatId || c.id === safeChatId);
          if (foundC) chatName = foundC.name;
        }
      }
      if (!chatName) {
        chatName = safeChatId;
      }

      const isBase64String = (str) => {
        if (!str || typeof str !== 'string') return false;
        if (str.startsWith('data:image/') || str.startsWith('data:application/')) return true;
        if (str.startsWith('/9j/') && str.length > 40) return true;
        if (str.startsWith('iVBORw') && str.length > 40) return true;
        if (str.startsWith('UklGR') && str.length > 40) return true;
        if (str.length > 100 && !/\s/.test(str) && /^[A-Za-z0-9+/=_-]+$/.test(str)) return true;
        return false;
      };

      const items = (Array.isArray(rawMessages) ? rawMessages : [])
        .map((message) => {
          const type = String((message && message.type) || (message && message._data && message._data.type) || '').toLowerCase();
          const caption = String((message && message.caption) || (message && message._data && message._data.caption) || '').trim();
          const rawBody = String(
            (message && (message.text || message.body)) ||
            (message && message._data && (message._data.text || message._data.body)) ||
            ''
          ).trim();

          let text = '';
          if (type === 'image' || (message && message.hasMedia && (!type || type === 'image')) || isBase64String(rawBody)) {
            text = caption ? `[📷 Imagen: ${caption}]` : '[📷 Imagen no disponible]';
          } else if (type === 'sticker') {
            text = '[Sticker]';
          } else if (type === 'video') {
            text = caption ? `[🎥 Video: ${caption}]` : '[🎥 Video no disponible]';
          } else if (type === 'audio' || type === 'ptt') {
            text = '[🎵 Audio]';
          } else if (type === 'document') {
            const fname = (message && message.filename) || (message && message._data && message._data.filename) || caption || 'Documento adjunto';
            text = `[📄 Documento: ${fname}]`;
          } else {
            text = rawBody || caption;
            if (isBase64String(text)) {
              text = caption ? `[📷 Imagen: ${caption}]` : '[📷 Imagen no disponible]';
            }
          }

          if (!text) {
            return null;
          }

          const rawTimestamp = Number(message && (message.timestamp || message.t) ? (message.timestamp || message.t) : 0);
          const timestampMs = rawTimestamp > 0 ? (rawTimestamp > 1e11 ? rawTimestamp : rawTimestamp * 1000) : Date.now();
          const timestampIso = new Date(timestampMs).toISOString();
          const fromMe = Boolean(message && message.fromMe);
          const sender = fromMe
            ? 'Yo'
            : String(
              (message && message._data && message._data.notifyName)
              || (message && message.notifyName)
              || (message && message.author)
              || (message && message.sender)
              || (message && message.from)
              || 'Contacto'
            );

          const hasMedia = Boolean(message && (message.hasMedia || ['image', 'sticker', 'video', 'audio', 'ptt', 'document'].includes(type)));
          const mediaMimeType = String((message && (message.mimetype || (message._data && message._data.mimetype))) || '');
          const mediaFilename = String((message && (message.filename || (message._data && message._data.filename))) || '');

          return {
            id: String(message && (message.id && message.id._serialized ? message.id._serialized : message.id) || `${timestampMs}-${Math.random()}`),
            fromMe,
            sender,
            text,
            timestampIso,
            type: type || 'chat',
            hasMedia,
            mediaAvailable: hasMedia,
            caption,
            mediaMimeType,
            mediaFilename
          };
        })
        .filter(Boolean)
        .sort((a, b) => new Date(a.timestampIso).getTime() - new Date(b.timestampIso).getTime());

      return {
        chatId: targetChatId,
        chatName,
        items
      };
    }

    /**
     * Descarga bajo demanda el archivo multimedia de un mensaje específico.
     * Convierte inmediatamente el Base64 efímero en un archivo temporal en disco,
     * liberando el buffer y devolviendo al Renderer solo metadatos y ruta de archivo.
     * 
     * @param {Object} params
     * @param {string} params.chatId
     * @param {string} params.messageId
     * @returns {Promise<{ success: boolean, messageId: string, tempFilePath?: string, mimeType?: string, filename?: string, size?: number, error?: string }>}
     */
    async downloadMessageMedia({ chatId, messageId } = {}) {
      if (!this.client || !this.isReady) {
        return {
          success: false,
          messageId: messageId || '',
          error: 'WhatsApp no está conectado o listo.'
        };
      }

      if (!messageId) {
        return {
          success: false,
          messageId: '',
          error: 'messageId es requerido para descargar multimedia.'
        };
      }

      try {
        let mediaData = null;
        let mimeType = 'application/octet-stream';
        let originalFilename = '';

        // 1. Intento vía getMessageById si está disponible en whatsapp-web.js
        if (typeof this.client.getMessageById === 'function') {
          try {
            const msgObj = await this.client.getMessageById(messageId);
            if (msgObj && typeof msgObj.downloadMedia === 'function') {
              const resMedia = await msgObj.downloadMedia();
              if (resMedia && resMedia.data) {
                mediaData = resMedia.data;
                mimeType = resMedia.mimetype || mimeType;
                originalFilename = resMedia.filename || '';
              }
            }
          } catch (_) {}
        }

        // 2. Fallback vía browser evaluation en colecciones Msg / WAWebCollections
        if (!mediaData && this.client.pupPage && typeof this.client.pupPage.evaluate === 'function') {
          try {
            const evalResult = await this.safeEvaluate(async (msgId) => {
              try {
                const collections = window.require && window.require('WAWebCollections');
                let m = collections && collections.Msg ? collections.Msg.get(msgId) : null;
                if (!m && collections && collections.Msg && typeof collections.Msg.getMessagesById === 'function') {
                  const ms = await collections.Msg.getMessagesById([msgId]);
                  m = ms && ms.messages ? ms.messages[0] : null;
                }
                if (!m) return null;

                if (m.mediaData && m.mediaData.mediaStage !== 'RESOLVED' && typeof m.downloadMedia === 'function') {
                  await m.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1 });
                }

                if (window.require) {
                  const dlManager = window.require('WAWebDownloadManager');
                  if (dlManager && dlManager.downloadManager && typeof dlManager.downloadManager.downloadAndMaybeDecrypt === 'function') {
                    const decrypted = await dlManager.downloadManager.downloadAndMaybeDecrypt({
                      directPath: m.directPath,
                      encFilehash: m.encFilehash,
                      filehash: m.filehash,
                      mediaKey: m.mediaKey,
                      mediaKeyTimestamp: m.mediaKeyTimestamp,
                      type: m.type,
                      signal: new AbortController().signal
                    });
                    if (decrypted && window.WWebJS && typeof window.WWebJS.arrayBufferToBase64Async === 'function') {
                      const b64 = await window.WWebJS.arrayBufferToBase64Async(decrypted);
                      return {
                        data: b64,
                        mimetype: m.mimetype,
                        filename: m.filename
                      };
                    }
                  }
                }
                return null;
              } catch (_) {
                return null;
              }
            }, messageId);

            if (evalResult && evalResult.data) {
              mediaData = evalResult.data;
              mimeType = evalResult.mimetype || mimeType;
              originalFilename = evalResult.filename || originalFilename;
            }
          } catch (_) {}
        }

        if (!mediaData) {
          return {
            success: false,
            messageId,
            error: 'El archivo multimedia ya no está disponible en WhatsApp Web.'
          };
        }

        // 3. Conversión inmediata de Base64 a Buffer binario y liberación de memoria Base64
        const binaryBuffer = Buffer.from(mediaData, 'base64');
        mediaData = null; // Liberar referencia inmediatamente

        const size = binaryBuffer.length;
        const MAX_SINGLE_BYTES = 25 * 1024 * 1024; // 25 MB
        if (size > MAX_SINGLE_BYTES) {
          return {
            success: false,
            messageId,
            error: `El archivo multimedia (${Math.round(size / 1024 / 1024)} MB) supera el límite permitido de 25 MB.`
          };
        }

        // 4. Determinar extensión adecuada
        const extMap = {
          'image/jpeg': '.jpg',
          'image/png': '.png',
          'image/webp': '.webp',
          'image/gif': '.gif',
          'video/mp4': '.mp4',
          'video/3gpp': '.3gp',
          'audio/ogg': '.ogg',
          'audio/mpeg': '.mp3',
          'audio/mp4': '.m4a',
          'application/pdf': '.pdf',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx'
        };
        const ext = extMap[mimeType] || path.extname(originalFilename) || '.bin';

        // 5. Directorio temporal seguro en OS tmpdir
        const tempBaseDir = path.join(os.tmpdir(), 'whatsapp-export-media');
        await fs.promises.mkdir(tempBaseDir, { recursive: true });

        const safeIdHash = crypto.createHash('md5').update(String(messageId)).digest('hex').slice(0, 12);
        const tempFileName = `media_${Date.now()}_${safeIdHash}${ext}`;
        const tempFilePath = path.join(tempBaseDir, tempFileName);

        await fs.promises.writeFile(tempFilePath, binaryBuffer);

        return {
          success: true,
          messageId,
          tempFilePath,
          mimeType,
          filename: originalFilename || tempFileName,
          size
        };
      } catch (err) {
        return {
          success: false,
          messageId,
          error: err && err.message ? err.message : String(err)
        };
      }
    }

    /**
     * Limpia de forma segura los archivos temporales creados para una exportación.
     * Solo elimina archivos ubicados dentro de la carpeta temporal whatsapp-export-media.
     * 
     * @param {Object} params
     * @param {Array<string>} params.filePaths
     * @returns {Promise<{ success: boolean, removedCount: number }>}
     */
    async cleanupTempMedia({ filePaths = [] } = {}) {
      if (!Array.isArray(filePaths) || filePaths.length === 0) {
        return { success: true, removedCount: 0 };
      }

      const tempBaseDir = path.resolve(os.tmpdir(), 'whatsapp-export-media');
      let removedCount = 0;

      for (const filePath of filePaths) {
        try {
          if (typeof filePath !== 'string') continue;
          const resolvedPath = path.resolve(filePath);
          // Asegurar que el archivo esté estrictamente dentro de tempBaseDir (prevenir path traversal)
          if (resolvedPath.startsWith(tempBaseDir) && fs.existsSync(resolvedPath)) {
            await fs.promises.unlink(resolvedPath);
            removedCount += 1;
          }
        } catch (_) {
          // Ignorar errores individuales en limpieza
        }
      }

      return { success: true, removedCount };
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
