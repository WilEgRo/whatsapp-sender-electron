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

/**
 * Genera el documento de conversación en texto plano universal (TXT).
 * @param {Object} conversation
 * @returns {string}
 */
function formatConversationTxt(conversation = {}) {
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
      const text = msg.text || '';
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
 * @returns {string}
 */
function formatConversationHtml(conversation = {}) {
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

        chatBodyHtml += `
          <div class="bubble-row ${isOut ? 'bubble-row--outgoing' : 'bubble-row--incoming'}">
            <div class="bubble">
              <div class="bubble-sender">${sender}</div>
              <div class="bubble-text">${text}</div>
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
      border-radius: 10px;
      word-break: break-word;
    }
    .bubble-row--outgoing .bubble {
      background: var(--bubble-out);
      border-bottom-right-radius: 2px;
    }
    .bubble-row--incoming .bubble {
      background: var(--bubble-in);
      border-bottom-left-radius: 2px;
    }
    .bubble-sender {
      font-size: 11px;
      font-weight: bold;
      color: var(--text-muted);
      margin-bottom: 2px;
    }
    .bubble-text {
      font-size: 14px;
    }
    .bubble-time {
      font-size: 10px;
      color: rgba(255, 255, 255, 0.6);
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
 * @returns {string}
 */
function formatConversationJson(conversation = {}) {
  const payload = {
    app: 'La Martina WhatsApp Sender Pro',
    exportedAt: new Date().toISOString(),
    target: conversation.target || {},
    metadata: conversation.metadata || {},
    messages: conversation.messages || []
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Orquesta la exportación de una conversación en el formato especificado.
 * @param {Object} params
 * @param {Object} params.conversation
 * @param {'txt'|'html'|'pdf'|'json'} [params.format='txt']
 * @returns {{ content: string, mimeType: string, extension: string, filename: string }}
 */
function exportConversation({ conversation = {}, format = 'txt' } = {}) {
  const safeFormat = String(format || 'txt').toLowerCase();
  const target = conversation.target || {};
  const safeName = String(target.name || 'conversacion')
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .substring(0, 30);
  const timestamp = new Date().toISOString().slice(0, 10);

  if (safeFormat === 'html' || safeFormat === 'pdf') {
    const htmlContent = formatConversationHtml(conversation);
    return {
      content: htmlContent,
      mimeType: 'text/html',
      extension: 'html',
      filename: `conversacion_${safeName}_${timestamp}.html`
    };
  }

  if (safeFormat === 'json') {
    const jsonContent = formatConversationJson(conversation);
    return {
      content: jsonContent,
      mimeType: 'application/json',
      extension: 'json',
      filename: `conversacion_${safeName}_${timestamp}.json`
    };
  }

  const txtContent = formatConversationTxt(conversation);
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
