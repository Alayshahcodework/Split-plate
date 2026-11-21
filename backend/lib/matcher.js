'use strict';

/**
 * Split Plate matching engine.
 *
 * Every member's restrictions, calorie window and "avoid" tags are hard rules:
 * a dish only counts for someone if it passes all of them. A restaurant is a
 * match when every member has at least one dish there. "Love" tags are soft and
 * only affect ranking. When no single restaurant works, the engine looks for
 * 2-3 nearby restaurants that together cover everyone (Multi-Stop plans).
 */

const KETO_CARB_LIMIT = 20; // grams of carbs per dish
const WALK_METERS_PER_MIN = 80;
const ROUTE_FACTOR = 1.3; // city blocks are not straight lines
const MAX_HOP_MIN = 12; // max walk between two stops of a 2-stop plan
const MAX_ROUTE_MIN = 20; // max total walk between stops of a 3-stop plan
const MAX_MATCHES = 6;
const MAX_PLANS = 3;

const RESTRICTIONS = [
  { id: 'vegan', label: 'Vegan', icon: 'leaf' },
  { id: 'vegetarian', label: 'Vegetarian', icon: 'carrot' },
  { id: 'gluten-free', label: 'Gluten-Free', icon: 'wheat' },
  { id: 'dairy-free', label: 'Dairy-Free', icon: 'milk' },
  { id: 'keto', label: 'Keto Diet', icon: 'drumstick' },
  { id: 'nut-allergy', label: 'Nut Allergy', icon: 'ban' },
  { id: 'halal', label: 'Halal', icon: 'moon' },
  { id: 'kosher', label: 'Kosher', icon: 'hexagram' },
  { id: 'pescatarian', label: 'Pescatarian', icon: 'fish' },
  { id: 'shellfish-allergy', label: 'Shellfish Allergy', icon: 'shell' },
  { id: 'egg-free', label: 'Egg-Free', icon: 'egg' },
  { id: 'soy-free', label: 'Soy-Free', icon: 'bean' },
];
const RESTRICTION_IDS = new Set(RESTRICTIONS.map((r) => r.id));

const CONTAINS = new Set(['meat', 'pork', 'fish', 'shellfish', 'dairy', 'egg', 'gluten', 'nuts', 'soy', 'sesame', 'alcohol', 'honey']);
const ANIMAL = ['meat', 'fish', 'shellfish', 'dairy', 'egg', 'honey'];

function has(dish, cat) {
  if (cat === 'meat') return dish.contains.includes('meat') || dish.contains.includes('pork');
  return dish.contains.includes(cat);
}
const hasAny = (dish, cats) => cats.some((c) => has(dish, c));

const RULES = {
  vegan: (d) => !hasAny(d, ANIMAL),
  vegetarian: (d) => !hasAny(d, ['meat', 'fish', 'shellfish']),
  pescatarian: (d) => !has(d, 'meat'),
  'gluten-free': (d) => !has(d, 'gluten'),
  'dairy-free': (d) => !has(d, 'dairy'),
  'egg-free': (d) => !has(d, 'egg'),
  'soy-free': (d) => !has(d, 'soy'),
  keto: (d) => d.carbs <= KETO_CARB_LIMIT,
  'nut-allergy': (d) => !has(d, 'nuts'),
  'shellfish-allergy': (d) => !has(d, 'shellfish'),
  // Meat must come from a halal-certified kitchen; no pork or alcohol anywhere.
  halal: (d, r) => !hasAny(d, ['pork', 'alcohol']) && (!has(d, 'meat') || !!r.halal),
  // Kosher is only trusted from kosher-certified kitchens.
  kosher: (d, r) => !!r.kosher && !hasAny(d, ['pork', 'shellfish']),
};

// ---------------------------------------------------------------------------
// Text normalisation for free-form "avoid" / "love" tags
// ---------------------------------------------------------------------------

function singular(w) {
  if (w.length <= 3) return w;
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.endsWith('oes')) return w.slice(0, -2);
  if (w.endsWith('ches') || w.endsWith('shes')) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  return w;
}

function normWords(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(singular);
}

/** "No Mushrooms" -> "mushroom", "Thai food" -> "thai food" */
function normTerm(s) {
  let words = normWords(s);
  while (words.length > 1 && ['no', 'avoid', 'without', 'love', 'like', 'extra'].includes(words[0])) words = words.slice(1);
  if (words.length === 1 && words[0] === 'no') return '';
  return words.join(' ');
}

const textOf = (parts) => ' ' + parts.map((p) => normWords(p).join(' ')).join(' | ') + ' ';
const textHas = (text, phrase) => text.includes(' ' + phrase + ' ');

const SPICY_TERMS = new Set(['spicy', 'spice', 'heat', 'hot', 'spicy food', 'chili', 'chile']);

