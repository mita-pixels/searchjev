// AMO の掲載情報を API で更新する：プライバシーポリシーとスクリーンショット
// 使い方: node amo-update.mjs   （../amo-credentials.txt の1行目=発行者、2行目=秘密鍵）
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = 'https://addons.mozilla.org/api/v5/addons/addon/searchjev';
const [iss, secret] = fs.readFileSync(new URL('../amo-credentials.txt', import.meta.url), 'utf8').split(/\r?\n/).map(s => s.trim());

// AMO の API 認証：HS256 の JWT（有効期限は最大5分）
function jwt() {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss, jti: crypto.randomUUID(), iat: now, exp: now + 60 })}`;
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
}
const auth = () => ({ Authorization: `JWT ${jwt()}` });

async function call(method, path, body, json = true) {
  const res = await fetch(BASE + path, { method, headers: { ...auth(), ...(json ? { 'Content-Type': 'application/json' } : {}) }, body: json ? JSON.stringify(body) : body });
  const text = await res.text();
  return { status: res.status, text: text.slice(0, 300) };
}

const policy = fs.readFileSync(new URL('./privacy-policy.md', import.meta.url), 'utf8');
const [ja, en] = policy.split('\n---\n').map(s => s.trim());
// console.log('privacy policy:', await call('PATCH', '/eula_policy/', { privacy_policy: { ja, 'en-US': en } }));

const existing = JSON.parse((await (await fetch(BASE + '/', { headers: auth() })).text())).previews || [];
{
  const shots = [
    ['screenshot-1-results.jpg', { ja: '各結果の上に項目別スコアと総合点を表示し、総合点の順に並べ替えます', 'en-US': 'Per-result scores and a total; results are re-ranked by the total' }],
    ['screenshot-2-demoted.jpg', { ja: '量産記事らしい元1位の結果は、総合37点で下に回されます', 'en-US': 'A mass-produced SEO article that Google ranked #1 is pushed down' }],
    ['screenshot-3-settings.jpg', { ja: 'プリセットと重みを選ぶと、直前の検索で順位がどう変わるかをプレビューできます', 'en-US': 'Presets and weights with a live preview on your last search' }],
  ];
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (const p of existing) if (!p.caption) { await wait(1000); console.log("caption existing", p.id, JSON.stringify(await call("PATCH", `/previews/${p.id}/`, { caption: shots[p.position || 0][1] }))); }
  for (const [i, [file, caption]] of shots.entries()) {
    if (i < existing.length) continue;
    await wait(40000);
    const form = new FormData();
    form.append('image', new Blob([fs.readFileSync(new URL(`./${file}`, import.meta.url))], { type: 'image/jpeg' }), file);
    form.append('position', String(i));
    const r = await call('POST', '/previews/', form, false);
    console.log(`preview ${file}:`, r.status, r.text.slice(0, 120));
    const id = (r.text.match(/"id":(\d+)/) || [])[1];
    if (id) await wait(40000);
    if (id) console.log('  caption:', (await call('PATCH', `/previews/${id}/`, { caption })).status);
  }
}
