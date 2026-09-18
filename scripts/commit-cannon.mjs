// Génère "commit-cannon.svg" : un canon qui tire un obus sur chaque case
// de la vraie grille de contributions GitHub, au moment chronologique de
// chaque commit. Fait maison — pas une lib tierce — pour avoir exactement
// ce visuel (contrairement au serpent Platane/snk qu'il remplace).
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
const PAD_TOP = 8, PAD_LEFT = 8, PAD_RIGHT = 8;
const CANNON_TRACK_H = 30;
const cols = weeks.length;
const gridWidth = cols * PITCH - GAP;
const gridHeight = 7 * PITCH - GAP;
const width = PAD_LEFT + gridWidth + PAD_RIGHT;
const height = PAD_TOP + gridHeight + CANNON_TRACK_H;

const cellX = (col) => PAD_LEFT + col * PITCH;
const cellY = (row) => PAD_TOP + row * PITCH;
const groundY = PAD_TOP + gridHeight + CANNON_TRACK_H - 6;

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
const CYCLE = 26;        // durée totale d'une boucle, en secondes
const ACTIVE_SPAN = CYCLE * 0.86; // le tir s'arrête un peu avant la fin (pause avant relance)
const EPS = 0.05;        // marge en % pour simuler un "saut" instantané entre deux valeurs
const SHOT_LEAD = 0.22;  // temps de vol d'un obus, en secondes

activeDays.forEach((d, i) => {
  d.t = (i / totalActive) * ACTIVE_SPAN;
});

// une position de canon par colonne active (la première fois qu'elle tire)
const stopsMap = new Map();
for (const d of activeDays) if (!stopsMap.has(d.col)) stopsMap.set(d.col, d.t);
const stops = [...stopsMap.entries()].sort((a, b) => a[1] - b[1]);

const pct = (t) => (t / CYCLE) * 100;
const cannonX = (col) => cellX(col) + CELL / 2;

// --- CSS : déplacement du canon (saut net entre positions, avec temps d'arrêt) ---
// Valeurs ABSOLUES dans les keyframes, pas relatives : une animation CSS sur
// "transform" remplace entièrement l'attribut transform="..." de l'élément
// (même celui du tout premier keyframe), donc l'attribut ne peut pas servir
// de position de base ici — tout doit être porté par les keyframes eux-mêmes.
let cannonKeyframes = "";
const cannonHomeX = stops.length ? cannonX(stops[0][0]) : PAD_LEFT;
if (stops.length) {
  const frames = [];
  frames.push(`0% { transform: translateX(${cannonHomeX.toFixed(2)}px); }`);
  for (let i = 0; i < stops.length; i++) {
    const [col, t] = stops[i];
    const x = cannonX(col);
    const nextT = i + 1 < stops.length ? stops[i + 1][1] : ACTIVE_SPAN;
    frames.push(`${pct(t).toFixed(3)}% { transform: translateX(${x.toFixed(2)}px); }`);
    frames.push(`${Math.max(pct(t), pct(nextT) - EPS).toFixed(3)}% { transform: translateX(${x.toFixed(2)}px); }`);
  }
  frames.push(`100% { transform: translateX(${cannonX(stops.at(-1)[0]).toFixed(2)}px); }`);
  cannonKeyframes = `@keyframes cannonMove {\n  ${frames.join("\n  ")}\n}`;
}

// --- SVG : cases (avec leur animation de révélation) + obus tirés ---
let cellRects = "";
let cellKeyframes = "";
let shotEls = "";
let shotKeyframes = "";

days.forEach((d, i) => {
  const x = cellX(d.col), y = cellY(d.row);
  const dim = LEVEL_COLOR.NONE;
  if (d.count > 0) {
    const name = `r${i}`;
    const litAt = pct(d.t);
    cellKeyframes += `@keyframes ${name} { 0% { fill: ${dim}; } ${Math.max(0, litAt - EPS).toFixed(3)}% { fill: ${dim}; } ${litAt.toFixed(3)}% { fill: ${LEVEL_COLOR[d.level]}; } 100% { fill: ${LEVEL_COLOR[d.level]}; } }\n`;
    cellRects += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" style="animation: ${name} ${CYCLE}s linear infinite;"/>\n`;
  } else {
    cellRects += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${dim}"/>\n`;
  }
});

activeDays.forEach((d, i) => {
  const name = `shot${i}`;
  const startX = cannonX(d.col);
  const startY = groundY - 4;
  const targetX = cellX(d.col) + CELL / 2;
  const targetY = cellY(d.row) + CELL / 2;
  const dx = targetX - startX, dy = targetY - startY;
  const arrive = pct(d.t);
  const leave = pct(Math.max(0, d.t - SHOT_LEAD));
  shotKeyframes += `@keyframes ${name} {\n` +
    `  0% { opacity: 0; transform: translate(0px,0px); }\n` +
    `  ${leave.toFixed(3)}% { opacity: 0; transform: translate(0px,0px); }\n` +
    `  ${Math.min(leave + EPS, arrive).toFixed(3)}% { opacity: 1; transform: translate(0px,0px); }\n` +
    `  ${arrive.toFixed(3)}% { opacity: 1; transform: translate(${dx.toFixed(2)}px,${dy.toFixed(2)}px); }\n` +
    `  ${Math.min(arrive + EPS, 100).toFixed(3)}% { opacity: 0; transform: translate(${dx.toFixed(2)}px,${dy.toFixed(2)}px); }\n` +
    `  100% { opacity: 0; transform: translate(${dx.toFixed(2)}px,${dy.toFixed(2)}px); }\n` +
    `}\n`;
  shotEls += `<circle cx="${startX}" cy="${startY}" r="1.6" fill="#ffd9a0" style="animation: ${name} ${CYCLE}s linear infinite; opacity:0;"/>\n`;
});

// --- le canon lui-même (petit dessin : roue + canon incliné) ---
// Deux <g> imbriqués : l'extérieur pose la position Y (attribut SVG, fixe),
// l'intérieur gère le déplacement X (CSS). Nécessaire car une animation CSS
// sur "transform" REMPLACE l'attribut transform="translate(...)" au lieu de
// s'y ajouter — un seul groupe aurait perdu son décalage Y au premier frame.
const cannonSvg = `
<g transform="translate(0,${groundY})">
  <g class="cannon" style="animation: cannonMove ${CYCLE}s linear infinite;">
    <circle cx="0" cy="0" r="5.2" fill="#0d1117" stroke="#ff9100" stroke-width="1.4"/>
    <rect x="-1.6" y="-11" width="3.2" height="9" rx="1.4" fill="#ff9100" transform="rotate(-18 0 -2)"/>
  </g>
</g>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<style>
rect { shape-rendering: crispEdges; }
${cannonKeyframes}
${cellKeyframes}
${shotKeyframes}
</style>
<rect width="${width}" height="${height}" fill="#0d1117"/>
${cellRects}
${shotEls}
${cannonSvg}
<line x1="${PAD_LEFT - 2}" y1="${groundY + 1}" x2="${PAD_LEFT + gridWidth + 2}" y2="${groundY + 1}" stroke="#30363d" stroke-width="1"/>
</svg>`;

await writeFile("assets/commit-cannon.svg", svg);
console.log(`OK — ${days.length} jours, ${activeDays.length} tirs, ${stops.length} arrêts du canon, ${(svg.length / 1024).toFixed(0)} Ko`);
