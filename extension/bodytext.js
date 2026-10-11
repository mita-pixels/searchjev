// 記事ページの HTML から、判定に使う本文の抜粋と公開日を取り出す（background と検証スクリプトで共有）
var SJ_BODY_CHARS = 2500;

function sjExtractBody(doc) {
  // 公開日・更新日（構造化データやメタタグ。説明文の日付より正確）
  const meta = sel => { const m = doc.querySelector(sel); return m && (m.getAttribute('content') || m.getAttribute('datetime')); };
  let date = meta('meta[property="article:modified_time"]') || meta('meta[property="article:published_time"]') ||
    meta('meta[itemprop="dateModified"]') || meta('meta[itemprop="datePublished"]') || meta('time[datetime]');
  if (!date) {
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
      const m = (s.textContent || '').match(/"date(?:Modified|Published)"\s*:\s*"([^"]+)"/);
      if (m) { date = m[1]; break; }
    }
  }
  const d = date && !isNaN(new Date(date)) ? new Date(date).toISOString().slice(0, 10) : null;

  // 本文：ナビ・広告・フッターなどを除き、article / main を優先する
  for (const el of doc.querySelectorAll('script, style, noscript, svg, iframe, nav, header, footer, aside, form, [role="navigation"], [aria-hidden="true"]')) el.remove();
  const candidates = [...doc.querySelectorAll('article, main, [role="main"]')];
  const root = candidates.sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0] || doc.body;
  const text = root ? (root.textContent || '').replace(/[ \t\r\f\v ]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim() : '';
  const h = [...doc.querySelectorAll('h1, h2, h3')].map(x => (x.textContent || '').trim()).filter(Boolean).slice(0, 25);
  return { excerpt: text.slice(0, SJ_BODY_CHARS), length: text.length, headings: h, date: d };
}
