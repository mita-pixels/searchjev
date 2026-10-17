// content script / background / 設定画面で共有する既定値と計算
// 重み：量産〜Googleの順位は最初の検証（poc/analyze2.mjs、手ラベル206件）で決めた値。
// v0.3.4 で、判定として機能していると確かめた関連度を 1、新しい発信者の立場を 0.5 にした（検証データ第2弾の確認用で悪化しないことを確認）
var SJ_DEFAULTS = {
  enabled: true,
  weights: { seo: 2, firsthand: 0.5, commercial: 1, google: 1, relevance: 1, kind: 1, publisher: 0.5, intent: 0.5 },
  // 記事の種類ごとの扱い（1=上げる, 0=そのまま, -1=下げる）。手ラベルで「ゴミ」が多かった種類を下げ、「良い」が多かった種類を上げる
  kindAdjust: { guide: 0, comparison: -1, voice: 1, news: -1, product: 0, video: -1, other: 0 },
  // 発信者の立場ごとの扱い。当事者・公的機関は「ゴミ」が少なく、当事者以外の企業（オウンドメディア）は利害による偏りが強い
  publisherAdjust: { party: 1, public: 1, media: 0, individual: 0, community: 0, seller: 0, company: -1 },
  readBody: false,        // 記事ページの本文も読んで、関連度を判定し直す
  relevanceCutoff: 1.0,   // 関連度（0〜3）がこれ未満なら最下位へ
  demoteOld: false,       // 古くなりやすい話題で古い記事を下げる
  oldWeight: 1,
  cacheDays: 7,
};

var SJ_KINDS = {
  guide: '解説・ガイド', comparison: '比較・おすすめ', voice: '体験談・口コミ', news: 'ニュース',
  product: '製品・サービスのページ', video: '動画', other: 'その他',
};

var SJ_PUBLISHERS = {
  party: '当事者', public: '公的機関', media: '報道・メディア', individual: '個人',
  community: 'Q&A・コミュニティ', seller: '販売・比較サイト', company: '企業（当事者以外）',
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

// 重みのプリセット。recommended は既定値と同じ
var SJ_PRESETS = {
  recommended: { label: 'おすすめ', note: '検証で最もよく当たった組み合わせ', weights: { ...SJ_DEFAULTS.weights } },
  antiSeo: { label: '量産記事を徹底的に下げる', note: 'AI・技術系の検索向け', weights: { seo: 4, firsthand: 1, commercial: 1, google: 0.5, relevance: 1, kind: 1, publisher: 0.5, intent: 0.5 } },
  firsthand: { label: '一次情報を重視', note: '公式・公的機関・実体験を上げる', weights: { seo: 1, firsthand: 3, commercial: 1, google: 0.5, relevance: 1, kind: 1, publisher: 1, intent: 0.5 } },
  google: { label: 'Googleの順位を重視', note: '生活系の検索向け。並べ替えは控えめ', weights: { seo: 1, firsthand: 0.5, commercial: 0.5, google: 3, relevance: 1, kind: 0.5, publisher: 0.5, intent: 0.5 } },
};

// 本文モードで本文を読むのは、タイトルでの関連度の判定に迷った結果だけ（確率 0.1〜0.9）。
// 検証データ（第2弾）では、全部読むより関連度がよく当たり（調整用 0.765→0.799、確認用 0.790→0.806）、読む数は約半分になった（poc/testset/gate.mjs）
var SJ_BODY_GATE = 0.8;
function sjNeedsBody(a) { return Math.abs(a.relevance / 3 - 0.5) * 2 < SJ_BODY_GATE; }

// 判定に迷っているか。noul は確率 0.3〜0.7、score・choice は Jev の確信度 50% 未満を「迷っている」とする
// （検証データ（第2弾）では、記事の種類の正解率が確信度 0.8 以上で 89%、0.5 未満で 44%）
function sjUnsure(a) {
  const noul = p => Math.abs(p - 0.5) < 0.2;
  const low = c => c != null && c < 0.5;
  const c = a.conf || {};
  return { seo: noul(a.seo), commercial: noul(a.commercial), relevance: noul(a.relevance / 3),
    firsthand: low(c.firsthand), kind: low(c.kind), publisher: low(c.publisher) };
}

// 表示用の項目別スコア（0〜100、すべて「高いほど良い」）。種類や検索意図が分からないときはその項目を含めない
// intent = 検索した人が求める記事の種類の確率（検索語ごとに Jev で判定）。settings から種類・発信者ごとの上げ下げを読む
function sjParts(a, rankScore, settings, intent) {
  const p = {
    seo: 1 - a.seo,
    firsthand: a.firsthand,
    // 公式の料金ページなど、一次情報の商業ページは減点しない（一次情報が高いほど商業目的の減点を弱める）
    commercial: 1 - a.commercial * (1 - a.firsthand),
    google: rankScore,
    relevance: a.relevance / 3,
  };
  if (a.kind && settings.kindAdjust) p.kind = ((settings.kindAdjust[a.kind] || 0) + 1) / 2; // 上げる=1, そのまま=0.5, 下げる=0
  if (a.publisher && settings.publisherAdjust) p.publisher = ((settings.publisherAdjust[a.publisher] || 0) + 1) / 2;
  // 検索意図との一致度 = Σ（検索語がその種類を求める確率 × 結果がその種類である確率）
  if (intent && a.kindProbs) p.intent = Object.keys(intent).reduce((s, k) => s + intent[k] * (a.kindProbs[k] || 0), 0);
  return p;
}

// 総合点 0〜100 = 項目別スコアの重み付き平均。a = Jevの回答（0〜1、relevance のみ 0〜3）
function sjFinalScore(a, rankScore, settings, intent) {
  const w = settings.weights;
  const p = sjParts(a, rankScore, settings, intent);
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
    publisherAdjust: { ...SJ_DEFAULTS.publisherAdjust, ...((settings && settings.publisherAdjust) || {}) },
  };
}
