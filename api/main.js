// API (Vercel 함수 + 로컬 server.js 공용)
// 저장소: Upstash Redis 환경변수가 있으면 Redis(배포), 없으면 notes.json(로컬 개발)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..'), STK = path.join(ROOT, 'emoji'), FILE = path.join(ROOT, 'notes.json');
const ADMIN = process.env.ADMIN_KEY || '';
const COLORS = ['#F1FF1B', '#FF833E', '#EFC48B', '#CFE919', '#B2FBFF'];
const SHAPES = ['circle', 'squircle', 'hex', 'scallop', 'clover', 'flower'];

const R_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const R_TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
async function redis(...cmd) {
  const r = await fetch(R_URL, { method: 'POST', headers: { authorization: 'Bearer ' + R_TOK }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw Error(j.error);
  return j.result;
}
const readFile = () => { try { return JSON.parse(fs.readFileSync(FILE)); } catch { return []; } };
const writeFile = a => fs.writeFileSync(FILE, JSON.stringify(a));
const db = R_URL ? {
  // Redis 해시 "notes": 메모 id → JSON
  async all() { const h = (await redis('HGETALL', 'notes')) || [], out = []; for (let i = 1; i < h.length; i += 2) out.push(JSON.parse(h[i])); return out.sort((a, b) => a.t - b.t); },
  async get(id) { const v = await redis('HGET', 'notes', id); return v && JSON.parse(v); },
  put: n => redis('HSET', 'notes', n.id, JSON.stringify(n)),
  del: id => redis('HDEL', 'notes', id),
} : {
  all: async () => readFile(),
  get: async id => readFile().find(n => n.id === id),
  async put(n) { const a = readFile(), i = a.findIndex(x => x.id === n.id); i < 0 ? a.push(n) : (a[i] = n); writeFile(a); },
  async del(id) { writeFile(readFile().filter(x => x.id !== id)); },
};

const clamp = v => Math.min(100, Math.max(0, Number(v) || 0));
const pos = v => Math.min(5000, Math.max(-5000, Number(v) || 0));
const pub = ({ key, ...n }) => n; // 수정 키는 작성자에게만
function clean(b) {
  const text = String(b.text || '').trim().slice(0, 150);
  if (!text) throw Error('내용을 입력하세요');
  return {
    name: String(b.name || '').trim().slice(0, 20),
    text,
    color: COLORS.includes(b.color) ? b.color : COLORS[0],
    shape: SHAPES.includes(b.shape) ? b.shape : SHAPES[0],
    stickers: (Array.isArray(b.stickers) ? b.stickers : []).slice(0, 30)
      .map(s => ({ s: String(s.s).slice(0, 100), x: clamp(s.x), y: clamp(s.y) })),
  };
}
async function body(req) {
  if (req.body !== undefined) { // Vercel은 이미 파싱해 둠
    const b = Buffer.isBuffer(req.body) ? req.body.toString() : req.body;
    return typeof b === 'string' ? JSON.parse(b || '{}') : b || {};
  }
  let s = '';
  for await (const c of req) { s += c; if (s.length > 20000) throw Error('너무 커요'); }
  return JSON.parse(s || '{}');
}
const send = (res, code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(obj)); };

module.exports = async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.searchParams.get('p') ?? u.pathname.replace(/^\/api\/?/, ''); // Vercel rewrite는 ?p= 로 넘어옴
  try {
    if (p === 'stickers')
      return send(res, 200, fs.existsSync(STK) ? fs.readdirSync(STK).filter(f => /\.(png|jpe?g|gif|webp|svg)$/i.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : []);
    if (p === 'notes' && req.method === 'GET') return send(res, 200, (await db.all()).map(pub));
    if (p === 'notes' && req.method === 'POST') {
      const n = { id: crypto.randomUUID(), ...clean(await body(req)), t: Date.now(), key: crypto.randomUUID() };
      await db.put(n);
      return send(res, 201, n);
    }
    const m = p.match(/^notes\/([\w-]+)(\/pos)?$/);
    if (m) {
      const n = await db.get(m[1]);
      if (!n) return send(res, 404, {});
      // 위치 이동: 누구나 (보드처럼)
      if (m[2] && req.method === 'PATCH') { const b = await body(req); n.x = pos(b.x); n.y = pos(b.y); await db.put(n); return send(res, 200, pub(n)); }
      // 수정·삭제: 작성자 키 또는 관리자 키
      const k = u.searchParams.get('key');
      if (!k || (k !== n.key && !(ADMIN && k === ADMIN))) return send(res, 403, {});
      if (req.method === 'PUT') { Object.assign(n, clean(await body(req))); await db.put(n); return send(res, 200, pub(n)); }
      if (req.method === 'DELETE') { await db.del(n.id); return send(res, 200, {}); }
    }
    send(res, 404, {});
  } catch (e) {
    send(res, e instanceof SyntaxError || e.message === '내용을 입력하세요' ? 400 : 500, { error: e.message });
  }
};
