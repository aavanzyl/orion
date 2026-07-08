import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const PREFIX = 'aes256:';

function deriveKey(salt: string, pbkdf2Salt: Buffer): Buffer {
  return pbkdf2Sync(salt, pbkdf2Salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
}

export function encrypt(plaintext: string, salt: string): string {
  const iv = randomBytes(IV_LENGTH);
  const pbkdf2Salt = randomBytes(SALT_BYTES);
  const key = deriveKey(salt, pbkdf2Salt);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([pbkdf2Salt, iv, authTag, encrypted]).toString('base64url');
}

export function decrypt(ciphertext: string, salt: string): string {
  if (!ciphertext.startsWith(PREFIX)) return ciphertext;
  const buf = Buffer.from(ciphertext.slice(PREFIX.length), 'base64url');
  const pbkdf2Salt = buf.subarray(0, SALT_BYTES);
  const iv = buf.subarray(SALT_BYTES, SALT_BYTES + IV_LENGTH);
  const authTag = buf.subarray(SALT_BYTES + IV_LENGTH, SALT_BYTES + IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buf.subarray(SALT_BYTES + IV_LENGTH + AUTH_TAG_LENGTH);
  const key = deriveKey(salt, pbkdf2Salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export function maskApiKey(value: string): string {
  if (value.length <= 8) return '*'.repeat(value.length);
  return value.slice(0, 4) + '...' + value.slice(-4);
}
