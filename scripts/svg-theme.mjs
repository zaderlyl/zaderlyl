// Thème SVG partagé par les 3 visuels du profil (banner, stats, projects).
// Un seul endroit pour la palette et le "chrome" de fenêtre — pour que tout
// reste cohérent si on veut changer une couleur plus tard.
//
// Usage dans un générateur :
//   <svg ...>
//     <defs>${defs(id, height)}</defs>
//     <g clip-path="url(#round${id})">
//       <rect width="860" height="${height}" fill="url(#bg${id})"/>
//       ${windowChrome(id, "titre de la fenêtre")}
//       ... contenu, à partir de y=56 (34 titlebar + 5 liseré + marge) ...
//     </g>
//     ${outline(height)}
//   </svg>

export const RAINBOW = ["#ff6b6b", "#ffa94d", "#ffd43b", "#69db7c", "#3bc9db", "#4dabf7", "#9775fa", "#f06595"];

export const INK = {
  bgTop: "#14101f",
  bgMid: "#0d0b14",
  bgBot: "#0a0b0d",
  titlebar: "#181322",
  line: "#2c2440",
  panel: "#181425",
  text: "#eef0f4",
  dim: "#a99fc2",
  faint: "#5c5470",
};

export function defs(id, height) {
  return `
    <linearGradient id="bg${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${INK.bgTop}"/>
      <stop offset="0.5" stop-color="${INK.bgMid}"/>
      <stop offset="1" stop-color="${INK.bgBot}"/>
    </linearGradient>
    <clipPath id="round${id}"><rect x="0" y="0" width="860" height="${height}" rx="14"/></clipPath>
    <filter id="glow${id}" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="2.6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>`;
}

// Barre de titre façon fenêtre + liseré arc-en-ciel juste en dessous.
// À placer à l'intérieur du <g clip-path="...">, après le rect de fond.
export function windowChrome(title) {
  const stripW = 860 / RAINBOW.length;
  const strip = RAINBOW.map((c, i) => `<rect x="${(i * stripW).toFixed(1)}" y="34" width="${stripW.toFixed(1)}" height="5" fill="${c}"/>`).join("");
  return `
    <rect x="0" y="0" width="860" height="34" fill="${INK.titlebar}"/>
    <line x1="0" y1="34" x2="860" y2="34" stroke="${INK.line}" stroke-width="1"/>
    <circle cx="22" cy="17" r="5.5" fill="#ff6b6b"/>
    <circle cx="41" cy="17" r="5.5" fill="#ffd43b"/>
    <circle cx="60" cy="17" r="5.5" fill="#69db7c"/>
    <text x="430" y="21.5" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="12" fill="${INK.dim}">${escapeXml(title)}</text>
    ${strip}`;
}

export function outline(height) {
  return `<rect x="0.5" y="0.5" width="859" height="${height - 1}" rx="14" fill="none" stroke="${INK.line}"/>`;
}

export function escapeXml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
