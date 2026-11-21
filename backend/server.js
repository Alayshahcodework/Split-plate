'use strict';

/**
 * Split Plate backend. No dependencies: Node's http module serves the
 * frontend (../frontend), a small JSON API, and Server-Sent Events for live group sync.
 *
 * Group state lives in memory and is snapshotted to DATA_DIR/rooms.json so a
 * restart doesn't wipe active groups (on hosts with a persistent disk).
 * Run a single instance, since groups are not shared between processes.
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const matcher = require('./lib/matcher');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, '..', 'frontend'); // the website this server hosts
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '.data');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');
const RESTAURANTS_FILE = process.env.RESTAURANTS_FILE || path.join(__dirname, 'data', 'restaurants.json');
const ROOM_TTL_MS = (Number(process.env.ROOM_TTL_HOURS) || 24) * 60 * 60 * 1000;
const MAX_MEMBERS = 12;
const MAX_ROOMS = 5000;
const MAX_BODY_BYTES = 16 * 1024;
const HEARTBEAT_MS = 20 * 1000;

const catalog = matcher.loadCatalog(JSON.parse(fs.readFileSync(RESTAURANTS_FILE, 'utf8')));

const WALK_OPTIONS = [5, 10, 15, 20, 30];
const PRICE_LEVELS = [1, 2, 3, 4];
const DEFAULT_SETTINGS = { maxWalk: 15, maxPrice: 3, openNow: false };
const COLORS = ['#D35F3A', '#1F8A70', '#4F46E5', '#DB2777', '#0284C7', '#B45309', '#7C3AED', '#059669', '#DC2626', '#2563EB', '#9333EA', '#0D9488'];

// "Add a sample friend" lets one person try the whole flow on their own.
const SAMPLE_FRIENDS = [
  { name: 'Maya', profile: { restrictions: ['vegan'], calMin: 350, calMax: 800, dislikes: ['Mushrooms'], likes: ['Spicy'] } },
  { name: 'Jordan', profile: { restrictions: ['gluten-free'], calMin: 450, calMax: 1000, dislikes: ['Cilantro'], likes: ['Thai'] } },
  { name: 'Sam', profile: { restrictions: ['nut-allergy'], calMin: 400, calMax: 950, dislikes: [], likes: ['Noodles'] } },
  { name: 'Priya', profile: { restrictions: ['vegetarian', 'halal'], calMin: 300, calMax: 900, dislikes: ['Eggplant'], likes: ['Indian'] } },
  { name: 'Leo', profile: { restrictions: ['keto'], calMin: 400, calMax: 1000, dislikes: ['Seafood'], likes: ['Grill'] } },
  { name: 'Ava', profile: { restrictions: ['kosher'], calMin: 300, calMax: 900, dislikes: [], likes: ['Salad'] } },
  { name: 'Noah', profile: { restrictions: ['dairy-free'], calMin: 550, calMax: 1300, dislikes: ['Olives'], likes: ['Burgers'] } },
  { name: 'Zara', profile: { restrictions: ['pescatarian', 'shellfish-allergy'], calMin: 350, calMax: 850, dislikes: ['Pickles'], likes: ['Japanese'] } },
];

const META = {
  area: { name: catalog.area.name, centerLabel: catalog.area.centerLabel || catalog.area.name },
  restrictions: matcher.RESTRICTIONS,
  walkOptions: WALK_OPTIONS,
  priceLevels: PRICE_LEVELS,
  defaultSettings: DEFAULT_SETTINGS,
  maxMembers: MAX_MEMBERS,
  restaurantCount: catalog.restaurants.length,
  suggestions: {
    dislikes: ['Cilantro', 'Mushrooms', 'Onion', 'Olives', 'Seafood', 'Pork', 'Spicy', 'Eggplant', 'Coconut', 'Cheese', 'Tomato', 'Pickles'],
    likes: ['Spicy', 'Thai', 'Indian', 'Mexican', 'Italian', 'Japanese', 'Korean', 'Pizza', 'Noodles', 'Burgers', 'Salad', 'Curry', 'Seafood', 'Avocado'],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const now = () => Date.now();
const newId = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');
const arr = (x) => (Array.isArray(x) ? x : []);

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cleanText(raw, max) {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
const cleanName = (raw) => cleanText(raw, 24);

function cleanTags(list, exclude = new Set()) {
  const out = [];
  const keys = new Set();
  for (const raw of arr(list)) {
    const tag = cleanText(raw, 30);
    const key = matcher.normTerm(tag);
    if (!tag || !key || keys.has(key) || exclude.has(key)) continue;
    keys.add(key);
    out.push(tag);
    if (out.length >= 15) break;
  }
  return out;
}

function cleanProfile(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const restrictions = [...new Set(arr(p.restrictions).filter((id) => matcher.RESTRICTION_IDS.has(id)))];
  const calMin = clampInt(p.calMin, 0, 2500, 0);
  let calMax = clampInt(p.calMax, 100, 3000, 1500);
  if (calMax < calMin) calMax = calMin;
  const dislikes = cleanTags(p.dislikes);
  const likes = cleanTags(p.likes, new Set(dislikes.map(matcher.normTerm)));
  return { restrictions, calMin, calMax, dislikes, likes };
}

function normCode(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const digits = s.startsWith('SPLIT') ? s.slice(5) : s;
  return /^\d{4,5}$/.test(digits) ? `SPLIT-${digits}` : null;
}

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || 'unknown';
}

const hits = new Map();
function rateLimit(key, max, windowMs) {
  const t = now();
  let h = hits.get(key);
  if (!h || t > h.reset) {
    h = { n: 0, reset: t + windowMs };
    hits.set(key, h);
  }
  if (++h.n > max) throw new HttpError(429, 'Slow down a little and try again in a moment.');
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

const rooms = new Map(); // code -> room
const streams = new Map(); // code -> Set<{ res, memberId }>

function generateCode() {
  for (let i = 0; i < 300; i++) {
    const digits = i < 200 ? 4 : 5;
    const code = `SPLIT-${crypto.randomInt(10 ** (digits - 1), 10 ** digits)}`;
    if (!rooms.has(code)) return code;
  }
  throw new HttpError(503, 'Too many active groups right now. Try again shortly.');
}

function addMember(room, { name, profile }) {
  const usedColors = new Set(room.members.map((m) => m.color));
  let base = cleanName(name) || `Guest ${room.members.length + 1}`;
  let finalName = base;
  for (let n = 2; room.members.some((m) => m.name.toLowerCase() === finalName.toLowerCase()); n++) finalName = `${base.slice(0, 21)} ${n}`;
  const member = {
    id: newId(),
    token: newId(24),
    name: finalName,
    color: COLORS.find((c) => !usedColors.has(c)) || COLORS[room.members.length % COLORS.length],
    ready: false,
    demo: false,
    joinedAt: now(),
    profile: cleanProfile(profile),
  };
  room.members.push(member);
  return member;
}

function removeMember(room, memberId) {
  room.members = room.members.filter((m) => m.id !== memberId);
  for (const target of Object.keys(room.votes)) {
    delete room.votes[target][memberId];
    if (!Object.keys(room.votes[target]).length) delete room.votes[target];
  }
  if (room.hostId === memberId) {
    const next = room.members.find((m) => !m.demo) || room.members[0];
    room.hostId = next ? next.id : null;
  }
  for (const entry of streams.get(room.code) || []) {
    if (entry.memberId === memberId) {
      entry.res.write('event: removed\ndata: {}\n\n');
      entry.res.end();
    }
  }
}

function deleteRoom(code) {
  rooms.delete(code);
  for (const entry of streams.get(code) || []) {
    entry.res.write('event: closed\ndata: {}\n\n');
    entry.res.end();
  }
  streams.delete(code);
  schedulePersist();
}

function findMember(room, id, token) {
  if (typeof id !== 'string' || typeof token !== 'string') return null;
  const m = room.members.find((x) => x.id === id);
  if (!m || m.demo) return null;
  const a = Buffer.from(m.token);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? m : null;
}

function isOnline(code, memberId) {
  for (const e of streams.get(code) || []) if (e.memberId === memberId) return true;
  return false;
}

function signature(room) {
  const ready = room.members.filter((m) => m.ready).map((m) => [m.id, m.profile]);
  return crypto.createHash('sha1').update(JSON.stringify({ ready, s: room.settings })).digest('hex').slice(0, 12);
}

function resultTargets(room) {
  const set = new Set();
  if (room.results) {
    for (const m of room.results.matches) set.add(m.id);
    for (const p of room.results.multiStops) set.add(p.id);
  }
  return set;
}

function publicRoom(room) {
  let results = null;
  if (room.results) {
    const { signature: sig, ...rest } = room.results;
    results = { ...rest, stale: sig !== signature(room) };
  }
  return {
    code: room.code,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    hostId: room.hostId,
    settings: room.settings,
    decision: room.decision,
    votes: room.votes,
    members: room.members.map((m) => ({
      id: m.id,
      name: m.name,
      color: m.color,
      ready: m.ready,
      demo: !!m.demo,
      joinedAt: m.joinedAt,
      profile: m.profile,
      online: isOnline(room.code, m.id),
    })),
    results,
  };
}

function broadcast(room) {
  const set = streams.get(room.code);
  if (!set || !set.size) return;
  const payload = `event: room\ndata: ${JSON.stringify(publicRoom(room))}\n\n`;
  for (const entry of set) entry.res.write(payload);
}

function changed(room) {
  room.updatedAt = now();
  schedulePersist();
  broadcast(room);
}

/** Sample friends rate each option the way their profile fits it. */
function castDemoVotes(room) {
  const demoIds = new Set(room.members.filter((m) => m.demo).map((m) => m.id));
  if (!demoIds.size || !room.results) return;
  const vote = (targetId, evals) => {
    for (const e of evals) {
      if (!demoIds.has(e.memberId)) continue;
      const stars = Math.min(5, Math.max(1, Math.round(e.fit / 20 + (Math.random() - 0.5))));
      (room.votes[targetId] = room.votes[targetId] || {})[e.memberId] = stars;
    }
  };
  for (const m of room.results.matches) vote(m.id, m.members);
  for (const p of room.results.multiStops) vote(p.id, p.stops.flatMap((s) => s.members));
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

let persistTimer = null;
let persistWarned = false;

function snapshot() {
  return JSON.stringify([...rooms.values()]);
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(persistNow, 1500);
  persistTimer.unref();
}

async function persistNow() {
  persistTimer = null;
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${ROOMS_FILE}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, snapshot());
    await fsp.rename(tmp, ROOMS_FILE);
  } catch (err) {
    if (!persistWarned) console.warn(`[split-plate] Could not save groups to ${ROOMS_FILE}: ${err.message}`);
    persistWarned = true;
  }
}

