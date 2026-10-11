// Jev の呼び出しとキャッシュ。APIキーはここだけが扱い、ページ側には渡さない
const API = 'https://api.typesafe.ai/v1/systemone';

// 質問文は poc/score.mjs・candidates.mjs・freshness.mjs で検証したものと同じ
const RESULT_QUESTIONS = {
  seo_filler: {
    type: 'noul',
    instructions:
      'Google検索結果の1件（`result`）について、検索語（`query`）に対して書かれた記事が、' +
      'SEOやアフィリエイト目的で量産された中身の薄い記事（AI生成の可能性が高いもの）に見えるかを判定してください。' +
      'タイトル・説明文・ドメインから判断します。',
    criteria: {
      true: '「〜とは？徹底解説」「おすすめ◯選」「いかがでしたか」型、どこにでもある一般論の寄せ集め、' +
        '運営者や筆者の専門性が見えない、アフィリエイト誘導が主目的に見える',
      false: '公式・公的機関・メーカー・専門家・実体験・独自データ・具体的な技術情報など、' +
        'その記事でしか得られない中身がありそう',
    },
  },
  firsthand: {
    type: 'score',
    instructions:
      'Google検索結果の1件（`result`）が、どの程度「一次情報」を含んでいそうかを評価してください。' +
      '一次情報とは、公式情報、公的機関の情報、当事者の実体験、独自の検証・データ、専門家による解説を指します。',
    criteria: [
      '他サイトの情報をまとめ直しただけに見える。発信者が誰か分からない',
      '一般的な解説。発信者は分かるが、独自の情報は少なそう',
      '専門店・専門家・経験者による、具体的で独自の情報がありそう',
      '公式・公的機関・一次ソースそのもの、または独自の検証・実体験が中心',
    ],
  },
  commercial: {
    type: 'noul',
    instructions:
      'Google検索結果の1件（`result`）の記事が、読者に商品やサービスを買わせる・申し込ませる・' +
      'アフィリエイトリンクを踏ませることを主な目的にしていそうかを判定してください。',
    criteria: {
      true: 'ランキング・比較・おすすめ紹介で購入や申込に誘導する、自社サービスへの集客記事、EC・求人の一覧ページ',
      false: '情報提供や記録が主目的で、販売や申込への誘導は主目的ではない',
    },
  },
  kind: {
    type: 'choice',
    instructions: 'Google検索結果の1件（`result`）は、どの種類の記事・ページかを選んでください。タイトル・説明文・ドメインから判断します。',
    criteria: {
      guide: '解説・ガイド・手順（やり方や仕組みを説明する記事）',
      comparison: '比較・おすすめ・ランキング（複数の選択肢を並べて薦める記事）',
      experience: '体験談・レビュー・やってみた（書き手の経験が中心）',
      news: 'ニュース・発表・話題の紹介（出来事や発表を報じる記事）',
      qa: 'Q&A・掲示板・質問ページ',
      official: '公式の製品・サービス・料金・店舗ページ',
      reference: '公式ドキュメント・制度や規約の説明・辞書',
      listing: 'EC・求人・店舗などの一覧ページ',
      video: '動画',
      other: 'その他',
    },
  },
  relevance: {
    type: 'score',
    instructions:
      'Google検索結果の1件（`result`）が、検索語（`query`）で調べている人の疑問に直接答えていそうかを評価してください。',
    criteria: [
      'ほぼ無関係、または別の話題',
      '関連はあるが、疑問への答えは期待しにくい',
      '疑問に答えていそうだが、部分的',
      '疑問にまさに答えていそう',
    ],
  },
};

const QUERY_QUESTIONS = {
  staleness: {
    type: 'score',
    instructions:
      '検索語（`query`）で調べている人にとって、情報がどのくらいの速さで古くなる話題かを評価してください。' +
      '古い記事を読むと、今は通用しない情報をつかまされる危険がどれくらいあるかで判断します。',
    criteria: [
      'ほぼ古くならない：普遍的な知識、歴史、基本的な仕組み、料理や体の基本など',
      '年単位で変わる：制度、定番の製品、成熟した技術の使い方など',
      '数か月単位で変わる：新しい製品、料金プラン、変化の速いソフトウェアやサービスなど',
      '数週間単位で変わる：生成AIの最新ツール、速報性の高い話題など',
    ],
  },
};

