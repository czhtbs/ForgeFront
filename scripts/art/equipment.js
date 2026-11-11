import { mkdirSync, writeFileSync } from 'node:fs';

// A shared 32 px grid keeps equipment, attributes and research icons consistent.
const icons = {
  rifle: '<path d="M4 14h19v6H4zM23 15h6v2h-6M8 20h5v6H8M18 20h3v4h-3" fill="#65767b"/><path d="M2 14h5v10H2" fill="#b89c65"/>',
  sword: '<path d="M19 3h7v7L13 23l-6-6z" fill="#c0d4d0"/><path d="m5 14 13 13M5 25l7-7" stroke="#b69252" stroke-width="4"/>',
  blast: '<path d="m16 2 4 8 9-2-4 9 5 6-10 1-5 7-4-9-9-3 8-6-1-9z" fill="#e3a54d"/><path d="m16 11 6 6-7 7-5-8z" fill="#fff2b6"/>',
  arc: '<path d="M17 2 5 19h10l-2 12 15-20H17z" fill="#9b87ca"/><path d="m18 7-7 10h8l-2 8 6-11h-8z" fill="#ece2ff" stroke="none"/>',
  burn: '<path d="M18 2v9l6-4 4 12-4 9H9l-5-8 5-11 3 6z" fill="#da8250"/><path d="m17 14 5 10-4 4h-6l-2-5z" fill="#f5d585" stroke="none"/>',
  frost: '<path d="M16 3v26M4 9l24 14M4 23 28 9M11 5l5 5 5-5M11 27l5-5 5 5M4 14l7-1-2-7M28 18l-7 1 2 7" fill="none" stroke="#74aebd" stroke-width="3"/>',
  pierce: '<path d="M13 5h4v22h-4M23 5h4v22h-4" fill="#b4c9b3"/><path d="M2 16h26m-7-5 7 5-7 5" fill="none" stroke="#a67c48" stroke-width="3"/>',
  bounce: '<path d="M3 25 12 7l8 18 9-17m-9 1 9-1-1 9" fill="none" stroke="#a67c48" stroke-width="3"/>',
  split: '<path d="M3 16h12m0 0L26 5m-11 11h14M15 16l11 11M21 5h5v5M24 12l5 4-5 4M21 27h5v-5" fill="none" stroke="#a67c48" stroke-width="3"/>',
  return: '<path d="M5 9h18l5 6-5 8H5m7-6-7 6 7 6" fill="none" stroke="#6a9c88" stroke-width="3"/>',
  homing: '<path d="M3 27h7V15l6-7h11M22 3l6 5-6 5" fill="none" stroke="#6a9c88" stroke-width="3"/><path d="M18 17h10v10H18z" fill="#cf9b76"/>',
  linger: '<path d="M9 3h14v5l-5 8 5 8v5H9v-5l5-8-5-8z" fill="#b9ccbb"/><path d="M11 25h10l-5-7zM11 7h10l-5 7z" fill="#c59c59" stroke="none"/>',
  trail: '<path d="M2 16h28" fill="none" stroke="#9bb7a3" stroke-width="2"/><path d="m6 11 4 5-4 5-4-5zm9 0 4 5-4 5-4-5zm10 0 4 5-4 5-4-5z" fill="#d4a44e"/>',
  delay: '<path d="M6 7h20v20H6z" fill="#c1d4c4"/><path d="M16 11v7h6M12 3h8" fill="none" stroke="#52736c" stroke-width="3"/>',
  lob: '<path d="M3 25Q14-9 28 25m-8-2 8 2-1-8" fill="none" stroke="#a67c48" stroke-width="3"/>',
  far: '<path d="M3 16h26M8 9l-6 7 6 7M24 9l6 7-6 7" fill="none" stroke="#518e8b" stroke-width="3"/>',
  near: '<path d="M2 16h10m-5-6 6 6-6 6M30 16H20m5-6-6 6 6 6" fill="none" stroke="#518e8b" stroke-width="3"/>',
  spread: '<path d="M16 28V16L5 5m11 11V3m0 13L27 5" fill="none" stroke="#518e8b" stroke-width="3"/><path d="M2 2h6v6H2zM13 1h6v6h-6zM24 2h6v6h-6z" fill="#b8d0a7"/>',
  health: '<path d="M16 28 3 16V7l6-4 7 5 7-5 6 4v9z" fill="#cc8073"/><path d="M14 10h4v4h4v4h-4v4h-4v-4h-4v-4h4z" fill="#fff5db" stroke="none"/>',
  haste: '<path d="m10 5 10 11-10 11M20 5l10 11-10 11" fill="none" stroke="#bc9756" stroke-width="4"/>',
  mobility: '<path d="M11 3h9v15l9 5v5H9V15H5V8h6z" fill="#84a590"/><path d="M3 21h4M1 27h5" stroke="#6a8c7d" stroke-width="3"/>',
  attack: '<path d="m18 3 10 10-14 14-10-10z" fill="#c7d6ce"/><path d="m7 10 14 14M3 28l10-10" stroke="#ae8750" stroke-width="4"/>',
  range: '<path d="M5 5h22v22H5zM10 10h12v12H10zM16 1v9m0 12v9M1 16h9m12 0h9" fill="none" stroke="#6e9a90" stroke-width="2"/>',
  empty: '<path d="M7 7h18v18H7z" fill="none" stroke="#b7c7b5" stroke-dasharray="4 3"/>',
};
for (const [slot, color] of [['ranged', '#87aaa8'], ['melee', '#b9ab82']]) for (const [tier, lines] of [['Light', 1], ['Medium', 2], ['Heavy', 3]]) {
  icons[slot + tier] = `<path d="M5 5h22v14l-11 11L5 19z" fill="${color}"/><path d="M10 10h12M10 15h12${lines > 1 ? 'M10 20h12' : ''}${lines > 2 ? 'M14 24h4' : ''}" fill="none" stroke="#f5f0d9" stroke-width="3"/>`;
}
const factory = (symbol) => `<path d="M3 13 12 7v6l9-6v6h8v16H3z" fill="#9ca995"/><path d="M24 3h4v10h-4" fill="#819b92"/><path d="M8 18h5v5H8m10-5h5v5h-5" fill="#ebd9a6"/>${symbol}`;
icons.ammoWorks = factory('<path d="M13 25h6v6h-6" fill="#da8250"/>');
icons.attachmentWorks = factory('<path d="m16 18 5 5-5 5-5-5z" fill="#cfac63"/>');
icons.chipWorks = factory('<path d="M12 20h8v8h-8" fill="#69aaa5"/>');
icons.armorWorks = factory('<path d="M12 18h9v7l-4 5-5-5z" fill="#8cabc2"/>');
icons.researchLab = '<path d="M3 15h26v14H3z" fill="#a7af98"/><path d="M8 15V8l5-5h6l5 5v7z" fill="#8b9b9b"/><path d="M8 20h16v5H8" fill="#6caeab"/>';
mkdirSync('public/assets/icons', { recursive: true });
for (const [id, shape] of Object.entries(icons)) {
  const body = `<g stroke="#405c57" stroke-width="1.4" stroke-linejoin="round">${shape}</g>`;
  writeFileSync(`public/assets/icons/${id}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 32 32">${body}</svg>\n`);
  if (id.endsWith('Works') || id === 'researchLab' || /^(ranged|melee)/.test(id) || ['far', 'near', 'spread'].includes(id)) writeFileSync(`public/assets/cards/${id}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150"><path d="M0 0h300v150H0z" fill="#e6eddb"/><g transform="translate(102 25) scale(3)">${body}</g></svg>\n`);
}
