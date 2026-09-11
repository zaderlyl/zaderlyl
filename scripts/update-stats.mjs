// Regenere assets/banner.svg (statique) et assets/stats.svg (donnees reelles)
// a partir de l'API GitHub. Aucune dependance externe, aucun service tiers.
//
// stats.svg : contributions des 12 derniers mois, streak actuelle, meilleure
// streak (calculees depuis le calendrier de contributions), et repartition
// des langages sur les depots publics (agregee depuis /repos/{r}/languages).

import { writeFile } from "node:fs/promises";

const USER = "zaderlyl";
const token = process.env.STATS_TOKEN || process.env.GITHUB_TOKEN;
const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "readme-stats-updater",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}
async function ghGraphql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`graphql: HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error("graphql: " + JSON.stringify(json.errors));
  return json.data;
}

// --- contributions + streaks ---
const data = await ghGraphql(
  `query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount } }
        }
      }
    }
  }`,
  { login: USER },
);
const cal = data.user.contributionsCollection.contributionCalendar;
const days = cal.weeks.flatMap((w) => w.contributionDays);
const total = cal.totalContributions;

let longest = 0, run = 0;
for (const d of days) { if (d.contributionCount > 0) { run++; longest = Math.max(longest, run); } else run = 0; }
let current = 0;
for (let i = days.length - 1; i >= 0; i--) {
  if (days[i].contributionCount > 0) current++;
  else if (i === days.length - 1) continue; // aujourd'hui peut etre encore a 0
  else break;
}

// --- langages (repos publics, hors fork, hors le depot de profil) ---
async function allRepos(user) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await gh(`/users/${user}/repos?type=owner&per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}
const repos = (await allRepos(USER)).filter(
  (r) => !r.fork && r.size > 0 && r.full_name.toLowerCase() !== `${USER}/${USER}`.toLowerCase(),
);
// Pas de vrais langages de programmation — exclus du calcul (docs, exports...).
const IGNORE = new Set(["Rich Text Format", "TeX", "Roff"]);
const totals = {};
for (const r of repos) {
  const langs = await gh(`/repos/${r.full_name}/languages`);
  for (const [lang, bytes] of Object.entries(langs)) {
    if (IGNORE.has(lang)) continue;
    totals[lang] = (totals[lang] || 0) + bytes;
  }
}
const sumBytes = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);

const LANG_COLOR = {
  CSS: "#563d7c", Rust: "#dea584", HTML: "#e34c26", JavaScript: "#f1e05a",
  Java: "#b07219", Shell: "#89e051", TypeScript: "#3178c6", Python: "#3572A5",
  PHP: "#4F5D95", Swift: "#F05138", C: "#555555", "C++": "#f34b7d",
};
const TOP_N = 6;
const top = sorted.slice(0, TOP_N);
const otherPct = 100 - top.reduce((s, [, b]) => s + (b / sumBytes) * 100, 0);

// --- build the stacked bar + legend svg fragments ---
const BAR_X = 24, BAR_W = 812;
let x = BAR_X;
const bars = [];
for (const [lang, bytes] of top) {
  const w = (bytes / sumBytes) * BAR_W;
  bars.push(`<rect x="${x.toFixed(1)}" y="190" width="${w.toFixed(1)}" height="14" fill="${LANG_COLOR[lang] || "#7b8394"}"/>`);
  x += w;
}
bars.push(`<rect x="${x.toFixed(1)}" y="190" width="${(BAR_X + BAR_W - x).toFixed(1)}" height="14" fill="#7b8394"/>`);

const legendEntries = [...top.map(([lang, bytes]) => [lang, (bytes / sumBytes) * 100, LANG_COLOR[lang] || "#7b8394"])];
if (otherPct > 0.05) legendEntries.push(["Autres", otherPct, "#7b8394"]);
const cols = [24, 240, 450];
const legend = legendEntries.map((entry, i) => {
  const [lang, pct, color] = entry;
  const col = cols[i % 3];
  const row = Math.floor(i / 3);
  const cy = 230 + row * 26;
  return `<circle cx="${col + 6}" cy="${cy}" r="5" fill="${color}"/>` +
    `<text x="${col + 18}" y="${cy + 4}" fill="#eef0f4">${lang}</text>` +
    `<text x="${col + 116}" y="${cy + 4}" fill="#7b8394">${pct.toFixed(1)}%</text>`;
}).join("\n        ");

const legendRows = Math.ceil(legendEntries.length / 3);
const svgHeight = 210 + legendRows * 26 + 40;

const streakFlame = (n) => (n > 0 ? " \u{1F525}" : "");

const stats = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 ${svgHeight}" width="860" height="${svgHeight}" role="img" aria-label="Statistiques GitHub de ${USER} : ${total} contributions sur 12 mois, streak actuelle ${current} jours, meilleure streak ${longest} jours">
  <defs>
    <linearGradient id="bg2" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#111318"/>
      <stop offset="1" stop-color="#0a0b0d"/>
    </linearGradient>
    <clipPath id="round2"><rect x="0" y="0" width="860" height="${svgHeight}" rx="14"/></clipPath>
  </defs>
  <g clip-path="url(#round2)">
    <rect width="860" height="${svgHeight}" fill="url(#bg2)"/>
    <rect x="0" y="0" width="860" height="36" fill="#1c1f26"/>
    <line x1="0" y1="36" x2="860" y2="36" stroke="#2a2e37" stroke-width="1"/>
    <circle cx="22" cy="18" r="5.5" fill="#e6675f"/>
    <circle cx="41" cy="18" r="5.5" fill="#e6b95f"/>
    <circle cx="60" cy="18" r="5.5" fill="#5fbf6e"/>
    <text x="430" y="23" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="12.5" fill="#7b8394">gh stats --user ${USER}</text>

    <g font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">
      <rect x="24" y="56" width="264" height="92" rx="10" fill="#14161b" stroke="#2a2e37"/>
      <text x="46" y="102" font-size="34" font-weight="700" fill="#3987e5">${total}</text>
      <text x="46" y="126" font-size="12.5" fill="#7b8394">contributions · 12 derniers mois</text>

      <rect x="298" y="56" width="264" height="92" rx="10" fill="#14161b" stroke="#2a2e37"/>
      <text x="320" y="102" font-size="34" font-weight="700" fill="#eda100">${current}${streakFlame(current)}</text>
      <text x="320" y="126" font-size="12.5" fill="#7b8394">jours · streak actuelle</text>

      <rect x="572" y="56" width="264" height="92" rx="10" fill="#14161b" stroke="#2a2e37"/>
      <text x="594" y="102" font-size="34" font-weight="700" fill="#4fbf8a">${longest}${streakFlame(longest)}</text>
      <text x="594" y="126" font-size="12.5" fill="#7b8394">jours · meilleure streak</text>

      <text x="24" y="178" font-size="13" fill="#aeb3bf">Langages les plus utilisés — ${repos.length} dépôts publics</text>
      ${bars.join("\n      ")}

      <g font-size="13" fill="#eef0f4">
        ${legend}
      </g>

      <text x="24" y="${svgHeight - 18}" font-size="11" fill="#4a4f5c">instanté · ${USER}/${USER} · régénéré via GitHub Actions</text>
    </g>
  </g>
  <rect x="0.5" y="0.5" width="859" height="${svgHeight - 1}" rx="14" fill="none" stroke="#2a2e37"/>
</svg>
`;

await writeFile("assets/stats.svg", stats);
console.log(`assets/stats.svg écrit — ${total} contributions, streak ${current}/${longest}, ${repos.length} repos, top langue: ${top[0]?.[0]}`);
