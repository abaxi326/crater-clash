#!/usr/bin/env node
/**
 * Scripted playtest: fires weapons at the opponent in a fresh duel and captures a frame sequence of each shot.
 *
 *   node scripts/playtest.mjs [options]
 *
 * Options
 *   --weapons <ids|all>   Comma-separated weapon ids (default: all).
 *   --biome <id>          Biome (default verdant).
 *   --seed <n>            Match seed (default 7).
 *   --size <WxH>          Viewport (default 1600x900).
 *   --frames <list>       Seconds after firing to capture (default 0.35,0.9,1.6,2.6,4).
 *   --out <dir>           Output directory (default shots/play).
 *   --base <url>          Server (default http://127.0.0.1:5180).
 *
 * Relies on the QA hooks in DESIGN.md §10 (?play=duel&biome&seed&weapon&mute, window.__cc).
 * Prints a JSON summary per weapon (aim used, hp before/after, console errors). Exit code 2 on any error.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ALL = ['ember', 'thunderhead', 'trident', 'starfall', 'fireworks', 'skipper', 'ricochet', 'burrower', 'seeker',
  'magma', 'tesla', 'singularity', 'sunbeam', 'faultline', 'earthmaker', 'repair', 'aegis', 'blink'];

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const weapons = opt('weapons', 'all') === 'all' ? ALL : opt('weapons', '').split(',').filter(Boolean);
const biome = opt('biome', 'verdant');
const seed = opt('seed', '7');
const [vw, vh] = opt('size', '1600x900').split('x').map(Number);
const frames = opt('frames', '0.35,0.9,1.6,2.6,4').split(',').map(Number);
const outDir = resolve(opt('out', 'shots/play'));
const base = opt('base', 'http://127.0.0.1:5180');
mkdirSync(outDir, { recursive: true });

// In-page aim search: sweep angle/power with the game's own trajectory predictor and pick the shot whose
// predicted end point lands closest to the opponent.
const AIM_SEARCH = `(() => {
  const g = window.__cc.game, s = g.state;
  const me = s.tanks[s.activePlayer], foe = s.tanks[1 - s.activePlayer];
  const dir = foe.x > me.x ? 1 : -1;
  let best = null;
  for (let a = 25; a <= 70; a += 2.5) {
    for (let p = 15; p <= 100; p += 1) {
      g.setAngle(dir > 0 ? a : 180 - a);
      g.setPower(p);
      const path = g.aimGuide(8000);
      if (!path.length) continue;
      const end = path[path.length - 1];
      const d = Math.abs(end.x - foe.x) + Math.abs(end.y - foe.y) * 0.35;
      if (!best || d < best.d) best = { angle: me.angle, power: me.power, d: Math.round(d) };
    }
  }
  return best;
})()`;

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const summary = [];
let failures = 0;
try {
  for (const weapon of weapons) {
    const page = await browser.newPage({ viewport: { width: vw, height: vh } });
    const errors = [];
    page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e.stack || e.message)));
    const entry = { weapon, fired: false, aim: null, hpBefore: null, hpAfter: null, errors };
    try {
      await page.goto(`${base}/?play=duel&biome=${biome}&seed=${seed}&weapon=${weapon}&mute=1`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__cc && window.__cc.game && window.__cc.game.canControl(), null, { timeout: 20000 });
      entry.aim = await page.evaluate(AIM_SEARCH);
      entry.hpBefore = await page.evaluate(() => window.__cc.game.state.tanks.map(t => t.hp));
      entry.fired = await page.evaluate(([a, p, w]) => window.__cc.fire(a, p, w) !== false, [entry.aim.angle, entry.aim.power, weapon]);
      let elapsed = 0;
      for (let i = 0; i < frames.length; i++) {
        await page.waitForTimeout(Math.max(0, (frames[i] - elapsed) * 1000));
        elapsed = frames[i];
        await page.screenshot({ path: `${outDir}/${weapon}-${i + 1}.png` });
      }
      entry.hpAfter = await page.evaluate(() => window.__cc.game.state.tanks.map(t => t.hp));
      entry.phase = await page.evaluate(() => window.__cc.game.state.phase);
    } catch (err) {
      errors.push(`harness: ${err.message}`);
    }
    if (errors.length) failures++;
    summary.push(entry);
    console.log(JSON.stringify(entry));
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`[playtest] ${summary.length} weapons, ${failures} with errors, frames in ${outDir}`);
if (failures) process.exit(2);
