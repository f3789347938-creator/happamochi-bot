// Protocol evidence: work/oa-call-public-assets/PROTOCOL.md (OA web app 8.7.0).
const ORIGIN = 'https://chat.line.biz';
const CLIENT_VERSION = '20240513144702';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
const JSON_LIMIT = 2 * 1024 * 1024;
const SSE_FRAME_LIMIT = 512 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const OPERATIONS = new Set(['configuration', 'csrf', 'history', 'chats', 'members', 'streamToken', 'streamUrl', 'sendText', 'sse']);

/** Deliberately contains neither server response text nor underlying exception causes. */
export class OaApiError extends Error {
  constructor(status, operation) {
    const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
    const safeOperation = OPERATIONS.has(operation) ? operation : 'configuration';
    super(`OA ${safeOperation} failed (${safeStatus})`);
    this.name = 'OaApiError';
    this.status = safeStatus;
    this.operation = safeOperation;
  }
}

function invalid(operation) { throw new OaApiError(0, operation); }

function identifier(value, operation) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(value)) invalid(operation);
  return value;
}

function cursor(value, operation) {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) invalid(operation);
  return value;
}

function pageLimit(value, operation) {
  if (!Number.isInteger(value) || value < 1 || value > 100) invalid(operation);
  return String(value);
}

function cancelQuietly(readerOrStream) {
  // Cancellation must not replace the sanitized error or hold a request open.
  try { void readerOrStream?.cancel().catch(() => {}); } catch {}
}

async function boundedJson(response, signal) {
  const advertised = response.headers.get('content-length');
  if (advertised !== null && /^\d+$/.test(advertised) && Number(advertised) > JSON_LIMIT) {
    cancelQuietly(response.body);
    throw new Error('response limit');
  }
  if (!response.body) return {};
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const pieces = [];
  let size = 0;
  let complete = false;
  const abort = () => cancelQuietly(reader);
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new Error('aborted');
      const { value, done } = await reader.read();
      if (done) { complete = true; break; }
      size += value.byteLength;
      if (size > JSON_LIMIT) throw new Error('response limit');
      pieces.push(decoder.decode(value, { stream: true }));
    }
    pieces.push(decoder.decode());
    const text = pieces.join('');
    if (text.trim() === '') return {};
    const result = JSON.parse(text);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('response shape');
    return result;
  } finally {
    signal.removeEventListener('abort', abort);
    if (!complete) cancelQuietly(reader);
    reader.releaseLock();
  }
}

/** No retries: a failed/timeout send can already have reached the server. */
export class OaClient {
  #botId;
  #cookie;
  #fetch;
  #csrfValue;
  #csrfPending;

