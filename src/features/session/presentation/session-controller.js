/**
 * WhatsApp Sender Electron - Session Feature
 * Presentation: Session Controller
 * 
 * Gestiona el ciclo de vida de la conexión y autenticación con WhatsApp Web
 * (QR, pantallas de carga, estado listo, desconexión y progreso de sincronización).
 */

class SessionController {
  /**
   * @param {Object} options
   * @param {Object} [options.stateRef] - Referencia a AppController para compatibilidad
   * @param {Object} [options.ui]
   * @param {Object} [options.ipcClient]
   */
  constructor(options = {}) {
    this.stateRef = options.stateRef || null;
    this.ui = options.ui || null;
    this.ipcClient = options.ipcClient || (this.stateRef && this.stateRef.ipcClient) || null;
    this._isReady = false;
  }

  get isReady() {
    if (this.stateRef && this.stateRef.isReady !== undefined) {
      return this.stateRef.isReady;
    }
    return this._isReady;
  }

  set isReady(value) {
    this._isReady = Boolean(value);
    if (this.stateRef) {
      this.stateRef.isReady = this._isReady;
    }
  }

  _getUi() {
    if (this.ui) return this.ui;
    if (this.stateRef && this.stateRef.ui) {
      this.ui = this.stateRef.ui;
      return this.ui;
    }
    return null;
  }

