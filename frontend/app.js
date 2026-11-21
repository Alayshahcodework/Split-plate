'use strict';

(() => {
  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');

  // ------------------------------------------------------------------ utils

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  const priceStr = (n) => '$'.repeat(Math.max(1, Number(n) || 1));
  const initial = (name) => (String(name || '?').trim().charAt(0) || '?').toUpperCase();
  const stripNo = (t) => String(t).replace(/^\s*(no|avoid|without)\s+/i, '');
  const normTag = (t) => stripNo(t).toLowerCase().replace(/\s+/g, ' ').trim().replace(/(es|s)$/, '');
  const capFirst = (t) => t.charAt(0).toUpperCase() + t.slice(1);

  const store = {
    get(k, d = null) {
      try {
        const v = localStorage.getItem(k);
        return v == null ? d : JSON.parse(v);
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch {
        /* private mode */
      }
    },
    del(k) {
      try {
        localStorage.removeItem(k);
      } catch {
        /* private mode */
      }
    },
  };

  function normCode(raw) {
    const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const digits = s.startsWith('SPLIT') ? s.slice(5) : s;
    return /^\d{4,5}$/.test(digits) ? `SPLIT-${digits}` : null;
  }

  function fmtTime(hhmm) {
    const [h, m] = String(hhmm).split(':').map(Number);
    const hh = ((h % 24) + 24) % 24;
    const suffix = hh >= 12 ? 'PM' : 'AM';
    const h12 = hh % 12 || 12;
    if (hh === 0 && !m) return 'midnight';
    return m ? `${h12}:${String(m).padStart(2, '0')} ${suffix}` : `${h12} ${suffix}`;
  }

  const DEFAULT_PROFILE = { restrictions: [], calMin: 300, calMax: 1200, dislikes: [], likes: [] };
  const TABS = [
    { id: 'diets', label: 'My Diets', icon: 'user' },
    { id: 'lobby', label: 'Lobby', icon: 'users' },
    { id: 'matches', label: 'Matches', icon: 'utensils' },
    { id: 'multi', label: 'Multi-Stop', icon: 'route' },
  ];

  // ------------------------------------------------------------------ icons

  const ICONS = {
    utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    userCog: '<circle cx="18" cy="15" r="3"/><circle cx="9" cy="7" r="4"/><path d="M10 15H6a4 4 0 0 0-4 4v2"/><path d="m21.7 16.4-.9-.3"/><path d="m15.2 13.9-.9-.3"/><path d="m16.6 18.7.3-.9"/><path d="m19.1 12.2.3-.9"/><path d="m19.6 18.7-.4-1"/><path d="m16.8 12.3-.4-1"/><path d="m14.3 16.6 1-.4"/><path d="m20.7 13.8 1-.4"/>',
    userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/>',
    route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    heartCrack: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="m12 13-1-1 2-2-3-3 2-2"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    mapPin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    footprints: '<path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/><path d="M16 17h4"/><path d="M4 13h4"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/>',
    qr: '<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>',
    leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
    carrot: '<path d="M2.27 21.7s9.87-3.5 12.73-6.36a4.5 4.5 0 0 0-6.36-6.37C5.77 11.84 2.27 21.7 2.27 21.7zM8.64 14l-2.05-2.04M15.34 15l-2.46-2.46"/><path d="M22 9s-1.33-2-3.5-2C16.86 7 15 9 15 9s1.33 2 3.5 2S22 9 22 9z"/><path d="M15 2s-2 1.33-2 3.5S15 9 15 9s2-1.84 2-3.5C17 3.33 15 2 15 2z"/>',
    wheat: '<path d="M2 22 16 8"/><path d="M3.47 12.53 5 11l1.53 1.53a3.5 3.5 0 0 1 0 4.94L5 19l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/><path d="M7.47 8.53 9 7l1.53 1.53a3.5 3.5 0 0 1 0 4.94L9 15l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/><path d="M11.47 4.53 13 3l1.53 1.53a3.5 3.5 0 0 1 0 4.94L13 11l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/><path d="M20 2h2v2a4 4 0 0 1-4 4h-2V6a4 4 0 0 1 4-4Z"/>',
    milk: '<path d="M8 2h8"/><path d="M9 2v2.789a4 4 0 0 1-.672 2.219l-.656.984A4 4 0 0 0 7 10.212V20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-9.789a4 4 0 0 0-.672-2.219l-.656-.984A4 4 0 0 1 15 4.788V2"/><path d="M7 15a6.472 6.472 0 0 1 5 0 6.47 6.47 0 0 0 5 0"/>',
    drumstick: '<path d="M15.4 15.63a7.875 6 135 1 1 6.23-6.23 4.5 3.43 135 0 0-6.23 6.23"/><path d="m8.29 12.71-2.6 2.6a2.5 2.5 0 1 0-1.65 4.65A2.5 2.5 0 1 0 8.7 18.3l2.59-2.59"/>',
    ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    hexagram: '<path d="M12 2.5 20.5 17h-17Z"/><path d="M12 21.5 3.5 7h17Z"/>',
    fish: '<path d="M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z"/><path d="M18 12v.5"/><path d="M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33"/>',
    shell: '<path d="M14 11a2 2 0 1 1-4 0 4 4 0 0 1 8 0 6 6 0 0 1-12 0 8 8 0 0 1 16 0 10 10 0 1 1-20 0 11.93 11.93 0 0 1 2.42-7.22 2 2 0 1 1 3.16 2.44"/>',
    egg: '<path d="M12 22c6.23-.05 7.87-5.57 7.5-10-.36-4.34-3.95-9.96-7.5-10-3.55.04-7.14 5.66-7.5 10-.37 4.43 1.27 9.95 7.5 10z"/>',
    bean: '<path d="M10.165 6.598C9.954 7.478 9.64 8.36 9 9c-.64.64-1.521.954-2.402 1.165A6 6 0 0 0 8 22c7.732 0 14-6.268 14-14a6 6 0 0 0-11.835-1.402Z"/><path d="M5.341 10.62a4 4 0 1 0 5.279-5.28"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
    crown: '<path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  };

  const icon = (name, cls = '') =>
    `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  // ------------------------------------------------------------------ state

  const state = {
    meta: null,
    session: null, // { code, memberId, token }
    room: null,
    tab: 'diets',
    draft: null, // { name, profile }
    dirty: false,
    tagMode: 'dislike',
    expanded: new Set(),
    showAll: false,
    sheet: false,
    live: false,
    es: null,
    landing: { mode: 'start', code: '', name: '' },
  };

  const myId = () => state.session && state.session.memberId;
  const me = () => state.room && state.room.members.find((m) => m.id === myId());
  const isHost = () => !!state.room && state.room.hostId === myId();
  const memberById = (id) => state.room && state.room.members.find((m) => m.id === id);
  const memberName = (id) => (memberById(id) || {}).name || 'Former member';
  const restrictionInfo = (id) => state.meta.restrictions.find((r) => r.id === id) || { id, label: id, icon: 'info' };
  const centerLabel = () => state.meta.area.centerLabel;
  const roomPath = (action = '') => `/api/rooms/${encodeURIComponent(state.session.code)}${action ? '/' + action : ''}`;
  const joinLink = () => `${location.origin}/g/${state.session.code}`;

  // ------------------------------------------------------------------ api

  async function api(path, body) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (state.session) {
      headers['X-Member-Id'] = state.session.memberId;
      headers['X-Member-Token'] = state.session.token;
    }
    let res;
    try {
      res = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw Object.assign(new Error("Can't reach Split Plate. Check your connection."), { status: 0 });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
    return data;
  }

  let toastTimer;
  function toast(msg, kind = '') {
    toastEl.textContent = msg;
    toastEl.className = `toast show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.className = 'toast'), kind === 'error' ? 4500 : 2800);
  }

  async function run(el, fn) {
    if (el) el.disabled = true;
    try {
      await fn();
    } catch (err) {
      console.error(err);
      toast(err.message || 'Something went wrong.', 'error');
    } finally {
      if (el && el.isConnected) el.disabled = false;
    }
  }

  // ------------------------------------------------------------------ live sync

  function setLive(v) {
    state.live = v;
    const dot = document.querySelector('.code-pill .dot');
    if (dot) dot.classList.toggle('live', v);
  }

  function disconnect() {
    if (state.es) state.es.close();
    state.es = null;
    state.live = false;
  }

  function connect() {
    disconnect();
    const s = state.session;
    if (!s) return;
    const es = new EventSource(`${roomPath('events')}?m=${encodeURIComponent(s.memberId)}&t=${encodeURIComponent(s.token)}`);
    state.es = es;
    es.addEventListener('room', (ev) => {
      if (state.es !== es) return;
      setLive(true);
      try {
        applyRoom(JSON.parse(ev.data));
      } catch (err) {
        console.error(err);
      }
    });
    es.addEventListener('removed', () => state.es === es && exitRoom('You were removed from the group.'));
    es.addEventListener('closed', () => state.es === es && exitRoom('This group was closed.'));
    es.onopen = () => state.es === es && setLive(true);
    es.onerror = () => {
      if (state.es !== es) return;
      setLive(false);
      if (es.readyState === EventSource.CLOSED) {
        state.es = null;
        recover(s);
      }
    };
  }

  async function recover(s) {
    if (state.session !== s) return;
    try {
      const { room } = await api(roomPath('me'), {});
      applyRoom(room);
    } catch (err) {
      if (state.session !== s) return;
      if (err.status === 404) return exitRoom('This group has expired.');
      if (err.status === 401) return exitRoom('You are no longer in this group.');
    }
    setTimeout(() => state.session === s && !state.es && connect(), 3000);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.session && (!state.es || state.es.readyState === EventSource.CLOSED)) connect();
  });

  function applyRoom(room, opts = {}) {
    if (!room || !state.session) return;
    const prev = state.room;
    if (prev && room.updatedAt < prev.updatedAt) return; // out-of-order response
    state.room = room;
    if (!me()) return exitRoom('You were removed from the group.');

    const newResults = !!room.results && (!prev || !prev.results || prev.results.computedAt !== room.results.computedAt);
    if (newResults && prev) {
      state.expanded.clear();
      state.showAll = false;
      if (state.tab === 'lobby' || opts.fromMatch) state.tab = 'matches';
      const n = room.results.matches.length;
      toast(n ? `${plural(n, 'restaurant')} work for everyone!` : 'No single spot fits everyone. Check Multi-Stop.');
    }
    const prevDecision = prev && prev.decision && prev.decision.targetId;
    const decision = room.decision && room.decision.targetId;
    if (prev && decision && decision !== prevDecision) toast(`It's decided: ${targetName(decision)}`);

    renderHeader();
    if (state.tab !== 'diets' || opts.forceView) renderView();
  }

  // ------------------------------------------------------------------ navigation

  async function enterRoom(code, sess, room, tab) {
    state.session = { code, memberId: sess.memberId, token: sess.token };
    if (!room) {
      try {
        room = (await api(`/api/rooms/${encodeURIComponent(code)}/me`, {})).room;
      } catch (err) {
        state.session = null;
        throw err;
      }
    }
    state.session.code = room.code;
    store.set('sp.session.' + room.code, { memberId: sess.memberId, token: sess.token });
    store.set('sp.last', room.code);
    state.room = room;
    const mine = me();
    state.draft = { name: mine.name, profile: clone(mine.profile) };
    state.dirty = false;
    state.expanded = new Set();
    state.showAll = false;
    state.sheet = false;
    state.tab = tab || (!mine.ready ? 'diets' : room.results ? 'matches' : 'lobby');
    history.replaceState(null, '', '/g/' + room.code);
    app.innerHTML = '';
    renderRoom();
    connect();
    window.scrollTo(0, 0);
  }

  function exitRoom(msg, forget = true) {
    const code = state.session && state.session.code;
    disconnect();
    if (forget && code) {
      store.del('sp.session.' + code);
      if (store.get('sp.last') === code) store.del('sp.last');
    }
    state.session = null;
    state.room = null;
    state.sheet = false;
    state.dirty = false;
    history.replaceState(null, '', '/');
    renderLanding();
    if (msg) toast(msg);
  }

  function go(tab) {
    state.tab = tab;
    renderHeader();
    renderView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ------------------------------------------------------------------ shared bits

  function avatar(m, size = '') {
    if (!m) return `<span class="avatar ${size}" style="--c:#9ca3af">?</span>`;
    const dot = size === '' && m.online && !m.demo ? '<span class="online" title="Online"></span>' : '';
    return `<span class="avatar ${size}" style="--c:${esc(m.color)}" title="${esc(m.name)}">${esc(initial(m.name))}${dot}</span>`;
  }

  function ring(pct, label = 'fit') {
    const r = 23;
    const c = 2 * Math.PI * r;
    return `<div class="ring ${pct >= 85 ? 'great' : ''}" title="${pct}% group fit">
      <svg viewBox="0 0 56 56"><circle class="bg" cx="28" cy="28" r="${r}"/><circle class="fg" cx="28" cy="28" r="${r}" stroke-dasharray="${((c * pct) / 100).toFixed(1)} ${c.toFixed(1)}"/></svg>
      <b>${pct}%</b><small>${label}</small></div>`;
  }

  function metaLine(r) {
    return `<div class="meta">
      <span>${esc(r.cuisine)}</span>
      <span>${priceStr(r.price)}</span>
      <span>${icon('star', 'fill sm star-ic')} ${Number(r.rating).toFixed(1)} <span class="muted">(${Number(r.reviews || 0).toLocaleString()})</span></span>
      <span>${icon('footprints', 'sm')} ${r.walk} min</span>
      <span class="${r.open ? 'open-yes' : 'open-no'}">${r.open ? `Open until ${fmtTime(r.hours.close)}` : `Closed · opens ${fmtTime(r.hours.open)}`}</span>
      ${r.halal ? '<span class="pill cert">Halal</span>' : ''}${r.kosher ? '<span class="pill cert">Kosher</span>' : ''}
    </div>`;
  }

  function allTargets() {
    const res = state.room.results;
    if (!res) return [];
    return [...res.matches.map((m) => ({ kind: 'match', id: m.id, item: m })), ...res.multiStops.map((p) => ({ kind: 'plan', id: p.id, item: p }))];
  }
  const findTarget = (id) => allTargets().find((t) => t.id === id);
  function targetName(id) {
    const t = findTarget(id);
    if (!t) return 'your pick';
    return t.kind === 'match' ? t.item.restaurant.name : t.item.stops.map((s) => s.restaurant.name).join(' + ');
  }

  /** People whose profiles were part of the current results (and are still here). */
  const eligibleVoters = () => (state.room.results.memberIds || []).filter((id) => memberById(id)).length || state.room.members.length;

  /**
   * Group favorite = most whole-group support: total stars divided by everyone
   * who could vote, so one lone 5-star can't beat a place the whole party rated 4+.
   */
  function favorite() {
    const eligible = eligibleVoters();
    let best = null;
    for (const t of allTargets()) {
      const v = Object.values(state.room.votes[t.id] || {});
      if (!v.length) continue;
      const support = v.reduce((a, b) => a + b, 0) / eligible;
      if (!best || support > best.support + 1e-9 || (Math.abs(support - best.support) < 1e-9 && avg(v) > best.avg)) {
        best = { id: t.id, support, avg: avg(v), n: v.length, eligible };
      }
    }
    return best;
  }

  function voteBlock(targetId) {
    const votes = state.room.votes[targetId] || {};
    const mine = votes[myId()] || 0;
    const vals = Object.values(votes);
    const eligible = eligibleVoters();
    const stars = [1, 2, 3, 4, 5]
      .map((n) => `<button type="button" class="star ${n <= mine ? 'on' : ''}" data-action="vote" data-target="${esc(targetId)}" data-stars="${n}" aria-label="Rate ${n} of 5" aria-pressed="${n === mine}">${icon('star')}</button>`)
      .join('');
    const voters = Object.keys(votes).map((id) => avatar(memberById(id), 'xs')).join('');
    const group = vals.length
      ? `<b>${avg(vals).toFixed(1)}</b>${icon('star', 'fill')}<span>${vals.length}/${eligible} rated</span><span class="voters">${voters}</span>`
      : '<span class="muted">No ratings yet</span>';
    return `<div class="vote"><div class="vote-me"><span class="lbl">Your rating</span><div class="stars" role="group" aria-label="Your rating">${stars}</div></div><div class="vote-group">${group}</div></div>`;
  }

  function hostActions(targetId) {
    if (!isHost()) return '';
    const decided = state.room.decision && state.room.decision.targetId === targetId;
    return `<div class="card-actions">${
      decided
        ? '<button type="button" class="btn btn-ghost btn-sm" data-action="undecide">Change pick</button>'
        : `<button type="button" class="btn btn-dark btn-sm" data-action="decide" data-target="${esc(targetId)}">${icon('lock', 'sm')} Lock it in</button>`
    }</div>`;
  }

  function mapsLink(t) {
    if (t.kind === 'match') {
      const r = t.item.restaurant;
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.lat},${r.lng}`)}`;
    }
    const pts = t.item.stops.map((s) => `${s.restaurant.lat},${s.restaurant.lng}`);
    const q = new URLSearchParams({ api: '1', origin: pts[0], destination: pts[pts.length - 1], travelmode: 'walking' });
    if (pts.length > 2) q.set('waypoints', pts.slice(1, -1).join('|'));
    return `https://www.google.com/maps/dir/?${q}`;
  }

  function decisionBanner() {
    const d = state.room.decision;
    if (!d) return '';
    const t = findTarget(d.targetId);
    if (!t) return '';
    let title;
    let sub;
    if (t.kind === 'match') {
      const r = t.item.restaurant;
      title = r.name;
      sub = `${r.cuisine} · ${r.address} · ${r.walk} min walk from ${centerLabel()}`;
    } else {
      title = t.item.stops.map((s) => s.restaurant.name).join(' + ');
      sub = `Multi-Stop plan · ${t.item.stops.length} stops, ${t.item.between} min apart`;
    }
    return `<div class="decided-banner">
      <span class="trophy">${icon('trophy')}</span>
      <div class="body">
        <div class="kicker">It's decided</div>
        <h2>${esc(title)}</h2>
        <p>${esc(sub)}</p>
        <div class="row">
          <a class="btn btn-light btn-sm" href="${esc(mapsLink(t))}" target="_blank" rel="noopener">${icon('mapPin', 'sm')} Open in Maps</a>
          ${isHost() ? '<button type="button" class="btn btn-light btn-sm" data-action="undecide">Change pick</button>' : ''}
        </div>
      </div>
    </div>`;
  }

  function staleBanner(res) {
    if (!res.stale) return '';
    return `<div class="stale"><span class="row">${icon('alert', 'sm')} Profiles or settings changed since this search.</span>
      <button type="button" class="btn btn-dark btn-sm" data-action="find">${icon('refresh', 'sm')} Refresh</button></div>`;
  }

  function diagList(res) {
    const d = res.diagnostics;
    const rows = [...d.members]
      .sort((a, b) => a.inRange - b.inRange)
      .map((x) => {
        const m = memberById(x.memberId);
        const blocked = x.inRange === 0;
        const why = blocked
          ? x.anywhere
            ? ' · nothing nearby fits. Widen the walk or budget.'
            : ' · nothing on any menu fits. Loosen calories or the avoid list.'
          : '';
        return `<div class="diag-row ${blocked ? 'block' : ''}">${avatar(m, 'sm')}<span class="txt"><b>${esc(memberName(x.memberId))}</b>${esc(why)}</span><span class="num">${x.inRange}/${d.inRange} spots</span></div>`;
      })
      .join('');
    const none = d.inRange === 0 ? `<div class="diag-row block">${icon('alert', 'sm')}<span class="txt">No restaurants pass the walk, budget and open-now filters.</span></div>` : '';
    return `<div class="diag">${none}${rows}</div>`;
  }

  function disclaimer() {
    return `<p class="disclaimer">${icon('info')}<span>Menus, calories and allergens are sample data for ${esc(state.meta.area.name)}. Always confirm allergies with restaurant staff before ordering.</span></p>`;
  }

  // ------------------------------------------------------------------ landing

  function renderLanding() {
    document.title = 'Split Plate | Less thinking. More eating.';
    const L = state.landing;
    const last = store.get('sp.last');
    const lastSess = last && store.get('sp.session.' + last);
    const savedName = (store.get('sp.me') || {}).name || '';
    const name = L.name || savedName;
    const nameField = `<label class="field"><span>Your name</span><input class="input" id="l-name" name="name" maxlength="24" autocomplete="given-name" placeholder="e.g. Alex" value="${esc(name)}" required></label>`;
    const form =
      L.mode === 'start'
        ? `<form data-form="start" novalidate>${nameField}<button class="btn btn-primary btn-lg btn-block" type="submit">Start a group ${icon('arrowRight')}</button></form>`
        : `<form data-form="join" novalidate>
            <label class="field"><span>Group code</span><input class="input mono" id="l-code" name="code" maxlength="11" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="SPLIT-1234" value="${esc(L.code)}" required></label>
            ${nameField}
            <button class="btn btn-primary btn-lg btn-block" type="submit">Join group ${icon('arrowRight')}</button>
          </form>`;

    app.innerHTML = `
    <div class="landing">
      <div class="blob red"></div><div class="blob peach"></div>
      <div class="l-wrap">
        <header class="l-top">
          <a class="l-brand" href="/"><span class="brand-mark">${icon('utensils')}</span>Split Plate</a>
          <a class="lnk" href="#how">How it works</a>
        </header>
        <section class="hero">
          <div>
            <h1>Less thinking.<span class="red">More eating.</span></h1>
            <p class="lede">Everyone adds their diet, allergies and cravings. Split Plate compares the whole party, suggests a few restaurants that work for all of you, and lets you rate them to decide.</p>
            <ul class="hero-points">
              <li>${icon('check')} Vegan, gluten-free, keto, halal, kosher &amp; allergies</li>
              <li>${icon('check')} Calorie targets and "please, no cilantro"</li>
              <li>${icon('check')} A backup plan when nothing fits everyone</li>
            </ul>
          </div>
          <div class="hero-side"><div class="hero-card">
            ${lastSess ? `<div class="rejoin"><span>Back to <b>${esc(last)}</b>?</span><button type="button" class="btn btn-sm btn-dark" data-action="rejoin">Rejoin</button></div>` : ''}
            <div class="seg" role="tablist" aria-label="Start or join">
              <button type="button" role="tab" class="${L.mode === 'start' ? 'on' : ''}" aria-selected="${L.mode === 'start'}" data-action="landing-mode" data-mode="start">Start a group</button>
              <button type="button" role="tab" class="${L.mode === 'join' ? 'on' : ''}" aria-selected="${L.mode === 'join'}" data-action="landing-mode" data-mode="join">Join a group</button>
            </div>
            ${form}
            <p class="fine">No account needed. Groups expire after 24 hours of inactivity.</p>
          </div></div>
        </section>
        <section class="how" id="how">
          <h2>How it works</h2>
          <div class="how-grid">
            <div class="how-card"><span class="how-num">1</span><h3><u>Compares</u> party preferences</h3><p>Everyone sets their restrictions, allergies, calorie targets and dislikes on their own phone. Split Plate lines them all up.</p></div>
            <div class="how-card"><span class="how-num">2</span><h3><u>Suggests</u> a few restaurants</h3><p>Only places where every single person has something to order, ranked by how well they fit the whole group.</p></div>
            <div class="how-card"><span class="how-num">3</span><h3><u>Provides</u> ratings to finalize</h3><p>Everyone rates the shortlist, the group favorite rises to the top, and the host locks it in.</p></div>
            <div class="how-card alt"><span class="how-num">${icon('route')}</span><h3><u>Multi-Stop</u> backup plan</h3><p>Zero matches? We pair nearby spots so everyone grabs something they can eat, then you meet up and eat together.</p></div>
          </div>
        </section>
        <footer class="l-foot"><span>Split Plate · ${esc(state.meta.area.name)} · ${state.meta.restaurantCount} restaurants</span><span>Menu data is for demonstration. Always confirm allergens with restaurant staff.</span></footer>
      </div>
    </div>`;
  }

  // ------------------------------------------------------------------ room shell

  function renderRoom() {
    if (!document.getElementById('shell')) {
      app.innerHTML = `<div id="shell"><header id="topbar" class="topbar"></header><main id="view" class="view-wrap"></main><nav id="bottomnav" class="bottomnav" aria-label="Sections"></nav></div><div id="sheet-root"></div>`;
    }
    renderHeader();
    renderView();
    renderSheet();
  }

  function renderHeader() {
    const top = document.getElementById('topbar');
    const bottom = document.getElementById('bottomnav');
    if (!top || !state.room) return;
    const room = state.room;
    const n = room.members.length;
    document.title = `${room.code} · Split Plate`;
    const res = room.results;
    const badges = {
      lobby: n,
      matches: res && res.matches.length ? res.matches.length : 0,
      multi: res && !res.matches.length && res.multiStops.length ? res.multiStops.length : 0,
    };
    const tabBtn = (t) =>
      `<button type="button" data-action="tab" data-tab="${t.id}" ${state.tab === t.id ? 'aria-current="page"' : ''}>${icon(t.icon)}<span>${t.label}</span>${
        badges[t.id] ? `<span class="badge ${t.id === 'multi' ? 'alert' : ''}">${badges[t.id]}</span>` : ''
      }</button>`;
    top.innerHTML = `<div class="topbar-in">
      <div class="brand"><span class="brand-mark">${icon('utensils')}</span><span class="brand-text"><b>Split Plate</b><small>${esc(state.meta.area.name)} • ${n > 1 ? 'Group Mode' : 'Solo Mode'}</small></span></div>
      <nav class="tabs-top" aria-label="Sections">${TABS.map(tabBtn).join('')}</nav>
      <button type="button" class="code-pill" data-action="share" aria-label="Invite people to ${esc(room.code)}"><span class="dot ${state.live ? 'live' : ''}"></span>${esc(room.code)}${icon('qr', 'sm')}</button>
    </div>`;
    bottom.innerHTML = TABS.map(tabBtn).join('');
  }

  /** Replace HTML while keeping keyboard focus and caret position. */
  function swap(el, html) {
    const active = document.activeElement;
    const id = active && el.contains(active) ? active.id : null;
    let sel = null;
    if (id) {
      try {
        sel = [active.selectionStart, active.selectionEnd];
      } catch {
        sel = null;
      }
    }
    el.innerHTML = html;
    if (id) {
      const next = document.getElementById(id);
      if (next) {
        next.focus({ preventScroll: true });
        if (sel && sel[0] != null) {
          try {
            next.setSelectionRange(sel[0], sel[1]);
          } catch {
            /* not a text input */
          }
        }
      }
    }
  }

  function renderView() {
    const el = document.getElementById('view');
    if (!el || !state.room) return;
    const views = { diets: viewDiets, lobby: viewLobby, matches: viewMatches, multi: viewMulti };
    swap(el, (views[state.tab] || viewLobby)());
  }

  // ------------------------------------------------------------------ My Diets (step 1)

  const fill = (v, min, max) => (((v - min) / (max - min)) * 100).toFixed(1);

  function tagHtml(kind, text, i) {
    return `<span class="tag ${kind}">${kind === 'like' ? icon('heart', 'fill') : ''}${kind === 'dislike' ? 'No ' : ''}${esc(stripNo(text))}<button type="button" data-action="remove-tag" data-kind="${kind}" data-index="${i}" aria-label="Remove ${esc(text)}">${icon('x')}</button></span>`;
  }

  function saveStatus() {
    const m = me();
    if (state.dirty) return { cls: 'dirty', html: `${icon('alert', 'sm')} Unsaved changes`, btn: `Save &amp; continue ${icon('arrowRight')}` };
    if (m && m.ready) return { cls: 'saved', html: `${icon('check', 'sm')} Saved`, btn: `Go to lobby ${icon('arrowRight')}` };
    return { cls: '', html: 'Not saved yet', btn: `Save &amp; continue ${icon('arrowRight')}` };
  }

  function viewDiets() {
    const d = state.draft;
    const p = d.profile;
    const chips = state.meta.restrictions
      .map((r) => {
        const on = p.restrictions.includes(r.id);
        return `<button type="button" class="chip-btn ${on ? 'on' : ''}" aria-pressed="${on}" data-action="toggle-restriction" data-id="${esc(r.id)}">${icon(r.icon)}<span class="lbl">${esc(r.label)}</span><span class="tick">${icon(on ? 'check' : 'plus')}</span></button>`;
      })
      .join('');
    const tags = [...p.dislikes.map((t, i) => tagHtml('dislike', t, i)), ...p.likes.map((t, i) => tagHtml('like', t, i))].join('');
    const existing = new Set([...p.dislikes, ...p.likes].map(normTag));
    const sugg = state.meta.suggestions[state.tagMode === 'dislike' ? 'dislikes' : 'likes'].filter((s) => !existing.has(normTag(s))).slice(0, 10);
    const st = saveStatus();
    const dislikeMode = state.tagMode === 'dislike';

    return `<section class="view">
      <div class="step-card">
        <div class="kicker">Step 1 of 2</div>
        <h1>Your Dining Profile</h1>
        <p>Set your food restrictions and calorie targets. The algorithm enforces these for the whole party.</p>
        <span class="step-icon">${icon('userCog', 'lg')}</span>
        <label class="name-field"><span>Your name in this group</span><input id="f-name" maxlength="24" autocomplete="given-name" value="${esc(d.name)}"></label>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-h"><span class="card-t">${icon('leaf')} Dietary restrictions &amp; allergies</span><span class="count">${p.restrictions.length} Active</span></div>
          <div class="chips-grid">${chips}</div>
        </div>
        <div class="card">
          <div class="card-h"><span class="card-t">${icon('flame')} Caloric target (per meal)</span><span class="range-val" id="cal-range">${p.calMin} – ${p.calMax} kcal</span></div>
          <div class="slider">
            <div class="slider-lab"><label for="cal-min">Minimum calorie intake</label><b id="cal-min-v">${p.calMin} kcal</b></div>
            <input type="range" id="cal-min" min="0" max="1500" step="50" value="${p.calMin}" style="--fill:${fill(p.calMin, 0, 1500)}%">
          </div>
          <div class="slider">
            <div class="slider-lab"><label for="cal-max">Maximum calorie limit</label><b id="cal-max-v">${p.calMax} kcal</b></div>
            <input type="range" id="cal-max" min="200" max="2500" step="50" value="${p.calMax}" style="--fill:${fill(p.calMax, 200, 2500)}%">
          </div>
          <p class="hint">Only dishes inside your range count as options for you. Everyone in the party gets their own range.</p>
        </div>
      </div>

      <div class="card">
        <div class="card-h"><span class="card-t">${icon('heartCrack')} Dislikes &amp; strong preferences</span><span class="count">${p.dislikes.length + p.likes.length} Tags</span></div>
        <div class="tags">${tags || '<span class="hint">No dislikes or cravings yet. Add a few below.</span>'}</div>
        <form class="tag-form" data-form="tag" autocomplete="off">
          <div class="seg mode" role="group" aria-label="Tag type">
            <button type="button" data-action="tag-mode" data-mode="dislike" class="${dislikeMode ? 'on' : ''}" aria-pressed="${dislikeMode}">${icon('x', 'sm')} Avoid</button>
            <button type="button" data-action="tag-mode" data-mode="like" class="${dislikeMode ? '' : 'on'}" aria-pressed="${!dislikeMode}">${icon('heart', 'sm')} Love</button>
          </div>
          <input class="input" id="f-tag" maxlength="30" aria-label="${dislikeMode ? 'Ingredient to avoid' : 'Something you love'}" placeholder="${dislikeMode ? 'e.g. Cilantro, Mushrooms, Seafood' : 'e.g. Spicy, Thai, Noodles'}">
          <button class="btn btn-dark" type="submit">${icon('plus')} Add</button>
        </form>
        ${sugg.length ? `<div class="suggest"><span class="lbl">Quick add:</span>${sugg.map((s) => `<button type="button" data-action="quick-tag" data-value="${esc(s)}">+ ${esc(s)}</button>`).join('')}</div>` : ''}
        <p class="hint" style="margin-top:12px"><b>Avoid</b> never suggests a dish that has it. <b>Love</b> ranks places that have it higher.</p>
      </div>

      <div class="save-bar">
        <span class="save-status ${st.cls}">${st.html}</span>
        <button type="button" class="btn btn-primary" data-action="save-profile">${st.btn}</button>
      </div>
    </section>`;
  }

  function markDirty() {
    state.dirty = true;
    const st = saveStatus();
    const s = document.querySelector('.save-status');
    if (s) {
      s.className = `save-status ${st.cls}`;
      s.innerHTML = st.html;
    }
    const b = document.querySelector('[data-action="save-profile"]');
    if (b) b.innerHTML = st.btn;
  }

  function updateCalUi() {
    const p = state.draft.profile;
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    set('cal-min-v', `${p.calMin} kcal`);
    set('cal-max-v', `${p.calMax} kcal`);
    set('cal-range', `${p.calMin} – ${p.calMax} kcal`);
    const minEl = document.getElementById('cal-min');
    const maxEl = document.getElementById('cal-max');
    if (minEl) {
      minEl.value = p.calMin;
      minEl.style.setProperty('--fill', fill(p.calMin, 0, 1500) + '%');
    }
    if (maxEl) {
      maxEl.value = p.calMax;
      maxEl.style.setProperty('--fill', fill(p.calMax, 200, 2500) + '%');
    }
  }

  function addTag(raw) {
    const text = capFirst(stripNo(String(raw).replace(/\s+/g, ' ').trim()).slice(0, 30));
    if (!text) return false;
    const p = state.draft.profile;
    const key = normTag(text);
    const list = state.tagMode === 'dislike' ? 'dislikes' : 'likes';
    const other = list === 'dislikes' ? 'likes' : 'dislikes';
    if (p[list].some((t) => normTag(t) === key)) {
      toast(`${text} is already on your list`);
      return false;
    }
    if (p[list].length >= 15) {
      toast('That is plenty of tags (15 max).');
      return false;
    }
    p[other] = p[other].filter((t) => normTag(t) !== key);
    p[list].push(text);
    state.dirty = true;
    renderView();
    return true;
  }

  // ------------------------------------------------------------------ Lobby (step 2)

  function memberRow(m) {
    const p = m.profile;
    const you = m.id === myId();
    const chips = [
      ...p.restrictions.map((id) => `<span class="mini">${esc(restrictionInfo(id).label)}</span>`),
      `<span class="mini cal">${p.calMin}–${p.calMax} kcal</span>`,
      ...p.dislikes.map((t) => `<span class="mini dislike">No ${esc(stripNo(t))}</span>`),
      ...p.likes.map((t) => `<span class="mini like">♥ ${esc(t)}</span>`),
    ].join('');
    return `<li class="member">
      ${avatar(m)}
      <div class="member-body">
        <div class="member-top">
          <span class="member-name">${esc(m.name)}${you ? ' <small>(you)</small>' : ''}</span>
          ${state.room.hostId === m.id ? `<span class="pill host">${icon('crown')} Host</span>` : ''}
          ${m.demo ? '<span class="pill demo">Sample</span>' : ''}
          ${m.ready ? `<span class="pill ok">${icon('check')} Ready</span>` : '<span class="pill wait">Setting up…</span>'}
        </div>
        ${m.ready ? `<div class="mini-chips">${chips}</div>` : '<span class="hint">Still choosing their restrictions</span>'}
      </div>
      ${isHost() && !you ? `<button type="button" class="icon-btn" data-action="remove-member" data-id="${esc(m.id)}" aria-label="Remove ${esc(m.name)}" title="Remove from group">${icon('x')}</button>` : ''}
    </li>`;
  }

  function groupTags(people, key) {
    const map = new Map();
    for (const m of people)
      for (const t of m.profile[key]) {
        const k = normTag(t);
        if (!map.has(k)) map.set(k, { label: stripNo(t), names: [] });
        map.get(k).names.push(m.name);
      }
    return map;
  }

  function partyGlance() {
    const ready = state.room.members.filter((m) => m.ready);
    if (!ready.length) return '<p class="hint">Once people save their profiles, everyone\'s rules show up here side by side.</p>';

    const byRule = new Map();
    for (const m of ready) for (const id of m.profile.restrictions) (byRule.get(id) || byRule.set(id, []).get(id)).push(m.name);
    const rules = [...byRule]
      .map(([id, names]) => `<div class="need-row"><span class="mini">${esc(restrictionInfo(id).label)}</span><span class="who-names">${esc(names.join(', '))}</span></div>`)
      .join('');

    const avoid = groupTags(ready, 'dislikes');
    const love = groupTags(ready, 'likes');
    const tagChips = (map, cls, prefix) =>
      [...map.values()].map((t) => `<span class="mini ${cls}" title="${esc(t.names.join(', '))}">${prefix}${esc(t.label)} <span style="opacity:.7">· ${esc(t.names.join(', '))}</span></span>`).join('');
    const conflicts = [...love]
      .filter(([k]) => avoid.has(k))
      .map(([k, t]) => {
        const a = avoid.get(k);
        return `<div class="conflict">${icon('alert')}<span><b>${esc(t.names.join(', '))}</b> ${t.names.length > 1 ? 'love' : 'loves'} ${esc(t.label.toLowerCase())}, but <b>${esc(a.names.join(', '))}</b> ${a.names.length > 1 ? 'avoid' : 'avoids'} it. We'll look for places with options for both.</span></div>`;
      })
      .join('');

    const top = Math.max(1000, Math.ceil(Math.max(...ready.map((m) => m.profile.calMax)) / 500) * 500);
    const bars = ready
      .map((m) => {
        const l = (m.profile.calMin / top) * 100;
        const w = Math.max(1.5, ((m.profile.calMax - m.profile.calMin) / top) * 100);
        return `<div class="cal-row"><span class="nm">${esc(m.name)}</span><div class="cal-track" title="${m.profile.calMin}–${m.profile.calMax} kcal"><span class="cal-bar" style="--c:${esc(m.color)};left:${l.toFixed(1)}%;width:${w.toFixed(1)}%"></span></div></div>`;
      })
      .join('');

    return `<div class="needs">
      <div><h4>Hard rules</h4>${rules || '<p class="hint">No hard restrictions. Easy crowd!</p>'}</div>
      ${avoid.size ? `<div><h4>Avoid</h4><div class="mini-chips">${tagChips(avoid, 'dislike', 'No ')}</div></div>` : ''}
      ${love.size ? `<div><h4>Cravings</h4><div class="mini-chips">${tagChips(love, 'like', '♥ ')}</div></div>` : ''}
      ${conflicts}
      <div><h4>Calorie targets per meal</h4><div class="cal-chart">${bars}<div class="cal-axis"><span></span><div><span>0</span><span>${top / 2}</span><span>${top} kcal</span></div></div></div></div>
    </div>`;
  }

  function settingsCard() {
    const s = state.room.settings;
    const host = isHost();
    const dis = host ? '' : 'disabled';
    return `<div class="card">
      <div class="card-h"><span class="card-t">${icon('sliders')} Search settings</span><span class="count">${host ? "You're the host" : `Set by ${esc(memberName(state.room.hostId))}`}</span></div>
      <div class="setting">
        <div class="setting-lab">Max walk <small>from ${esc(centerLabel())}</small></div>
        <div class="seg">${state.meta.walkOptions.map((w) => `<button type="button" class="${s.maxWalk === w ? 'on' : ''}" data-action="set-walk" data-v="${w}" ${dis}>${w} min</button>`).join('')}</div>
      </div>
      <div class="setting">
        <div class="setting-lab">Budget <small>up to</small></div>
        <div class="seg">${state.meta.priceLevels.map((p) => `<button type="button" class="${s.maxPrice === p ? 'on' : ''}" data-action="set-price" data-v="${p}" ${dis}>${priceStr(p)}</button>`).join('')}</div>
      </div>
      <div class="setting">
        <div class="setting-lab" style="align-items:center"><span>Open now only <small>skip places that are closed</small></span>
          <button type="button" class="switch" role="switch" aria-checked="${s.openNow}" aria-label="Open now only" data-action="toggle-open" ${dis}></button></div>
      </div>
    </div>`;
  }

  function viewLobby() {
    const room = state.room;
    const members = room.members;
    const readyCount = members.filter((m) => m.ready).length;
    const res = room.results;
    const full = members.length >= state.meta.maxMembers;

    let ctaTitle;
    let ctaSub;
    let ctaBtn;
    if (!readyCount) {
      ctaTitle = 'Waiting for profiles';
      ctaSub = 'At least one person needs to save a dining profile.';
      ctaBtn = `<button type="button" class="btn btn-primary btn-lg" disabled>Find our matches</button>`;
    } else if (res && !res.stale) {
      ctaTitle = res.matches.length ? `${plural(res.matches.length, 'match', 'matches')} ready` : 'No single spot fits everyone';
      ctaSub = res.matches.length ? 'Rate them together to pick a winner.' : 'Check out the Multi-Stop backup plans.';
      ctaBtn = `<button type="button" class="btn btn-primary btn-lg" data-action="tab" data-tab="${res.matches.length ? 'matches' : 'multi'}">${res.matches.length ? 'See matches' : 'See Multi-Stop'} ${icon('arrowRight')}</button>`;
    } else {
      ctaTitle = readyCount === members.length ? (members.length > 1 ? "Everyone's ready!" : "You're ready!") : `${readyCount} of ${members.length} ready`;
      ctaSub =
        readyCount === members.length
          ? `Searching ${state.meta.restaurantCount} spots near ${centerLabel()}`
          : 'Matching only includes people who have saved a profile.';
      ctaBtn = `<button type="button" class="btn btn-primary btn-lg" data-action="find">${icon('sparkles')} ${res ? 'Refresh matches' : 'Find our matches'}</button>`;
    }

    return `<section class="view">
      <div class="step-card">
        <div class="kicker">Step 2 of 2</div>
        <h1>Your party</h1>
        <p>Share the code so everyone can add their own dining profile from their phone. When you're all in, find your matches.</p>
        <span class="step-icon">${icon('users', 'lg')}</span>
        <div class="invite">
          <div><div style="font-size:12px;color:rgba(255,255,255,.6)">Group code</div><div class="invite-code">${esc(room.code)}</div></div>
          <div class="row">
            <button type="button" class="btn btn-light btn-sm" data-action="copy-link">${icon('copy', 'sm')} Copy link</button>
            <button type="button" class="btn btn-light btn-sm" data-action="share">${icon('qr', 'sm')} QR code</button>
          </div>
        </div>
      </div>

      ${state.dirty ? `<div class="stale"><span class="row">${icon('alert', 'sm')} You have unsaved changes to your dining profile.</span><button type="button" class="btn btn-dark btn-sm" data-action="tab" data-tab="diets">Finish saving</button></div>` : ''}
      ${room.results ? decisionBanner() : ''}

      <div class="lobby-grid">
        <div class="col">
          <div class="card">
            <div class="card-h"><span class="card-t">${icon('users')} Members</span><span class="count">${readyCount}/${members.length} ready</span></div>
            <ul class="members">${members.map(memberRow).join('')}</ul>
            <div class="row" style="margin-top:14px;justify-content:space-between">
              <button type="button" class="btn btn-ghost btn-sm" data-action="add-demo" ${full ? 'disabled' : ''}>${icon('userPlus', 'sm')} Add a sample friend</button>
              <button type="button" class="btn-text btn-danger-text" data-action="leave">Leave group</button>
            </div>
            <p class="hint" style="margin-top:8px">Trying it alone? Sample friends come with their own diets so you can see how matching works.</p>
          </div>
        </div>
        <div class="col">
          <div class="card"><div class="card-h"><span class="card-t">${icon('sparkles')} Party at a glance</span></div>${partyGlance()}</div>
          ${settingsCard()}
        </div>
      </div>

      <div class="cta-bar">
        <span class="cta-txt"><b>${esc(ctaTitle)}</b>${esc(ctaSub)}</span>
        ${ctaBtn}
      </div>
    </section>`;
  }

  // ------------------------------------------------------------------ Matches

  function noResults() {
    const ready = state.room.members.filter((m) => m.ready).length;
    return `<div class="card empty">
      <div class="big-ic">${icon('utensils')}</div>
      <h2>No matches yet</h2>
      <p>${ready ? 'When everyone has saved their dining profile, search from here or the lobby.' : 'Save your dining profile first, then invite your party.'}</p>
      ${ready ? `<button type="button" class="btn btn-primary" data-action="find">${icon('sparkles')} Find our matches</button>` : `<button type="button" class="btn btn-primary" data-action="tab" data-tab="diets">Set up my profile</button>`}
    </div>`;
  }

  function whoChip(e) {
    const m = memberById(e.memberId);
    return `<span class="who-chip">${avatar(m, 'sm')}<b>${esc(memberName(e.memberId))}</b><span class="n">${plural(e.count, 'dish', 'dishes')}</span>${
      e.likeHits.length ? `<span class="heart" title="Has what they love: ${esc(e.likeHits.join(', '))}">${icon('heart', 'fill')}</span>` : ''
    }</span>`;
  }

  function ordersHtml(evals) {
    return `<div class="orders">${evals
      .map(
        (e) => `<div class="order-person">
          <h5>${avatar(memberById(e.memberId), 'sm')} ${esc(memberName(e.memberId))} <span class="muted" style="font-weight:500">· ${plural(e.count, 'option')}</span></h5>
          <ul class="dish-list">${e.dishes
            .map(
              (d) => `<li class="dish"><span class="dn">${esc(d.name)}${d.liked ? `<span class="liked" title="Matches something they love">${icon('heart', 'fill')}</span>` : ''}${
                d.spice >= 2 ? `<span class="hot" title="Spicy">${icon('flame')}</span>` : ''
              }</span><span class="dm">${d.calories} kcal${d.price ? ` · $${d.price}` : ''}</span></li>`
            )
            .join('')}</ul>
        </div>`
      )
      .join('')}</div>`;
  }

  function matchCard(m, i, fav) {
    const r = m.restaurant;
    const decided = state.room.decision && state.room.decision.targetId === m.id;
    const open = state.expanded.has(m.id);
    return `<article class="card mcard ${decided ? 'decided' : ''}">
      <div class="mcard-top">
        <span class="rank">${i + 1}</span>
        <div><h3>${esc(r.name)}</h3>${metaLine(r)}</div>
        ${ring(m.fit)}
      </div>
      ${fav && fav.id === m.id ? `<span class="fav">${icon('trophy')} Group favorite</span>` : ''}
      <p class="blurb">${esc(r.blurb || '')}</p>
      <div class="who">${m.members.map(whoChip).join('')}</div>
      <button type="button" class="expand-btn" data-action="expand" data-id="${esc(m.id)}" aria-expanded="${open}">${open ? 'Hide' : 'See'} what everyone can order ${icon('chevron', 'sm')}</button>
      ${open ? ordersHtml(m.members) : ''}
      ${voteBlock(m.id)}
      ${hostActions(m.id)}
    </article>`;
  }

  function leaderBar(fav) {
    if (state.room.decision) return '';
    if (!fav) return `<div class="leader"><span class="row">${icon('star', 'fill')} Rate each option. The group favorite rises to the top.</span></div>`;
    const action = isHost()
      ? `<button type="button" class="btn btn-dark btn-sm" data-action="decide" data-target="${esc(fav.id)}">${icon('lock', 'sm')} Lock it in</button>`
      : `<span class="hint">${esc(memberName(state.room.hostId))} locks in the final pick</span>`;
    return `<div class="leader"><span class="row">${icon('trophy')} <span><b>${esc(targetName(fav.id))}</b> is the group favorite · ${fav.avg.toFixed(1)}★ from ${fav.n} of ${fav.eligible}</span></span>${action}</div>`;
  }

  function viewMatches() {
    const res = state.room.results;
    if (!res) return `<section class="view"><div class="view-head"><div><h1>Matches</h1><p>Restaurants where everyone has something to eat.</p></div></div>${noResults()}</section>`;
    const s = res.settings;
    const n = res.memberIds.length;
    const filters = `within ${s.maxWalk} min · up to ${priceStr(s.maxPrice)}${s.openNow ? ' · open now' : ''}`;
    const head = `<div class="view-head"><div><h1>Matches</h1><p>${
      res.matches.length ? `${plural(res.matches.length, 'spot')} ${res.matches.length === 1 ? 'works' : 'work'} for ${n > 1 ? `all ${n} of you` : 'you'}` : 'Nothing fits everyone yet'
    } · ${filters}</p></div><button type="button" class="btn btn-ghost btn-sm" data-action="find">${icon('refresh', 'sm')} Re-run</button></div>`;

    if (!res.matches.length) {
      const plans = res.multiStops.length;
      return `<section class="view">${head}${staleBanner(res)}${decisionBanner()}
        <div class="card empty warn">
          <div class="big-ic">${icon('alert')}</div>
          <h2>No single restaurant works for everyone</h2>
          <p>Within ${s.maxWalk} min and up to ${priceStr(s.maxPrice)}, no spot has a dish for all ${n} of you. ${plans ? "Good news: there's a backup plan." : ''}</p>
          ${diagList(res)}
          <div class="row" style="justify-content:center">
            ${plans ? `<button type="button" class="btn btn-primary" data-action="tab" data-tab="multi">${icon('route', 'sm')} See ${plural(plans, 'Multi-Stop plan')}</button>` : ''}
            ${isHost() ? `<button type="button" class="btn btn-ghost" data-action="widen">${icon('sliders', 'sm')} Widen search</button>` : ''}
          </div>
        </div>
        ${disclaimer()}
      </section>`;
    }

    const fav = favorite();
    const list = state.showAll ? res.matches : res.matches.slice(0, 3);
    const more = res.matches.length > 3 && !state.showAll ? `<button type="button" class="btn btn-ghost" data-action="show-more">Show ${plural(res.matches.length - 3, 'more option')}</button>` : '';
    return `<section class="view">${head}${staleBanner(res)}${decisionBanner()}${leaderBar(fav)}
      <div class="match-list">${list.map((m, i) => matchCard(m, i, fav)).join('')}</div>
      ${more ? `<div class="row" style="justify-content:center">${more}</div>` : ''}
      ${disclaimer()}
    </section>`;
  }

  // ------------------------------------------------------------------ Multi-Stop

  function planCard(p, i, fav) {
    const decided = state.room.decision && state.room.decision.targetId === p.id;
    const stops = p.stops
      .map(
        (s, si) => `
        <li class="tl-item tl-leg"><span class="tl-node"></span><div class="tl-body">${icon('footprints', 'sm')} ${s.walkFromPrev} min walk</div></li>
        <li class="tl-item tl-stop"><span class="tl-node num">${si + 1}</span><div class="tl-body">
          <h4>${esc(s.restaurant.name)}</h4>${metaLine(s.restaurant)}
          <div class="stop-orders">${s.members
            .map(
              (e) => `<div class="stop-order">${avatar(memberById(e.memberId), 'sm')}<div class="txt"><b>${esc(memberName(e.memberId))}</b> <span>can get ${esc(
                e.dishes
                  .slice(0, 2)
                  .map((d) => d.name)
                  .join(' or ')
              )}${e.count > 2 ? ` (+${e.count - 2} more)` : ''}</span></div></div>`
            )
            .join('')}</div>
        </div></li>`
      )
      .join('');
    return `<article class="card plan ${decided ? 'mcard decided' : ''}">
      <div class="plan-head"><div><span class="plan-tag">Plan ${'ABCDEF'[i]}</span><h3>${p.stops.length} stops · ${p.between} min apart</h3></div>${ring(p.fit)}</div>
      ${fav && fav.id === p.id ? `<span class="fav">${icon('trophy')} Group favorite</span>` : ''}
      <ol class="timeline">
        <li class="tl-item tl-start"><span class="tl-node">${icon('mapPin')}</span><div class="tl-body">Start at ${esc(centerLabel())}</div></li>
        ${stops}
      </ol>
      <p class="plan-tip">${icon('info')}<span>Pick up from ${p.stops.length === 2 ? 'both stops' : 'each stop'} and eat together at ${esc(centerLabel())}, or turn it into a progressive dinner.</span></p>
      ${voteBlock(p.id)}
      ${hostActions(p.id)}
    </article>`;
  }

  function viewMulti() {
    const res = state.room.results;
    const intro = `<div class="step-card">
      <div class="kicker">Backup plan</div>
      <h1>Multi-Stop</h1>
      <p>When no single spot works for everyone, split the order across nearby restaurants. Grab food from each stop and meet up to eat together.</p>
      <span class="step-icon">${icon('route', 'lg')}</span>
    </div>`;
    if (!res) return `<section class="view">${intro}${noResults()}</section>`;

    if (!res.multiStops.length) {
      const body = res.matches.length
        ? `<div class="card empty"><div class="big-ic">${icon('check')}</div><h2>No need to split up</h2>
            <p>${plural(res.matches.length, 'restaurant')} ${res.matches.length === 1 ? 'works' : 'work'} for the whole party, so you can all go to one place.</p>
            <button type="button" class="btn btn-primary" data-action="tab" data-tab="matches">See matches ${icon('arrowRight', 'sm')}</button></div>`
        : `<div class="card empty warn"><div class="big-ic">${icon('alert')}</div><h2>Even splitting up doesn't cover everyone</h2>
            <p>No combination of nearby restaurants has something for every person. Someone's filters are too tight for this area.</p>
            ${diagList(res)}
            ${isHost() ? `<button type="button" class="btn btn-ghost" data-action="widen">${icon('sliders', 'sm')} Widen search</button>` : ''}</div>`;
      return `<section class="view">${intro}${staleBanner(res)}${decisionBanner()}${body}</section>`;
    }

    const fav = favorite();
    const note = res.matches.length
      ? `<div class="leader"><span class="row">${icon('info')} ${plural(res.matches.length, 'restaurant')} already ${res.matches.length === 1 ? 'works' : 'work'} for everyone. These are alternatives.</span><button type="button" class="btn btn-ghost btn-sm" data-action="tab" data-tab="matches">See matches</button></div>`
      : '';
    return `<section class="view">${intro}${staleBanner(res)}${decisionBanner()}${note}
      <div class="match-list">${res.multiStops.map((p, i) => planCard(p, i, fav)).join('')}</div>
      ${disclaimer()}
    </section>`;
  }

  // ------------------------------------------------------------------ share sheet

  let qrLoading = null;
  function loadQr() {
    if (window.qrcode) return Promise.resolve();
    if (!qrLoading) {
      qrLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = '/vendor/qrcode.min.js';
        s.onload = resolve;
        s.onerror = () => {
          qrLoading = null;
          reject(new Error('QR library failed to load'));
        };
        document.head.appendChild(s);
      });
    }
    return qrLoading;
  }

  async function drawQr() {
    const el = document.getElementById('qr');
    if (!el) return;
    try {
      await loadQr();
      const qr = window.qrcode(0, 'M');
      qr.addData(joinLink());
      qr.make();
      const target = document.getElementById('qr');
      if (target) target.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch {
      const target = document.getElementById('qr');
      if (target) target.innerHTML = '<span class="hint">QR code unavailable. Share the link instead.</span>';
    }
  }

  function renderSheet() {
    const root = document.getElementById('sheet-root');
    if (!root) return;
    if (!state.sheet || !state.session) {
      root.innerHTML = '';
      return;
    }
    root.innerHTML = `<div class="sheet-backdrop" data-action="sheet-backdrop">
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <button type="button" class="icon-btn close" data-action="close-sheet" aria-label="Close">${icon('x')}</button>
        <h2 id="sheet-title">Invite your party</h2>
        <p class="hint">Scan to join, or send the link.</p>
        <div class="qr" id="qr"><span class="hint">Loading…</span></div>
        <div class="big-code">${esc(state.session.code)}</div>
        <div class="link-box"><input id="share-link" readonly value="${esc(joinLink())}" aria-label="Invite link"><button type="button" class="btn btn-dark btn-sm" data-action="copy-link">${icon('copy', 'sm')} Copy</button></div>
        ${navigator.share ? `<button type="button" class="btn btn-primary btn-block" data-action="native-share">${icon('share', 'sm')} Share…</button>` : ''}
      </div>
    </div>`;
    drawQr();
    const closeBtn = root.querySelector('.close');
    if (closeBtn) closeBtn.focus();
  }

  function closeSheet() {
    state.sheet = false;
    renderSheet();
  }

  // ------------------------------------------------------------------ actions

  async function saveSettings(patch) {
    const before = clone(state.room.settings);
    Object.assign(state.room.settings, patch);
    renderView();
    try {
      const data = await api(roomPath('settings'), { settings: patch });
      applyRoom(data.room);
    } catch (err) {
      state.room.settings = before;
      renderView();
      toast(err.message, 'error');
    }
  }

  async function find(el) {
    await run(el, async () => {
      const data = await api(roomPath('match'), {});
      applyRoom(data.room, { fromMatch: true });
      if (state.tab !== 'matches' && state.tab !== 'multi') go('matches');
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  async function copyLink() {
    const link = joinLink();
    try {
      await navigator.clipboard.writeText(link);
      toast('Invite link copied');
    } catch {
      state.sheet = true;
      renderSheet();
      const input = document.getElementById('share-link');
      if (input) input.select();
      toast('Copy the link from here');
    }
  }

  const ACTIONS = {
    reload: () => location.reload(),
    tab: (el) => go(el.dataset.tab),
    'landing-mode': (el) => {
      state.landing.mode = el.dataset.mode;
      renderLanding();
      const target = document.getElementById(state.landing.mode === 'join' ? 'l-code' : 'l-name');
      if (target) target.focus();
    },
    rejoin: (el) => {
      const code = store.get('sp.last');
      const sess = code && store.get('sp.session.' + code);
      if (!sess) return renderLanding();
      run(el, async () => {
        try {
          await enterRoom(code, sess);
        } catch (err) {
          if (err.status === 404 || err.status === 401) {
            store.del('sp.session.' + code);
            store.del('sp.last');
            renderLanding();
            throw new Error(err.status === 404 ? 'That group has expired.' : 'You are no longer in that group.');
          }
          throw err;
        }
      });
    },

    // My Diets
    'toggle-restriction': (el) => {
      const list = state.draft.profile.restrictions;
      const id = el.dataset.id;
      const i = list.indexOf(id);
      if (i >= 0) list.splice(i, 1);
      else list.push(id);
      state.dirty = true;
      renderView();
    },
    'tag-mode': (el) => {
      state.tagMode = el.dataset.mode;
      renderView();
      const input = document.getElementById('f-tag');
      if (input) input.focus();
    },
    'quick-tag': (el) => addTag(el.dataset.value),
    'remove-tag': (el) => {
      const list = el.dataset.kind === 'like' ? 'likes' : 'dislikes';
      state.draft.profile[list].splice(Number(el.dataset.index), 1);
      state.dirty = true;
      renderView();
    },
    'save-profile': (el) => {
      const m = me();
      if (m.ready && !state.dirty) return go('lobby');
      const name = state.draft.name.replace(/\s+/g, ' ').trim();
      if (!name) {
        toast('Add your name first');
        const input = document.getElementById('f-name');
        if (input) input.focus();
        return;
      }
      run(el, async () => {
        const data = await api(roomPath('profile'), { name, profile: state.draft.profile });
        store.set('sp.me', { name, profile: clone(state.draft.profile) });
        state.dirty = false;
        applyRoom(data.room);
        state.draft.name = me().name;
        go('lobby');
        toast('Profile saved');
      });
    },

    // Lobby
    share: () => {
      state.sheet = true;
      renderSheet();
    },
    'close-sheet': closeSheet,
    'sheet-backdrop': (el, ev) => {
      if (ev.target === el) closeSheet();
    },
    'copy-link': copyLink,
    'native-share': () => {
      navigator
        .share({ title: 'Split Plate', text: `Join my Split Plate group (${state.session.code}) so we can pick where to eat.`, url: joinLink() })
        .catch(() => {});
    },
    'set-walk': (el) => isHost() && saveSettings({ maxWalk: Number(el.dataset.v) }),
    'set-price': (el) => isHost() && saveSettings({ maxPrice: Number(el.dataset.v) }),
    'toggle-open': () => isHost() && saveSettings({ openNow: !state.room.settings.openNow }),
    'add-demo': (el) =>
      run(el, async () => {
        const data = await api(roomPath('demo'), {});
        applyRoom(data.room);
        const added = data.room.members[data.room.members.length - 1];
        toast(`${added.name} joined with a sample profile`);
      }),
    'remove-member': (el) => {
      const m = memberById(el.dataset.id);
      if (!m || !confirm(`Remove ${m.name} from the group?`)) return;
      run(el, async () => applyRoom((await api(roomPath('remove'), { memberId: m.id })).room));
    },
    leave: (el) => {
      if (!confirm('Leave this group? You can rejoin later with the code.')) return;
      run(el, async () => {
        await api(roomPath('leave'), {});
        exitRoom('You left the group');
      });
    },
    find: (el) => find(el),
    widen: (el) => {
      const s = state.room.settings;
      const walks = state.meta.walkOptions;
      const patch = { maxWalk: walks.find((w) => w > s.maxWalk) || walks[walks.length - 1], maxPrice: 4, openNow: false };
      run(el, async () => {
        applyRoom((await api(roomPath('settings'), { settings: patch })).room);
        applyRoom((await api(roomPath('match'), {})).room, { fromMatch: true });
        toast(`Widened to ${patch.maxWalk} min walk, any budget`);
      });
    },

    // Matches & Multi-Stop
    expand: (el) => {
      const id = el.dataset.id;
      if (state.expanded.has(id)) state.expanded.delete(id);
      else state.expanded.add(id);
      renderView();
    },
    'show-more': () => {
      state.showAll = true;
      renderView();
    },
    vote: (el) => {
      const target = el.dataset.target;
      const stars = Number(el.dataset.stars);
      const votes = { ...(state.room.votes[target] || {}) };
      const next = votes[myId()] === stars ? 0 : stars;
      if (next) votes[myId()] = next;
      else delete votes[myId()];
      state.room.votes = { ...state.room.votes, [target]: votes };
      renderView();
      api(roomPath('vote'), { targetId: target, stars: next })
        .then((data) => applyRoom(data.room))
        .catch((err) => {
          toast(err.message, 'error');
          recover(state.session);
        });
    },
    decide: (el) =>
      run(el, async () => {
        applyRoom((await api(roomPath('decide'), { targetId: el.dataset.target })).room);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }),
    undecide: (el) => run(el, async () => applyRoom((await api(roomPath('decide'), { targetId: null })).room)),
  };

  const FORMS = {
    async start(form) {
      const name = form.elements.name.value.replace(/\s+/g, ' ').trim();
      if (!name) {
        toast('Add your name first');
        form.elements.name.focus();
        return;
      }
      await run(form.querySelector('[type=submit]'), async () => {
        const saved = store.get('sp.me') || {};
        const profile = { ...DEFAULT_PROFILE, ...(saved.profile || {}) };
        const data = await api('/api/rooms', { name, profile });
        store.set('sp.me', { ...saved, name, profile });
        await enterRoom(data.code, { memberId: data.memberId, token: data.token }, data.room, 'diets');
      });
    },
    async join(form) {
      const code = normCode(form.elements.code.value);
      const name = form.elements.name.value.replace(/\s+/g, ' ').trim();
      if (!code) {
        toast('Enter a group code like SPLIT-1234');
        form.elements.code.focus();
        return;
      }
      if (!name) {
        toast('Add your name first');
        form.elements.name.focus();
        return;
      }
      await run(form.querySelector('[type=submit]'), async () => {
        const saved = store.get('sp.me') || {};
        const profile = { ...DEFAULT_PROFILE, ...(saved.profile || {}) };
        const existing = store.get('sp.session.' + code) || {};
        const data = await api(`/api/rooms/${encodeURIComponent(code)}/join`, { name, profile, memberId: existing.memberId, token: existing.token });
        store.set('sp.me', { ...saved, name, profile });
        await enterRoom(code, { memberId: data.memberId, token: data.token }, data.room);
      });
    },
    tag(form) {
      const input = form.querySelector('#f-tag');
      if (addTag(input.value)) {
        const fresh = document.getElementById('f-tag');
        if (fresh) {
          fresh.value = '';
          fresh.focus();
        }
      }
    },
  };

  const INPUTS = {
    'l-name': (el) => (state.landing.name = el.value),
    'l-code': (el) => (state.landing.code = el.value),
    'f-name': (el) => {
      state.draft.name = el.value;
      markDirty();
    },
    'cal-min': (el) => {
      const p = state.draft.profile;
      p.calMin = Number(el.value);
      if (p.calMax < p.calMin + 100) p.calMax = Math.min(2500, p.calMin + 100);
      updateCalUi();
      markDirty();
    },
    'cal-max': (el) => {
      const p = state.draft.profile;
      p.calMax = Number(el.value);
      if (p.calMin > p.calMax - 100) p.calMin = Math.max(0, p.calMax - 100);
      updateCalUi();
      markDirty();
    },
  };

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = ACTIONS[el.dataset.action];
    if (fn) fn(el, ev);
  });
  document.addEventListener('submit', (ev) => {
    const form = ev.target.closest('form[data-form]');
    if (!form) return;
    ev.preventDefault();
    const fn = FORMS[form.dataset.form];
    if (fn) fn(form);
  });
  document.addEventListener('input', (ev) => {
    const fn = INPUTS[ev.target.id];
    if (fn) fn(ev.target);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && state.sheet) closeSheet();
  });
  window.addEventListener('beforeunload', (ev) => {
    if (state.session && state.dirty) {
      ev.preventDefault();
      ev.returnValue = '';
    }
  });

  // ------------------------------------------------------------------ boot

  async function boot() {
    try {
      state.meta = await api('/api/meta');
    } catch {
      app.innerHTML = `<div class="boot"><div class="card empty"><div class="big-ic">${icon('alert')}</div><h2>Can't reach Split Plate</h2><p>Check your connection and try again.</p><button type="button" class="btn btn-primary" data-action="reload">Retry</button></div></div>`;
      return;
    }

    const match = location.pathname.match(/^\/g\/([^/]+)/);
    const code = match && normCode(decodeURIComponent(match[1]));
    if (code) {
      const sess = store.get('sp.session.' + code);
      if (sess) {
        try {
          await enterRoom(code, sess);
          return;
        } catch (err) {
          if (err.status === 401 || err.status === 410) store.del('sp.session.' + code);
          if (err.status === 404) {
            store.del('sp.session.' + code);
            history.replaceState(null, '', '/');
            renderLanding();
            toast("That group doesn't exist or has expired.", 'error');
            return;
          }
        }
      }
      state.landing.mode = 'join';
      state.landing.code = code;
      renderLanding();
      const nameInput = document.getElementById('l-name');
      if (nameInput && !nameInput.value) nameInput.focus();
      return;
    }
    if (location.pathname !== '/') history.replaceState(null, '', '/');
    renderLanding();
  }

  boot();
})();
