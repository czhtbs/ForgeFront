import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ITEMS } from '../src/content/equipment.ts';

const output = new URL('../public/assets/cards/', import.meta.url);
mkdirSync(output, { recursive: true });
const troop = (x, y, enemy = true, opacity = 1) => `<g transform="translate(${x} ${y})" opacity="${opacity}" fill="${enemy ? '#bc6555' : '#2c8582'}" stroke="#354e48" stroke-width="2"><ellipse cy="14" rx="13" ry="5" fill="#617b5b" opacity=".14" stroke="none"/><rect x="-8" y="-5" width="16" height="18" rx="6"/><circle cy="-8" r="7" fill="${enemy ? '#df9c7e' : '#77b8a0'}"/><path d="M7 1h12v4H7" fill="#4e605b"/></g>`;
const arrow = (d, color = '#c9903b', dash = '') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#arrow)" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
const ring = (x, y, r, color, opacity = .18) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" fill-opacity="${opacity}" stroke="${color}" stroke-width="2"/>`;
const burst = (x, y, r = 25) => `<g transform="translate(${x} ${y})"><path d="${Array.from({ length: 20 }, (_, i) => { const a = i * Math.PI / 10, radius = i % 2 ? r * .55 : r; return `${i ? 'L' : 'M'}${Math.cos(a) * radius} ${Math.sin(a) * radius}`; }).join('')}Z" fill="#f2b84c" stroke="#c9763d" stroke-width="2"/><circle r="${r * .3}" fill="#fff5b1"/></g>`;
const flame = (x, y, scale = 1) => `<g transform="translate(${x} ${y}) scale(${scale})"><path d="M0 18C-21 8-15-8-5-14C-9-2 5-5 3-24C23-8 20 12 0 18Z" fill="#ef9950" stroke="#c46c3f" stroke-width="2"/><path d="M0 14C-10 8-6-2 2-8C0 2 9 6 0 14" fill="#ffe7a0"/></g>`;
const crystal = (x, y, scale = 1) => `<g transform="translate(${x} ${y}) scale(${scale})" stroke="#79becd" stroke-width="3" stroke-linecap="round">${[0, 60, 120].map(a => `<g transform="rotate(${a})"><path d="M-19 0h38M-13-6l6 6-6 6M13-6l-6 6 6 6" fill="none"/></g>`).join('')}</g>`;
const gun = `<g transform="translate(34 66) rotate(-12)"><path d="M-5 6h24l8-7h42v11H29l-9 8H-5Z" fill="#4b6665" stroke="#334e4c" stroke-width="2"/><path d="M30 10l6 17h10l-4-17" fill="#9b9875" stroke="#334e4c" stroke-width="2"/><path d="M69 2h14v5H69M25-2h15v-5H25" fill="#a6b8aa" stroke="#334e4c" stroke-width="2"/></g>`;
const source = troop(42, 80, false);
const diagrams = {
  rifle: gun + arrow('M124 70H221') + troop(252, 76),
  sword: '<g transform="translate(125 78) rotate(38)"><path d="M-8 22V-48L0-64 8-48V22Z" fill="#c1d2cb" stroke="#476a69" stroke-width="3"/><path d="M0-56V20" stroke="#fbfff0" stroke-width="3"/><path d="M-22 22h44v8h-44Z" fill="#cfaa66" stroke="#7a7051" stroke-width="2"/><path d="M-6 31h12v28H-6Z" fill="#756b58"/><circle cy="61" r="8" fill="#cfaa66"/></g>' + arrow('M153 30Q220 55 213 100') + troop(245, 91),
  blast: source + arrow('M65 78H166') + ring(218, 76, 42, '#d8824b') + troop(250, 60) + troop(221, 113) + burst(211, 71, 29),
  arc: source + arrow('M65 78H142') + '<path d="M152 76l17-13-5 15 27-20M154 80l20 8-8 10 34 7M163 75l24 1-6-10 38 5" fill="none" stroke="#9581c8" stroke-width="4" stroke-linejoin="round"/>' + troop(208, 47) + troop(245, 77) + troop(216, 114),
  burn: source + arrow('M65 78H163') + ring(222, 92, 41, '#d88d50') + troop(251, 72) + flame(211, 83, 1.05) + flame(238, 101, .7),
  frost: source + arrow('M65 78H159', '#79becd') + ring(221, 84, 39, '#81c3cc') + troop(247, 87) + crystal(207, 65, 1.2) + crystal(243, 108, .55),
  pierce: source + troop(132, 80) + troop(197, 80, true, .75) + troop(260, 80, true, .45) + arrow('M68 78H278') + '<path d="M117 62l8 8M183 62l8 8M248 62l8 8" stroke="#f4d276" stroke-width="3"/>',
  bounce: source + troop(143, 48) + troop(201, 112) + troop(257, 45) + arrow('M65 73L132 48 195 105 250 48'),
  split: source + troop(250, 38) + troop(263, 80) + troop(250, 122) + arrow('M65 78H129') + arrow('M135 78L226 38') + arrow('M135 78H239') + arrow('M135 78L226 120'),
  return: source + troop(247, 80) + arrow('M65 70Q145 23 228 66') + arrow('M228 94Q145 136 65 94', '#688d85'),
  homing: source + troop(220, 43, true, .25) + troop(258, 101) + arrow('M68 79C118 78 165 25 193 50S206 102 235 99') + '<path d="M226 48l26 38" stroke="#bb7970" stroke-width="2" stroke-dasharray="4 5"/>',
  linger: source + arrow('M65 78H177') + ring(220, 80, 36, '#caa45d', .08) + ring(220, 80, 23, '#caa45d', .12) + '<circle cx="220" cy="80" r="10" fill="#f5ca6d"/>' + troop(260, 106) + [0, 1, 2, 3].map(i => `<circle cx="${205 + i * 10}" cy="128" r="2" fill="#b3945a"/>`).join(''),
  trail: source + [97, 132, 167, 202].map(x => ring(x, 89, 16, '#db9359') + flame(x, 87, .4)).join('') + arrow('M65 72H243') + troop(268, 78),
  delay: source + arrow('M65 78H147') + '<circle cx="185" cy="78" r="27" fill="#fff8df" stroke="#78928b" stroke-width="3"/><path d="M185 59v19l13 7" fill="none" stroke="#78928b" stroke-width="3"/><path d="M219 78h14" stroke="#c9903b" stroke-width="2" stroke-dasharray="3 3"/>' + burst(260, 78, 24),
  lob: source + '<path d="M150 20V135" stroke="#99ad8c" stroke-width="2" stroke-dasharray="5 6"/>' + troop(253, 101) + arrow('M64 78Q156-25 239 91') + '<ellipse cx="166" cy="106" rx="9" ry="3" fill="#63785b" opacity=".2"/><circle cx="167" cy="36" r="5" fill="#d6ab54"/>',
};
const shell = inner => `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300" viewBox="0 0 300 150"><defs><linearGradient id="ground" x2="1" y2="1"><stop stop-color="#eff2e2"/><stop offset="1" stop-color="#dce9d4"/></linearGradient><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M1 1L9 5 1 9Z" fill="#bd924c"/></marker></defs><path fill="url(#ground)" d="M0 0h300v150H0z"/><path d="M0 112Q74 81 158 118T300 105V150H0Z" fill="#ccdcbc" opacity=".25"/><g stroke="#829675" opacity=".14" stroke-width="1">${Array.from({ length: 14 }, (_, i) => `<path d="M${15 + i * 21} ${112 + i % 3 * 7}l5-2"/>`).join('')}</g>${inner}</svg>`;
for (const item of ITEMS) {
  assert.ok(diagrams[item], `Missing card: ${item}`);
  writeFileSync(new URL(`${item}.svg`, output), shell(diagrams[item]));
}
for (const kind of ['barracks', 'launcherWorks', 'attachmentWorks', 'mine']) {
  const sprite = kind.endsWith('Works') ? 'workshop' : kind;
  const image = readFileSync(new URL(`../public/assets/b-style/${sprite}.png`, import.meta.url)).toString('base64');
  const product = kind === 'barracks' ? troop(237, 81, false) + troop(263, 100, false) : kind === 'launcherWorks' ? `<g transform="translate(205 32) scale(.65)">${gun}</g>` : kind === 'attachmentWorks' ? crystal(237, 61, .8) + flame(258, 102, .6) : '<g fill="#dab65d" stroke="#a78441" stroke-width="2"><ellipse cx="247" cy="99" rx="23" ry="9"/><ellipse cx="247" cy="91" rx="23" ry="9"/><ellipse cx="247" cy="83" rx="23" ry="9"/><path d="M234 80l13-4 13 4-13 5Z" fill="#f4d98c"/></g>';
  writeFileSync(new URL(`${kind}.svg`, output), shell(`<image href="data:image/png;base64,${image}" x="26" y="2" width="145" height="145"/>${arrow('M172 81H204', '#81987c')}${product}`));
}
console.log(`Built ${ITEMS.length + 4} static UI cards.`);
