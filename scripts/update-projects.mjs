// Régénère le tableau "Projets" du README.
// - liste TOUS les repos publics de l'utilisateur (+ ceux de config.include)
// - triés par date de dernière modification, le plus récent en haut
// - un repo créé ou modifié remonte donc automatiquement au prochain passage
// - la colonne Stack affiche des logos (badges shields.io teintés en orange),
//   pas du texte — voir ICON_MAP et overrides[...].stackIcons
//
// Aucune dépendance : Node 20+ (fetch global). Lancé par GitHub Actions.

import { readFile, writeFile } from "node:fs/promises";

const README = "README.md";
const CONFIG = "projects.config.json";
const START = "<!-- PROJECTS:START -->";
const END = "<!-- PROJECTS:END -->";
const ACCENT = "FF9100";

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

function escapeCell(s) {
  return String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

// Nom de langage GitHub -> slug simple-icons. Chaque slug est vérifié à la
// main (shields.io ignore silencieusement un slug inconnu, sans erreur —
// donc un slug faux ne casse rien, il disparaît juste discrètement).
const ICON_MAP = {
  javascript: "javascript",
  typescript: "typescript",
  html: "html5",
  css: "css",
  php: "php",
  python: "python",
  java: "openjdk",
  rust: "rust",
  c: "c",
  "c++": "cplusplus",
  swift: "swift",
  shell: "gnubash",
  dockerfile: "docker",
};

// CDN officiel simple-icons : couleur ET taille personnalisables (contrairement
// aux badges shields.io, plus petits et dont la couleur du logo seul ne peut pas
// dépasser une vingtaine de pixels de haut).
function iconBadge(slug) {
  return `<img src="https://cdn.simpleicons.org/${slug}/${ACCENT}" width="28" height="28" alt="${slug}" title="${slug}">`;
}

// stackIcons (override explicite) sinon langage principal détecté par GitHub.
function stackCell(repo, ov) {
  const slugs = ov.stackIcons?.length
    ? ov.stackIcons
    : [ICON_MAP[(repo.language ?? "").toLowerCase()]].filter(Boolean);
  const icons = slugs.map(iconBadge).join(" ");
  const stars = repo.stargazers_count > 0 ? ` ![★](https://img.shields.io/badge/★%20${repo.stargazers_count}-0D1117?style=flat-square&labelColor=0D1117&color=${ACCENT})` : "";
  return `${icons}${stars}`;
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

// --- tableau markdown ---
const rows = [];
for (const r of repos) {
  const ov = overrides[r.full_name] ?? {};
  const desc = ov.note || r.description || "_(pas encore de description)_";

  rows.push(
    `| **[${r.name}](${r.html_url})** | ${escapeCell(desc)} | ${stackCell(r, ov)} |`,
  );
  console.log(`ok   ${r.full_name}`);
}

const table = [
  "| Projet | Description | Stack |",
  "|---|---|---|",
  ...rows,
].join("\n");

const block = `${START}\n<!-- Généré automatiquement — voir projects.config.json -->\n\n${table}\n\n${END}`;

const readme = await readFile(README, "utf8");
const re = new RegExp(`${START}[\\s\\S]*?${END}`);
if (!re.test(readme)) {
  console.error("Marqueurs PROJECTS:START / PROJECTS:END introuvables dans le README.");
  process.exit(1);
}
const next = readme.replace(re, block);

if (next === readme) {
  console.log("Aucun changement.");
} else {
  await writeFile(README, next);
  console.log("README mis à jour.");
}
