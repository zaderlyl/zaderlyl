// Régénère le tableau "Projets sélectionnés" du README.
// - liste TOUS les repos publics de l'utilisateur (+ ceux de config.include)
// - triés par date de dernière modification, le plus récent en haut
// - un repo créé ou modifié remonte donc automatiquement au prochain passage
// - pour chaque repo : nombre de commits, de branches, et un mini graphe
//   d'activité (8 dernières semaines) pour voir d'un coup d'œil où j'en suis
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

async function ghRaw(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  return res;
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
  if (!link) return 1; // une seule page => un seul commit (ou zéro, cas déjà filtré)
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

const BLOCKS = "▁▂▃▄▅▆▇█"; // 8 niveaux, jamais vide (même 0 commit affiche une ligne plate)
// Activité des 8 dernières semaines, en sparkline unicode. GitHub calcule
// cette stat de façon asynchrone : un 202 veut dire "pas encore prêt",
// on retente quelques fois avant d'abandonner pour ce passage (elle sera
// prête au prochain, GitHub la garde en cache une fois calculée).
async function getActivitySparkline(fullName) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await ghRaw(`/repos/${fullName}/stats/commit_activity`);
    if (res.status === 202) {
      await new Promise((r) => setTimeout(r, 2500));
      continue;
    }
    if (!res.ok) return null;
    const weeks = await res.json();
    if (!Array.isArray(weeks) || weeks.length === 0) return null;
    const last8 = weeks.slice(-8).map((w) => w.total);
    const max = Math.max(...last8, 1);
    return last8.map((v) => BLOCKS[Math.min(7, Math.round((v / max) * 7))]).join("");
  }
  return null;
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

// --- tableau (séquentiel : la stats API n'aime pas les rafales) ---
const rows = [];
for (const r of repos) {
  const ov = overrides[r.full_name] ?? {};
  const name = r.name;
  const desc = ov.note || r.description || "_(pas encore de description)_";
  const stackLabel = ov.stack || r.language || "";
  const stack = stackLabel ? `\`${stackLabel}\`` : "";
  const stars = r.stargazers_count > 0 ? ` · ★ ${r.stargazers_count}` : "";

  const [commits, branches, spark] = await Promise.all([
    getCommitCount(r.full_name),
    getBranchCount(r.full_name),
    getActivitySparkline(r.full_name),
  ]);

  const commitsCell = commits != null ? String(commits) : "—";
  const branchesCell = branches != null ? String(branches) : "—";
  const sparkCell = spark ? `\`${spark}\`` : "—";

  rows.push(
    `| **[${name}](${r.html_url})** | ${escapeCell(desc)} | ${stack}${stars} | ${commitsCell} | ${branchesCell} | ${sparkCell} | ${fmtDate(r.pushed_at)} |`,
  );
  console.log(`ok   ${r.full_name}  commits=${commitsCell} branches=${branchesCell} spark=${spark ?? "n/a"}`);
}

const table = [
  "| Projet | Description | Stack | Commits | Branches | Activité (8 sem.) | Maj |",
  "|---|---|---|---|---|---|---|",
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
