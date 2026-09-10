// Régénère le tableau "Projets sélectionnés" du README.
// - liste TOUS les repos publics de l'utilisateur (+ ceux de config.include)
// - triés par date de dernière modification, le plus récent en haut
// - un repo créé ou modifié remonte donc automatiquement au prochain passage
//
// Aucune dépendance : Node 20+ (fetch global). Lancé par GitHub Actions.

import { readFile, writeFile } from "node:fs/promises";

const README = "README.md";
const CONFIG = "projects.config.json";
const START = "<!-- PROJECTS:START -->";
const END = "<!-- PROJECTS:END -->";

const token = process.env.GITHUB_TOKEN;
const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "readme-updater",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
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

function fmtDate(iso) {
  return new Date(iso).toISOString().slice(0, 10); // AAAA-MM-JJ
}

function escapeCell(s) {
  return String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

// --- config ---
const config = JSON.parse(await readFile(CONFIG, "utf8"));
const user = config.user;
const exclude = new Set((config.exclude ?? []).map((s) => s.toLowerCase()));
exclude.add(`${user}/${user}`.toLowerCase()); // le dépôt de profil, toujours exclu
const overrides = config.overrides ?? {};

// --- récupération ---
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
    if (r.size === 0) return false;                          // repo vide
    if (r.fork && !config.includeForks) return false;
    if (r.archived && !config.includeArchived) return false;
    if (r.private) return false;
    return true;
  })
  .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at));

// --- tableau ---
const rows = repos.map((r) => {
  const ov = overrides[r.full_name] ?? {};
  const name = r.name;
  const desc = ov.note || r.description || "_(pas encore de description)_";
  const stackLabel = ov.stack || r.language || "";
  const stack = stackLabel ? `\`${stackLabel}\`` : "";
  const stars = r.stargazers_count > 0 ? ` · ★ ${r.stargazers_count}` : "";
  return `| **[${name}](${r.html_url})** | ${escapeCell(desc)} | ${stack}${stars} | ${fmtDate(r.pushed_at)} |`;
});

const table = [
  "| Projet | Description | Stack | Maj |",
  "|---|---|---|---|",
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

console.log(`${repos.length} repos listés :`);
for (const r of repos) console.log(`  ${fmtDate(r.pushed_at)}  ${r.full_name}`);

if (next === readme) {
  console.log("Aucun changement.");
} else {
  await writeFile(README, next);
  console.log("README mis à jour.");
}
