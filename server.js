// ShuttleCast Overlay — เซิร์ฟเวอร์เก็บคะแนนต่อห้อง + ส่งแบบ SSE (Node.js ไม่มี dependency)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'rooms.json');
const MAX_ROOMS = 200;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

// room -> { state, rev, clients:Set<res> }
const rooms = new Map();

function loadRooms() {
  try {
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const [id, entry] of Object.entries(saved)) rooms.set(id, { state: entry.state, rev: entry.rev || 1, clients: new Set() });
  } catch {}
}
let saveTimer = null;
function saveRooms() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      const out = {};
      for (const [id, room] of rooms) out[id] = { state: room.state, rev: room.rev };
      fs.writeFileSync(DATA_FILE, JSON.stringify(out));
    } catch (error) { console.error('save failed:', error.message); }
  }, 500);
}

function getRoom(id) {
  let room = rooms.get(id);
  if (!room) {
    if (rooms.size >= MAX_ROOMS) return null;
    room = { state: null, rev: 0, clients: new Set() };
    rooms.set(id, room);
  }
  return room;
}

const roomId = (value) => (/^[A-Za-z0-9_-]{1,40}$/.test(value || '') ? value : null);
const str = (value, max, fallback = '') => (typeof value === 'string' ? value.slice(0, max) : fallback);
const int = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};
const color = (value, fallback) => (/^#[0-9a-fA-F]{6}$/.test(value || '') ? value : fallback);

// รับเฉพาะฟิลด์ที่รู้จัก ตัดค่าเกินช่วง
function cleanState(input) {
  if (!input || typeof input !== 'object') return null;
  const matchGames = int(input.matchGames, 1, 5, 3);
  const target = int(input.target, 1, 30, 21);
  const cap = int(input.cap, target, 99, Math.max(target, 30));
  const results = Array.isArray(input.results) ? input.results.slice(0, 5).map((r, i) => ({
    game: int(r && r.game, 1, 5, i + 1),
    scoreA: int(r && r.scoreA, 0, 99, 0),
    scoreB: int(r && r.scoreB, 0, 99, 0),
    winner: r && r.winner === 'B' ? 'B' : 'A'
  })) : [];
  return {
    title: str(input.title, 60),
    sideA: str(input.sideA, 40, 'ฝั่ง A'),
    sideB: str(input.sideB, 40, 'ฝั่ง B'),
    colorA: color(input.colorA, '#d3a94f'),
    colorB: color(input.colorB, '#ead7aa'),
    matchGames, target, cap,
    winByTwo: input.winByTwo !== false,
    scoreA: int(input.scoreA, 0, 99, 0),
    scoreB: int(input.scoreB, 0, 99, 0),
    winsA: int(input.winsA, 0, 5, 0),
    winsB: int(input.winsB, 0, 5, 0),
    game: int(input.game, 1, 5, 1),
    size: ['s', 'm', 'l'].includes(input.size) ? input.size : 'm',
    results
  };
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': mime['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; if (raw.length > 20000) req.destroy(new Error('payload_too_large')); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('invalid_json')); } });
    req.on('error', reject);
  });
}

function broadcast(room) {
  const payload = `data: ${JSON.stringify({ state: room.state, rev: room.rev })}\n\n`;
  for (const client of room.clients) client.write(payload);
}

function routeApi(req, res, url) {
  if (url.pathname === '/api/health') return sendJson(res, 200, { ok: true, service: 'shuttlecast-overlay', rooms: rooms.size });

  const match = url.pathname.match(/^\/api\/room\/([^/]+)\/(state|events)$/);
  if (!match) return sendJson(res, 404, { ok: false, error: 'not_found' });
  const id = roomId(match[1]);
  if (!id) return sendJson(res, 400, { ok: false, error: 'invalid_room' });
  const room = getRoom(id);
  if (!room) return sendJson(res, 503, { ok: false, error: 'too_many_rooms' });

  // ?o=1 = คำขอจากหน้า overlay จริง (ไม่นับ preview ในหน้าควบคุม) ใช้บอกหน้าควบคุมว่ามี overlay เชื่อมอยู่กี่เครื่อง
  const isOverlay = url.searchParams.get('o') === '1';
  const overlays = () => {
    const live = [...room.clients].filter((client) => client.isOverlay).length;
    return live || (Date.now() - (room.polledAt || 0) < 10000 ? 1 : 0);
  };

  if (match[2] === 'state' && req.method === 'GET') {
    if (isOverlay) room.polledAt = Date.now();
    return sendJson(res, 200, { ok: true, state: room.state, rev: room.rev, overlays: overlays() });
  }

  if (match[2] === 'state' && req.method === 'POST') {
    return readJson(req).then((body) => {
      const state = cleanState(body.state);
      if (!state) return sendJson(res, 400, { ok: false, error: 'invalid_state' });
      room.state = state;
      room.rev += 1;
      saveRooms();
      broadcast(room);
      sendJson(res, 200, { ok: true, rev: room.rev, overlays: overlays() });
    }).catch((error) => sendJson(res, 400, { ok: false, error: error.message || 'bad_request' }));
  }

  if (match[2] === 'events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(`retry: 2000\ndata: ${JSON.stringify({ state: room.state, rev: room.rev })}\n\n`);
    res.isOverlay = isOverlay;
    room.clients.add(res);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => { clearInterval(heartbeat); room.clients.delete(res); });
    return;
  }

  return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
}

const pages = { '/': 'control.html', '/control': 'control.html', '/overlay': 'overlay.html' };

function serveStatic(req, res, url) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return sendJson(res, 400, { error: 'bad_path' }); }
  pathname = '/' + (pages[pathname] || pathname.slice(1));
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: 'forbidden' });
  fs.readFile(filePath, (error, data) => {
    if (error) return sendJson(res, 404, { error: 'not_found' });
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mime[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=3600'
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return routeApi(req, res, url);
  serveStatic(req, res, url);
});

loadRooms();
server.listen(PORT, '0.0.0.0', () => console.log(`ShuttleCast Overlay listening on 0.0.0.0:${PORT}`));
// ปิดเครื่อง/deploy ใหม่: ปิดการเชื่อมต่อ SSE ที่ค้างอยู่ (ไม่งั้น server.close รอไม่จบ) แล้วออกเลย
function shutdown() {
  for (const room of rooms.values()) for (const client of room.clients) { try { client.end(); } catch {} }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
