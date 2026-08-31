/**
 * WhatsApp Sender Electron - History Feature
 * Application: Export Conversation
 * 
 * Genera representaciones legibles de la conversación para humanos en formatos TXT, HTML y JSON.
 * Formato visual optimizado para lectura y archivado documental.
 */

const {
  formatConversationDate,
  formatMessageTime,
  groupMessagesByDay
} = require('../domain/conversation-rules');

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let fsModule = null;
try {
  fsModule = require('fs');
} catch (_) {}

/**
 * Genera el documento de conversación en texto plano universal (TXT).
 * @param {Object} conversation
 * @param {Object} [options]
 * @param {Map<string, Object>} [options.mediaMap]
 * @param {boolean} [options.includeMedia=false]
 * @returns {string}
 */
function formatConversationTxt(conversation = {}, { mediaMap = null, includeMedia = false } = {}) {
  const target = conversation.target || {};
  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
  const metadata = conversation.metadata || {};

  const name = target.name || 'Desconocido';
  const id = target.identifier || target.id || '';
  const typeLabel = target.type === 'groups' ? 'Grupo' : 'Contacto';
  const total = messages.length;

  const firstDate = metadata.firstMessageDate ? formatConversationDate(metadata.firstMessageDate) : 'N/A';
  const lastDate = metadata.lastMessageDate ? formatConversationDate(metadata.lastMessageDate) : 'N/A';
  const now = new Date().toLocaleString('es-BO');

  let output = '';
  output += '================================================================================\n';
  output += 'HISTORIAL DE CONVERSACIÓN — LA MARTINA SENDER PRO\n';
  output += '================================================================================\n';
  output += `Destinatario:        ${name}\n`;
  output += `Identificador:       ${id}\n`;
  output += `Tipo de destino:     ${typeLabel}\n`;
  output += `Mensajes en reporte: ${total}\n`;
  output += `Periodo abarcado:    ${firstDate} — ${lastDate}\n`;
  output += `Fecha exportación:   ${now}\n`;
  if (includeMedia) {
    output += 'Modalidad:           Con multimedia bajo demanda\n';
  }
  output += '================================================================================\n\n';

  if (total === 0) {
    output += '(No se registran mensajes en esta conversación)\n';
    return output;
  }

  const days = groupMessagesByDay(messages);
  days.forEach((dayGroup) => {
    output += `--- ${dayGroup.dateLabel.toUpperCase()} ---\n\n`;
    dayGroup.messages.forEach((msg) => {
      const time = formatMessageTime(msg.timestampIso);
      const date = formatConversationDate(msg.timestampIso);
      const sender = msg.senderLabel || (msg.isOutgoing ? 'Yo' : name);
      let text = msg.text || '';

      if (includeMedia && mediaMap && mediaMap.has(msg.id)) {
        const item = mediaMap.get(msg.id);
        if (item && item.available) {
          const fn = item.filename || `${msg.type || 'archivo'}`;
          const cap = msg.caption ? `\nDescripción: ${msg.caption}` : '';
          const typeLabelMap = {
            image: 'IMAGEN',
            video: 'VIDEO',
            audio: 'AUDIO',
            ptt: 'AUDIO',
            document: 'DOCUMENTO',
            sticker: 'STICKER'
          };
          const resolvedTypeName = typeLabelMap[msg.type] || (msg.type ? msg.type.toUpperCase() : 'MULTIMEDIA');
          text = `[📷 ${resolvedTypeName} INCLUIDA: ${fn}]${cap}`;
        } else if (item && item.label) {
          text = item.label;
        }
      }

      output += `[${date} ${time}] ${sender}:\n${text}\n\n`;
    });
  });

  output += '================================================================================\n';
  output += 'Fin del historial exportado.\n';

  return output;
}

/**
 * Genera un documento HTML autónomo y auto-estilizado, listo para visualización en navegador o impresión PDF.
 * @param {Object} conversation
 * @param {Object} [options]
 * @param {Map<string, Object>} [options.mediaMap]
 * @param {boolean} [options.includeMedia=false]
 * @returns {string}
 */
