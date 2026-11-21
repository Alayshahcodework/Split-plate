'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const matcher = require('../lib/matcher');
const raw = require('../data/restaurants.json');

const catalog = matcher.loadCatalog(raw);
const SETTINGS = { maxWalk: 15, maxPrice: 3, openNow: false };
const byId = Object.fromEntries(catalog.restaurants.map((r) => [r.id, r]));
const dishById = new Map(catalog.restaurants.flatMap((r) => r.menu.map((d) => [d.id, { d, r }])));

const person = (id, profile) => ({ id, profile: { restrictions: [], calMin: 0, calMax: 3000, dislikes: [], likes: [], ...profile } });
const allSuggestedDishes = (out, memberId) =>
  [
    ...out.matches.flatMap((m) => m.members),
    ...out.multiStops.flatMap((p) => p.stops.flatMap((s) => s.members)),
  ]
    .filter((e) => e.memberId === memberId)
    .flatMap((e) => e.dishes.map((d) => dishById.get(d.id)));

test('catalog loads and every restaurant has a menu', () => {
  assert.ok(catalog.restaurants.length >= 15);
  for (const r of catalog.restaurants) assert.ok(r.menu.length >= 5, r.id);
});

test('vegan members only ever see vegan dishes', () => {
  const out = matcher.computeMatches(catalog, [person('v', { restrictions: ['vegan'] })], { ...SETTINGS, maxWalk: 30, maxPrice: 4 });
  const dishes = allSuggestedDishes(out, 'v');
  assert.ok(dishes.length > 10);
  for (const { d } of dishes) {
    for (const c of ['meat', 'pork', 'fish', 'shellfish', 'dairy', 'egg', 'honey']) assert.ok(!d.contains.includes(c), `${d.name} contains ${c}`);
  }
});

test('nut allergy and gluten-free are hard rules', () => {
  const out = matcher.computeMatches(catalog, [person('a', { restrictions: ['nut-allergy', 'gluten-free'] })], { ...SETTINGS, maxWalk: 30, maxPrice: 4 });
  for (const { d } of allSuggestedDishes(out, 'a')) {
    assert.ok(!d.contains.includes('nuts'), d.name);
    assert.ok(!d.contains.includes('gluten'), d.name);
  }
});

test('kosher only matches kosher-certified kitchens; halal meat only from halal kitchens', () => {
  const out = matcher.computeMatches(catalog, [person('k', { restrictions: ['kosher'] })], { ...SETTINGS, maxWalk: 30, maxPrice: 4 });
  assert.ok(out.matches.length > 0);
  for (const m of out.matches) assert.ok(byId[m.restaurant.id].kosher, m.restaurant.name);

  const h = matcher.computeMatches(catalog, [person('h', { restrictions: ['halal'] })], { ...SETTINGS, maxWalk: 30, maxPrice: 4 });
  for (const { d, r } of allSuggestedDishes(h, 'h')) {
    assert.ok(!d.contains.includes('pork') && !d.contains.includes('alcohol'), d.name);
    if (d.contains.includes('meat')) assert.ok(r.halal, `${d.name} at ${r.name}`);
  }
});

test('keto uses the carb limit and calorie window is enforced', () => {
  const out = matcher.computeMatches(catalog, [person('k', { restrictions: ['keto'], calMin: 450, calMax: 700 })], { ...SETTINGS, maxWalk: 30, maxPrice: 4 });
  const dishes = allSuggestedDishes(out, 'k');
  assert.ok(dishes.length > 0);
  for (const { d } of dishes) {
    assert.ok(d.carbs <= matcher.KETO_CARB_LIMIT, d.name);
    assert.ok(d.calories >= 450 && d.calories <= 700, d.name);
  }
});

test('avoid tags remove matching dishes without false positives', () => {
  const r = byId['little-napoli'];
  const truffle = r.menu.find((d) => d.name.includes('Mushroom'));
  assert.equal(matcher.dishFits(truffle, r, person('x', { dislikes: ['No Mushrooms'] })), false);

  const moussaka = byId['olive-ember'].menu.find((d) => d.name === 'Lamb Moussaka');
  assert.equal(matcher.dishFits(moussaka, byId['olive-ember'], person('x', { dislikes: ['Eggplant'] })), false);
  // "egg" must not match "eggplant"
  const gigantes = byId['olive-ember'].menu.find((d) => d.name.startsWith('Gigantes'));
  assert.equal(matcher.dishFits(gigantes, byId['olive-ember'], person('x', { dislikes: ['Egg'] })), true);

  const larb = byId['chili-lantern'].menu.find((d) => d.name === 'Larb Gai');
  assert.equal(matcher.dishFits(larb, byId['chili-lantern'], person('x', { dislikes: ['Spicy'] })), false);
  assert.equal(matcher.dishFits(larb, byId['chili-lantern'], person('x', { dislikes: ['Seafood'] })), false, 'fish sauce counts as seafood');
  const redCurry = byId['chili-lantern'].menu.find((d) => d.name === 'Vegetable Red Curry');
  assert.equal(matcher.dishFits(redCurry, byId['chili-lantern'], person('x', { dislikes: ['Seafood'] })), true);
  const padThai = byId['chili-lantern'].menu.find((d) => d.name === 'Shrimp Pad Thai');
  assert.equal(matcher.dishFits(padThai, byId['chili-lantern'], person('x', { dislikes: ['Seafood'] })), false);
  const pho = byId['lemongrass-alley'].menu.find((d) => d.name === 'Vegetable Pho');
  assert.equal(matcher.dishFits(pho, byId['lemongrass-alley'], person('x', { dislikes: ['Cilantro'] })), false);
});

