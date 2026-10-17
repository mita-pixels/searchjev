// 記事ページの HTML の構造から、判定の手がかりになる特徴を数える（background と検証スクリプトで共有）
// 文章の中身ではなく、リンク・見出し・構造化データなど「ごまかしにくい」ものを数える。
// doc は本文抜き出し（bodytext.js）より前に渡すこと（あちらは要素を削除するため）
var SJ_AFFILIATE = [
  /amzn\.(to|asia)\//, /amazon\.co\.jp\/.*[?&]tag=/, /hb\.afl\.rakuten\.co\.jp/, /a\.r10\.to\//, /px\.a8\.net/, /af\.moshimo\.com/,
  /ck\.jp\.ap\.valuecommerce\.com/, /h\.accesstrade\.net/, /t\.afi-b\.com/, /click\.linksynergy\.com/, /ad\.jp\.ap\.valuecommerce/,
  /shopping\.yahoo\.co\.jp\/.*[?&]sc_e=af/, /felmat\.net/, /track\.affiliate-b\.com/, /janet\.jp/, /link-a\.net/,
];
var SJ_SHOP = /amazon\.co\.jp|rakuten\.co\.jp|shopping\.yahoo\.co\.jp|kakaku\.com|yodobashi\.com|biccamera\.com/;

function sjPageFeatures(doc, pageUrl) {
  let host = '';
  try { host = new URL(pageUrl).hostname.replace(/^www\./, ''); } catch (e) { /* URL不明 */ }
  const links = [...doc.querySelectorAll('a[href]')].map(a => ({ href: a.getAttribute('href') || '', rel: (a.getAttribute('rel') || '').toLowerCase(), text: (a.textContent || '').trim() }));
  const abs = l => { try { return new URL(l.href, pageUrl); } catch (e) { return null; } };
  const external = links.filter(l => { const u = abs(l); return u && /^https?:$/.test(u.protocol) && host && !u.hostname.endsWith(host); });
  const affiliate = links.filter(l => l.rel.includes('sponsored') || SJ_AFFILIATE.some(re => re.test(l.href)));
  const shop = external.filter(l => SJ_SHOP.test(l.href));
  const cta = links.filter(l => l.text.length <= 30 && /公式サイト|今すぐ|申し込|申込|無料で(試|始|登録)|購入|詳細を(見る|チェック)|をチェック|お得|キャンペーン/.test(l.text));
  const headings = [...doc.querySelectorAll('h1, h2, h3')].map(h => (h.textContent || '').trim()).filter(Boolean);
  const templ = headings.filter(t => /まとめ|よくある質問|FAQ|Q&A|いかがでした|結論|選び方|メリット|デメリット|注意点|おすすめ.{0,6}\d+選|ランキング|とは[？?]/.test(t));
  const html = doc.documentElement ? doc.documentElement.outerHTML || '' : '';
  const ldTypes = [];
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) for (const m of (s.textContent || '').matchAll(/"@type"\s*:\s*"([^"]+)"/g)) ldTypes.push(m[1]);
  const text = doc.body ? (doc.body.textContent || '').replace(/\s+/g, '') : '';
  return {
    affiliate_links: affiliate.length,                 // アフィリエイト・広告リンク（rel=sponsored を含む）
    shop_links: shop.length,                           // ECサイト・価格比較サイトへのリンク
    cta_links: cta.length,                             // 「公式サイトはこちら」「今すぐ申し込む」のような誘導ボタン
    ad_slots: (html.match(/adsbygoogle|googlesyndication|doubleclick\.net|class="[^"]*\b(ad|ads|advertisement)[-_ ]/g) || []).length,
    toc: /ez-toc|class="[^"]*\btoc\b|id="toc"|>目次</.test(html) ? 1 : 0, // 目次（プラグイン）
    headings: headings.length,
    template_headings: templ.length,                   // 「まとめ」「よくある質問」「選び方」のような型どおりの見出し
    text_chars: text.length,
    chars_per_heading: headings.length ? Math.round(text.length / headings.length) : text.length,
    author: /rel="author"|itemprop="author"|class="[^"]*\b(author|writer|profile)\b|"author"\s*:/.test(html) ? 1 : 0, // 著者・プロフィールの表記
    code_blocks: doc.querySelectorAll('pre, code').length,
    tables: doc.querySelectorAll('table').length,
    comments: /class="[^"]*\bcomments?\b|id="comments?"|disqus/.test(html) ? 1 : 0,
    external_links: external.length,
    links: links.length,
    ld_types: [...new Set(ldTypes)].slice(0, 8),       // 構造化データの種類（Article, Product, QAPage など）
  };
}
