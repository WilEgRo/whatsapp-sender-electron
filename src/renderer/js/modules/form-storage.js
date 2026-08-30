const crypto = require('crypto');
const os = require('os');

class FormStorage {
  constructor(storageKey = 'whatsappSenderData') {
    this.storageKey = storageKey;
    this.envelopeVersion = 1;
  }

  buildKeyMaterial() {
    const parts = [
      process.env.WHATSAPP_SENDER_STORAGE_SECRET || '',
      os.hostname(),
      os.userInfo().username,
      os.platform(),
      os.arch()
    ];

    return parts.join('|');
  }

  deriveKey(salt) {
    const keyMaterial = this.buildKeyMaterial();
    return crypto.scryptSync(keyMaterial, salt, 32);
  }

  encryptPayload(payload) {
    const iv = crypto.randomBytes(12);
    const salt = crypto.randomBytes(16);
    const key = this.deriveKey(salt);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const serialized = JSON.stringify(payload);
    const encrypted = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return JSON.stringify({
      v: this.envelopeVersion,
      alg: 'aes-256-gcm',
      iv: iv.toString('base64'),
      salt: salt.toString('base64'),
      tag: tag.toString('base64'),
      data: encrypted.toString('base64')
    });
  }

  decryptPayload(rawEnvelope) {
    const envelope = JSON.parse(rawEnvelope);

    if (!envelope || envelope.v !== this.envelopeVersion || envelope.alg !== 'aes-256-gcm') {
      throw new Error('Formato de almacenamiento cifrado no soportado');
    }

    const iv = Buffer.from(String(envelope.iv || ''), 'base64');
    const salt = Buffer.from(String(envelope.salt || ''), 'base64');
    const tag = Buffer.from(String(envelope.tag || ''), 'base64');
    const data = Buffer.from(String(envelope.data || ''), 'base64');
    const key = this.deriveKey(salt);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    return JSON.parse(decrypted);
  }

  save(payload) {
    try {
      const encrypted = this.encryptPayload(payload);
      localStorage.setItem(this.storageKey, encrypted);
    } catch (error) {
      console.error('No se pudieron cifrar datos antes de guardar:', error);
    }
  }

  load() {
    const raw = localStorage.getItem(this.storageKey);

    if (!raw) {
      return {};
    }

    try {
      if (raw.includes('"alg":"aes-256-gcm"')) {
        return this.decryptPayload(raw);
      }

      // Compatibilidad con snapshots previos no cifrados.
      return JSON.parse(raw);
    } catch (error) {
      console.error('No se pudieron recuperar datos guardados:', error);
      return {};
    }
  }
}

module.exports = FormStorage;
