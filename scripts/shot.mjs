#!/usr/bin/env node
/**
 * Headless-Chrome harness for visual checks and scripted play.
 *
 *   node scripts/shot.mjs <url|/path> [options]
 *
 * Options
 *   --out <file>        Screenshot path (default shots/shot.png). Directories are created.
 *   --size <WxH>        Viewport in CSS px (default 1600x900).
 *   --dpr <n>           Device pixel ratio (default 1).
 *   --wait <ms>         Wait after load before acting (default 1200).
 *   --eval <js>         Evaluate JS in the page after the wait (repeatable, runs in order;
 *                       may return a promise; the result is printed as JSON).
 *   --then <ms>         Wait after the evals before the screenshot (default 300).
 *   --steps <file|json> A JSON array of steps, run after --wait, each one of:
 *                         { "eval": "js" } | { "wait": ms } | { "shot": "file.png" } |
 *                         { "key": "ArrowLeft", "hold": ms? } | { "click": [x, y] } |
 *                         { "drag": [x1, y1, x2, y2], "ms": 400 } | { "text": "label" }
 *                       (no automatic final screenshot when --steps is used unless --out is given)
 *   --fps <ms>          Measure requestAnimationFrame rate for this many ms and print it.
 *   --quiet             Only print errors.
 *
 * Relative URLs resolve against http://127.0.0.1:5180 (the dev server, `npm run dev`).
 * Console errors and uncaught page errors are always printed; the exit code is 2 when any occurred.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const argv = process.argv.slice(2);
if (!argv.length || argv[0] === '--help') {
  console.log(readFileSync(new URL(import.meta.url)).toString().split('*/')[0]);
  process.exit(0);
}

const opts = { url: '', out: '', size: '1600x900', dpr: 1, wait: 1200, then: 300, evals: [], steps: null, fps: 0, quiet: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => argv[++i];
  if (a === '--out') opts.out = next();
  else if (a === '--size') opts.size = next();
  else if (a === '--dpr') opts.dpr = Number(next());
  else if (a === '--wait') opts.wait = Number(next());
  else if (a === '--then') opts.then = Number(next());
  else if (a === '--eval') opts.evals.push(next());
  else if (a === '--steps') opts.steps = next();
  else if (a === '--fps') opts.fps = Number(next());
  else if (a === '--quiet') opts.quiet = true;
  else if (!opts.url) opts.url = a;
}
const base = 'http://127.0.0.1:5180';
const url = /^https?:/.test(opts.url) ? opts.url : base + (opts.url.startsWith('/') ? '' : '/') + opts.url;
const [vw, vh] = opts.size.split('x').map(Number);
const log = (...m) => { if (!opts.quiet) console.log(...m); };

let errors = 0;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: opts.dpr });
  page.on('response', res => {
    if (res.status() >= 400 && !res.url().endsWith('/favicon.ico')) { errors++; console.log(`[http ${res.status()}] ${res.url()}`); }
  });
  page.on('console', msg => {
    const type = msg.type();
    if (type === 'error' && msg.text().startsWith('Failed to load resource')) return; // reported by the response handler
    if (type === 'error') { errors++; console.log(`[console.error] ${msg.text()}`); }
    else if (type === 'warning') log(`[console.warn] ${msg.text()}`);
    else log(`[console.${type}] ${msg.text()}`);
  });
  page.on('pageerror', err => { errors++; console.log(`[pageerror] ${err.stack || err.message}`); });
  page.on('requestfailed', req => { errors++; console.log(`[requestfailed] ${req.url()} ${req.failure()?.errorText}`); });

  const resp = await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  if (!resp || !resp.ok()) { errors++; console.log(`[http] ${resp?.status()} for ${url}`); }
  await page.waitForTimeout(opts.wait);

  const shoot = async file => {
    const out = resolve(file);
    mkdirSync(dirname(out), { recursive: true });
    await page.screenshot({ path: out });
    console.log(`[shot] ${out}`);
  };

  for (const js of opts.evals) {
    const result = await page.evaluate(js);
    if (result !== undefined) console.log(`[eval] ${JSON.stringify(result)}`);
  }

  if (opts.steps) {
    const raw = existsSync(opts.steps) ? readFileSync(opts.steps, 'utf8') : opts.steps;
    const steps = JSON.parse(raw);
    for (const step of steps) {
      if (step.eval !== undefined) {
        const result = await page.evaluate(step.eval);
        if (result !== undefined) console.log(`[eval] ${JSON.stringify(result)}`);
      }
      if (step.text) log(`[step] ${step.text}`);
      if (step.key) {
        if (step.hold) { await page.keyboard.down(step.key); await page.waitForTimeout(step.hold); await page.keyboard.up(step.key); }
        else await page.keyboard.press(step.key);
      }
      if (step.click) await page.mouse.click(step.click[0], step.click[1]);
      if (step.drag) {
        const [x1, y1, x2, y2] = step.drag;
        await page.mouse.move(x1, y1);
        await page.mouse.down();
        const n = Math.max(2, Math.round((step.ms ?? 300) / 16));
        for (let k = 1; k <= n; k++) { await page.mouse.move(x1 + (x2 - x1) * k / n, y1 + (y2 - y1) * k / n); await page.waitForTimeout(16); }
        await page.mouse.up();
      }
      if (step.wait) await page.waitForTimeout(step.wait);
      if (step.shot) await shoot(step.shot);
    }
  }

  if (opts.fps > 0) {
    const fps = await page.evaluate(ms => new Promise(done => {
      let frames = 0, worst = 0, last = performance.now();
      const t0 = last;
      const tick = now => {
        frames++; worst = Math.max(worst, now - last); last = now;
        if (now - t0 < ms) requestAnimationFrame(tick);
        else done({ fps: +(frames * 1000 / (now - t0)).toFixed(1), worstFrameMs: +worst.toFixed(1) });
      };
      requestAnimationFrame(tick);
    }), opts.fps);
    console.log(`[fps] ${JSON.stringify(fps)}`);
  }

  if (!opts.steps || opts.out) {
    await page.waitForTimeout(opts.then);
    await shoot(opts.out || 'shots/shot.png');
  }
} finally {
  await browser.close();
}
if (errors) { console.log(`[result] ${errors} error(s)`); process.exit(2); }