// Terms that map onto allergen/diet categories rather than ingredient words.
const CATEGORY_TERMS = {
  seafood: ['fish', 'shellfish'],
  fish: ['fish'],
  shellfish: ['shellfish'],
  meat: ['meat'],
  'red meat': ['meat'],
  pork: ['pork'],
  dairy: ['dairy'],
  milk: ['dairy'],
  lactose: ['dairy'],
  egg: ['egg'],
  gluten: ['gluten'],
  wheat: ['gluten'],
  nut: ['nuts'],
  'tree nut': ['nuts'],
  soy: ['soy'],
  sesame: ['sesame'],
  alcohol: ['alcohol'],
  wine: ['alcohol'],
  honey: ['honey'],
};

// Ingredient/menu words that should also count for a term.
const SYNONYMS = {
  cilantro: ['cilantro', 'coriander'],
  coriander: ['cilantro', 'coriander'],
  mushroom: ['mushroom', 'shiitake', 'truffle', 'shroomami'],
  onion: ['onion', 'shallot'],
  cheese: ['cheese', 'mozzarella', 'parmesan', 'feta', 'paneer', 'halloumi', 'cotija', 'provolone', 'cheddar', 'gruyere', 'ayib', 'quesadilla'],
  beef: ['beef', 'steak', 'pastrami', 'brisket', 'ribeye', 'oxtail', 'bulgogi', 'galbi', 'kitfo'],
  tomato: ['tomato', 'marinara', 'pico de gallo'],
  avocado: ['avocado', 'guacamole'],
  eggplant: ['eggplant', 'baba ganoush', 'moussaka'],
  pepper: ['pepper', 'bell pepper', 'jalapeno'],
  noodle: ['noodle', 'ramen', 'pho', 'pad thai', 'pad see ew', 'japchae', 'vermicelli', 'penne', 'pasta', 'macaroni', 'zoodle'],
  pasta: ['pasta', 'penne', 'macaroni'],
  curry: ['curry', 'masala', 'korma', 'rogan josh', 'wat'],
  sandwich: ['sandwich', 'hero', 'banh mi', 'wrap', 'reuben', 'roll'],
  soup: ['soup', 'pho', 'ramen', 'jjigae', 'soondubu', 'stew'],
  pizza: ['pizza', 'margherita'],
  dumpling: ['dumpling', 'gyoza'],
  sushi: ['sushi', 'sashimi', 'poke'],
  chicken: ['chicken', 'doro'],
  burger: ['burger', 'patty'],
  taco: ['taco', 'tostada'],
  vegan: ['vegan', 'plant based'],
  healthy: ['healthy', 'salad', 'bowl'],
  bbq: ['bbq', 'barbecue', 'grill'],
};

const expandTerm = (term) => (SYNONYMS[term] || [term]).map((w) => normWords(w).join(' '));

/** Does this dish contain / feature the given (normalised) term? */
function dishMatchesTerm(dish, term) {
  if (SPICY_TERMS.has(term)) return dish.spice >= 2;
  const cats = CATEGORY_TERMS[term];
  if (cats) return cats.some((c) => has(dish, c));
  return expandTerm(term).some((w) => textHas(dish._text, w));
}

