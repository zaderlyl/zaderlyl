// Génère "commit-cannon.svg" : un canon FIXE dans le coin, qui pivote pour
// viser chaque case de la vraie grille de contributions GitHub, et tire un
// carré coloré qui va se poser directement sur son emplacement, au moment
// chronologique de chaque commit. Fait maison — pas une lib tierce.
//
// Aucune dépendance : Node 20+ (fetch global). Lancé par GitHub Actions,
// mais testable en local : GITHUB_TOKEN=$(gh auth token) node scripts/commit-cannon.mjs zaderlyl

import { writeFile } from "node:fs/promises";

const token = process.env.GITHUB_TOKEN;
const user = process.argv[2] || process.env.GITHUB_REPOSITORY_OWNER;
if (!token || !user) {
  console.error("Usage: GITHUB_TOKEN=... node commit-cannon.mjs <username>");
  process.exit(1);
}

// --- récupération de la vraie grille de contributions (API GraphQL) ---
const query = `
query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        weeks { contributionDays { date contributionCount contributionLevel } }
      }
    }
  }
}`;
const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "commit-cannon",
  },
  body: JSON.stringify({ query, variables: { login: user } }),
});
if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
const json = await res.json();
if (json.errors) throw new Error(JSON.stringify(json.errors));
const weeks = json.data.user.contributionsCollection.contributionCalendar.weeks;

// --- géométrie de la grille (mêmes proportions que la vraie grille GitHub) ---
const CELL = 10, GAP = 3, PITCH = CELL + GAP;
const PAD_TOP = 8, PAD_LEFT = 8, PAD_RIGHT = 8, PAD_BOTTOM = 8;
const cols = weeks.length;
const gridWidth = cols * PITCH - GAP;
const gridHeight = 7 * PITCH - GAP;
const width = PAD_LEFT + gridWidth + PAD_RIGHT;
const height = PAD_TOP + gridHeight + PAD_BOTTOM;

const cellX = (col) => PAD_LEFT + col * PITCH;
const cellY = (row) => PAD_TOP + row * PITCH;

// Canon planté dans le coin bas-gauche, juste sous la grille.
const CANNON_X = PAD_LEFT;
const CANNON_Y = PAD_TOP + gridHeight + PAD_BOTTOM / 2 + 2;

const LEVEL_COLOR = {
  NONE: "#161b22",
  FIRST_QUARTILE: "#4a2e0f",
  SECOND_QUARTILE: "#8a4d0d",
  THIRD_QUARTILE: "#ff9100",
  FOURTH_QUARTILE: "#ffb84d",
};

// --- aplatir en jours chronologiques avec position de grille ---
const days = [];
weeks.forEach((w, col) => {
  w.contributionDays.forEach((d) => {
    const row = new Date(`${d.date}T00:00:00Z`).getUTCDay(); // 0=dim .. 6=sam
    days.push({ col, row, count: d.contributionCount, level: d.contributionLevel });
  });
});
const activeDays = days.filter((d) => d.count > 0);
const totalActive = Math.max(activeDays.length, 1);

// --- calage temporel ---
const CYCLE = 26;                 // durée totale d'une boucle, en secondes
const ACTIVE_SPAN = CYCLE * 0.9;  // le tir s'arrête un peu avant la fin (pause avant relance)
const EPS = 0.05;                 // marge en % pour simuler un "saut" instantané
const SHOT_LEAD = 0.24;           // temps de vol d'un obus, en secondes

activeDays.forEach((d, i) => {
  d.t = (i / totalActive) * ACTIVE_SPAN;
  d.tx = cellX(d.col) + CELL / 2;
  d.ty = cellY(d.row) + CELL / 2;
  d.angle = (Math.atan2(d.ty - CANNON_Y, d.tx - CANNON_X) * 180) / Math.PI;
});

const pct = (t) => (t / CYCLE) * 100;

