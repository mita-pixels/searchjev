// Google検索結果ページ：結果を読み取り、Jevの点数を表示して並べ替える
(() => {
  const RANK_SPAN = 9; // Googleの順位点：1位=1、10位以降=0（検証時と同じスケール）
  const batches = []; // { items: [{container, el, bar, rank, data, a}], staleness, error }
  let settings = null;
  let reordered = true; // ユーザーが「元の順」に戻したら false
  let toolbar = null;

  // ---- 読み取り ----
  function articleDate(snippet) {
    let m = snippet.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s*—/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]).toISOString().slice(0, 10);
    m = snippet.match(/(\d+)\s*(分|時間|日|週間|か月|ヶ月|年)前\s*—/);
    if (m) {
      const days = { 分: 0, 時間: 0, 日: 1, 週間: 7, か月: 30, ヶ月: 30, 年: 365 }[m[2]] * +m[1];
      return new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    }
    return null;
  }

  // 結果のタイトル：PC版は h3、スマホ版（Android）は role="heading" の div
  const HEADING = 'a h3, a [role="heading"]';

  // 結果1件を丸ごと含み、ほかの結果を含まない一番外側の要素（並べ替えの単位）
  function containerOf(block, rso) {
    let c = block;
    while (c.parentElement && c.parentElement !== rso && c.parentElement.querySelectorAll(HEADING).length === 1) {
      c = c.parentElement;
    }
    return c;
  }

  // 表示URL：PC版は cite、スマホ版は「https://〜」だけが書かれた span。
  // Reddit や note などは cite に URL ではなく「10 件以上のコメント · 1 年前」が入るので、URLで始まるものだけ使う
  function displayUrl(block) {
    const cite = block.querySelector('cite');
    if (cite && /^https?:\/\//.test(cite.innerText.trim())) return cite.innerText.trim();
    const span = [...block.querySelectorAll('span')].find(s => /^https?:\/\/\S+$/.test(s.textContent.trim()));
    return span ? span.textContent.trim() : '';
  }

  // 表示URLがない結果は、リンク先からドメインを取る（Googleのリダイレクトなら ping 属性の url=）
  function linkUrl(a) {
    try {
      const u = new URL(a.href);
      if (!/(^|\.)google\./.test(u.hostname)) return u;
      const ping = a.getAttribute('ping');
      const real = ping && new URLSearchParams(ping.split('?')[1] || '').get('url');
      if (real) return new URL(real);
    } catch (e) { /* 読めないリンクはドメインなしのまま */ }
    return null;
  }

  function extractNew(rso) {
    const found = [];
    const seen = new Set();
    for (const h of rso.querySelectorAll(HEADING)) {
      if (h.parentElement.closest('[role="heading"], h3')) continue; // 入れ子の見出しは外側だけ数える
      const a = h.closest('a');
      const block = a.closest('[data-rpos]') || a.closest('[data-hveid]');
      if (!block || seen.has(block) || block.dataset.sjDone) continue;
      seen.add(block);
      const title = h.innerText.trim();
      const citeT = displayUrl(block);
      let domain = '', path = citeT.split('›').slice(1).join('›').trim();
      try { domain = new URL(citeT.split(' ')[0]).hostname; } catch (e) {
        const u = linkUrl(a); // 動画・Reddit・note などは表示URLがない
        if (u) {
          domain = u.hostname;
          try { path = decodeURIComponent(u.pathname); } catch (e2) { path = u.pathname; }
          path = path.slice(0, 80);
        }
      }
      const lines = block.innerText.split('\n').map(s => s.trim()).filter(Boolean);
      const snippet = lines
        .filter(l => l !== title && l !== citeT && l !== 'ウェブ検索結果' && l !== 'もっと見る' && !l.startsWith('http'))
        .join(' ').slice(0, 300);
      found.push({
        block,
        container: containerOf(block, rso),
        // href は本文を読むときだけ使う（Googleのリダイレクトリンクのまま）
        data: { title, domain, path, snippet, href: a.href },
        date: articleDate(snippet),
      });
    }
    // 「トップニュース」などのまとまりの中の結果は動かさない：最も多い親を共有するものだけ対象
    const parents = new Map();
    for (const f of found) parents.set(f.container.parentElement, (parents.get(f.container.parentElement) || 0) + 1);
    const main = [...parents.entries()].sort((x, y) => y[1] - x[1])[0];
    return main ? found.filter(f => f.container.parentElement === main[0]) : [];
  }

  // ---- 表示 ----
  // ページの実際の背景が暗いか（Googleのダークテーマ）。背景が透明なら親をたどる
  function pageIsDark() {
    for (const el of [document.body, document.documentElement]) {
      const m = getComputedStyle(el).backgroundColor.match(/\d+(\.\d+)?/g);
      if (!m || (m.length === 4 && +m[3] === 0)) continue;
      const [r, g, b] = m.map(Number);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
    }
    return false;
  }

  function span(cls, text, title) {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    if (title) s.title = title;
    return s;
  }

  function renderBar(item, batch) {
    const bar = item.bar;
    bar.textContent = '';
    if (batch.error) {
      bar.append(span('sj-muted', batch.error === 'nokey' ? 'SearchJev: APIキーが未設定です' : `SearchJev: ${batch.message}`));
      if (batch.error === 'nokey' || batch.error === 'auth') {
        const b = document.createElement('button');
        b.className = 'sj-link';
        b.textContent = '設定を開く';
        b.onclick = () => browser.runtime.sendMessage({ type: 'openOptions' });
        bar.append(b);
      }
      return;
    }
    if (!item.a) { bar.append(span('sj-muted', 'SearchJev: 判定中…')); return; }
    const a = item.a;
    const lowRel = a.relevance < settings.relevanceCutoff;
    const cls = lowRel ? 'sj-low' : item.score >= 70 ? 'sj-good' : item.score >= 50 ? 'sj-mid' : 'sj-low';
    // 項目別スコアはすべて 0〜100・高いほど良い にそろえて表示する
    const p = item.parts;
    const pct = v => Math.round(v * 100);
    // Jevが判定に迷った項目は薄く表示して「?」を付ける
    const unsure = sjUnsure(a);
    const UNSURE_NOTE = '\n（Jevが判定に迷っています）';
    const metric = (key, text, title) => {
      const s = span(unsure[key] ? 'sj-m sj-unsure' : 'sj-m', unsure[key] ? `${text}?` : text, title);
      if (unsure[key]) s.title += UNSURE_NOTE;
      return s;
    };
    bar.append(
      span(`sj-total ${cls}`, `総合 ${item.score}`, '下の項目別スコアを、設定の重みで平均した点数（0〜100）'),
      metric('seo', `非量産 ${pct(p.seo)}`, `量産記事らしくなさ。SEO・アフィリエイト目的の量産記事である確率 ${pct(a.seo)}% の裏返し`),
      metric('firsthand', `一次情報 ${pct(p.firsthand)}`, `公式・公的機関・実体験（Q&Aの体験談を含む）・独自データ・専門家の度合い（Jevの評価 ${(a.firsthand * 3).toFixed(1)} / 3${a.conf && a.conf.firsthand != null ? `、確信度 ${pct(a.conf.firsthand)}%` : ''}）`),
      metric('commercial', `非商業 ${pct(p.commercial)}`, `売り込みらしくなさ。購入・申込への誘導が主目的である確率 ${pct(a.commercial)}%（企業のオウンドメディアや比較・ランキング記事も売り込みとみなす）。一次情報が高いページは減点を弱める`),
      metric('relevance', `関連 ${pct(p.relevance)}`, `検索した人の目的を果たせそうなページか（確率 ${pct(a.relevance / 3)}%${item.body ? '、本文から判定' : ''}）`),
      ...(p.intent != null ? [span('sj-m', `意図一致 ${pct(p.intent)}`, 'この記事の種類が、検索した人の求める種類（ツールバーに表示）と合っている度合い')] : []),
      span('sj-muted', `元${item.rank}位`),
    );
    if (a.kind && SJ_KINDS[a.kind]) {
      const adj = settings.kindAdjust[a.kind] || 0;
      const kindCls = adj > 0 ? 'sj-kind sj-kind-up' : adj < 0 ? 'sj-kind sj-kind-down' : 'sj-kind';
      const kindTip = `記事の種類。設定で「${adj > 0 ? '上げる' : adj < 0 ? '下げる' : 'そのまま'}」になっています${unsure.kind ? UNSURE_NOTE : ''}`;
      bar.append(span(unsure.kind ? `${kindCls} sj-unsure` : kindCls, unsure.kind ? `${SJ_KINDS[a.kind]}?` : SJ_KINDS[a.kind], kindTip));
    }
    if (a.publisher && SJ_PUBLISHERS[a.publisher]) {
      const adj = settings.publisherAdjust[a.publisher] || 0;
      const pubCls = adj > 0 ? 'sj-kind sj-kind-up' : adj < 0 ? 'sj-kind sj-kind-down' : 'sj-kind';
      const pubTip = `発信者の立場。設定で「${adj > 0 ? '上げる' : adj < 0 ? '下げる' : 'そのまま'}」になっています${unsure.publisher ? UNSURE_NOTE : ''}`;
      bar.append(span(unsure.publisher ? `${pubCls} sj-unsure` : pubCls, unsure.publisher ? `${SJ_PUBLISHERS[a.publisher]}?` : SJ_PUBLISHERS[a.publisher], pubTip));
    }
    if (item.body) bar.append(span('sj-muted', '本文で判定', '関連度は記事ページの本文も読んで判定しました'));
    else if (item.bodyPending) bar.append(span('sj-muted', '本文を読み込み中…'));
    else if (item.bodySkipped) bar.append(span('sj-muted', 'タイトルで判定', 'タイトルと説明文だけで関連度の判断がはっきりしていたので、本文は読みませんでした'));
    if (lowRel) bar.append(span('sj-warn', '関連薄'));
    if (item.date) bar.append(span('sj-muted', item.date.replace(/-/g, '/')));
    if (a.freshness != null && a.freshness < 0.5 && batch.staleness >= 1.5) {
      const hl = sjHalfLife(batch.staleness);
      const period = hl < 200 ? '数か月' : hl < 600 ? '1年ほど' : '数年';
      bar.append(span('sj-warn', '古い可能性', `この話題は${period}で情報が古くなりやすい`));
    }
  }

  function computeScores(batch) {
    for (const it of batch.items) {
      if (!it.a) continue;
      it.a.freshness = sjFreshness(it.date, batch.staleness);
      const rankScore = Math.max(0, 1 - (it.rank - 1) / RANK_SPAN);
      it.parts = sjParts(it.a, rankScore, settings, batch.intent);
      it.score = sjFinalScore(it.a, rankScore, settings, batch.intent);
    }
  }

  // 並べ替え：対象の結果がもともとあった位置（スロット）に、並べ替え後の順で入れ直す。
  // 広告や「他の人はこちらも質問」などの対象外ブロックは位置を変えない
  function applyOrder(batch) {
    const slots = batch.items.map(it => it.slot);
    let order = [...batch.items];
    if (reordered && settings.enabled && !batch.error && order.every(it => it.a)) {
      const key = it => (it.a.relevance < settings.relevanceCutoff ? -1 : it.score);
      order.sort((x, y) => key(y) - key(x) || x.rank - y.rank);
    }
    order.forEach((it, i) => slots[i].after(it.container));
  }

  function renderAll() {
    const dark = pageIsDark();
    for (const b of batches) {
      computeScores(b);
      for (const it of b.items) {
        it.bar.hidden = !settings.enabled;
        it.bar.classList.toggle('sj-dark', dark);
        renderBar(it, b);
      }
      applyOrder(b);
    }
    renderToolbar();
  }

  function renderToolbar() {
    const rso = document.getElementById('rso');
    if (!rso) return;
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.className = 'sj-toolbar';
      rso.before(toolbar);
    }
    toolbar.hidden = !settings.enabled;
    toolbar.classList.toggle('sj-dark', pageIsDark());
    toolbar.textContent = '';
    const pending = batches.some(b => !b.error && b.items.some(it => !it.a));
    const failed = batches.find(b => b.error);
    toolbar.append(span('sj-brand', `SearchJev v${browser.runtime.getManifest().version}`),
      span(failed ? 'sj-warn' : 'sj-muted', failed ? `判定できませんでした：${failed.message}`
        : pending ? '判定中…' : reordered ? 'Jevの点数で並べ替え済み' : 'Googleの元の順'));
    const btn = document.createElement('button');
    btn.className = 'sj-link';
    btn.textContent = reordered ? '元の順に戻す' : '並べ替える';
    btn.onclick = () => { reordered = !reordered; renderAll(); };
    const opt = document.createElement('button');
    opt.className = 'sj-link';
    opt.textContent = '設定';
    opt.onclick = () => browser.runtime.sendMessage({ type: 'openOptions' });
    const intent = batches[0] && batches[0].intent;
    if (intent && !failed) {
      const topKind = Object.keys(intent).sort((x, y) => intent[y] - intent[x])[0];
      if (SJ_KINDS[topKind]) toolbar.append(span('sj-muted', `この検索の意図：${SJ_KINDS[topKind]}`, '検索した人がいちばん読みたい記事の種類（Jevの判定）'));
    }
    if (!failed) toolbar.append(btn);
    toolbar.append(opt);
    const bodyErr = batches.find(b => b.bodyError);
    if (bodyErr) toolbar.append(span('sj-warn', `本文を読めませんでした：${bodyErr.bodyError}`));
  }

  // ---- 処理 ----
  let rankOffset = 0;
  async function processNew() {
    const rso = document.getElementById('rso');
    const query = new URLSearchParams(location.search).get('q');
    if (!rso || !query || !settings.enabled) return;
    const found = extractNew(rso);
    if (!found.length) return;

    const batch = { items: [], staleness: null, error: null };
    found.forEach((f, i) => {
      f.block.dataset.sjDone = '1';
      const bar = document.createElement('div');
      bar.className = 'sj-bar';
      f.block.prepend(bar); // 結果の一番上に置く（下に置くと次の結果のものに見える）
      const slot = document.createComment('sj-slot');
      f.container.before(slot);
      batch.items.push({ ...f, bar, slot, rank: rankOffset + i + 1, a: null, score: 0 });
    });
    rankOffset += found.length;
    batches.push(batch);
    renderAll();

    const res = await browser.runtime.sendMessage({ type: 'judge', query, results: batch.items.map(it => it.data) });
    if (res.ok) {
      batch.staleness = res.staleness;
      batch.intent = res.intent;
      batch.items.forEach((it, i) => { it.a = res.answers[i]; });
      saveLastSearch(query, batch);
    } else {
      batch.error = res.error;
      batch.message = res.message;
    }
    renderAll();
    if (res.ok && settings.readBody) await readBodies(query, batch);
  }

  // 本文モード：まずタイトルの判定で並べ、本文の判定が届いたものから関連度だけを差し替える
  // （検証で本文が効いたのは関連度だけだったため。量産・一次情報・売り込みはタイトルの判定のまま）
  // v0.3.5 から、タイトルでの関連度の判定に迷った結果だけ本文を読む（sjNeedsBody。費用と待ち時間が約半分になる）
  async function readBodies(query, batch) {
    const need = batch.items.map(it => sjNeedsBody(it.a));
    batch.items.forEach((it, i) => { it.bodyPending = need[i]; it.bodySkipped = !need[i]; });
    renderAll();
    if (!need.some(Boolean)) return;
    const res = await browser.runtime.sendMessage({ type: 'judgeBody', query, results: batch.items.map((it, i) => (need[i] ? it.data : null)) });
    batch.items.forEach((it, i) => {
      if (!need[i]) return;
      it.bodyPending = false;
      const b = res.ok && res.answers[i];
      if (!b) return;
      it.a = { ...it.a, relevance: b.relevance };
      if (b.date) it.date = b.date; // ページのメタ情報の日付は説明文の日付より正確
      it.body = true;
    });
    if (!res.ok) batch.bodyError = res.message;
    saveLastSearch(query, batch);
    renderAll();
  }

  // 設定画面のプレビュー用に、直前の検索（最初のまとまり）を保存する
  function saveLastSearch(query, batch) {
    if (batches[0] !== batch) return;
    browser.storage.local.set({ lastSearch: { query, intent: batch.intent, items: batch.items.map(it => ({ t: it.data.title, domain: it.data.domain, rank: it.rank, a: it.a })) } });
  }

  async function main() {
    settings = await sjLoadSettings();
    browser.storage.onChanged.addListener(async (changes, area) => {
      if (area !== 'local' || !changes.settings) return;
      const hadBody = settings.readBody;
      settings = await sjLoadSettings();
      renderAll();
      processNew();
      // 本文モードをオンにしたら、表示中の結果も本文で判定し直す
      if (!hadBody && settings.readBody) {
        const query = new URLSearchParams(location.search).get('q');
        for (const b of batches) if (!b.error && b.items.every(it => it.a) && !b.items.some(it => it.body)) readBodies(query, b);
      }
    });
    await processNew();
    // 「もっと見る」などで結果が追加されたら、その分だけ判定する
    let timer = null;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(processNew, 400);
    }).observe(document.getElementById('center_col') || document.body, { childList: true, subtree: true });
  }

  main();
})();