class JevError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function callJev(key, state, questions, attempt = 0) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'jev-latest', state, questions }),
  });
  if ((res.status === 429 || res.status === 529) && attempt < 4) {
    await new Promise(ok => setTimeout(ok, 500 * 2 ** attempt));
    return callJev(key, state, questions, attempt + 1);
  }
  if (res.status === 401) throw new JevError('auth', 'APIキーが無効です');
  if (!res.ok) throw new JevError('api', `Jev API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).answers;
}

// ---- キャッシュ（storage.local、cacheDays 日で失効） ----
async function cacheGet(key, maxAgeMs) {
  const v = (await browser.storage.local.get(key))[key];
  return v && Date.now() - v.t < maxAgeMs ? v.v : undefined;
}
const cacheSet = (key, v) => browser.storage.local.set({ [key]: { t: Date.now(), v } });

async function pruneCache() {
  const { cacheDays } = await sjLoadSettings();
  const all = await browser.storage.local.get(null);
  const old = Object.keys(all).filter(k => /^[jsb]:/.test(k) && Date.now() - all[k].t > cacheDays * 864e5);
  if (old.length) await browser.storage.local.remove(old);
}

// Jev の回答を 0〜1 に揃える
const normalize = a => ({
  seo: a.seo_filler.noul,
  firsthand: a.firsthand.score / 3,
  commercial: a.commercial.noul,
  relevance: a.relevance.score, // 0〜3 のまま（足切りに使う）
  kind: a.kind ? a.kind.choice : null,
});

// ---- 本文を読む ----
// 検証（poc/kind-body.mjs）と同じく、タイトル・説明文に加えてページ本文の見出しと冒頭を読ませる
const BODY_NOTE = '検索結果のタイトル・説明文に加えて、ページ本文の見出しと冒頭（`page`）を読んで判断してください。';
const BODY_QUESTIONS = Object.fromEntries(Object.entries(RESULT_QUESTIONS).map(([k, q]) =>
  [k, { ...q, instructions: q.instructions.replace('タイトル・説明文・ドメインから判断します。', '') + BODY_NOTE }]));

// 記事ページを取得して本文を抜き出す。Cookie は送らない（ログイン中のページや個人情報を読まないため）
async function fetchBody(url) {
  const res = await fetch(url, { credentials: 'omit', redirect: 'follow', signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (!/html/i.test(type)) throw new Error('not html');
  const buf = new Uint8Array(await res.arrayBuffer());
  const head = new TextDecoder('latin1').decode(buf.slice(0, 4000));
  const cs = (type.match(/charset=([\w-]+)/i) || head.match(/charset=["']?([\w-]+)/i) || [])[1] || 'utf-8';
  let html;
  try { html = new TextDecoder(cs.toLowerCase()).decode(buf); } catch (e) { html = new TextDecoder().decode(buf); }
  return sjExtractBody(new DOMParser().parseFromString(html, 'text/html'));
}

async function judgeBody({ query, results }) {
  const { apiKey } = await browser.storage.local.get('apiKey');
  if (!apiKey) return { ok: false, error: 'nokey', message: 'APIキーが未設定です' };
  if (!(await browser.permissions.contains({ origins: ['<all_urls>'] }))) {
    return { ok: false, error: 'permission', message: '本文を読むには、設定画面でサイトへのアクセスを許可してください' };
  }
  const { cacheDays } = await sjLoadSettings();
  const answers = await Promise.all(results.map(async r => {
    if (!r.href) return null;
    const k = `b:${query}\n${r.domain}\n${r.title}`;
    const hit = await cacheGet(k, cacheDays * 864e5);
    if (hit !== undefined) return hit;
    try {
      const body = await fetchBody(r.href);
      // 本文が短すぎる（ログイン画面・動画ページなど）ときはタイトルの判定のままにする
      if (body.excerpt.length < 300) { await cacheSet(k, null); return null; }
      const state = {
        query,
        result: { title: r.title, snippet: r.snippet, domain: r.domain, url_path: r.path },
        page: { headings: body.headings, excerpt: body.excerpt, length_chars: body.length },
      };
      const a = { ...normalize(await callJev(apiKey, state, BODY_QUESTIONS)), date: body.date };
      await cacheSet(k, a);
      return a;
    } catch (e) {
      if (e.code === 'auth') throw e;
      return null; // 取得できないページ（403・タイムアウトなど）はタイトルの判定のまま
    }
  })).catch(e => e);
  if (answers instanceof Error) return { ok: false, error: answers.code || 'network', message: answers.message };
  return { ok: true, answers };
}

async function judge({ query, results }) {
  const { apiKey } = await browser.storage.local.get('apiKey');
  if (!apiKey) return { ok: false, error: 'nokey', message: 'APIキーが未設定です' };
  const settings = await sjLoadSettings();
  const maxAge = settings.cacheDays * 864e5;

  try {
    const stalenessP = (async () => {
      const k = `s:${query}`;
      const hit = await cacheGet(k, maxAge);
      if (hit !== undefined) return hit;
      const s = (await callJev(apiKey, { query }, QUERY_QUESTIONS)).staleness.score;
      await cacheSet(k, s);
      return s;
    })();

    const answersP = Promise.all(results.map(async r => {
      const k = `j:${query}\n${r.domain}\n${r.title}`;
      const hit = await cacheGet(k, maxAge);
      if (hit !== undefined && hit.kind !== undefined) return hit; // v0.2 以前のキャッシュには種類がないので取り直す
      const state = { query, result: { title: r.title, snippet: r.snippet, domain: r.domain, url_path: r.path } };
      const a = normalize(await callJev(apiKey, state, RESULT_QUESTIONS));
      await cacheSet(k, a);
      return a;
    }));

    // 両方を一緒に待つ（片方だけ待つと、もう片方の失敗が拾われずに残る）
    const [answers, staleness] = await Promise.all([answersP, stalenessP]);
    return { ok: true, answers, staleness };
  } catch (e) {
    return { ok: false, error: e.code || 'network', message: e.message };
  }
}

browser.runtime.onMessage.addListener(msg => {
  if (msg.type === 'judge') return judge(msg);
  if (msg.type === 'judgeBody') return judgeBody(msg);
  if (msg.type === 'openOptions') return browser.runtime.openOptionsPage();
});
browser.action.onClicked.addListener(() => browser.runtime.openOptionsPage());
browser.runtime.onStartup.addListener(pruneCache);
browser.runtime.onInstalled.addListener(pruneCache);
