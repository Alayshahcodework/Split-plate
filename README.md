# Split Plate

**Less thinking. More eating.** Split Plate is a group restaurant matcher. Everyone in a party adds their own dietary restrictions, allergies, calorie target and dislikes from their phone. The app compares the whole party and suggests a few restaurants where *every* person has something to order. The group then rates the shortlist and the host locks in the pick. If no single place works, a **Multi-Stop** backup plan pairs nearby restaurants so everyone can grab food and still eat together.

## How it works

| Tab | What happens |
| --- | --- |
| **My Diets** (step 1 of 2) | Pick restrictions and allergies (vegan, vegetarian, gluten-free, dairy-free, keto, nut allergy, halal, kosher, pescatarian, shellfish allergy, egg-free, soy-free), set a min/max calorie target per meal, and add **Avoid** tags (e.g. "No Cilantro") and **Love** tags (e.g. "Spicy", "Thai"). |
| **Lobby** (step 2 of 2) | Share the group code (`SPLIT-1234`), link or QR code. See everyone's rules side by side, spot conflicts, and let the host set max walk, budget and "open now". Then hit **Find our matches**. |
| **Matches** | A few restaurants (top 3, up to 6) where everyone has at least one dish. Each shows a group-fit score, what each person can order, and star ratings from the group. The group favorite rises to the top and the host locks it in. Everyone sees it live. |
| **Multi-Stop** | The backup plan for zero matches: 2 (or 3) restaurants within a short walk of each other that together cover everyone, with who orders where. |

### Matching rules

- **Hard rules** (a dish only counts for you if it passes all of these):
  - Your restrictions. Keto means ≤ 20 g carbs per dish. Halal meat must come from a halal-certified kitchen. Kosher only counts kosher-certified kitchens.
  - Your calorie range.
  - Your Avoid tags. "Seafood" also catches fish sauce and oyster sauce, and "Egg" doesn't match "eggplant".
- **Soft preferences:** Love tags boost restaurants (by cuisine or tags) and dishes (by ingredients, or spice level for "Spicy").
- **Ranking:** a restaurant's group fit weighs the *least-happy* member heavily, so one person with a single sad option drags it down. The final rank also mixes in the restaurant's rating and how close it is.
- **Group favorite:** total stars divided by everyone who could vote, so one lone 5★ can't beat a place the whole party rated 4★.

Everything runs on the server, and the code lives in [backend/lib/matcher.js](backend/lib/matcher.js).

## Run it locally

Requires Node.js 18.17+ and has no dependencies to install.

```bash
cd split-plate
npm start          # http://localhost:3000
npm test           # matcher + API tests
```

To try a group on your own, open the site, start a group, save your profile, then use **Add a sample friend** in the Lobby. Sample friends come with their own diets and rate options automatically. To test with two real people, open the invite link in a second browser (or a private window).

## Deploy

It's a single Node web service. Group state lives in memory and is snapshotted to `DATA_DIR/rooms.json`, so **run exactly one instance**. Static-only hosts (Netlify, GitHub Pages) won't work, and neither will serverless functions such as Vercel, because live group sync needs a long-running server.

### Render (easiest)

1. Push this folder to a GitHub repo.
2. In Render: **New → Blueprint**, pick the repo. It reads [render.yaml](render.yaml).
3. Done. Render gives you an `https://split-plate-xxxx.onrender.com` URL.

On Render's free plan the service sleeps when idle and loses active groups on restart. That's fine for a demo. For a real launch, use a paid instance and add a disk mounted at `/data` with `DATA_DIR=/data`.

### Railway

New Project → Deploy from GitHub repo. Railway detects Node and runs `npm start`. Optionally add a volume at `/data` and set `DATA_DIR=/data`.

### Docker / Fly.io / any VPS

```bash
docker build -t split-plate .
docker run -p 3000:3000 -v split-plate-data:/data split-plate
```

On Fly.io, `fly launch` uses the Dockerfile. Keep it to one machine and mount a volume at `/data`.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on (hosts set this for you) |
| `DATA_DIR` | `./.data` | Where active groups are saved between restarts |
| `ROOM_TTL_HOURS` | `24` | Idle groups are deleted after this long |
| `RESTAURANTS_FILE` | `backend/data/restaurants.json` | Swap in your own restaurant/menu data |

## Restaurant and menu data

[backend/data/restaurants.json](backend/data/restaurants.json) ships with **17 sample restaurants around Washington Square Park ("NYC Campus")**. The names, menus, calories and allergens are made up for demonstration. To use real places, edit the file and redeploy. The server validates it on startup and refuses to start if something is malformed.

```jsonc
{
  "area": { "name": "NYC Campus", "centerLabel": "Washington Square Park",
            "center": { "lat": 40.7308, "lng": -73.9973 }, "timezone": "America/New_York" },
  "restaurants": [{
    "id": "saffron-lane", "name": "Saffron Lane", "cuisine": "Indian",
    "tags": ["curry", "tandoori"],            // used by Love tags
    "price": 2, "rating": 4.6, "reviews": 812,
    "address": "Bleecker St & Thompson St", "lat": 40.7299, "lng": -74.0002,
    "hours": { "open": "11:30", "close": "22:30" },   // close may be after midnight, e.g. "02:00"
    "halal": true, "kosher": false,           // kitchen certifications
    "blurb": "One-line description",
    "menu": [{
      "name": "Chana Masala with Rice", "calories": 620, "carbs": 92, "price": 15,
      "spice": 2,                             // 0-3; 2+ counts as spicy
      "contains": [],                         // meat, pork, fish, shellfish, dairy, egg, gluten, nuts, soy, sesame, alcohol, honey
      "ingredients": ["chickpeas", "tomato", "cilantro"]   // used by Avoid/Love tags
    }]
  }]
}
```

Walking time is estimated from straight-line distance (×1.3 for city blocks, 80 m/min). Always tell diners to confirm allergens with staff. The app shows this disclaimer on every results page.

## Project layout

```
split-plate/
├── backend/                  Node server (no dependencies)
│   ├── server.js             HTTP server: JSON API, live updates (Server-Sent Events), persistence,
│   │                         and serves the frontend folder
│   ├── lib/matcher.js        Matching engine: diet rules, calorie windows, tags, scoring, Multi-Stop
│   ├── data/restaurants.json Restaurant + menu dataset
│   └── test/                 node:test suites for the matcher and the API
├── frontend/                 The website (plain HTML/CSS/JS, no build step)
│   ├── index.html
│   ├── app.js                All four tabs, live sync, voting, invite sheet
│   ├── styles.css
│   ├── favicon.svg, site.webmanifest
│   └── vendor/qrcode.min.js  QR code generator (MIT)
├── package.json              npm start / npm test (run from this folder)
├── render.yaml, Dockerfile, Procfile   Deployment configs
└── README.md
```

The backend serves the frontend from the same address, so the site's `/api/...` calls need no extra configuration. Deploy the whole `split-plate` folder as one service.

## API (for reference)

All group actions are `POST /api/rooms/:code/<action>` with `X-Member-Id` / `X-Member-Token` headers (issued when you create or join).

- `POST /api/rooms`: create a group → `{ code, memberId, token, room }`
- `POST /api/rooms/:code/join`: join → `{ memberId, token, room }`
- `profile` · `settings` (host) · `match` · `vote` · `decide` (host) · `demo` · `remove` (host) · `leave` · `me`
- `GET /api/rooms/:code/events?m=&t=`: live room updates (SSE)
- `GET /api/meta`, `GET /api/health`
