const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('../../src/main/ipc/handlers');

app.disableHardwareAcceleration();

let win;
const consoleErrors = [];
const runtimeExceptions = [];
const cspErrors = [];

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({});
  });

  win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  });

  registerIpcHandlers({
    ipcMain,
    dialog,
    getMainWindow: () => win,
    getWhatsAppService: () => null,
    getScheduledMessageService: () => null
  });

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (/syntaxerror/i.test(message) || /uncaught/i.test(message) || level >= 3) {
      consoleErrors.push({ level, message, line, sourceId });
    }
    if (/content security policy/i.test(message) || /violates the following/i.test(message) || /refused to apply inline style/i.test(message)) {
      cspErrors.push(message);
    }
  });

  win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
    process.exit(1);
  });

  await win.loadFile(path.join(__dirname, '../../src/renderer/index.html'));

  // Wait for renderer initialization
  setTimeout(async () => {
    try {
      const diagnostic = await win.webContents.executeJavaScript(`
        (async () => {
          const errorsAfterNavigation = [];
          window.addEventListener('error', (e) => {
            errorsAfterNavigation.push({ type: 'error', message: e.message, filename: e.filename, lineno: e.lineno });
          });
          window.addEventListener('unhandledrejection', (e) => {
            errorsAfterNavigation.push({ type: 'unhandledrejection', reason: String(e.reason) });
          });

          // 1. INVENTORY OF TABS AND PANELS
          const tabButtons = Array.from(document.querySelectorAll('[data-tab]')).map(btn => ({
            id: btn.id,
            tab: btn.dataset.tab,
            text: (btn.textContent || '').trim().replace(/\\s+/g, ' '),
            classes: Array.from(btn.classList),
            disabled: btn.disabled,
            hidden: btn.classList.contains('hidden') || btn.style.display === 'none'
          }));

          const panels = Array.from(document.querySelectorAll('[data-panel]')).map(p => {
            const cs = window.getComputedStyle(p);
            const rect = p.getBoundingClientRect();
            return {
              id: p.id,
              panel: p.dataset.panel,
              classes: Array.from(p.classList),
              display: cs.display,
              visibility: cs.visibility,
              opacity: cs.opacity,
              position: cs.position,
              zIndex: cs.zIndex,
              width: rect.width,
              height: rect.height,
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              visible: rect.width > 0 && rect.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0
            };
          });

          // Check parent container of panels
          const canvasEl = document.getElementById('appCanvas');
          const canvasComputed = canvasEl ? {
            tag: canvasEl.tagName,
            id: canvasEl.id,
            classes: Array.from(canvasEl.classList),
            display: window.getComputedStyle(canvasEl).display,
            visibility: window.getComputedStyle(canvasEl).visibility,
            opacity: window.getComputedStyle(canvasEl).opacity,
            overflow: window.getComputedStyle(canvasEl).overflow,
            overflowY: window.getComputedStyle(canvasEl).overflowY,
            width: canvasEl.getBoundingClientRect().width,
            height: canvasEl.getBoundingClientRect().height
          } : null;

          // Initial active state
          const initialActiveTab = document.querySelector('[data-tab].active')?.dataset.tab || null;
          const initialActivePanels = Array.from(document.querySelectorAll('[data-panel].active')).map(p => p.dataset.panel);

          // 2. SIMULATE CLICKS ON EVERY TAB SEQUENTIALLY
          const clickResults = [];

          for (const tabInfo of tabButtons) {
            const btn = document.querySelector(\`[data-tab="\${tabInfo.tab}"]\`);
            const errsBefore = errorsAfterNavigation.length;

            let clickDispatched = false;
            if (btn) {
              btn.click();
              clickDispatched = true;
            }

            // Wait a tick for DOM & animations
            await new Promise(r => setTimeout(r, 200));

            const activeBtn = document.querySelector('[data-tab].active')?.dataset.tab || null;
            const activePanelsAfterClick = Array.from(document.querySelectorAll('[data-panel].active')).map(p => p.dataset.panel);
            const targetPanel = document.querySelector(\`[data-panel="\${tabInfo.tab}"]\`);

            let panelAudit = null;
            if (targetPanel) {
              const cs = window.getComputedStyle(targetPanel);
              const rect = targetPanel.getBoundingClientRect();

              // Check parents up to body
              const parentChain = [];
              let curr = targetPanel.parentElement;
              while (curr && curr !== document.body) {
                const parentCs = window.getComputedStyle(curr);
                const parentRect = curr.getBoundingClientRect();
                parentChain.push({
                  tag: curr.tagName.toLowerCase(),
                  id: curr.id || null,
                  className: curr.className || null,
                  display: parentCs.display,
                  visibility: parentCs.visibility,
                  opacity: parentCs.opacity,
                  overflow: parentCs.overflow,
                  rect: { width: parentRect.width, height: parentRect.height }
                });
                curr = curr.parentElement;
              }

              panelAudit = {
                id: targetPanel.id,
                panel: tabInfo.tab,
                classes: Array.from(targetPanel.classList),
                isActiveClass: targetPanel.classList.contains('active'),
                display: cs.display,
                visibility: cs.visibility,
                opacity: cs.opacity,
                position: cs.position,
                zIndex: cs.zIndex,
                pointerEvents: cs.pointerEvents,
                overflow: cs.overflow,
                transform: cs.transform,
                width: rect.width,
                height: rect.height,
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                visible: rect.width > 0 && rect.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden',
                parentChain
              };
            }

            const currentTitleEl = document.getElementById('currentSectionTitle');
            const currentDescEl = document.getElementById('currentSectionDesc');

            clickResults.push({
              tab: tabInfo.tab,
              buttonText: tabInfo.text,
              buttonId: tabInfo.id,
              buttonExists: Boolean(btn),
              buttonHidden: tabInfo.hidden,
              clickDispatched,
              activeTabAfterClick: activeBtn,
              activePanelsAfterClick,
              panelAudit,
              titleAfterClick: currentTitleEl ? currentTitleEl.textContent : '',
              descAfterClick: currentDescEl ? currentDescEl.textContent : '',
              newErrors: errorsAfterNavigation.slice(errsBefore)
            });
          }

          return {
            tabButtons,
            panels,
            canvasComputed,
            initialActiveTab,
            initialActivePanels,
            clickResults,
            errorsAfterNavigation
          };
        })()
      `);

      console.log('NAVIGATION_DIAGNOSTIC_RESULT:' + JSON.stringify({
        diagnostic,
        consoleErrors,
        cspErrors
      }));

      win.destroy();
      app.quit();
    } catch (err) {
      console.error('Diagnostic harness error:', err);
      process.exit(2);
    }
  }, 1500);
});
