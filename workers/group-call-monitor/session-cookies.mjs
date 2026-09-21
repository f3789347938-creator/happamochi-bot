const HOST = 'chat.line.biz';
const NAMES = Object.freeze(['ses', '__Host-chat-ses', 'XSRF-TOKEN', 'chat-device-group']);
const ALLOWED = new Set(NAMES);
const COOKIE_LIMIT = 32_768;
const SET_COOKIE_LIMIT = 4_096;
const RESPONSE_LIMIT = 65_536;
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const COOKIE_OCTETS = /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/;
const SPLIT_COOKIES = /,(?=\s*[!#$%&'*+.^_`|~0-9A-Za-z-]+=)/;

function invalid() { throw new TypeError('Invalid session cookie configuration'); }

function timestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}

// Seed headers can contain legacy analytics values such as JSON. Preserve those
// exact visible-ASCII values, but never allow a response to update their names.
function cookiePairs(value, empty = false) {
  if (typeof value !== 'string' || value.length > COOKIE_LIMIT || /[^\x20-\x7e]/.test(value)) return null;
  if (!value.trim()) return empty ? new Map() : null;
  const result = new Map();
  for (const part of value.split(';')) {
    const pair = part.trim();
    const separator = pair.indexOf('=');
    if (separator < 1) return null;
    const name = pair.slice(0, separator);
    if (!TOKEN.test(name) || result.has(name)) return null;
    result.set(name, pair.slice(separator + 1));
  }
  return result;
}

function canonical(pairs) {
  return [...pairs].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([name, value]) => `${name}=${value}`).join('; ');
}

function domain(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase().replace(/^\./, '');
  return normalized === HOST || normalized === 'line.biz' ? normalized : null;
}

function responseValue(value) {
  if (typeof value !== 'string' || value.length > SET_COOKIE_LIMIT) return false;
  if (value.startsWith('"') || value.endsWith('"')) {
    return value.length >= 2 && value.startsWith('"') && value.endsWith('"') && COOKIE_OCTETS.test(value.slice(1, -1));
  }
  return COOKIE_OCTETS.test(value);
}

function setCookieLines(headers) {
  let result;
  try {
    if (typeof headers?.getSetCookie === 'function') result = headers.getSetCookie();
  } catch {}
  if (!Array.isArray(result)) {
    try {
      if (typeof headers?.getAll === 'function') result = headers.getAll('Set-Cookie');
    } catch {}
  }
  if (!Array.isArray(result)) {
    try {
      const combined = headers?.get?.('set-cookie');
      result = typeof combined === 'string' ? [combined] : [];
    } catch { result = []; }
  }
  if (result.length > 64 || result.some(value => typeof value !== 'string') ||
      result.reduce((size, value) => size + value.length, 0) > RESPONSE_LIMIT) return [];
  // Some runtimes join Set-Cookie fields. The comma in an Expires date is not
  // followed by a cookie-name and '=' and therefore must not split the field.
  return result.flatMap(value => value.split(SPLIT_COOKIES));
}

function parseSetCookie(line, now) {
  if (line.length > SET_COOKIE_LIMIT || /[^\x20-\x7e]/.test(line)) return null;
  const parts = line.split(';');
  const pair = parts.shift().trim();
  const separator = pair.indexOf('=');
  if (separator < 1) return null;
  const name = pair.slice(0, separator);
  if (!ALLOWED.has(name)) return null;
  let value = pair.slice(separator + 1);
  // Quoted cookie-octets are legal; retain quoting in the outgoing header.
  if (!responseValue(value)) return null;
  const attrs = new Map();
  for (const part of parts) {
    const attribute = part.trim();
    if (!attribute) continue;
    const index = attribute.indexOf('=');
    const key = (index < 0 ? attribute : attribute.slice(0, index)).trim().toLowerCase();
    if (!TOKEN.test(key)) return null;
    if (!['domain', 'path', 'secure', 'max-age', 'expires'].includes(key)) continue;
    if (attrs.has(key)) return null;
    attrs.set(key, index < 0 ? null : attribute.slice(index + 1).trim());
  }
  if (attrs.get('path') !== '/' || !attrs.has('secure') || attrs.get('secure') !== null) return null;
  const hostOnly = !attrs.has('domain');
  const cookieDomain = hostOnly ? HOST : domain(attrs.get('domain'));
  if (!cookieDomain || (name === '__Host-chat-ses' && !hostOnly)) return null;

  let expiresAt = null;
  if (attrs.has('max-age')) {
    const ageText = attrs.get('max-age');
    if (typeof ageText !== 'string' || !/^-?\d+$/.test(ageText)) return null;
    const seconds = Number(ageText);
    if (!Number.isSafeInteger(seconds)) return null;
    expiresAt = seconds <= 0 ? now : now + seconds * 1_000;
    if (!Number.isSafeInteger(expiresAt)) return null;
  } else if (attrs.has('expires')) {
    expiresAt = Date.parse(attrs.get('expires'));
    if (!Number.isFinite(expiresAt)) return null;
  }
  if (expiresAt !== null && expiresAt <= now) value = null;
  return { name, value, expiresAt, updatedAt: now, domain: cookieDomain, hostOnly, secure: true, path: '/' };
}

