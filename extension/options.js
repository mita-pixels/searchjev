// 設定画面
const $ = id => document.getElementById(id);
let settings;

const WEIGHTS = [
  { key: 'seo', name: '非量産', color: '#2f6fdd', desc: 'SEO・アフィリエイト目的の量産記事を下げる。検証で最もよく当たった指標' },
  { key: 'firsthand', name: '一次情報', color: '#1d8a4e', desc: '公式・公的機関・実体験（Q&Aの体験談やファンwikiを含む）・独自データ・専門家を上げる' },
  { key: 'commercial', name: '非商業', color: '#c77c02', desc: '購入・申込への誘導が主目的の記事（企業のオウンドメディア、比較・ランキング記事を含む）を下げる。一次情報が高いページは下げない' },
  { key: 'google', name: 'Googleの順位', color: '#7a5af5', desc: 'Googleの元の順位をどれだけ残すか。生活系の検索ではGoogleの順位がよく当たる' },
  { key: 'relevance', name: '関連度', color: '#8a8a85', desc: '検索した人の目的を果たせそうなページを上げる' },
  { key: 'kind', name: '記事の種類', color: '#c2417a', desc: '「記事の種類」で選んだ上げる・下げるを効かせる強さ' },
  { key: 'publisher', name: '発信者の立場', color: '#5b6b2f', desc: '「発信者の立場」で選んだ上げる・下げるを効かせる強さ' },
  { key: 'intent', name: '意図との一致', color: '#0f8a8a', desc: '検索した人が求める種類（例：「〜 おすすめ」なら比較・おすすめ）の記事を上げる' },
];

// プレビュー用の見本：「imax おすすめ 映画館」の判定結果（Googleの元の順）。
// 実際に検索したあとは、直前の検索（content.js が保存する lastSearch）を使う
let preview = null;
const SAMPLE = [
  { t: '至急です。東京でIMAXがあるおすすめの映画館ありますか（知恵袋）', seo: 0.20, firsthand: 1.3, commercial: 0.07, relevance: 2.1, kind: "voice" },
  { t: 'オタクのお気に入り映画館メモ（東京・神奈川）（note）', seo: 0.38, firsthand: 1.8, commercial: 0.11, relevance: 1.8, kind: "voice" },
  { t: '2026年に東京で観るべきIMAX映画ベスト10（CinemaView）', seo: 0.82, firsthand: 0.8, commercial: 0.47, relevance: 1.8, kind: "comparison" },
  { t: 'IMAX® || TOHOシネマズ（公式）', seo: 0.16, firsthand: 2.8, commercial: 0.70, relevance: 1.3, kind: "product", publisher: "party" },
  { t: 'プロジェクト・ヘイル・メリーのためのベストIMAXスクリーン（Reddit）', seo: 0.41, firsthand: 1.7, commercial: 0.13, relevance: 2.7, kind: "voice" },
  { t: 'IMAX®の映画館一覧（映画.com）', seo: 0.25, firsthand: 1.0, commercial: 0.39, relevance: 2.5, kind: "other" },
  { t: 'おすすめの IMAX スクリーン（個人ブログ・スクリーンサイズ一覧）', seo: 0.44, firsthand: 1.4, commercial: 0.19, relevance: 2.5, kind: "comparison" },
  { t: '世界の「最高の映画館100選」に東京エリアから3館がランクイン（Time Out）', seo: 0.23, firsthand: 1.2, commercial: 0.11, relevance: 2.2, kind: "news" },
  { t: '映画オタクによる関東近郊オススメ映画館3選＋α（note）', seo: 0.50, firsthand: 1.9, commercial: 0.18, relevance: 2.7, kind: "comparison" },
].map(s => ({ ...s, firsthand: s.firsthand / 3 }));

const save = () => browser.storage.local.set({ settings });
const sameWeights = (a, b) => WEIGHTS.every(w => (a[w.key] || 0) === (b[w.key] || 0));

function renderPresets() {
  const box = $('presets');
  box.textContent = '';
  const current = Object.keys(SJ_PRESETS).find(k => sameWeights(SJ_PRESETS[k].weights, settings.weights));
  const entries = [...Object.entries(SJ_PRESETS), ...(current ? [] : [['custom', { label: 'カスタム', note: '「細かく調整する」で設定中' }]])];
  for (const [k, p] of entries) {
    const label = document.createElement('label');
    label.className = 'preset' + ((current || 'custom') === k ? ' selected' : '');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'preset';
    input.checked = (current || 'custom') === k;
    input.disabled = k === 'custom';
    input.onchange = () => { settings.weights = { ...p.weights }; renderWeights(); save(); };
    const b = document.createElement('b');
    b.textContent = p.label;
    const note = document.createElement('span');
    note.className = 'muted';
    note.textContent = p.note;
    label.append(input, b, note);
    box.append(label);
  }
}