function restaurantMatchesTerm(r, term) {
  if (SPICY_TERMS.has(term) || CATEGORY_TERMS[term]) return false; // decided at dish level
  return expandTerm(term).some((w) => textHas(r._text, w));
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

function loadCatalog(raw) {
  if (!raw || !raw.area || !Array.isArray(raw.restaurants)) throw new Error('restaurants.json must have "area" and "restaurants"');
  const seen = new Set();
  const restaurants = raw.restaurants.map((r) => {
    if (!r.id || seen.has(r.id)) throw new Error(`Restaurant id missing or duplicated: ${r.id}`);
    seen.add(r.id);
    for (const k of ['name', 'cuisine', 'price', 'rating', 'lat', 'lng', 'hours', 'menu']) {
      if (r[k] === undefined) throw new Error(`Restaurant ${r.id} is missing "${k}"`);
    }
    const menu = r.menu.map((d, i) => {
      const contains = (d.contains || []).map(String);
      for (const c of contains) if (!CONTAINS.has(c)) throw new Error(`${r.id} / ${d.name}: unknown "contains" value "${c}"`);
      for (const k of ['name', 'calories', 'carbs']) if (d[k] === undefined) throw new Error(`${r.id} / ${d.name}: missing "${k}"`);
      return {
        ...d,
        id: `${r.id}:${i}`,
        contains,
        spice: Number(d.spice) || 0,
        ingredients: d.ingredients || [],
        _text: textOf([d.name, ...(d.ingredients || [])]),
      };
    });
    return { ...r, tags: r.tags || [], menu, _text: textOf([r.name, r.cuisine, ...(r.tags || [])]) };
  });
  return { area: raw.area, restaurants };
}

// ---------------------------------------------------------------------------
// Geometry & time
// ---------------------------------------------------------------------------

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const walkMinutes = (a, b) => (haversineMeters(a, b) * ROUTE_FACTOR) / WALK_METERS_PER_MIN;

function minutesOfDay(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return (get('hour') % 24) * 60 + get('minute');
}
const hhmm = (s) => {
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + (m || 0);
};

function isOpenAt(hours, date, timeZone) {
  if (!hours) return true;
  const open = hhmm(hours.open);
  let close = hhmm(hours.close);
  if (close <= open) close += 1440; // closes after midnight
  const t = minutesOfDay(date, timeZone);
  return (t >= open && t < close) || (t + 1440 >= open && t + 1440 < close);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x) => Math.round(clamp01(x) * 100);
const OPTION_CURVE = [0, 0.55, 0.75, 0.9, 1];

/** Fairness-weighted: the least-happy member drags the group score down. */
function groupFit(scores) {
  if (!scores.length) return 0;
  return 0.6 * avg(scores) + 0.4 * Math.min(...scores);
}
const ratingNorm = (r) => clamp01((Number(r.rating) - 3.5) / 1.5);
const proximity = (walk, maxWalk) => clamp01(1 - walk / Math.max(maxWalk, 5));

function preparePerson(member) {
  const p = member.profile || {};
  const likes = [];
  for (const label of p.likes || []) {
    const term = normTerm(label);
    if (term && !likes.some((l) => l.term === term)) likes.push({ label, term });
  }
  return {
    id: member.id,
    restrictions: (p.restrictions || []).filter((id) => RULES[id]),
    calMin: Number.isFinite(p.calMin) ? p.calMin : 0,
    calMax: Number.isFinite(p.calMax) ? p.calMax : Infinity,
    dislikes: [...new Set((p.dislikes || []).map(normTerm).filter(Boolean))],
    likes,
  };
}

function dishFits(dish, restaurant, person) {
  for (const id of person.restrictions) if (!RULES[id](dish, restaurant)) return false;
  if (dish.calories < person.calMin || dish.calories > person.calMax) return false;
  for (const term of person.dislikes) if (dishMatchesTerm(dish, term)) return false;
  return true;
}

function evaluate(restaurant, person) {
  const mid = Number.isFinite(person.calMax) ? (person.calMin + person.calMax) / 2 : person.calMin + 400;
  const fitting = restaurant.menu
    .filter((d) => dishFits(d, restaurant, person))
    .map((d) => ({ d, liked: person.likes.filter((l) => dishMatchesTerm(d, l.term)) }));

  const hits = new Map();
  if (fitting.length) {
    for (const l of person.likes) if (restaurantMatchesTerm(restaurant, l.term)) hits.set(l.term, l.label);
    for (const f of fitting) for (const l of f.liked) hits.set(l.term, l.label);
  }
  const likeScore = person.likes.length ? hits.size / person.likes.length : 0.6;
  const count = fitting.length;
  const score = count ? 0.75 * OPTION_CURVE[Math.min(count, 4)] + 0.25 * likeScore : 0;

  fitting.sort((a, b) => b.liked.length - a.liked.length || Math.abs(a.d.calories - mid) - Math.abs(b.d.calories - mid));
  return {
    memberId: person.id,
    count,
    score,
    likeHits: [...hits.values()],
    dishes: fitting.map(({ d, liked }) => ({
      id: d.id,
      name: d.name,
      calories: d.calories,
      price: d.price,
      spice: d.spice,
      liked: liked.length > 0,
    })),
  };
}

const publicEval = (e) => ({
  memberId: e.memberId,
  count: e.count,
  fit: pct(e.score),
  likeHits: e.likeHits,
  dishes: e.dishes.slice(0, 8),
});

function summary(x) {
  const r = x.r;
  return {
    id: r.id,
    name: r.name,
    cuisine: r.cuisine,
    tags: r.tags,
    price: r.price,
    rating: r.rating,
    reviews: r.reviews,
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    blurb: r.blurb,
    hours: r.hours,
    halal: !!r.halal,
    kosher: !!r.kosher,
    walk: Math.max(1, Math.round(x.walk)),
    open: x.open,
  };
}

// ---------------------------------------------------------------------------
// Multi-Stop: cover the whole party with 2 (or 3) nearby restaurants
// ---------------------------------------------------------------------------

function buildPlan(stops, people, settings) {
  stops = [...stops].sort((a, b) => a.walk - b.walk);
  const legs = stops.map((s, i) => (i === 0 ? s.walk : walkMinutes(stops[i - 1].r, s.r)));
  const between = legs.slice(1).reduce((a, b) => a + b, 0);
  if (between > (stops.length === 2 ? MAX_HOP_MIN : MAX_ROUTE_MIN)) return null;

  const assign = people.map((_, k) => {
    let best = -1;
    let bestScore = 0;
    stops.forEach((s, si) => {
      const e = s.evals[k];
      if (e.count > 0 && e.score > bestScore + 1e-9) {
        best = si;
        bestScore = e.score;
      }
    });
    return { best, bestScore };
  });
  if (assign.some((a) => a.best < 0)) return null; // someone is still uncovered
  if (stops.some((_, si) => !assign.some((a) => a.best === si))) return null; // a stop nobody needs

  const fit = groupFit(assign.map((a) => a.bestScore));
  const score =
    0.6 * fit +
    0.2 * (1 - between / MAX_ROUTE_MIN) +
    0.1 * avg(stops.map((s) => ratingNorm(s.r))) +
    0.1 * avg(stops.map((s) => proximity(s.walk, settings.maxWalk))) -
    0.05 * (stops.length - 2);

  return {
    score,
    plan: {
      id: 'm:' + stops.map((s) => s.r.id).join('+'),
      fit: pct(fit),
      between: Math.max(1, Math.round(between)),
      stops: stops.map((s, si) => ({
        restaurant: summary(s),
        walkFromPrev: Math.max(1, Math.round(legs[si])),
        members: people.map((_, k) => (assign[k].best === si ? publicEval(s.evals[k]) : null)).filter(Boolean),
      })),
    },
  };
}

function planMultiStops(candidates, people, settings) {
  if (people.length < 2) return [];
  const sorted = [...candidates].sort((a, b) => b.covered - a.covered || b.fit - a.fit);
  const plans = [];
  const pool = sorted.slice(0, 24);
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const built = buildPlan([pool[i], pool[j]], people, settings);
      if (built) plans.push(built);
    }
  }
  if (!plans.length) {
    const small = sorted.slice(0, 15);
    for (let i = 0; i < small.length; i++)
      for (let j = i + 1; j < small.length; j++)
        for (let k = j + 1; k < small.length; k++) {
          const built = buildPlan([small[i], small[j], small[k]], people, settings);
          if (built) plans.push(built);
        }
  }
  plans.sort((a, b) => b.score - a.score);
  return plans.slice(0, MAX_PLANS).map((p) => p.plan);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * @param catalog  result of loadCatalog()
 * @param members  [{ id, profile: { restrictions, calMin, calMax, dislikes, likes } }]
 * @param settings { maxWalk, maxPrice, openNow }
 * @param now      Date used for opening hours
 */