function sameCookie(a, b) {
  return a && a.value === b.value && a.expiresAt === b.expiresAt && a.domain === b.domain &&
    a.hostOnly === b.hostOnly && a.secure === b.secure && a.path === b.path;
}

/**
 * Request-cookie jar for HTTPS chat.line.biz only. The caller must verify the
 * response origin before accept(), and must never forward header() elsewhere.
 * Only response-provided updates are retained: this does not extend a session
 * by itself or turn an expired session into an authenticated one.
 */
export class SessionCookies {
  #seed;
  #seedCookie;
  #updates = new Map();
  #revision = 0;
  #clock;

  constructor({ cookie, snapshot, now = Date.now } = {}) {
    this.#seed = cookiePairs(cookie);
    if (!this.#seed) invalid();
    this.#seedCookie = canonical(this.#seed);
    if (this.#seedCookie.length > COOKIE_LIMIT) invalid();
    if (typeof now !== 'function' && !Number.isSafeInteger(now)) invalid();
    this.#clock = typeof now === 'function' ? now : () => now;
    this.#now();
    this.#restore(snapshot);
  }

  #now(now) { return timestamp(now === undefined ? this.#clock() : now); }

  #restore(snapshot) {
    // Snapshots contain credentials and belong only in internal secret storage.
    // A freshly rotated environment secret always wins over an older snapshot.
    try {
      if (!snapshot || snapshot.version !== 1 || snapshot.seedCookie !== this.#seedCookie ||
          !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 ||
          !Array.isArray(snapshot.updates) || snapshot.updates.length > NAMES.length) return;
      const restored = new Map();
      for (const record of snapshot.updates) {
        if (!record || !ALLOWED.has(record.name) || restored.has(record.name) ||
            (record.value !== null && !responseValue(record.value)) ||
            !(record.expiresAt === null || Number.isSafeInteger(record.expiresAt)) ||
            !Number.isSafeInteger(record.updatedAt) || record.updatedAt < 0 ||
            typeof record.hostOnly !== 'boolean' || record.secure !== true || record.path !== '/' ||
            !domain(record.domain) || record.domain !== domain(record.domain) ||
            (record.hostOnly && record.domain !== HOST) ||
            (record.name === '__Host-chat-ses' && !record.hostOnly)) return;
        restored.set(record.name, {
          name: record.name, value: record.value, expiresAt: record.expiresAt, updatedAt: record.updatedAt,
          domain: record.domain, hostOnly: record.hostOnly, secure: true, path: '/',
        });
      }
      if (this.#render(this.#now(), restored).length > COOKIE_LIMIT) return;
      this.#updates = restored;
      this.#revision = snapshot.revision;
    } catch {
      // Corrupt stored state must never log credentials or override the seed.
    }
  }

  #render(now, updates = this.#updates) {
    const pairs = new Map(this.#seed);
    for (const [name, record] of updates) {
      if (record.value === null || (record.expiresAt !== null && record.expiresAt <= now)) pairs.delete(name);
      else pairs.set(name, record.value);
    }
    return canonical(pairs);
  }

  header(now) { return this.#render(this.#now(now)); }

  accept(headers, sentHeader, now) {
    const receivedAt = this.#now(now);
    const sent = cookiePairs(sentHeader, true);
    if (!sent) return false;
    const pending = new Map();
    for (const line of setCookieLines(headers)) {
      const record = parseSetCookie(line, receivedAt);
      if (record) pending.set(record.name, record);
    }
    const next = new Map(this.#updates);
    let changed = false;
    for (const [name, candidate] of pending) {
      const current = this.#updates.get(name);
      const storedValue = current ? current.value : this.#seed.get(name);
      const activeValue = current && (current.value === null ||
        (current.expiresAt !== null && current.expiresAt <= receivedAt)) ? undefined : storedValue;
      const expectedValue = sent.get(name);
      // Per-cookie compare-and-swap: an older in-flight request must not undo a
      // newer response. A response sent with a cookie that just expired may
      // still renew that exact stored cookie, without resurrecting a deletion.
      if (expectedValue !== activeValue && (expectedValue === undefined || expectedValue !== storedValue)) continue;
      if (sameCookie(current, candidate)) continue;
      next.set(name, candidate);
      changed = true;
    }
    if (!changed || this.#render(receivedAt, next).length > COOKIE_LIMIT) return false;
    this.#updates = next;
    this.#revision += 1;
    return true;
  }

  /** Contains secrets. Persist internally; never log or return in a response. */
  snapshot() {
    return {
      version: 1, seedCookie: this.#seedCookie, revision: this.#revision,
      updates: [...this.#updates.values()].map(record => ({ ...record })),
    };
  }

  /** Safe diagnostics only; presence does not imply a valid logged-in session. */
  metadata(now) {
    const at = this.#now(now);
    const active = cookiePairs(this.#render(at), true);
    return {
      revision: this.#revision,
      hasSession: Boolean(active.get('ses') || active.get('__Host-chat-ses')),
      cookies: NAMES.map(name => {
        const record = this.#updates.get(name);
        return {
          name, present: active.has(name), expiresAt: record?.expiresAt ?? null,
          updatedAt: record?.updatedAt ?? null, source: record ? 'response' : 'seed',
        };
      }),
    };
  }
}

export { SessionCookies as CookieJar };