// --- CSS : rotation du canon (saut net d'une cible à l'autre, avec un temps de visée) ---
const turretFrames = [];
if (activeDays.length) {
  turretFrames.push(`0% { transform: rotate(${activeDays[0].angle.toFixed(2)}deg); }`);
  for (let i = 0; i < activeDays.length; i++) {
    const d = activeDays[i];
    const nextT = i + 1 < activeDays.length ? activeDays[i + 1].t : ACTIVE_SPAN;
    turretFrames.push(`${pct(d.t).toFixed(3)}% { transform: rotate(${d.angle.toFixed(2)}deg); }`);
    turretFrames.push(`${Math.max(pct(d.t), pct(nextT) - EPS).toFixed(3)}% { transform: rotate(${d.angle.toFixed(2)}deg); }`);
  }
  turretFrames.push(`100% { transform: rotate(${activeDays.at(-1).angle.toFixed(2)}deg); }`);
}
const turretKeyframes = turretFrames.length ? `@keyframes turretAim {\n  ${turretFrames.join("\n  ")}\n}` : "";

// --- cases de fond (toujours au niveau "vide" — les obus viennent se poser dessus) ---
let cellRects = "";
days.forEach((d) => {
  cellRects += `<rect x="${cellX(d.col)}" y="${cellY(d.row)}" width="${CELL}" height="${CELL}" rx="2" fill="${LEVEL_COLOR.NONE}"/>\n`;
});

// --- obus : carrés qui décollent du canon, filent vers leur case et s'y posent (restent visibles) ---
let shotEls = "";
let shotKeyframes = "";
activeDays.forEach((d, i) => {
  const name = `shot${i}`;
  const size = CELL - 2;
  const startX = CANNON_X - size / 2, startY = CANNON_Y - size / 2;
  const dx = d.tx - CANNON_X, dy = d.ty - CANNON_Y;
  const arrive = pct(d.t);
  const leave = pct(Math.max(0, d.t - SHOT_LEAD));
  shotKeyframes += `@keyframes ${name} {\n` +
    `  0% { opacity: 0; transform: translate(0px,0px) scale(0.4); }\n` +
    `  ${leave.toFixed(3)}% { opacity: 0; transform: translate(0px,0px) scale(0.4); }\n` +
    `  ${Math.min(leave + EPS, arrive).toFixed(3)}% { opacity: 1; transform: translate(0px,0px) scale(0.4); }\n` +
    `  ${arrive.toFixed(3)}% { opacity: 1; transform: translate(${dx.toFixed(2)}px,${dy.toFixed(2)}px) scale(1); }\n` +
    `  100% { opacity: 1; transform: translate(${dx.toFixed(2)}px,${dy.toFixed(2)}px) scale(1); }\n` +
    `}\n`;
  shotEls += `<rect class="shot" x="${startX}" y="${startY}" width="${size}" height="${size}" rx="2" fill="${LEVEL_COLOR[d.level]}" style="animation: ${name} ${CYCLE}s linear infinite; opacity:0; transform-origin: ${CANNON_X}px ${CANNON_Y}px;"/>\n`;
});

// --- le canon lui-même : base fixe (attribut) + tourelle qui pivote (CSS) ---
// Deux <g> imbriqués, comme pour la version précédente : une animation CSS sur
// "transform" remplace l'attribut transform de l'élément au lieu de s'y
// ajouter. La base (position, attribut statique) doit donc être un groupe
// PARENT distinct du groupe animé (la tourelle, qui ne fait QUE pivoter
// autour de son propre pivot local, donc n'a pas besoin de translation).
const cannonSvg = `
<g transform="translate(${CANNON_X},${CANNON_Y})">
  <circle cx="0" cy="0" r="5" fill="#0d1117" stroke="#ff9100" stroke-width="1.4"/>
  <g class="turret" style="animation: turretAim ${CYCLE}s linear infinite; transform-origin: 0px 0px;">
    <rect x="0" y="-1.6" width="10" height="3.2" rx="1.4" fill="#ff9100"/>
  </g>
  <circle cx="0" cy="0" r="2" fill="#ffb84d"/>
</g>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<style>
rect { shape-rendering: crispEdges; }
${turretKeyframes}
${shotKeyframes}
</style>
<rect width="${width}" height="${height}" fill="#0d1117"/>
${cellRects}
${cannonSvg}
${shotEls}
</svg>`;

await writeFile("assets/commit-cannon.svg", svg);
console.log(`OK — ${days.length} jours, ${activeDays.length} tirs, canon fixe au coin (${CANNON_X},${CANNON_Y}), ${(svg.length / 1024).toFixed(0)} Ko`);
