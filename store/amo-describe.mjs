// AMO の説明文（description）を amo-metadata.json の内容に更新する
import fs from 'node:fs';
import crypto from 'node:crypto';
const [iss, secret] = fs.readFileSync(new URL('../amo-credentials.txt', import.meta.url), 'utf8').split(/\r?\n/).map(s => s.trim());
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss, jti: crypto.randomUUID(), iat: now, exp: now + 60 })}`;
const jwt = `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
const m = JSON.parse(fs.readFileSync(new URL('./amo-metadata.json', import.meta.url), 'utf8'));
const res = await fetch('https://addons.mozilla.org/api/v5/addons/addon/searchjev/', { method: 'PATCH', headers: { Authorization: `JWT ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ description: m.description }) });
console.log(res.status, (await res.text()).slice(0, 120));
