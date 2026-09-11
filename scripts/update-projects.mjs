// Régénère le tableau "Projets" du README + assets/projects.svg.
// - liste TOUS les repos publics de l'utilisateur (+ ceux de config.include)
// - triés par date de dernière modification, le plus récent en haut
// - un repo créé ou modifié remonte donc automatiquement au prochain passage
// - pour chaque repo : commits, branches, et l'activité réelle des 8
//   dernières semaines, dessinée en barres dans assets/projects.svg
//
// Aucune dépendance : Node 20+ (fetch global). Lancé par GitHub Actions.

import { readFile, writeFile } from "node:fs/promises";

const README = "README.md";
const CONFIG = "projects.config.json";
const SVG_OUT = "assets/projects.svg";
const START = "<!-- PROJECTS:START -->";
const END = "<!-- PROJECTS:END -->";

const token = process.env.GITHUB_TOKEN;
const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "readme-updater",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

async function ghRaw(path) {
  return fetch(`https://api.github.com${path}`, { headers });
}
async function gh(path) {
  const res = await ghRaw(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function getAllUserRepos(user) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await gh(`/users/${user}/repos?type=owner&sort=pushed&per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

// Nombre total de commits (branche par défaut) : GitHub ne l'expose pas
// directement, mais la pagination le donne — dernière page d'1 commit/page.
async function getCommitCount(fullName) {
  const res = await ghRaw(`/repos/${fullName}/commits?per_page=1`);
  if (!res.ok) return null;
  const link = res.headers.get("link");
  if (!link) return 1;
  const m = /page=(\d+)>;\s*rel="last"/.exec(link);
  return m ? Number(m[1]) : null;
}

async function getBranchCount(fullName) {
  try {
    const branches = await gh(`/repos/${fullName}/branches?per_page=100`);
    return branches.length;
  } catch {
    return null;
  }
}

// Commits par semaine sur les 52 dernières semaines. Calcul asynchrone côté
// GitHub : un 202 veut dire "pas encore prêt", on retente un peu avant
// d'abandonner pour ce passage (elle sera prête au prochain, GitHub la
// garde en cache une fois calculée).
async function getWeeklyActivity(fullName) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await ghRaw(`/repos/${fullName}/stats/commit_activity`);
    if (res.status === 202) {
      await new Promise((r) => setTimeout(r, 2500));
      continue;
    }
    if (!res.ok) return null;
    const weeks = await res.json();
    if (!Array.isArray(weeks) || weeks.length === 0) return null;
    return weeks.slice(-8).map((w) => w.total);
  }
  return null;
}

function fmtDate(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}
function escapeCell(s) {
  return String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}
function escapeXml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}
function lerpColor(hexA, hexB, t) {
  const a = [1, 3, 5].map((i) => parseInt(hexA.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(hexB.slice(i, i + 2), 16));
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// --- config ---
const config = JSON.parse(await readFile(CONFIG, "utf8"));
const user = config.user;
const exclude = new Set((config.exclude ?? []).map((s) => s.toLowerCase()));
exclude.add(`${user}/${user}`.toLowerCase());
const overrides = config.overrides ?? {};

// --- récupération repos ---
const owned = await getAllUserRepos(user);
const extra = await Promise.all(
  (config.include ?? []).map((full) => gh(`/repos/${full}`).catch((e) => {
    console.error(`skip include ${full}: ${e.message}`);
    return null;
  })),
);

const seen = new Set();
const repos = [...owned, ...extra.filter(Boolean)]
  .filter((r) => {
    if (!r || seen.has(r.full_name.toLowerCase())) return false;
    seen.add(r.full_name.toLowerCase());
    if (exclude.has(r.full_name.toLowerCase())) return false;
    if (r.size === 0) return false;
    if (r.fork && !config.includeForks) return false;
    if (r.archived && !config.includeArchived) return false;
    if (r.private) return false;
    return true;
  })
  .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at));

// --- données par repo (séquentiel : la stats API n'aime pas les rafales) ---
const items = [];
for (const r of repos) {
  const ov = overrides[r.full_name] ?? {};
  const desc = ov.note || r.description || "(pas encore de description)";
  const stackLabel = ov.stack || r.language || "";

  const [commits, branches, weeks] = await Promise.all([
    getCommitCount(r.full_name),
    getBranchCount(r.full_name),
    getWeeklyActivity(r.full_name),
  ]);

  items.push({ repo: r, desc, stackLabel, commits, branches, weeks });
  console.log(`ok   ${r.full_name}  commits=${commits ?? "—"} branches=${branches ?? "—"} weeks=${weeks ? weeks.join(",") : "n/a"}`);
}

// --- tableau markdown ---
const rows = items.map(({ repo: r, desc, stackLabel, commits, branches }) => {
  const stack = stackLabel ? `\`${stackLabel}\`` : "";
  const stars = r.stargazers_count > 0 ? ` · ★ ${r.stargazers_count}` : "";
  const descText = desc.startsWith("(") ? `_${desc}_` : desc;
  return `| **[${r.name}](${r.html_url})** | ${escapeCell(descText)} | ${stack}${stars} | ${commits ?? "—"} | ${branches ?? "—"} | ${fmtDate(r.pushed_at)} |`;
});
const table = [
  "| Projet | Description | Stack | Commits | Branches | Maj |",
  "|---|---|---|---|---|---|",
  ...rows,
].join("\n");
const block = `${START}\n<!-- Généré automatiquement — voir projects.config.json -->\n\n${table}\n\n${END}`;

const readme = await readFile(README, "utf8");
const re = new RegExp(`${START}[\\s\\S]*?${END}`);
if (!re.test(readme)) {
  console.error("Marqueurs PROJECTS:START / PROJECTS:END introuvables dans le README.");
  process.exit(1);
}
const nextReadme = readme.replace(re, block);
if (nextReadme === readme) console.log("README : aucun changement.");
else { await writeFile(README, nextReadme); console.log("README mis à jour."); }

// --- assets/projects.svg : dashboard visuel ---
const ROW_H = 74;
const TOP = 56;
const svgHeight = TOP + items.length * ROW_H + 22;
const maxCommits = Math.max(...items.map((i) => i.commits || 0), 1);
const BAR_DIM = "#2a2e37", BAR_LIT = "#3987e5";

const rowsSvg = items.map(({ repo: r, desc, commits, branches, weeks }, idx) => {
  const y = TOP + idx * ROW_H;
  const cVal = commits ?? 0;
  const barW = Math.max(3, (cVal / maxCommits) * 420);
  const w = weeks && weeks.length ? weeks : new Array(8).fill(0);
  const wMax = Math.max(...w, 1);
  const microBars = w.map((v, i) => {
    const h = Math.max(2, (v / wMax) * 20);
    const color = lerpColor(BAR_DIM, BAR_LIT, v / wMax);
    const bx = 470 + i * 16;
    const by = y + 46 - h;
    return `<rect x="${bx}" y="${by.toFixed(1)}" width="10" height="${h.toFixed(1)}" rx="2" fill="${color}"/>`;
  }).join("");

  return `
    <text x="24" y="${y + 14}" font-size="15" font-weight="700" fill="#eef0f4">${escapeXml(r.name)}</text>
    <text x="${24 + r.name.length * 8.6 + 10}" y="${y + 14}" font-size="11.5" fill="#7b8394">${escapeXml(truncate(desc, 46))}</text>
    <text x="836" y="${y + 14}" text-anchor="end" font-size="11.5" fill="#7b8394">${cVal} commits · ${branches ?? "—"} branche${(branches ?? 0) > 1 ? "s" : ""}</text>
    <rect x="24" y="${y + 24}" width="420" height="8" rx="4" fill="#1c1f26"/>
    <rect x="24" y="${y + 24}" width="${barW.toFixed(1)}" height="8" rx="4" fill="${BAR_LIT}"/>
    ${microBars}
    <text x="470" y="${y + 62}" font-size="9.5" fill="#4a4f5c">8 dernières semaines</text>
    ${idx < items.length - 1 ? `<line x1="24" y1="${y + ROW_H - 12}" x2="836" y2="${y + ROW_H - 12}" stroke="#1c1f26" stroke-width="1"/>` : ""}
  `;
}).join("\n");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 ${svgHeight}" width="860" height="${svgHeight}" role="img" aria-label="Vue d'ensemble des ${items.length} projets publics : commits, branches et activité des 8 dernières semaines">
  <defs>
    <linearGradient id="bg3" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#111318"/>
      <stop offset="1" stop-color="#0a0b0d"/>
    </linearGradient>
    <clipPath id="round3"><rect x="0" y="0" width="860" height="${svgHeight}" rx="14"/></clipPath>
  </defs>
  <g clip-path="url(#round3)">
    <rect width="860" height="${svgHeight}" fill="url(#bg3)"/>
    <rect x="0" y="0" width="860" height="36" fill="#1c1f26"/>
    <line x1="0" y1="36" x2="860" y2="36" stroke="#2a2e37" stroke-width="1"/>
    <circle cx="22" cy="18" r="5.5" fill="#e6675f"/>
    <circle cx="41" cy="18" r="5.5" fill="#e6b95f"/>
    <circle cx="60" cy="18" r="5.5" fill="#5fbf6e"/>
    <text x="430" y="23" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="12.5" fill="#7b8394">ls ./projects --sort=updated</text>
    <g font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">
      ${rowsSvg}
    </g>
  </g>
  <rect x="0.5" y="0.5" width="859" height="${svgHeight - 1}" rx="14" fill="none" stroke="#2a2e37"/>
</svg>
`;

await writeFile(SVG_OUT, svg);
console.log(`${SVG_OUT} écrit — ${items.length} projets.`);
