// スコアランキングの送信と表示。
//
// ■ セキュリティ上の約束
// このファイルは liff.getProfile() を呼ばない。ユーザーIDや名前を
// サーバーへ送ることも一切しない。送るのは liff.getAccessToken() の
// アクセストークンだけで、「誰のスコアか」はサーバーがLINEに問い合わせて
// 決める。クライアントを書き換えても他人のスコアにはできない。
//
// ■ 遊べることを優先する
// ランキングは「おまけ」なので、ログインしていない/通信が失敗した場合も
// ゲーム自体は普通に遊べるようにする。例外は全部飲み込んで、
// 画面に一言出すだけに留める。

const API_SUBMIT = '/api/mochi/score';
const API_RANKING = '/api/mochi/ranking';
const API_ME = '/api/mochi/me';
const API_START = '/api/mochi/runs/start';

const num = (v) => Math.round(v).toLocaleString('ja-JP');

/** LINEの中で開かれていて、アクセストークンが取れるか */
function accessToken() {
  try {
    const liff = window.liff;
    if (!liff || typeof liff.getAccessToken !== 'function') return null;
    // LINE外(普通のブラウザ)では isLoggedIn が false になる
    if (typeof liff.isLoggedIn === 'function' && !liff.isLoggedIn()) return null;
    return liff.getAccessToken() || null;
  } catch {
    return null;
  }
}

export function canSubmit() {
  return accessToken() !== null;
}

async function post(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    const data = await response.json();
    return { ok: response.ok, status: response.status, data };
  } finally { clearTimeout(timer); }
}

/** Register only when play begins, after LIFF is ready. Guest play stays available. */
export async function startScoreRun(id) {
  const token = accessToken();
  if (!token) return { status: 'guest' };
  try {
    const res = await post(API_START, { accessToken: token, id });
    if (!res.ok) return { status: 'start_error' };
    const data = res.data;
    return data.id === id ? { id, status: 'ready' } : { status: 'start_error' };
  } catch { return { status: 'start_error' }; }
}

/**
 * 自己ベストをサーバーへ送る。
 * 戻り値は画面に出す短い文章(送れなかった理由も含む)。
 */
export async function submitScore({ score, merges, stage, runId }) {
  const token = accessToken();
  if (!token) {
    return { ok: false, retryable: true, message: 'LINEログインを確認して再送してください。' };
  }
  try {
    const res = await post(API_SUBMIT, { accessToken: token, score, merges, stage, ...(runId ? { runId } : {}) });
    if (!res.ok) {
      // 401はログインの問題、400は値の問題。どちらも遊びは続けられる。
      return { ok: false, retryable: ![400, 403, 404, 409].includes(res.status), message: '記録を保存できませんでした。' };
    }
    const data = res.data;
    const rank = data.rank ? `${data.rank}位` : '';
    if (data.updated) {
      return { ok: true, reward: data.reward, message: `自己ベスト更新！ 現在 ${rank}`.trim() };
    }
    return {
      ok: true,
      reward: data.reward,
      message: `ベスト ${num(data.best)}点 · 現在 ${rank}`.trim(),
    };
  } catch {
    return { ok: false, retryable: true, message: '通信できませんでした。記録を再送できます。' };
  }
}

/** 上位一覧を取る。読むだけなのでログイン不要。 */
export async function fetchRanking(limit = 20) {
  try {
    const res = await fetch(`${API_RANKING}?limit=${encodeURIComponent(limit)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.ranking) ? data.ranking : [];
  } catch {
    return null;
  }
}

/** 自分の順位を取る。ログインしていなければ null。 */
export async function fetchMyRank() {
  const token = accessToken();
  if (!token) return null;
  try {
    const res = await fetch(API_ME, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: token }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.me ?? null;
  } catch {
    return null;
  }
}

/**
 * 一覧をDOMに描く。
 * 名前はサーバーから来た文字列なので、textContent で入れて
 * HTMLとして解釈させない(表示名に < > が入っていても安全)。
 */
export function renderRanking(listEl, rows, myName) {
  listEl.textContent = '';
  if (!rows || rows.length === 0) {
    const li = document.createElement('li');
    li.className = 'ranking-empty';
    li.textContent = 'まだ記録がありません。最初の1位をねらおう！';
    listEl.appendChild(li);
    return;
  }
  for (const r of rows) {
    const li = document.createElement('li');
    if (myName && r.name === myName) li.classList.add('is-me');

    const rank = document.createElement('span');
    rank.className = 'ranking-rank';
    rank.textContent = `${r.rank}.`;

    const name = document.createElement('span');
    name.className = 'ranking-name';
    name.textContent = r.name;

    const score = document.createElement('span');
    score.className = 'ranking-score';
    score.textContent = `${num(r.score)}点`;

    li.append(rank, name, score);
    listEl.appendChild(li);
  }
}