  bindIpcEvents() {
    if (!this.ipcClient) return;
    const ui = this._getUi();

    this.ipcClient.on('server-ready', () => {
      if (ui) ui.updateStatus('Conectando a WhatsApp Web...', 'connecting');
    });

    this.ipcClient.on('whatsapp-qr', async (_event, qrCodeValue) => {
      try {
        const qrCanvas = await QRCode.toCanvas(qrCodeValue, {
          width: 240,
          margin: 2,
          color: { dark: '#0d1b16', light: '#f6fff9' }
        });

        if (ui) ui.showQrCanvas(qrCanvas);
      } catch (error) {
        console.error('Error renderizando QR:', error);
        if (ui) ui.showToast('No se pudo renderizar el codigo QR', 'error');
      }
    });

    this.ipcClient.on('whatsapp-authenticated', () => {
      console.log('[WhatsApp] Sesión autenticada. Mostrando pantalla de carga...');
      if (ui) {
        ui.showSessionLoading(
          'WhatsApp autenticado correctamente',
          'Iniciando sesión en WhatsApp y preparando la aplicación...',
          25
        );
        ui.showToast('¡Código QR escaneado correctamente!', 'success');
      }
    });

    this.ipcClient.on('whatsapp-loading-screen', (_event, payload) => {
      const percent = payload && payload.percent ? Number(payload.percent) : 0;
      const message = payload && payload.message ? payload.message : 'Descargando datos de WhatsApp...';
      if (ui) {
        ui.updateSessionLoadingStatus(
          `Cargando sesión de WhatsApp (${Math.round(percent)}%)...`,
          `${message}. Por favor NO CIERRE el programa.`,
          percent,
          { subtitle: 'WhatsApp autenticado correctamente. Cargando sesión...' }
        );
      }
    });

    this.ipcClient.on('whatsapp-ready', () => {
      this.isReady = true;
      if (ui) {
        ui.updateStatus('WhatsApp conectado', 'ready');
        ui.updateSessionLoadingStatus(
          'WhatsApp autenticado y listo',
          'Sincronizando chats, grupos y contactos...',
          95,
          { subtitle: 'WhatsApp autenticado correctamente' }
        );
      }
      console.log('[Groups] WhatsApp listo. Iniciando sincronizacion de grupos...');
      if (this.stateRef && typeof this.stateRef.loadGroups === 'function') {
        this.stateRef.loadGroups();
      }
    });

    this.ipcClient.on('whatsapp-disconnected', (_event, reason) => {
      this.isReady = false;
      if (ui) {
        ui.hideQr();
        ui.updateStatus('WhatsApp desconectado', 'error');
        ui.showToast(`Sesion desconectada: ${reason || 'sin detalle'}`, 'warning');
      }
    });

    this.ipcClient.on('groups-loaded', (_event, groups) => {
      if (this.stateRef) {
        this.stateRef.groups = groups;
      }
      console.log(`[Groups] Sincronizacion completada. Grupos cargados: ${groups.length}`);
      if (this.stateRef && typeof this.stateRef.applyGroupFilter === 'function') {
        this.stateRef.applyGroupFilter();
      }
      if (ui) {
        ui.renderGroupExportOptions(groups, this.stateRef ? this.stateRef.exportGroupId : '');
        if (this.stateRef) {
          this.stateRef.refreshDestinationStatuses('groups', { repaint: true });
          ui.renderScheduleTargetOptions(
            this.stateRef.scheduleDraft.targetType,
            this.stateRef.contacts,
            groups,
            this.stateRef.scheduleDraft.targetId
          );
        }
      }
    });

    this.ipcClient.on('groups-sync-status', (_event, payload) => {
      if (!payload || !payload.state) return;

      if (payload.state === 'loading') {
        console.log('[Groups] Sincronizando grupos desde WhatsApp...');
        if (ui) {
          ui.updateStatus('Sincronizando grupos...', 'connecting');
          ui.updateSessionLoadingStatus(
            'Sincronizando chats y grupos de WhatsApp...',
            'Buscando y organizando grupos en segundo plano...',
            98
          );
        }
        return;
      }

      if (payload.state === 'completed') {
        console.log(`[Groups] Sincronizacion de grupos finalizada: ${payload.total} grupos.`);
        if (this.isReady && ui) {
          ui.updateStatus('WhatsApp conectado', 'ready');
        }
        if (ui) {
          ui.updateSessionLoadingStatus(
            '¡Sincronización completada al 100%!',
            `Se sincronizaron ${payload.total || 0} grupos correctamente. Abriendo aplicación...`,
            100,
            { title: '¡WhatsApp Conectado y Sincronizado!' }
          );
          setTimeout(() => {
            ui.hideQr();
          }, 1200);
        }
        return;
      }

      if (payload.state === 'failed') {
        console.error(`[Groups] Error al sincronizar grupos: ${payload.error || 'sin detalle'}`);
        if (ui) {
          ui.showToast('No se pudieron sincronizar grupos en este intento', 'warning');
          setTimeout(() => {
            ui.hideQr();
          }, 1500);
        }
      }
    });

    if (ui && ui.cancelSendBtn) {
      ui.cancelSendBtn.addEventListener('click', async () => {
        if (ui.cancelSendBtn.disabled) return;

        ui.cancelSendBtn.disabled = true;
        ui.cancelSendBtn.innerHTML = '<span class="cancel-send-icon">⏳</span> <span>Cancelando...</span>';
        ui.updateSendProgress({ status: 'cancelling' });

        try {
          await this.ipcClient.invoke('cancel-send');
        } catch (error) {
          console.error('[SessionController] Error enviando señal de cancelación:', error);
        }
      });
    }

    if (ui && ui.taskDock) {
      ui.taskDock.on('cancel', async () => {
        ui.updateSendProgress({ status: 'cancelling' });
        try {
          await this.ipcClient.invoke('cancel-send');
        } catch (error) {
          console.error('[SessionController] Error cancelando desde TaskDock:', error);
        }
      });
    }

    this.ipcClient.on('send-progress', (_event, progress) => {
      const activeSendMode = this.stateRef ? this.stateRef.activeSendMode : null;
      if (!progress || !activeSendMode || progress.targetType !== activeSendMode) {
        return;
      }

      if (ui) {
        ui.updateSendProgress(progress);
        if (progress.status === 'completed' || progress.status === 'cancelled') {
          setTimeout(() => ui.hideProgress(), 2400);
        }
      }
    });
  }
}

module.exports = {
  SessionController
};
