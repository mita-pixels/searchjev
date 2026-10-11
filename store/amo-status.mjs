// AMO の審査状況を表示する
import fs from 'node:fs';
import crypto from 'node:crypto';
const [iss, secret] = fs.readFileSync(new URL('../amo-credentials.txt', import.meta.url), 'utf8').split(/\r?\n/).map(s => s.trim());
function jwt() {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss, jti: crypto.randomUUID(), iat: now, exp: now + 60 })}`;
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
}
const get = async p => (await fetch(`https://addons.mozilla.org/api/v5/addons/addon/searchjev${p}`, { headers: { Authorization: `JWT ${jwt()}` } })).json();
const a = await get('/');
console.log({ status: a.status, is_disabled: a.is_disabled, categories: a.categories, previews: (a.previews || []).map(p => ({ id: p.id, caption: p.caption })), url: a.url });
const v = await get('/versions/?filter=all_with_unlisted');
for (const x of v.results || []) console.log({ version: x.version, channel: x.channel, file_status: x.file && x.file.status, compatibility: x.compatibility, license: x.license && x.license.slug });
