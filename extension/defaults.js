// content script / background / 設定画面で共有する既定値と計算
// 重みは検証（poc/analyze2.mjs、手ラベル206件）で最もよく当たった組み合わせ
var SJ_DEFAULTS = {
  enabled: true,
  weights: { seo: 2, firsthand: 0.5, commercial: 1, google: 1, relevance: 0, kind: 1 },
  // 記事の種類ごとの扱い（1=上げる, 0=そのまま, -1=下げる）。手ラベルで「ゴミ」が多かった種類を下げ、「良い」が多かった種類を上げる
  kindAdjust: { guide: 0, comparison: -1, experience: 1, news: -1, qa: 0, official: 0, reference: 1, listing: 0, video: -1, other: 0 },
  readBody: false,        // 記事ページの本文も読んで判定し直す（費用約4倍）
  relevanceCutoff: 1.0,   // 関連度（0〜3）がこれ未満なら最下位へ
  demoteOld: false,       // 古くなりやすい話題で古い記事を下げる
  oldWeight: 1,
  cacheDays: 7,
};

var SJ_KINDS = {
  guide: '解説・ガイド', comparison: '比較・おすすめ', experience: '体験談・レビュー', news: 'ニュース',
  qa: 'Q&A・掲示板', official: '公式ページ', reference: '公式ドキュメント・制度', listing: '一覧ページ', video: '動画', other: 'その他',
};

// 話題の古くなる速さ（0〜3）→ 半減期（日）
var SJ_HALF_LIFE_DAYS = [Infinity, 3 * 365, 365, 120];

function sjHalfLife(staleness) {
  const lo = Math.floor(staleness), hi = Math.min(3, lo + 1), t = staleness - lo;
  const rate = d => (d === Infinity ? 0 : 1 / d);
  const r = rate(SJ_HALF_LIFE_DAYS[lo]) * (1 - t) + rate(SJ_HALF_LIFE_DAYS[hi]) * t;
  return r === 0 ? Infinity : 1 / r;
}

// 鮮度 0〜1。日付がなければ null
function sjFreshness(dateIso, staleness, now = new Date()) {
  if (!dateIso || staleness == null) return null;
  const hl = sjHalfLife(staleness);
  if (hl === Infinity) return 1;
  const age = Math.max(0, (now - new Date(dateIso)) / 864e5);
  return 0.5 ** (age / hl);
}

// 重みのプリセット。recommended は検証（手ラベル206件）で最もよく当たった組み合わせ
var SJ_PRESETS = {
  recommended: { label: 'おすすめ', note: '検証で最もよく当たった組み合わせ', weights: { seo: 2, firsthand: 0.5, commercial: 1, google: 1, relevance: 0, kind: 1 } },
  antiSeo: { label: '量産記事を徹底的に下げる', note: 'AI・技術系の検索向け', weights: { seo: 4, firsthand: 1, commercial: 1, google: 0.5, relevance: 0, kind: 1 } },
  firsthand: { label: '一次情報を重視', note: '公式・公的機関・実体験を上げる', weights: { seo: 1, firsthand: 3, commercial: 1, google: 0.5, relevance: 0, kind: 1 } },
  google: { label: 'Googleの順位を重視', note: '生活系の検索向け。並べ替えは控えめ', weights: { seo: 1, firsthand: 0.5, commercial: 0.5, google: 3, relevance: 0, kind: 0.5 } },
};

// 表示用の項目別スコア（0〜100、すべて「高いほど良い」）。種類が分からないときは kind を含めない
function sjParts(a, rankScore, kindAdjust) {
  const p = {
    seo: 1 - a.seo,
    firsthand: a.firsthand,
    // 公式の料金ページなど、一次情報の商業ページは減点しない（一次情報が高いほど商業目的の減点を弱める）
    commercial: 1 - a.commercial * (1 - a.firsthand),
    google: rankScore,
    relevance: a.relevance / 3,
  };
  if (a.kind && kindAdjust) p.kind = ((kindAdjust[a.kind] || 0) + 1) / 2; // 上げる=1, そのまま=0.5, 下げる=0
  return p;
}

// 総合点 0〜100 = 項目別スコアの重み付き平均。a = Jevの回答（0〜1、relevance のみ 0〜3）
function sjFinalScore(a, rankScore, settings) {
  const w = settings.weights;
  const p = sjParts(a, rankScore, settings.kindAdjust);
  let sum = 0, total = 0;
  for (const k of Object.keys(p)) { sum += (w[k] || 0) * p[k]; total += w[k] || 0; }
  if (settings.demoteOld && a.freshness != null) {
    sum += settings.oldWeight * a.freshness;
    total += settings.oldWeight;
  }
  return total > 0 ? Math.round((100 * sum) / total) : 0;
}

async function sjLoadSettings() {
  const { settings } = await browser.storage.local.get('settings');
  return {
    ...SJ_DEFAULTS,
    ...(settings || {}),
    weights: { ...SJ_DEFAULTS.weights, ...((settings && settings.weights) || {}) },
    kindAdjust: { ...SJ_DEFAULTS.kindAdjust, ...((settings && settings.kindAdjust) || {}) },
  };
}
