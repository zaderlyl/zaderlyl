# Fonctionnement

Ce dépôt est le **README de profil** GitHub (il porte le même nom que le compte).

## Le tableau des projets se remplit tout seul

`scripts/update-projects.mjs` :

1. récupère **tous les repos publics** de `zaderlyl` via l'API GitHub,
2. y ajoute ceux listés dans `projects.config.json → include` (projets de groupe),
3. enlève : le dépôt de profil, ceux de `exclude`, les repos vides, les forks, les archivés,
4. **trie par date de dernière modification** (le plus récent en haut),
5. réécrit la zone entre `<!-- PROJECTS:START -->` et `<!-- PROJECTS:END -->` du README.

Donc :
- un **nouveau repo public** apparaît en tête automatiquement ;
- un repo **modifié** (n'importe quel push) remonte en tête ;
- rien à éditer à la main dans le README.

## Quand ça se met à jour

`.github/workflows/update-readme.yml` lance le script :
- **toutes les 6 heures** (cron) ;
- à chaque modif de `projects.config.json` ou du script ;
- **immédiatement** via l'onglet *Actions → Update README projects → Run workflow*.

## Ce que tu peux régler — uniquement `projects.config.json`

| Objectif | Champ |
|---|---|
| Cacher un repo | ajoute `owner/name` dans `exclude` |
| Afficher un repo qui n'est pas à toi | ajoute-le dans `include` |
| Donner une belle description | `overrides["owner/name"].note` — ou remplis le champ **About** du repo sur GitHub |
| Corriger le langage affiché | `overrides["owner/name"].stack` |
| Inclure les forks / archivés | `includeForks` / `includeArchived` → `true` |

Les 4 repos sans description (`dystopia-europa`, `WebGPU-test`, `Portfolio`, `SAE105`)
afficheront _(pas encore de description)_ tant que tu n'auras pas rempli leur champ
**About** sur GitHub (ou ajouté un `overrides`).

## Activation (une seule fois)

1. *Settings → Actions → General → Workflow permissions* → **Read and write permissions** → *Save*.
2. Onglet *Actions* → *Update README projects* → *Run workflow*.

## Repos épinglés (complémentaire)

*Customize your pins* sur la page de profil : choisis 4–6 projets. Les cartes
épinglées utilisent le champ **About** de chaque repo → pense à le remplir.
