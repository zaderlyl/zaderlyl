// Régénère le tableau "Projets" du README + assets/projects.svg.
// - liste TOUS les repos publics de l'utilisateur (+ ceux de config.include)
// - triés par date de dernière modification, le plus récent en haut
// - un repo créé ou modifié remonte donc automatiquement au prochain passage
// - pour chaque repo : commits, branches, et l'activité réelle des 8
//   dernières semaines, dessinée en barres dans assets/projects.svg
//   (couleur = langage principal du repo, comme sur GitHub)
//
// Aucune dépendance : Node 20+ (fetch global). Lancé par GitHub Actions.

import { readFile, writeFile } from "node:fs/promises";
import { defs, windowChrome, outline, escapeXml } from "./svg-theme.mjs";

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
function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}
function lerpColor(hexA, hexB, t) {
  const a = [1, 3, 5].map((i) => parseInt(hexA.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(hexB.slice(i, i + 2), 16));
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, t))));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// Couleurs "langage" officielles GitHub — même code couleur que la barre
// de langages du dashboard stats, pour que les deux visuels se répondent.
const LANG_COLOR = {
  CSS: "#563d7c", Rust: "#dea584", HTML: "#e34c26", JavaScript: "#f1e05a",
  Java: "#b07219", Shell: "#89e051", TypeScript: "#3178c6", Python: "#3572A5",
  PHP: "#4F5D95", Swift: "#F05138", C: "#555555", "C++": "#f34b7d",
};
const FALLBACK_COLOR = "#4dabf7";

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
  // La couleur suit la stack annoncée en priorité (un override "Java · Firebase"
  // doit rester Java même si GitHub détecte "HTML" à cause des assets web),
  // sinon le langage détecté par GitHub.
  const stackFirstLang = (stackLabel || "").split(/[·,]/)[0]?.trim();
  const color = LANG_COLOR[stackFirstLang] || LANG_COLOR[r.language] || FALLBACK_COLOR;

  const [commits, branches, weeks] = await Promise.all([
    getCommitCount(r.full_name),
    getBranchCount(r.full_name),
    getWeeklyActivity(r.full_name),
  ]);

  items.push({ repo: r, desc, stackLabel, color, commits, branches, weeks });
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

// --- assets/projects.svg : dashboard visuel, couleur = langage du repo ---
const ROW_H = 76;
const TOP = 56;
const svgHeight = TOP + items.length * ROW_H + 20;
const maxCommits = Math.max(...items.map((i) => i.commits || 0), 1);
const DIM = "#211c31";
const ID = "p";

const rowsSvg = items.map(({ repo: r, desc, commits, branches, weeks, color }, idx) => {
  const y = TOP + idx * ROW_H;
  const cVal = commits ?? 0;
  const barW = Math.max(3, (cVal / maxCommits) * 420);
  const w = weeks && weeks.length ? weeks : new Array(8).fill(0);
  const wMax = Math.max(...w, 1);
  const microBars = w.map((v, i) => {
    const h = Math.max(2, (v / wMax) * 22);
    const c = lerpColor(DIM, color, 0.35 + (v / wMax) * 0.65);
    const bx = 470 + i * 16;
    const by = y + 48 - h;
    return `<rect x="${bx}" y="${by.toFixed(1)}" width="10" height="${h.toFixed(1)}" rx="2" fill="${c}"/>`;
  }).join("");

  const nameW = r.name.length * 8.7;
  return `
    <circle cx="18" cy="${y + 9}" r="4.5" fill="${color}"/>
    <text x="30" y="${y + 14}" font-size="15" font-weight="700" fill="#eef0f4">${escapeXml(r.name)}</text>
    <text x="${30 + nameW + 10}" y="${y + 14}" font-size="11.5" fill="#a99fc2">${escapeXml(truncate(desc, 44))}</text>
    <text x="836" y="${y + 14}" text-anchor="end" font-size="11.5" fill="#a99fc2">${cVal} commits · ${branches ?? "—"} branche${(branches ?? 0) > 1 ? "s" : ""}</text>
    <rect x="24" y="${y + 24}" width="420" height="8" rx="4" fill="#211c31"/>
    <rect x="24" y="${y + 24}" width="${barW.toFixed(1)}" height="8" rx="4" fill="${color}"/>
    ${microBars}
    <text x="470" y="${y + 64}" font-size="9.5" fill="#5c5470">8 dernières semaines</text>
    ${idx < items.length - 1 ? `<line x1="24" y1="${y + ROW_H - 12}" x2="836" y2="${y + ROW_H - 12}" stroke="#1c1830" stroke-width="1"/>` : ""}
  `;
}).join("\n");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 ${svgHeight}" width="860" height="${svgHeight}" role="img" aria-label="Vue d'ensemble des ${items.length} projets publics : commits, branches et activité des 8 dernières semaines, couleur par langage">
  <defs>${defs(ID, svgHeight)}</defs>
  <g clip-path="url(#round${ID})">
    <rect width="860" height="${svgHeight}" fill="url(#bg${ID})"/>
    ${windowChrome("ls ./projects --sort=updated")}
    <g font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">
      ${rowsSvg}
    </g>
  </g>
  ${outline(svgHeight)}
</svg>
`;

await writeFile(SVG_OUT, svg);
console.log(`${SVG_OUT} écrit — ${items.length} projets.`);