function persistSync() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ROOMS_FILE, snapshot());
  } catch {
    /* best effort on shutdown */
  }
}

function loadRooms() {
  try {
    const list = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8'));
    for (const room of list) if (room && room.code && now() - room.updatedAt < ROOM_TTL_MS) rooms.set(room.code, room);
    if (rooms.size) console.log(`[split-plate] Restored ${rooms.size} active group(s).`);
  } catch {
    /* no saved state yet */
  }
}

function sweep() {
  const t = now();
  for (const [code, room] of rooms) {
    const someoneOnline = room.members.some((m) => isOnline(code, m.id));
    if (!someoneOnline && t - room.updatedAt > ROOM_TTL_MS) deleteRoom(code);
  }
  for (const [key, h] of hits) if (t > h.reset) hits.delete(key);
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  );
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooBig = false;
    const chunks = [];
    req.on('data', (c) => {
      if (tooBig) return; // keep draining so the 413 response can still be delivered
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        tooBig = true;
        chunks.length = 0;
        reject(new HttpError(413, 'Request too large.'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return;
      if (!chunks.length) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      } catch {
        reject(new HttpError(400, 'Invalid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg', '.webmanifest', '.txt']);
const fileCache = new Map(); // path -> { etag, body, gz }

async function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    rel = '/';
  }
  // Client-side routes (/ and /g/SPLIT-1234) all get the app shell.
  if (rel === '/' || /^\/g\/[^/]*\/?$/.test(rel)) rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return notFound(res);

  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    return notFound(res);
  }
  if (!stat.isFile()) return notFound(res);

  const ext = path.extname(file).toLowerCase();
  const etag = `W/"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
  let cached = fileCache.get(file);
  if (!cached || cached.etag !== etag) {
    const body = await fsp.readFile(file);
    cached = { etag, body, gz: COMPRESSIBLE.has(ext) && body.length > 1024 ? zlib.gzipSync(body) : null };
    fileCache.set(file, cached);
  }

  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300, must-revalidate',
    ETag: etag,
    Vary: 'Accept-Encoding',
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  const useGzip = cached.gz && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
  const body = useGzip ? cached.gz : cached.body;
  if (useGzip) headers['Content-Encoding'] = 'gzip';
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><meta charset="utf-8"><title>Not found</title><p style="font-family:sans-serif">Page not found. <a href="/">Go to Split Plate</a></p>');
}

// ---------------------------------------------------------------------------
// Live updates (Server-Sent Events)
// ---------------------------------------------------------------------------

function openStream(req, res, room, url) {
  const member = findMember(room, url.searchParams.get('m'), url.searchParams.get('t'));
  if (!member) throw new HttpError(401, 'You are not a member of this group.');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');

  let set = streams.get(room.code);
  if (!set) streams.set(room.code, (set = new Set()));
  const wasOnline = isOnline(room.code, member.id);
  const entry = { res, memberId: member.id };
  set.add(entry);
  if (wasOnline) res.write(`event: room\ndata: ${JSON.stringify(publicRoom(room))}\n\n`);
  else broadcast(room);

  req.on('close', () => {
    const s = streams.get(room.code);
    if (s) {
      s.delete(entry);
      if (!s.size) streams.delete(room.code);
    }
    const current = rooms.get(room.code);
    if (current && !isOnline(room.code, member.id)) broadcast(current);
  });
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'rooms', code, action]

  if (req.method === 'GET' && url.pathname === '/api/meta') return sendJson(res, 200, META);
  if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, { ok: true, rooms: rooms.size });
  if (parts[1] !== 'rooms' || parts.length > 4) throw new HttpError(404, 'Not found.');

  const ip = clientIp(req);
  if (req.method === 'POST') rateLimit(`post:${ip}`, 150, 60 * 1000);

  // Create a group
  if (parts.length === 2) {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
    rateLimit(`create:${ip}`, 30, 10 * 60 * 1000);
    const body = await readJson(req);
    if (rooms.size >= MAX_ROOMS) sweep();
    if (rooms.size >= MAX_ROOMS) throw new HttpError(503, 'Too many active groups right now. Try again shortly.');
    const t = now();
    const room = {
      code: generateCode(),
      createdAt: t,
      updatedAt: t,
      hostId: null,
      members: [],
      settings: { ...DEFAULT_SETTINGS },
      results: null,
      votes: {},
      decision: null,
    };
    const host = addMember(room, body);
    room.hostId = host.id;
    rooms.set(room.code, room);
    changed(room);
    return sendJson(res, 201, { code: room.code, memberId: host.id, token: host.token, room: publicRoom(room) });
  }

  const code = normCode(parts[2]);
  const room = code && rooms.get(code);
  if (!room) throw new HttpError(404, "That group doesn't exist or has expired. Check the code and try again.");
  const action = parts[3] || '';

  if (req.method === 'GET') {
    if (action === '') return sendJson(res, 200, { room: publicRoom(room) });
    if (action === 'events') return openStream(req, res, room, url);
    throw new HttpError(404, 'Not found.');
  }
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  const body = await readJson(req);

  if (action === 'join') {
    const existing = findMember(room, body.memberId, body.token);
    if (existing) return sendJson(res, 200, { memberId: existing.id, token: existing.token, room: publicRoom(room) });
    if (room.members.length >= MAX_MEMBERS) throw new HttpError(409, `This group is full (${MAX_MEMBERS} people max).`);
    const member = addMember(room, body);
    changed(room);
    return sendJson(res, 200, { memberId: member.id, token: member.token, room: publicRoom(room) });
  }

  const me = findMember(room, req.headers['x-member-id'], req.headers['x-member-token']);
  if (!me) throw new HttpError(401, 'You are not a member of this group.');
  if (action === 'me') return sendJson(res, 200, { room: publicRoom(room) }); // validates a saved session
  const requireHost = () => {
    if (room.hostId !== me.id) throw new HttpError(403, 'Only the host can do that.');
  };

  switch (action) {
    case 'profile': {
      if (body.name !== undefined) {
        const name = cleanName(body.name);
        if (name && !room.members.some((m) => m.id !== me.id && m.name.toLowerCase() === name.toLowerCase())) me.name = name;
        else if (name && name.toLowerCase() !== me.name.toLowerCase()) throw new HttpError(409, `Someone in this group is already called ${name}.`);
      }
      me.profile = cleanProfile(body.profile);
      me.ready = true;
      break;
    }
    case 'settings': {
      requireHost();
      const s = body.settings && typeof body.settings === 'object' ? body.settings : {};
      if (WALK_OPTIONS.includes(Number(s.maxWalk))) room.settings.maxWalk = Number(s.maxWalk);
      if (PRICE_LEVELS.includes(Number(s.maxPrice))) room.settings.maxPrice = Number(s.maxPrice);
      if (typeof s.openNow === 'boolean') room.settings.openNow = s.openNow;
      break;
    }
    case 'match': {
      const ready = room.members.filter((m) => m.ready);
      if (!ready.length) throw new HttpError(409, 'At least one person needs to save their dining profile first.');
      const out = matcher.computeMatches(catalog, ready, room.settings, new Date());
      room.results = {
        ...out,
        computedAt: now(),
        memberIds: ready.map((m) => m.id),
        settings: { ...room.settings },
        signature: signature(room),
      };
      room.decision = null;
      const live = resultTargets(room);
      for (const target of Object.keys(room.votes)) if (!live.has(target)) delete room.votes[target];
      castDemoVotes(room);
      break;
    }
    case 'vote': {
      const target = String(body.targetId || '');
      if (!resultTargets(room).has(target)) throw new HttpError(404, 'That option is no longer in the results.');
      const stars = clampInt(body.stars, 0, 5, 0);
      const votes = (room.votes[target] = room.votes[target] || {});
      if (stars === 0) delete votes[me.id];
      else votes[me.id] = stars;
      if (!Object.keys(votes).length) delete room.votes[target];
      break;
    }
    case 'decide': {
      requireHost();
      if (body.targetId === null || body.targetId === undefined) room.decision = null;
      else {
        const target = String(body.targetId);
        if (!resultTargets(room).has(target)) throw new HttpError(404, 'That option is no longer in the results.');
        room.decision = { targetId: target, at: now(), by: me.id };
      }
      break;
    }
    case 'demo': {
      if (room.members.length >= MAX_MEMBERS) throw new HttpError(409, `This group is full (${MAX_MEMBERS} people max).`);
      const used = new Set(room.members.map((m) => m.name.toLowerCase()));
      const pick = SAMPLE_FRIENDS.find((f) => !used.has(f.name.toLowerCase())) || SAMPLE_FRIENDS[crypto.randomInt(SAMPLE_FRIENDS.length)];
      const friend = addMember(room, pick);
      friend.demo = true;
      friend.ready = true;
      break;
    }
    case 'remove': {
      requireHost();
      const target = room.members.find((m) => m.id === body.memberId);
      if (!target) throw new HttpError(404, 'That person is not in the group.');
      if (target.id === me.id) throw new HttpError(400, 'Use "Leave group" to remove yourself.');
      removeMember(room, target.id);
      break;
    }
    case 'leave': {
      removeMember(room, me.id);
      if (!room.members.some((m) => !m.demo)) {
        deleteRoom(room.code);
        return sendJson(res, 200, { ok: true });
      }
      break;
    }
    default:
      throw new HttpError(404, 'Not found.');
  }

  changed(room);
  return sendJson(res, 200, { room: publicRoom(room) });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

function createServer() {
  return http.createServer(async (req, res) => {
    setSecurityHeaders(res);
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else if (req.method === 'GET' || req.method === 'HEAD') await serveStatic(req, res, url.pathname);
      else sendJson(res, 405, { error: 'Method not allowed.' });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      if (!res.headersSent) sendJson(res, status, { error: status >= 500 ? 'Something went wrong on our side.' : err.message });
      else res.end();
    }
  });
}

function start(port = PORT, host = HOST) {
  loadRooms();
  const server = createServer();
  server.keepAliveTimeout = 65 * 1000;
  server.headersTimeout = 70 * 1000;

  const heartbeat = setInterval(() => {
    for (const set of streams.values()) for (const e of set) e.res.write(': ping\n\n');
  }, HEARTBEAT_MS);
  const sweeper = setInterval(sweep, 10 * 60 * 1000);
  heartbeat.unref();
  sweeper.unref();
  server.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(sweeper);
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => resolve(server));
  });
}

function closeAllStreams() {
  for (const set of streams.values()) for (const e of set) e.res.end();
  streams.clear();
}

if (require.main === module) {
  start().then((server) => {
    const { port } = server.address();
    console.log(`[split-plate] Ready on http://localhost:${port}  (${catalog.restaurants.length} restaurants in ${catalog.area.name})`);
    const shutdown = () => {
      persistSync();
      closeAllStreams();
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  });
}

module.exports = { start, closeAllStreams, normCode, cleanProfile };