function formatConversationHtml(conversation = {}, { mediaMap = null, includeMedia = false } = {}) {
  const target = conversation.target || {};
  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
  const metadata = conversation.metadata || {};

  const name = escapeHtml(target.name || 'Desconocido');
  const id = escapeHtml(target.identifier || target.id || '');
  const typeLabel = target.type === 'groups' ? 'Grupo' : 'Contacto';
  const total = messages.length;
  const now = escapeHtml(new Date().toLocaleString('es-BO'));

  const firstDate = metadata.firstMessageDate ? formatConversationDate(metadata.firstMessageDate) : 'N/A';
  const lastDate = metadata.lastMessageDate ? formatConversationDate(metadata.lastMessageDate) : 'N/A';

  const days = groupMessagesByDay(messages);

  let chatBodyHtml = '';
  if (total === 0) {
    chatBodyHtml = '<p class="empty-notice">No se registran mensajes en esta conversación.</p>';
  } else {
    days.forEach((day) => {
      chatBodyHtml += `<div class="day-divider"><span>${escapeHtml(day.dateLabel)}</span></div>`;
      day.messages.forEach((msg) => {
        const isOut = Boolean(msg.isOutgoing || msg.fromMe);
        const sender = escapeHtml(msg.senderLabel || (isOut ? 'Yo' : target.name));
        const text = escapeHtml(msg.text || '').replace(/\n/g, '<br>');
        const time = escapeHtml(formatMessageTime(msg.timestampIso));

        let mediaHtml = '';
        if (includeMedia && mediaMap && mediaMap.has(msg.id)) {
          const item = mediaMap.get(msg.id);
          if (item && item.available && item.tempFilePath) {
            const isImage = (msg.type === 'image' || String(item.mimeType).startsWith('image/'));
            if (isImage && fsModule && fsModule.existsSync(item.tempFilePath)) {
              try {
                const b64 = fsModule.readFileSync(item.tempFilePath).toString('base64');
                mediaHtml = `<img class="media-preview-img" src="data:${item.mimeType || 'image/jpeg'};base64,${b64}" alt="${escapeHtml(item.filename || 'Imagen')}">`;
              } catch (_) {}
            } else {
              const fname = escapeHtml(item.filename || 'Archivo adjunto');
              const sizeKb = Math.round((Number(item.size) || 0) / 1024);
              mediaHtml = `<div class="media-badge"><span>📎 ${fname} (${sizeKb} KB)</span></div>`;
            }
          } else if (item && item.label) {
            mediaHtml = `<div class="media-badge media-badge--unavailable"><span>${escapeHtml(item.label)}</span></div>`;
          }
        }

        chatBodyHtml += `
          <div class="bubble-row ${isOut ? 'bubble-row--outgoing' : 'bubble-row--incoming'}">
            <div class="bubble">
              <div class="bubble-sender">${sender}</div>
              <div class="bubble-text">${text}</div>
              ${mediaHtml}
              <div class="bubble-time">${time}</div>
            </div>
          </div>
        `;
      });
    });
  }

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Historial: ${name}</title>
  <style>
    :root {
      --bg-body: #0d1b16;
      --bg-card: #142821;
      --text-main: #f0fdf4;
      --text-muted: #86efac;
      --border-color: rgba(34, 197, 94, 0.2);
      --bubble-out: #166534;
      --bubble-in: #1f2937;
    }
    @media print {
      :root {
        --bg-body: #ffffff;
        --bg-card: #ffffff;
        --text-main: #000000;
        --text-muted: #555555;
        --border-color: #cccccc;
        --bubble-out: #e2fbe8;
        --bubble-in: #f3f4f6;
      }
      body { padding: 0 !important; background: white !important; }
      .chat-header { border: 1px solid #ccc !important; }
      .media-preview-img { max-height: 240px !important; page-break-inside: avoid; }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg-body);
      color: var(--text-main);
      margin: 0;
      padding: 24px;
      line-height: 1.5;
    }
    .chat-container {
      max-width: 800px;
      margin: 0 auto;
      background: var(--bg-card);
      border-radius: 12px;
      border: 1px solid var(--border-color);
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
    }
    .chat-header {
      padding: 20px 24px;
      background: rgba(0, 0, 0, 0.2);
      border-bottom: 1px solid var(--border-color);
    }
    .chat-header h1 {
      margin: 0 0 6px 0;
      font-size: 22px;
    }
    .chat-header .meta {
      font-size: 13px;
      color: var(--text-muted);
    }
    .chat-messages {
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .day-divider {
      text-align: center;
      margin: 16px 0 8px 0;
    }
    .day-divider span {
      background: rgba(255, 255, 255, 0.08);
      color: var(--text-muted);
      font-size: 12px;
      padding: 4px 12px;
      border-radius: 12px;
      font-weight: 500;
    }
    .bubble-row {
      display: flex;
      width: 100%;
    }
    .bubble-row--outgoing {
      justify-content: flex-end;
    }
    .bubble-row--incoming {
      justify-content: flex-start;
    }
    .bubble {
      max-width: 75%;
      padding: 10px 14px;
      border-radius: 12px;
      position: relative;
    }
    .bubble-row--outgoing .bubble {
      background: var(--bubble-out);
      border-top-right-radius: 2px;
    }
    .bubble-row--incoming .bubble {
      background: var(--bubble-in);
      border-top-left-radius: 2px;
    }
    .bubble-sender {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 4px;
    }
    .bubble-text {
      word-break: break-word;
      font-size: 14px;
    }
    .media-preview-img {
      max-width: 100%;
      max-height: 320px;
      border-radius: 8px;
      margin-top: 8px;
      display: block;
      object-fit: contain;
    }
    .media-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      background: rgba(0, 0, 0, 0.25);
      border-radius: 6px;
      font-size: 0.88em;
      margin-top: 6px;
    }
    .media-badge--unavailable {
      opacity: 0.75;
      font-style: italic;
    }
    .bubble-time {
      font-size: 11px;
      color: var(--text-muted);
      text-align: right;
      margin-top: 4px;
    }
    @media print {
      .bubble-time { color: #666; }
    }
    .empty-notice {
      text-align: center;
      color: var(--text-muted);
      padding: 40px 0;
    }
  </style>
</head>
<body>
  <div class="chat-container">
    <div class="chat-header">
      <h1>${name}</h1>
      <div class="meta">
        <span>${typeLabel} • ${id}</span> | 
        <span>${total} mensajes (${firstDate} — ${lastDate})</span> | 
        <span>Exportado: ${now}</span>
      </div>
    </div>
    <div class="chat-messages">
      ${chatBodyHtml}
    </div>
  </div>
</body>
</html>`;
}

/**
 * Genera la representación estructurada en formato JSON para respaldo técnico.
 * @param {Object} conversation
 * @param {Object} [options]
 * @param {Map<string, Object>} [options.mediaMap]
 * @param {boolean} [options.includeMedia=false]
 * @returns {string}
 */
function formatConversationJson(conversation = {}, { mediaMap = null, includeMedia = false } = {}) {
  const rawMessages = Array.isArray(conversation.messages) ? conversation.messages : [];
  const processedMessages = rawMessages.map((msg) => {
    const copy = { ...msg };
    if (includeMedia && mediaMap && mediaMap.has(msg.id)) {
      const item = mediaMap.get(msg.id);
      copy.media = {
        available: Boolean(item && item.available),
        filename: (item && item.filename) || msg.mediaFilename || '',
        mimeType: (item && item.mimeType) || msg.mediaMimeType || '',
        size: (item && item.size) || 0
      };
    }
    return copy;
  });

  const payload = {
    app: 'La Martina WhatsApp Sender Pro',
    exportedAt: new Date().toISOString(),
    includeMedia: Boolean(includeMedia),
    target: conversation.target || {},
    metadata: conversation.metadata || {},
    messages: processedMessages
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Orquesta la exportación de una conversación en el formato especificado.
 * @param {Object} params
 * @param {Object} params.conversation
 * @param {'txt'|'html'|'pdf'|'json'} [params.format='txt']
 * @param {Map<string, Object>} [params.mediaMap=null]
 * @param {boolean} [params.includeMedia=false]
 * @returns {{ content: string, mimeType: string, extension: string, filename: string }}
 */
function exportConversation({ conversation = {}, format = 'txt', mediaMap = null, includeMedia = false } = {}) {
  const safeFormat = String(format || 'txt').toLowerCase();
  const target = conversation.target || {};
  const safeName = String(target.name || 'conversacion')
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .substring(0, 30);
  const timestamp = new Date().toISOString().slice(0, 10);

  if (safeFormat === 'html' || safeFormat === 'pdf') {
    const htmlContent = formatConversationHtml(conversation, { mediaMap, includeMedia });
    return {
      content: htmlContent,
      mimeType: 'text/html',
      extension: 'html',
      filename: `conversacion_${safeName}_${timestamp}.html`
    };
  }

  if (safeFormat === 'json') {
    const jsonContent = formatConversationJson(conversation, { mediaMap, includeMedia });
    return {
      content: jsonContent,
      mimeType: 'application/json',
      extension: 'json',
      filename: `conversacion_${safeName}_${timestamp}.json`
    };
  }

  const txtContent = formatConversationTxt(conversation, { mediaMap, includeMedia });
  return {
    content: txtContent,
    mimeType: 'text/plain',
    extension: 'txt',
    filename: `conversacion_${safeName}_${timestamp}.txt`
  };
}

module.exports = {
  formatConversationTxt,
  formatConversationHtml,
  formatConversationJson,
  exportConversation
};