  constructor({ botId, cookie, fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
    this.#botId = identifier(botId, 'configuration');
    if (typeof cookie !== 'string' || !cookie.trim() || cookie.length > 32_768 ||
        /[^\x20-\x7e]/.test(cookie) || !cookie.split(';').every(part => /^[!#$%&'*+.^_`|~0-9A-Za-z-]+=[^;]*$/.test(part.trim())) ||
        typeof fetchImpl !== 'function') invalid('configuration');
    this.#cookie = cookie.trim();
    this.#fetch = fetchImpl;
  }

  async #request(operation, path, { method = 'GET', body, csrf = false } = {}) {
    if (csrf && !this.#csrfValue) await this.csrf();
    const controller = new AbortController();
    let status = 0;
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new OaApiError(0, operation));
      }, REQUEST_TIMEOUT_MS);
    });
    try {
      const headers = new Headers({
        Accept: 'application/json',
        Cookie: this.#cookie,
        Referer: `${ORIGIN}/`,
        Origin: ORIGIN,
        'x-oa-chat-client-version': CLIENT_VERSION,
        'User-Agent': USER_AGENT,
      });
      if (this.#csrfValue) headers.set(this.#csrfValue.headerName, this.#csrfValue.token);
      if (body !== undefined) headers.set('Content-Type', 'application/json');
      const request = async () => {
        const response = await this.#fetch(`${ORIGIN}${path}`, {
          method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
          // A login redirect must never forward session cookies to another origin.
          redirect: 'manual',
        });
        status = response.status;
        if (!response.ok) {
          cancelQuietly(response.body);
          throw new Error('http failure');
        }
        return boundedJson(response, controller.signal);
      };
      return await Promise.race([request(), deadline]);
    } catch {
      // Fetch/JSON exceptions can contain URLs, cookies, or response fragments.
      throw new OaApiError(controller.signal.aborted ? 0 : status, operation);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  /** Explicit calls refresh the token; concurrent refreshes share one request. */
  async csrf() {
    if (this.#csrfPending) return this.#csrfPending;
    this.#csrfPending = (async () => {
      const result = await this.#request('csrf', '/api/v1/csrfToken');
      const { headerName, token } = result;
      // Honor the returned name, but never let a malformed response override Cookie/Host.
      if (typeof headerName !== 'string' || !/^x-[a-z0-9-]*(?:csrf|xsrf)[a-z0-9-]*$/i.test(headerName) ||
          headerName.length > 100 || typeof token !== 'string' || !/^[\x21-\x7e]{1,16384}$/.test(token)) {
        throw new OaApiError(200, 'csrf');
      }
      this.#csrfValue = { headerName, token };
      return { headerName, token };
    })();
    try { return await this.#csrfPending; }
    finally { this.#csrfPending = undefined; }
  }

  history(chatId, { backward, limit = 100 } = {}) {
    const chat = identifier(chatId, 'history');
    const query = new URLSearchParams({ limit: pageLimit(limit, 'history') });
    if (backward !== undefined) query.set('backward', cursor(backward, 'history'));
    return this.#request('history', `/api/v3/bots/${this.#botId}/chats/${chat}/messages?${query}`);
  }

  chats({ next, limit = 25 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) invalid('chats');
    const query = new URLSearchParams({
      folderType: 'ALL', tagIds: '', autoTagIds: '', prioritizePinnedChat: 'false',
      limit: pageLimit(limit, 'chats'),
    });
    if (next !== undefined) query.set('next', cursor(next, 'chats'));
    return this.#request('chats', `/api/v2/bots/${this.#botId}/chats?${query}`);
  }

  streamToken() {
    return this.#request('streamToken', `/api/v1/bots/${this.#botId}/streamingApiToken`, { method: 'POST', csrf: true });
  }

  members(chatId, { next, limit = 100 } = {}) {
    const chat = identifier(chatId, 'members');
    const query = new URLSearchParams({ limit: pageLimit(limit, 'members') });
    if (next !== undefined) query.set('next', cursor(next, 'members'));
    return this.#request('members', `/api/v1/bots/${this.#botId}/chats/${chat}/members?${query}`);
  }

  /** token is the complete streamToken() response. Never log the returned URL. */
  streamUrl(token, lastEventId = '') {
    try {
      if (!token || typeof token !== 'object' || typeof token.streamingApiToken !== 'string' ||
          !token.streamingApiToken || token.streamingApiToken.length > 16_384 ||
          /[\u0000-\u001f\u007f]/.test(token.streamingApiToken)) invalid('streamUrl');
      const base = new URL(token.streamingApiBaseUrl ?? 'https://chat-streaming-api.line.biz');
      if (base.protocol !== 'https:' || !(base.hostname === 'line.biz' || base.hostname.endsWith('.line.biz')) ||
          base.username || base.password || base.port || base.search || base.hash || base.pathname !== '/') invalid('streamUrl');
      const version = token.streamingApiVersion ?? 'v1';
      if (typeof version !== 'string' || !/^v[1-9]\d{0,2}$/.test(version)) invalid('streamUrl');
      base.pathname = `/api/${version}/sse`;
      base.search = new URLSearchParams({
        token: token.streamingApiToken, deviceType: '', clientType: 'PC', pingSecs: '20',
        lastEventId: cursor(lastEventId, 'streamUrl'),
      }).toString();
      return base.toString();
    } catch { throw new OaApiError(0, 'streamUrl'); }
  }

  sendText(chatId, text, sendId) {
    const chat = identifier(chatId, 'sendText');
    if (typeof text !== 'string' || !text.length || text.length > 5000 ||
        typeof sendId !== 'string' || !sendId.length || sendId.length > 256 || /[\u0000-\u001f\u007f]/.test(sendId)) invalid('sendText');
    return this.#request('sendText', `/api/v1/bots/${this.#botId}/chats/${chat}/messages/send`, {
      method: 'POST', csrf: true,
      body: { id: '', type: 'textV2', text: text.replace(/[{}]/g, '$&$&'), sendId },
    });
  }
}

/**
 * WHATWG SSE framing. Yields {id, event, data}; data stays unparsed.
 * IDs persist until reset; partial frames at EOF are discarded, never replay-committed.
 * Caller owns connection timeout/reconnect and must commit the cursor after processing.
 */
export async function* parseSse(stream) {
  let reader;
  let complete = false;
  try {
    reader = stream.getReader();
    const bytes = new Uint8Array(SSE_FRAME_LIMIT);
    const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
    let length = 0;
    let frameSize = 0;
    let pendingCR = false;
    let firstLine = true;
    let id = '';
    let event = '';
    let data = [];
    const line = () => {
      let text = decoder.decode(bytes.subarray(0, length));
      length = 0;
      if (firstLine) {
        firstLine = false;
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      }
      if (text === '') {
        const result = data.length ? { id, event: event || 'message', data: data.join('\n') } : null;
        data = [];
        event = '';
        frameSize = 0;
        return result;
      }
      if (text.startsWith(':')) return null;
      const colon = text.indexOf(':');
      const field = colon < 0 ? text : text.slice(0, colon);
      let value = colon < 0 ? '' : text.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') data.push(value);
      else if (field === 'event') event = value;
      else if (field === 'id' && !value.includes('\0')) id = value;
      return null;
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) { complete = true; break; }
      if (!(value instanceof Uint8Array)) invalid('sse');
      for (const byte of value) {
        if (pendingCR) {
          pendingCR = false;
          if (byte === 10 && ++frameSize > SSE_FRAME_LIMIT) invalid('sse');
          const ready = line();
          if (ready) yield ready;
          if (byte === 10) continue;
        }
        if (++frameSize > SSE_FRAME_LIMIT) invalid('sse');
        if (byte === 13) pendingCR = true;
        else if (byte === 10) {
          const ready = line();
          if (ready) yield ready;
        } else bytes[length++] = byte;
      }
    }
    if (pendingCR) {
      const ready = line();
      if (ready) yield ready;
    }
  } catch { throw new OaApiError(0, 'sse'); }
  finally {
    if (reader) {
      if (!complete) cancelQuietly(reader);
      reader.releaseLock();
    }
  }
}
