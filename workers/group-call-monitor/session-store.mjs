const STORAGE_KEY = 'oa-session-snapshot-v1';
const DOMAIN = 'happamochi/group-call-monitor/session-store/v1';
const MAX_SNAPSHOT_BYTES = 65_536;
const MAX_CIPHERTEXT_BYTES = MAX_SNAPSHOT_BYTES + 16;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** Never exposes storage errors, crypto errors, cookie values, or their causes. */
export class SessionStoreError extends Error {
  constructor(operation) {
    const safeOperation = ['configuration', 'load', 'save'].includes(operation) ? operation : 'configuration';
    super(`OA session storage ${safeOperation} failed`);
    this.name = 'SessionStoreError';
    this.operation = safeOperation;
  }
}

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function base64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value, min, max) {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error();
  const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0));
  if (bytes.length < min || bytes.length > max || base64(bytes) !== value) throw new Error();
  return bytes;
}

/** One instance per OA Durable Object; reuse it for every session update. */
export class SessionStore {
  #storage;
  #botId;
  #cookie;
  #adminToken;
  #keyPromise;
  #fingerprintPromise;
  #pending = Promise.resolve();

  constructor(storage, { botId, cookie, adminToken } = {}) {
    if (!storage || typeof storage.get !== 'function' || typeof storage.put !== 'function' ||
        typeof botId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(botId) ||
        typeof cookie !== 'string' || !cookie.trim() || cookie.length > 32_768 ||
        typeof adminToken !== 'string' || !adminToken.trim() || adminToken.length > 16_384) {
      throw new SessionStoreError('configuration');
    }
    this.#storage = storage;
    this.#botId = botId;
    this.#cookie = cookie;
    this.#adminToken = adminToken;
  }

  #fingerprint() {
    if (!this.#fingerprintPromise) this.#fingerprintPromise = crypto.subtle.digest('SHA-256', encoder.encode(this.#cookie))
      .then(buffer => Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join(''));
    return this.#fingerprintPromise;
  }

  #key() {
    if (!this.#keyPromise) this.#keyPromise = (async () => {
      const material = await crypto.subtle.importKey('raw', encoder.encode(this.#adminToken), 'HKDF', false, ['deriveKey']);
      return crypto.subtle.deriveKey({
        name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(DOMAIN),
        info: encoder.encode(JSON.stringify(['cookie-snapshot', this.#botId])),
      }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    })();
    return this.#keyPromise;
  }

  #aad(seedFingerprint) {
    return encoder.encode(JSON.stringify([DOMAIN, 1, this.#botId, seedFingerprint]));
  }

  #enqueue(operation, work) {
    const task = this.#pending.then(work).catch(() => { throw new SessionStoreError(operation); });
    // A failed write is reported to its caller without poisoning later saves.
    this.#pending = task.catch(() => {});
    return task;
  }

  load() {
    return this.#enqueue('load', async () => {
      const envelope = await this.#storage.get(STORAGE_KEY);
      if (envelope === undefined || envelope === null) return null;
      if (!record(envelope) || envelope.version !== 1 || envelope.botId !== this.#botId ||
          typeof envelope.seedFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(envelope.seedFingerprint)) throw new Error();
      const seedFingerprint = await this.#fingerprint();
      // A manually replaced OA_COOKIE takes precedence, even if the old key rotated too.
      if (envelope.seedFingerprint !== seedFingerprint) return null;
      const iv = fromBase64(envelope.iv, 12, 12);
      const ciphertext = fromBase64(envelope.ciphertext, 16, MAX_CIPHERTEXT_BYTES);
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: this.#aad(seedFingerprint), tagLength: 128 }, await this.#key(), ciphertext);
      const snapshot = JSON.parse(decoder.decode(plaintext));
      if (!record(snapshot)) throw new Error();
      return snapshot;
    });
  }

  save(snapshot) {
    let plaintext;
    try {
      if (!record(snapshot)) throw new Error();
      const json = JSON.stringify(snapshot);
      if (typeof json !== 'string' || json.length > MAX_SNAPSHOT_BYTES || !record(JSON.parse(json))) throw new Error();
      plaintext = encoder.encode(json);
      if (plaintext.byteLength > MAX_SNAPSHOT_BYTES) throw new Error();
    } catch { return Promise.reject(new SessionStoreError('save')); }
    // Serialize at invocation, not later in the queue: callers may mutate the jar.
    return this.#enqueue('save', async () => {
      const seedFingerprint = await this.#fingerprint();
      const key = await this.#key();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: this.#aad(seedFingerprint), tagLength: 128 }, key, plaintext);
      await this.#storage.put(STORAGE_KEY, {
        version: 1, botId: this.#botId, seedFingerprint,
        iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)),
      });
    });
  }
}