function shares() {
  const total = WEIGHTS.reduce((s, w) => s + (settings.weights[w.key] || 0), 0);
  return Object.fromEntries(WEIGHTS.map(w => [w.key, total ? (settings.weights[w.key] || 0) / total : 0]));
}

function buildWeightSliders() {
  const box = $('weights');
  for (const w of WEIGHTS) {
    const row = document.createElement('div');
    row.className = 'weight';
    row.innerHTML = `<span class="name"></span><input type="range" min="0" max="4" step="0.5"><span class="share"></span><span class="desc muted"></span>`;
    row.querySelector('.name').textContent = w.name;
    row.querySelector('.desc').textContent = w.desc;
    const input = row.querySelector('input');
    input.dataset.w = w.key;
    input.oninput = () => { settings.weights[w.key] = +input.value; renderWeights(); save(); };
    box.append(row);
  }
}

function renderWeights() {
  const sh = shares();
  for (const input of document.querySelectorAll('#weights input')) {
    input.value = settings.weights[input.dataset.w] || 0;
    input.parentElement.querySelector('.share').textContent = `影響 ${Math.round(sh[input.dataset.w] * 100)}%`;
  }
  const bar = $('sharebar');
  bar.textContent = '';
  const legend = $('legend');
  legend.textContent = '';
  for (const w of WEIGHTS) {
    if (!sh[w.key]) continue;
    const s = document.createElement('span');
    s.style.width = `${sh[w.key] * 100}%`;
    s.style.background = w.color;
    s.title = `${w.name} ${Math.round(sh[w.key] * 100)}%`;
    bar.append(s);
    const l = document.createElement('span');
    const i = document.createElement('i');
    i.style.background = w.color;
    l.append(i, `${w.name} ${Math.round(sh[w.key] * 100)}%`);
    legend.append(l);
  }
  renderPresets();
  renderPreview();
}

async function loadPreview() {
  const { lastSearch } = await browser.storage.local.get('lastSearch');
  if (lastSearch && lastSearch.items.length) {
    preview = { intent: lastSearch.intent, items: lastSearch.items.map(x => ({ ...x.a, t: x.domain ? `${x.t}（${x.domain}）` : x.t, rank: x.rank })) };
    $('previewTitle').textContent = `プレビュー：直前の検索「${lastSearch.query}」`;
    $('previewNote').textContent = 'あなたが最後に検索した結果の、実際の判定値とGoogleの順位を使っています。方針や重みを変えると、その場で順位が変わります。';
  } else {
    preview = { items: SAMPLE.map((s, i) => ({ ...s, rank: i + 1 })) };
    $('previewTitle').textContent = 'プレビュー：見本「imax おすすめ 映画館」';
    $('previewNote').textContent = '見本のデータです。一度Googleで検索すると、その結果でプレビューできるようになります。';
  }
}

function renderPreview() {
  const rows = preview.items.map(s => {
    const rankScore = Math.max(0, 1 - (s.rank - 1) / 9);
    return { ...s, orig: s.rank, score: sjFinalScore(s, rankScore, settings, preview.intent), cut: s.relevance < settings.relevanceCutoff };
  });
  rows.sort((x, y) => (y.cut ? -1 : y.score) - (x.cut ? -1 : x.score) || x.orig - y.orig);
  const tb = $('preview');
  tb.textContent = '';
  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    const move = r.orig - (i + 1);
    tr.innerHTML = `<td class="num"></td><td class="num total"></td><td></td><td class="num"></td>`;
    tr.children[0].textContent = `${i + 1}位`;
    tr.children[1].textContent = r.cut ? '足切り' : r.score;
    const tags = [SJ_KINDS[r.kind], SJ_PUBLISHERS[r.publisher]].filter(Boolean);
    tr.children[2].textContent = tags.length ? `${r.t}［${tags.join('・')}］` : r.t;
    const m = tr.children[3];
    m.textContent = move > 0 ? `↑${move}（元${r.orig}位）` : move < 0 ? `↓${-move}（元${r.orig}位）` : `元${r.orig}位`;
    m.className = 'num ' + (move > 0 ? 'up' : move < 0 ? 'down' : 'muted');
    tb.append(tr);
  });
}