function computeMatches(catalog, members, settings, now = new Date()) {
  const { area, restaurants } = catalog;
  const people = members.map(preparePerson);

  const all = restaurants.map((r) => {
    const walk = walkMinutes(area.center, r);
    const open = isOpenAt(r.hours, now, area.timezone);
    const inRange = Math.round(walk) <= settings.maxWalk && r.price <= settings.maxPrice && (!settings.openNow || open);
    const evals = people.map((p) => evaluate(r, p));
    const covered = evals.filter((e) => e.count > 0).length;
    return { r, walk, open, inRange, evals, covered, fit: groupFit(evals.map((e) => e.score)) };
  });

  const pool = all.filter((x) => x.inRange);
  const rank = (x) => 0.7 * x.fit + 0.15 * ratingNorm(x.r) + 0.15 * proximity(x.walk, settings.maxWalk);

  const full = pool.filter((x) => people.length && x.covered === people.length).sort((a, b) => rank(b) - rank(a));
  const matches = full.slice(0, MAX_MATCHES).map((x) => ({
    id: 'r:' + x.r.id,
    fit: pct(x.fit),
    restaurant: summary(x),
    members: x.evals.map(publicEval),
  }));

  const partial = pool.filter((x) => x.covered > 0 && x.covered < people.length);
  const multiStops = planMultiStops(partial, people, settings);

  const diagnostics = {
    totalRestaurants: all.length,
    inRange: pool.length,
    fullMatches: full.length,
    members: people.map((p, k) => ({
      memberId: p.id,
      inRange: pool.filter((x) => x.evals[k].count > 0).length,
      anywhere: all.filter((x) => x.evals[k].count > 0).length,
    })),
  };

  return { matches, multiStops, diagnostics };
}

module.exports = {
  RESTRICTIONS,
  RESTRICTION_IDS,
  KETO_CARB_LIMIT,
  loadCatalog,
  computeMatches,
  normTerm,
  dishFits: (dish, restaurant, member) => dishFits(dish, restaurant, preparePerson(member)),
  isOpenAt,
  walkMinutes,
};
