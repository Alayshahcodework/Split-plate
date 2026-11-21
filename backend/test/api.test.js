'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'split-plate-test-'));
const { start, closeAllStreams } = require('../server');

let server;
let base;

test.before(async () => {
  server = await start(0, '127.0.0.1');
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  closeAllStreams();
  server.close();
});

async function call(pathname, body, who) {
  const headers = { 'Content-Type': 'application/json' };
  if (who) {
    headers['X-Member-Id'] = who.memberId;
    headers['X-Member-Token'] = who.token;
  }
  const res = await fetch(base + pathname, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
}

test('serves the site shell and client routes', async () => {
  for (const p of ['/', '/g/SPLIT-1234']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<div id="app"/);
  }
  const js = await fetch(base + '/app.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.equal((await fetch(base + '/../server.js')).status, 404);
  assert.equal((await fetch(base + '/nope.txt')).status, 404);
});

test('full group flow: create, join, profiles, match, vote, decide', async () => {
  const meta = await call('/api/meta');
  assert.equal(meta.status, 200);
  assert.equal(meta.data.restrictions.length, 12);

  const created = await call('/api/rooms', { name: 'Alex', profile: { restrictions: ['vegan'], calMin: 300, calMax: 900 } });
  assert.equal(created.status, 201);
  assert.match(created.data.code, /^SPLIT-\d{4,5}$/);
  const code = created.data.code;
  const host = { memberId: created.data.memberId, token: created.data.token };
  assert.equal(created.data.room.members[0].ready, false);
  assert.equal(created.data.room.members[0].token, undefined, 'tokens must never be exposed');

  // join accepts a bare 4-digit code too
  const digits = code.slice(6);
  const joined = await call(`/api/rooms/${digits}/join`, { name: 'Bea', profile: {} });
  assert.equal(joined.status, 200);
  const guest = { memberId: joined.data.memberId, token: joined.data.token };

  // rejoin with the same credentials returns the same member
  const rejoin = await call(`/api/rooms/${code}/join`, { name: 'Other', ...guest });
  assert.equal(rejoin.data.memberId, guest.memberId);
  assert.equal(rejoin.data.room.members.length, 2);

  // auth is required
  assert.equal((await call(`/api/rooms/${code}/profile`, { profile: {} })).status, 401);
  assert.equal((await call(`/api/rooms/${code}/me`, {}, { memberId: host.memberId, token: 'wrong' })).status, 401);

  // nobody ready -> cannot match
  assert.equal((await call(`/api/rooms/${code}/match`, {}, host)).status, 409);

  let r = await call(`/api/rooms/${code}/profile`, { name: 'Alex', profile: { restrictions: ['vegan', 'bogus'], calMin: 300, calMax: 900, dislikes: ['No Mushrooms', '<b>x</b>'], likes: ['Spicy', 'Mushrooms'] } }, host);
  assert.equal(r.status, 200);
  const alex = r.data.room.members.find((m) => m.id === host.memberId);
  assert.deepEqual(alex.profile.restrictions, ['vegan']);
  assert.equal(alex.profile.dislikes[1], 'bx/b');
  assert.deepEqual(alex.profile.likes, ['Spicy'], 'a like that is also avoided is dropped');
  assert.equal(alex.ready, true);

  r = await call(`/api/rooms/${code}/profile`, { name: 'Bea', profile: { restrictions: ['gluten-free'], calMin: 400, calMax: 1100 } }, guest);
  assert.equal(r.status, 200);

  // duplicate names are rejected
  assert.equal((await call(`/api/rooms/${code}/profile`, { name: 'alex', profile: {} }, guest)).status, 409);

  // only the host changes settings
  assert.equal((await call(`/api/rooms/${code}/settings`, { settings: { maxWalk: 20 } }, guest)).status, 403);
  r = await call(`/api/rooms/${code}/settings`, { settings: { maxWalk: 20, maxPrice: 2, openNow: false } }, host);
  assert.deepEqual(r.data.room.settings, { maxWalk: 20, maxPrice: 2, openNow: false });

  r = await call(`/api/rooms/${code}/match`, {}, guest);
  assert.equal(r.status, 200);
  const res = r.data.room.results;
  assert.ok(res.matches.length > 0);
  assert.equal(res.stale, false);
  assert.deepEqual(res.memberIds.sort(), [host.memberId, guest.memberId].sort());

  const first = res.matches[0].id;
  r = await call(`/api/rooms/${code}/vote`, { targetId: first, stars: 5 }, guest);
  assert.equal(r.data.room.votes[first][guest.memberId], 5);
  r = await call(`/api/rooms/${code}/vote`, { targetId: first, stars: 0 }, guest);
  assert.equal(r.data.room.votes[first], undefined);
  assert.equal((await call(`/api/rooms/${code}/vote`, { targetId: 'r:not-real', stars: 3 }, guest)).status, 404);

  assert.equal((await call(`/api/rooms/${code}/decide`, { targetId: first }, guest)).status, 403);
  r = await call(`/api/rooms/${code}/decide`, { targetId: first }, host);
  assert.equal(r.data.room.decision.targetId, first);

  // changing a profile marks results stale
  r = await call(`/api/rooms/${code}/profile`, { profile: { restrictions: ['gluten-free', 'keto'], calMin: 400, calMax: 1100 } }, guest);
  assert.equal(r.data.room.results.stale, true);

  // sample friends
  r = await call(`/api/rooms/${code}/demo`, {}, guest);
  const demo = r.data.room.members.find((m) => m.demo);
  assert.ok(demo && demo.ready);
  r = await call(`/api/rooms/${code}/match`, {}, host);
  assert.equal(r.data.room.decision, null, 're-running clears the decision');
  const anyTarget = r.data.room.results.matches[0] || r.data.room.results.multiStops[0];
  if (anyTarget) assert.ok(r.data.room.votes[anyTarget.id][demo.id] >= 1, 'sample friends vote');

  // host leaves -> host passes to the other real person
  r = await call(`/api/rooms/${code}/leave`, {}, host);
  assert.equal(r.data.room.hostId, guest.memberId);
  r = await call(`/api/rooms/${code}/remove`, { memberId: demo.id }, guest);
  assert.equal(r.data.room.members.length, 1);

  // last real person leaving closes the group
  r = await call(`/api/rooms/${code}/leave`, {}, guest);
  assert.deepEqual(r.data, { ok: true });
  assert.equal((await call(`/api/rooms/${code}`)).status, 404);
});

test('live updates arrive over Server-Sent Events', async () => {
  const created = await call('/api/rooms', { name: 'Host', profile: {} });
  const code = created.data.code;
  const host = { memberId: created.data.memberId, token: created.data.token };

  const denied = await fetch(`${base}/api/rooms/${code}/events?m=${host.memberId}&t=nope`);
  assert.equal(denied.status, 401);

  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/rooms/${code}/events?m=${host.memberId}&t=${host.token}`, { signal: ctrl.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const nextRoom = async () => {
    for (;;) {
      const idx = buf.indexOf('\n\n');
      if (idx >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const data = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (chunk.includes('event: room') && data) return JSON.parse(data.slice(6));
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('stream ended');
      buf += decoder.decode(value, { stream: true });
    }
  };

  const first = await nextRoom();
  assert.equal(first.members[0].online, true);

  await call(`/api/rooms/${code}/join`, { name: 'Guest', profile: {} });
  const second = await nextRoom();
  assert.equal(second.members.length, 2);
  assert.equal(second.members[1].name, 'Guest');
  ctrl.abort();
});

test('rejects bad input', async () => {
  assert.equal((await call('/api/rooms/SPLIT-0000')).status, 404);
  assert.equal((await call('/api/rooms/garbage/join', {})).status, 404);
  const res = await fetch(base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' });
  assert.equal(res.status, 400);
  const big = await fetch(base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x'.repeat(40000) }) }).catch(() => ({ status: 413 }));
  assert.equal(big.status, 413);
});
