// Renders every app icon PNG from the SVG layers below.
// Usage: npm run icons
//
// Design: a sunset sky (his orange) over grass hills (her green),
// with a mustache (dev) and a dumbbell (gym) in the middle.
// Android adaptive icons crop the foreground to a circle of ~61% of the
// canvas, so the mark stays inside that safe zone.

import { writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const SIZE = 1024;
const INK = '#2B1206';

const MUSTACHE =
  'M50 14 C44 6 34 4 26 10 C20 15 14 20 6 16 C3 15 1 12 2 9 C0 14 2 22 10 26 C20 31 34 28 42 22 C46 19 49 18 50 18 C51 18 54 19 58 22 C66 28 80 31 90 26 C98 22 100 14 98 9 C99 12 97 15 94 16 C86 20 80 15 74 10 C66 4 56 6 50 14 Z';

const dumbbell = (fill) => `
  <g transform="translate(312 280) scale(6.25)" fill="${fill}">
    <rect x="14" y="14" width="36" height="4" rx="2"/>
    <rect x="10" y="5" width="6" height="22" rx="2"/>
    <rect x="48" y="5" width="6" height="22" rx="2"/>
    <rect x="3" y="9" width="6" height="14" rx="2"/>
    <rect x="55" y="9" width="6" height="14" rx="2"/>
  </g>`;

const mustache = (fill) => `
  <g transform="translate(282 516) scale(4.6)"><path fill="${fill}" d="${MUSTACHE}"/></g>`;

const mark = (fill) => dumbbell(fill) + mustache(fill);

const background = `
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFB25B"/>
      <stop offset="1" stop-color="#F26B3A"/>
    </linearGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#sky)"/>
  <circle cx="512" cy="500" r="300" fill="#FFE08A" opacity="0.85"/>
  <path d="M0 820 Q256 740 540 800 T1024 780 V1024 H0 Z" fill="#4E9F3D"/>
  <path d="M0 900 Q340 840 680 890 T1024 880 V1024 H0 Z" fill="#2F6B22"/>`;

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${body}</svg>`;

function render(file, body, width) {
  const png = new Resvg(svg(body), { fitTo: { mode: 'width', value: width } }).render().asPng();
  writeFileSync(new URL(`../assets/images/${file}`, import.meta.url), png);
  console.log(`assets/images/${file} (${width}px)`);
}

render('icon.png', background + mark(INK), 1024);
render('android-icon-background.png', background, 1024);
render('android-icon-foreground.png', mark(INK), 1024);
// Android themed icons only use the alpha channel of the monochrome layer.
render('android-icon-monochrome.png', mark('#FFFFFF'), 1024);
render('splash-icon.png', mark(INK), 512);
render('favicon.png', background + mark(INK), 48);
// Status-bar notification icon: Android requires an all-white silhouette on transparency.
render('notification-icon.png', mark('#FFFFFF'), 96);
