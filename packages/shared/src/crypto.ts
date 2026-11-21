import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { EncryptedPayload, EncryptedSecretsMap } from './schemas.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12; // 96 bits recommended for AES-GCM
const AUTH_TAG_LENGTH_BYTES = 16; // 128 bits authentication tag

/**
 * Parses and validates the 32-byte master key from hex (64 chars) or base64 (44 chars).
 * Never logs or exposes the key in error messages.
 */
export function parseMasterKey(rawKey?: string): Buffer {
  const keyStr = (rawKey ?? process.env.APP_MASTER_KEY ?? '').trim();
  if (!keyStr) {
    throw new Error('APP_MASTER_KEY ausente. Configure uma chave de 32 bytes (hex ou base64).');
  }

  let keyBuffer: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(keyStr)) {
    keyBuffer = Buffer.from(keyStr, 'hex');
  } else {
    keyBuffer = Buffer.from(keyStr, 'base64');
  }

  if (keyBuffer.length !== 32) {
    throw new Error(
      `APP_MASTER_KEY inválida: esperado 32 bytes, recebido ${keyBuffer.length} bytes.`
    );
  }

  return keyBuffer;
}

/**
 * Encrypts a single plaintext secret using AES-256-GCM with a unique 12-byte random IV.
 */
export function encryptSecret(plaintext: string, rawMasterKey?: string): EncryptedPayload {
  if (!plaintext) {
    throw new Error('Não é possível criptografar um valor vazio.');
  }

  const key = parseMasterKey(rawMasterKey);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

/**
 * Decrypts an AES-256-GCM EncryptedPayload back into plaintext in memory.
 */
export function decryptSecret(payload: EncryptedPayload, rawMasterKey?: string): string {
  const key = parseMasterKey(rawMasterKey);
  const iv = Buffer.from(payload.iv, 'base64');
  const authTag = Buffer.from(payload.authTag, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');

  if (iv.length !== IV_LENGTH_BYTES) {
    throw new Error('IV inválido no payload criptografado.');
  }
  if (authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error('AuthTag inválida no payload criptografado.');
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Encrypts a dictionary of plaintext secrets { EMAIL: "...", PASSWORD: "..." }
 * into an EncryptedSecretsMap safe for storing in Supabase JSONB.
 */
export function encryptSecretsMap(
  plainSecrets: Record<string, string>,
  rawMasterKey?: string
): EncryptedSecretsMap {
  const result: EncryptedSecretsMap = {};
  for (const [secretKey, value] of Object.entries(plainSecrets)) {
    if (value !== undefined && value !== '') {
      result[secretKey] = encryptSecret(value, rawMasterKey);
    }
  }
  return result;
}

/**
 * Decrypts an entire EncryptedSecretsMap in memory for short-lived worker execution.
 */
export function decryptSecretsMap(
  encryptedMap: EncryptedSecretsMap,
  rawMasterKey?: string
): Record<string, string> {
  const plain: Record<string, string> = {};
  for (const [secretKey, payload] of Object.entries(encryptedMap)) {
    plain[secretKey] = decryptSecret(payload, rawMasterKey);
  }
  return plain;
}

/**
 * Resolves placeholders like `{{secret:UC_NUMBER}}` inside strings using an in-memory decrypted secret map.
 */
export function interpolateSecrets(
  template: string,
  decryptedSecrets: Record<string, string>
): string {
  return template.replace(/\{\{secret:([A-Z0-9_]+)\}\}/g, (_match, key: string) => {
    const val = decryptedSecrets[key];
    if (val === undefined) {
      throw new Error(`Secret obrigatório '{{secret:${key}}}' não configurado para este provedor.`);
    }
    return val;
  });
}