test('every suggested restaurant has at least one dish for every member', () => {
  const party = [
    person('maya', { restrictions: ['vegan'], calMin: 350, calMax: 800, dislikes: ['Mushrooms'], likes: ['Spicy'] }),
    person('jordan', { restrictions: ['gluten-free'], calMin: 450, calMax: 1000, dislikes: ['Cilantro'], likes: ['Thai'] }),
    person('sam', { restrictions: ['nut-allergy'], calMin: 400, calMax: 950, likes: ['Noodles'] }),
  ];
  const out = matcher.computeMatches(catalog, party, SETTINGS);
  assert.ok(out.matches.length >= 1 && out.matches.length <= 6);
  for (const m of out.matches) {
    assert.equal(m.members.length, 3);
    for (const e of m.members) assert.ok(e.count > 0, `${e.memberId} has nothing at ${m.restaurant.name}`);
    assert.ok(m.restaurant.walk <= SETTINGS.maxWalk);
    assert.ok(m.restaurant.price <= SETTINGS.maxPrice);
  }
  // sorted best first
  const fits = out.matches.map((m) => m.fit);
  assert.ok(fits[0] >= Math.min(...fits));
});

test('love tags are reported as hits', () => {
  const out = matcher.computeMatches(catalog, [person('t', { likes: ['Thai'] })], SETTINGS);
  const thai = out.matches.find((m) => m.restaurant.id === 'chili-lantern');
  assert.ok(thai, 'Chili Lantern should be suggested');
  assert.deepEqual(thai.members[0].likeHits, ['Thai']);
});

test('zero matches falls back to Multi-Stop plans that cover everyone', () => {
  const party = [
    person('ava', { restrictions: ['kosher'], calMin: 700, calMax: 1200 }),
    person('leo', { restrictions: ['keto'], calMin: 500, calMax: 1200 }),
  ];
  const out = matcher.computeMatches(catalog, party, SETTINGS);
  assert.equal(out.matches.length, 0);
  assert.ok(out.multiStops.length >= 1);
  for (const plan of out.multiStops) {
    const covered = plan.stops.flatMap((s) => s.members.map((e) => e.memberId)).sort();
    assert.deepEqual(covered, ['ava', 'leo']);
    assert.ok(plan.between <= 12);
    const avaStop = plan.stops.find((s) => s.members.some((e) => e.memberId === 'ava'));
    assert.ok(byId[avaStop.restaurant.id].kosher);
  }
  assert.equal(out.diagnostics.fullMatches, 0);
});

test('diagnostics flag a member nobody can feed', () => {
  const party = [person('a', {}), person('b', { restrictions: ['vegan', 'keto'], calMin: 1400, calMax: 2000 })];
  const out = matcher.computeMatches(catalog, party, SETTINGS);
  assert.equal(out.matches.length, 0);
  assert.equal(out.multiStops.length, 0);
  const b = out.diagnostics.members.find((m) => m.memberId === 'b');
  assert.equal(b.inRange, 0);
  assert.equal(b.anywhere, 0);
});

test('filters: walk distance, budget and open-now', () => {
  const solo = [person('s', {})];
  const near = matcher.computeMatches(catalog, solo, { maxWalk: 5, maxPrice: 4, openNow: false });
  for (const m of near.matches) assert.ok(m.restaurant.walk <= 5);
  const cheap = matcher.computeMatches(catalog, solo, { maxWalk: 30, maxPrice: 1, openNow: false });
  for (const m of cheap.matches) assert.equal(m.restaurant.price, 1);

  // 4 AM in New York: only late-night spots (none here close after 3 AM)
  const fourAm = new Date('2026-11-20T09:00:00Z');
  const late = matcher.computeMatches(catalog, solo, { maxWalk: 30, maxPrice: 4, openNow: true }, fourAm);
  assert.equal(late.matches.length, 0);
  // 1:30 AM: Crescent Grill (until 3 AM) and Little Napoli (until 2 AM) are open
  const night = matcher.computeMatches(catalog, solo, { maxWalk: 30, maxPrice: 4, openNow: true }, new Date('2026-11-20T06:30:00Z'));
  assert.deepEqual(night.matches.map((m) => m.restaurant.id).sort(), ['crescent-grill', 'little-napoli']);
});

test('isOpenAt handles overnight hours', () => {
  const tz = 'America/New_York';
  const hours = { open: '10:00', close: '03:00' };
  assert.equal(matcher.isOpenAt(hours, new Date('2026-11-20T06:30:00Z'), tz), true); // 1:30 AM
  assert.equal(matcher.isOpenAt(hours, new Date('2026-11-20T10:00:00Z'), tz), false); // 5 AM
  assert.equal(matcher.isOpenAt(hours, new Date('2026-11-20T17:00:00Z'), tz), true); // noon
});