// 記事の種類・発信者の立場ごとの「上げる／そのまま／下げる」
function buildKinds(boxId = 'kinds', names = SJ_KINDS, field = 'kindAdjust') {
  const box = $(boxId);
  for (const [k, name] of Object.entries(names)) {
    const row = document.createElement('label');
    row.className = 'kind';
    const sel = document.createElement('select');
    for (const [v, t] of [[1, '上げる'], [0, 'そのまま'], [-1, '下げる']]) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = t;
      sel.append(o);
    }
    sel.value = settings[field][k] || 0;
    sel.onchange = () => { settings[field][k] = +sel.value; renderPreview(); save(); };
    const span = document.createElement('span');
    span.textContent = name;
    row.append(span, sel);
    box.append(row);
  }
}

async function renderBody() {
  const granted = await browser.permissions.contains({ origins: ['<all_urls>'] });
  $('readBody').checked = settings.readBody && granted;
  $('bodyStatus').textContent = settings.readBody && !granted ? 'サイトへのアクセスが許可されていないため、本文は読んでいません。もう一度オンにしてください。' : '';
}

function renderOther() {
  $('enabled').checked = settings.enabled;
  $('demoteOld').checked = settings.demoteOld;
  $('oldWeight').value = settings.oldWeight;
  $('oldWeightOut').textContent = settings.oldWeight;
  $('oldWeightRow').hidden = !settings.demoteOld;
  $('relevanceCutoff').value = settings.relevanceCutoff;
  $('relevanceCutoffOut').textContent = settings.relevanceCutoff;
  $('cacheDays').textContent = settings.cacheDays;
}

async function cacheCount() {
  const all = await browser.storage.local.get(null);
  $('cacheInfo').textContent = `${Object.keys(all).filter(k => k.startsWith('j:')).length} 件`;
}

function status(text, cls) {
  $('status').textContent = text;
  $('status').className = cls || '';
}

async function init() {
  $('version').textContent = `v${browser.runtime.getManifest().version}`;
  settings = await sjLoadSettings();
  const { apiKey } = await browser.storage.local.get('apiKey');
  if (apiKey) { $('apiKey').value = apiKey; status('APIキーは保存済みです', 'ok'); }
  await loadPreview();
  buildKinds();
  buildKinds("publishers", SJ_PUBLISHERS, "publisherAdjust");
  renderBody();
  // 許可の確認ダイアログはユーザーの操作（このクリック）の中で出す必要がある
  $('readBody').onchange = async e => {
    if (e.target.checked) {
      const ok = await browser.permissions.request({ origins: ['<all_urls>'] });
      settings.readBody = ok;
    } else {
      settings.readBody = false;
      browser.permissions.remove({ origins: ['<all_urls>'] });
    }
    await save();
    renderBody();
  };
  buildWeightSliders();
  renderWeights();
  // 設定画面を開いたまま検索した場合も、プレビューを最新の検索に更新する
  browser.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'local' && changes.lastSearch) { await loadPreview(); renderPreview(); }
  });
  renderOther();
  cacheCount();

  $('toggleKey').onclick = () => {
    const show = $('apiKey').type === 'password';
    $('apiKey').type = show ? 'text' : 'password';
    $('toggleKey').textContent = show ? '隠す' : '表示';
  };
  $('saveKey').onclick = async () => {
    const key = $('apiKey').value.trim();
    await browser.storage.local.set({ apiKey: key });
    if (!key) return status('APIキーを削除しました');
    status('確認中…');
    // 小さな判定を1回だけ投げてキーを確かめる
    const res = await browser.runtime.sendMessage({
      type: 'judge', query: 'SearchJev 接続テスト',
      results: [{ title: '接続テスト', snippet: 'APIキーの確認', domain: 'example.com', path: '' }],
    });
    if (res.ok) status('保存しました。接続を確認できました', 'ok');
    else status(`保存しましたが、確認に失敗しました：${res.message}`, 'err');
  };
  $('enabled').onchange = e => { settings.enabled = e.target.checked; save(); };
  $('demoteOld').onchange = e => { settings.demoteOld = e.target.checked; renderOther(); save(); };
  $('oldWeight').oninput = e => { settings.oldWeight = +e.target.value; renderOther(); save(); };
  $('relevanceCutoff').oninput = e => { settings.relevanceCutoff = +e.target.value; renderOther(); renderPreview(); save(); };
  $('clearCache').onclick = async () => {
    const all = await browser.storage.local.get(null);
    await browser.storage.local.remove(Object.keys(all).filter(k => /^[js]:/.test(k)));
    cacheCount();
  };
}

init();
