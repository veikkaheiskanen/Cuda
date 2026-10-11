'use strict';
const crypto = require('node:crypto');
function secureStore(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Native Keychain key is unavailable.');
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const nonce = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
      return Buffer.concat([nonce, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    },
    decryptString(value) {
      if (!Buffer.isBuffer(value) || value.length < 28) throw new Error('Invalid encrypted token');
      const cipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      cipher.setAuthTag(value.subarray(-16));
      return Buffer.concat([cipher.update(value.subarray(12, -16)), cipher.final()]).toString('utf8');
    }
  };
}
module.exports = { secureStore };
