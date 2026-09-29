// Capture harness: drives the live app with real mouse/keyboard events and records
// Chrome's own compositor frames (CDP screencast) into a constant-frame-rate MP4.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const require = createRequire(path.join(REPO, 'package.json'));
const { chromium } = require('playwright-core');

// Raw screencast frames stay outside the repo.
export const WORK = process.env.PROMO_WORK || path.join(os.tmpdir(), 'logbook-promo-capture');
export const FFMPEG = process.env.FFMPEG || 'ffmpeg';
export const PORT = Number(process.env.PROMO_PORT ?? 8020);
// The scratch server's STILL_DB_PATH; the seed writes demo rows straight into it.
export const DB = process.env.PROMO_DB || path.join(WORK, 'demo.sqlite3');
export const BASE = `http://127.0.0.1:${PORT}`;
export const OUT = path.join(REPO, 'promo-capture');
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---- cursor overlay -----------------------------------------------------------------------
// A top-layer popover that follows real mouse events, so it also stays above <dialog> modals.
const CURSOR_SCRIPT = `(() => {
  try { localStorage.setItem('still-muted', 'true'); } catch {}
  const ARROW = '<svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" viewBox="0 0 28 28"><defs><filter id="s" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="1.2" stdDeviation="1.1" flood-color="#000" flood-opacity=".35"/></filter></defs><path filter="url(#s)" d="M5.5 3.2v18.9l4.6-4.4 3.1 7.1 3.4-1.5-3-7h6.4z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const BEAM = '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 28 28"><defs><filter id="t" x="-60%" y="-30%" width="220%" height="160%"><feDropShadow dx="0" dy="1" stdDeviation=".9" flood-color="#000" flood-opacity=".3"/></filter></defs><path filter="url(#t)" d="M10 4.5c2 0 3.2.6 4 1.6.8-1 2-1.6 4-1.6M10 23.5c2 0 3.2-.6 4-1.6.8 1 2 1.6 4 1.6M14 6.1v15.8M11.6 14h4.8" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round"/><path d="M10 4.5c2 0 3.2.6 4 1.6.8-1 2-1.6 4-1.6M10 23.5c2 0 3.2-.6 4-1.6.8 1 2 1.6 4 1.6M14 6.1v15.8M11.6 14h4.8" fill="none" stroke="#111" stroke-width="1.5" stroke-linecap="round"/></svg>';
  let host, glyph, ring, kind = 'arrow', x = -80, y = -80, hidden = false, forced = false;
  const place = () => { if (host) host.style.transform = 'translate(' + x + 'px,' + y + 'px)'; };
  const setKind = next => {
    if (!glyph || next === kind) return;
    kind = next;
    glyph.innerHTML = next === 'text' ? BEAM : ARROW;
    glyph.style.transform = next === 'text' ? 'translate(-17px,-17px)' : 'translate(-7.5px,-4.3px)';
  };
  const visible = () => { if (host) host.style.opacity = (hidden || forced) ? '0' : '1'; };
  const raise = () => { if (!host || !host.isConnected) return; try { host.hidePopover(); } catch {} try { host.showPopover(); } catch {} };
  const install = () => {
    if (document.getElementById('promo-cursor') || !document.body) return;
    host = document.createElement('div');
    host.id = 'promo-cursor';
    host.setAttribute('popover', 'manual');
    host.setAttribute('aria-hidden', 'true');
    Object.assign(host.style, { position: 'fixed', inset: 'auto', left: '0', top: '0', margin: '0', padding: '0', border: '0', width: '0', height: '0',
      overflow: 'visible', background: 'transparent', pointerEvents: 'none', zIndex: '2147483647', transition: 'opacity 140ms ease', willChange: 'transform' });
    ring = document.createElement('div');
    Object.assign(ring.style, { position: 'absolute', left: '-18px', top: '-18px', width: '36px', height: '36px', borderRadius: '50%',
      border: '2px solid rgba(40,120,200,.75)', background: 'rgba(40,120,200,.12)', opacity: '0', transform: 'scale(.3)' });
    glyph = document.createElement('div');
    Object.assign(glyph.style, { position: 'absolute', left: '0', top: '0', width: '38px', height: '38px', transformOrigin: '7px 4px', transition: 'scale 90ms ease' });
    glyph.innerHTML = ARROW; glyph.style.transform = 'translate(-7.5px,-4.3px)';
    host.append(ring, glyph);
    document.body.appendChild(host);
    raise(); place(); visible();
    new MutationObserver(records => {
      if (records.some(r => r.target instanceof HTMLDialogElement && r.target.open)) raise();
    }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['open'] });
    document.addEventListener('toggle', event => { if (event.target !== host && event.newState === 'open') raise(); }, true);
  };
  const cursorFor = target => {
    if (!(target instanceof Element)) return 'arrow';
    const style = getComputedStyle(target).cursor;
    if (style === 'text') return 'text';
    if (style === 'auto' && (target.isContentEditable || target.closest('input:not([type=range]):not([type=checkbox]), textarea'))) return 'text';
    return 'arrow';
  };
  window.addEventListener('mousemove', event => {
    if (window.__promoTouchOnly) return;
    install(); x = event.clientX; y = event.clientY; hidden = false; visible(); place();
    setKind(cursorFor(document.elementFromPoint(x, y)));
  }, { capture: true, passive: true });
  window.addEventListener('mousedown', () => {
    if (window.__promoTouchOnly) return;
    install(); if (!ring) return;
    glyph.style.scale = '.86';
    ring.animate([{ opacity: .9, transform: 'scale(.3)' }, { opacity: 0, transform: 'scale(1.35)' }], { duration: 480, easing: 'cubic-bezier(.2,.7,.2,1)' });
  }, { capture: true, passive: true });
  window.addEventListener('mouseup', () => { if (glyph) glyph.style.scale = '1'; }, { capture: true, passive: true });
  window.addEventListener('keydown', event => { if (!['Meta', 'Shift', 'Control', 'Alt'].includes(event.key)) { hidden = true; visible(); } }, { capture: true, passive: true });
  const touchDot = (px, py) => {
    install(); if (!host) return;
    const dot = document.createElement('div');
    dot.setAttribute('popover', 'manual');
    // inset first: the shorthand would otherwise reset left/top.
    dot.style.inset = 'auto';
    Object.assign(dot.style, { position: 'fixed', left: (px - 22) + 'px', top: (py - 22) + 'px', margin: '0', padding: '0', width: '44px', height: '44px', borderRadius: '50%',
      background: 'rgba(255,255,255,.55)', border: '1.5px solid rgba(0,0,0,.28)', boxShadow: '0 2px 10px rgba(0,0,0,.25)', pointerEvents: 'none', overflow: 'visible' });
    host.parentNode.appendChild(dot);
    try { dot.showPopover(); } catch {}
    dot.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)', offset: .25 }, { opacity: 1, transform: 'scale(1)', offset: .6 }, { opacity: 0, transform: 'scale(1.15)' }],
      { duration: 520, easing: 'ease-out' }).finished.then(() => dot.remove());
  };
  window.addEventListener('pointerdown', event => { if (event.pointerType === 'touch') { hidden = true; visible(); touchDot(event.clientX, event.clientY); } }, { capture: true, passive: true });
  window.__promoCursor = { hide: v => { forced = v; visible(); }, raise, touch: touchDot };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();`;

// ---- browser ------------------------------------------------------------------------------
// Screencast frames come out at the browser's real scale factor, not the emulated one,
// so each scale factor gets its own browser.
const browsers = new Map();
export async function openBrowser(dsf = 2) {
  if (!browsers.has(dsf)) browsers.set(dsf, await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none', `--force-device-scale-factor=${dsf}`] }));
  return browsers.get(dsf);
}
export async function closeBrowsers() { for (const browser of browsers.values()) await browser.close(); browsers.clear(); }

export async function newPage(browser, { width = 1280, height = 800, dpr = 2, colorScheme = 'light', mobile = false, theme = 'day' } = {}) {
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: dpr, colorScheme, timezoneId: 'Europe/Stockholm', locale: 'en-US',
    isMobile: mobile, hasTouch: mobile, bypassCSP: true, reducedMotion: 'no-preference',
  });
  await context.addInitScript(`try { if (!sessionStorage.getItem('promo-theme-set')) { localStorage.setItem('still-theme', ${JSON.stringify(theme)}); sessionStorage.setItem('promo-theme-set', '1'); } } catch {}
    window.__promoTouchOnly = ${mobile};`);
  await context.addInitScript(CURSOR_SCRIPT);
  const page = await context.newPage();
  page.on('pageerror', error => console.error('[pageerror]', error.message));
  page.on('console', message => { if (message.type() === 'error') console.error('[console]', message.text()); });
  return { context, page };
}

// ---- recorder -----------------------------------------------------------------------------
export class Recorder {
  constructor(page, name, { quality = 92 } = {}) {
    this.page = page; this.name = name; this.quality = quality;
    this.dir = path.join(WORK, 'frames', name);
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
    this.frames = []; this.marks = []; this.events = []; this.pending = [];
  }
  async start() {
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      const file = path.join(this.dir, String(this.frames.length).padStart(6, '0') + '.jpg');
      this.frames.push({ file, t: metadata.timestamp });
      this.pending.push(fs.promises.writeFile(file, Buffer.from(data, 'base64')));
      this.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    const [w, h] = await this.page.evaluate(() => [Math.round(innerWidth * devicePixelRatio), Math.round(innerHeight * devicePixelRatio)]);
    this.size = [w, h];
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: this.quality, maxWidth: w, maxHeight: h, everyNthFrame: 1 });
    this.t0 = Date.now() / 1000;
    // Nudge a first frame out even on a static page.
    await this.page.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
    await sleep(120);
  }
  now() { return Date.now() / 1000 - this.t0; }
  mark(label, extra = {}) { const t = +this.now().toFixed(3); this.marks.push({ t, label, ...extra }); console.log(`  [${this.name}] ${t.toFixed(2)}s ${label}`); }
  event(type, extra = {}) { this.events.push({ t: +this.now().toFixed(3), type, ...extra }); }
  async stop() {
    this.t1 = Date.now() / 1000;
    await this.cdp.send('Page.stopScreencast');
    await Promise.all(this.pending);
    await this.cdp.detach().catch(() => {});
    fs.writeFileSync(path.join(this.dir, 'timestamps.json'), JSON.stringify({ t0: this.t0, t1: this.t1, frames: this.frames.map(f => +(f.t - this.t0).toFixed(4)) }));
  }
  // Encode to CFR MP4. Chrome only emits frames on change, so each output frame shows the latest
  // captured frame at that instant. Exact 1/fps timing via a symlinked image sequence.
  encode(outFile, { fps = 60, crf = 15, trimStart = 0, trimEnd = null } = {}) {
    const frames = [...this.frames].sort((a, b) => a.t - b.t);
    if (!frames.length) throw new Error('no frames captured');
    const start = this.t0 + Math.max(0, trimStart), end = trimEnd === null ? this.t1 : Math.min(this.t1, this.t0 + trimEnd);
    const total = Math.max(1, Math.round((end - start) * fps));
    const seq = path.join(this.dir, 'seq-' + path.basename(outFile, '.mp4'));
    fs.rmSync(seq, { recursive: true, force: true });
    fs.mkdirSync(seq, { recursive: true });
    let current = Math.max(0, frames.findLastIndex(f => f.t <= start));
    for (let k = 0; k < total; k++) {
      const t = start + k / fps;
      while (current + 1 < frames.length && frames[current + 1].t <= t) current++;
      fs.symlinkSync(frames[current].file, path.join(seq, String(k).padStart(6, '0') + '.jpg'));
    }
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(seq, '%06d.jpg'),
      '-vf', 'scale=in_range=pc:out_range=tv:flags=lanczos,format=yuv420p', '-color_range', 'tv', '-r', String(fps),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-tune', 'animation',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', outFile]);
    fs.rmSync(seq, { recursive: true, force: true });
    return outFile;
  }
  stats() {
    const ts = this.frames.map(f => f.t);
    const span = (this.t1 ?? ts.at(-1)) - this.t0;
    const gaps = ts.slice(1).map((t, i) => t - ts[i]);
    const busy = gaps.filter(g => g < 0.1);
    // Peak delivery rate: most frames inside any 0.5 s window, doubled.
    let peak = 0;
    for (let i = 0, j = 0; i < ts.length; i++) { while (ts[i] - ts[j] > 0.5) j++; peak = Math.max(peak, i - j + 1); }
    return { frames: ts.length, seconds: +span.toFixed(2), peakFps: peak * 2, firstFrameLag: +(ts[0] - this.t0).toFixed(3) };
  }
  writeLog(outFile) {
    fs.writeFileSync(outFile, JSON.stringify({ name: this.name, duration: +(this.t1 - this.t0).toFixed(3), marks: this.marks, events: this.events }, null, 2));
  }
}

// ---- human input --------------------------------------------------------------------------
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export class Hand {
  constructor(page, recorder = null) { this.page = page; this.rec = recorder; this.x = null; this.y = null; }
  async park(x, y) { await this.page.mouse.move(x, y); this.x = x; this.y = y; }
  // Glide along a gentle arc with ease-in-out, ~60 real mousemove events per second.
  async moveTo(x, y, { duration = null } = {}) {
    if (this.x === null) { await this.park(x, y); return; }
    const dx = x - this.x, dy = y - this.y, distance = Math.hypot(dx, dy);
    const ms = duration ?? Math.min(900, Math.max(260, 180 + distance * 0.55));
    const steps = Math.max(8, Math.round(ms / 16));
    const bow = Math.min(60, distance * 0.12) * (dx >= 0 ? 1 : -1);
    const nx = -dy / (distance || 1), ny = dx / (distance || 1);
    const sx = this.x, sy = this.y, begin = Date.now();
    for (let i = 1; i <= steps; i++) {
      const p = ease(i / steps), arc = Math.sin(Math.PI * p) * bow;
      await this.page.mouse.move(sx + dx * p + nx * arc, sy + dy * p + ny * arc);
      const wait = begin + (ms * i) / steps - Date.now();
      if (wait > 0) await sleep(wait);
    }
    this.x = x; this.y = y;
  }
  async box(target) {
    const locator = typeof target === 'string' ? this.page.locator(target).first() : target;
    await locator.waitFor({ state: 'visible' });
    const box = await locator.boundingBox();
    if (!box) throw new Error('no bounding box for target');
    return box;
  }
  async moveToTarget(target, { dx = null, dy = null, duration } = {}) {
    const box = await this.box(target);
    const x = box.x + (dx === null ? box.width / 2 : dx < 0 ? box.width + dx : dx);
    const y = box.y + (dy === null ? box.height / 2 : dy);
    await this.moveTo(x, y, { duration });
    return { x, y, box };
  }
  async click({ hold = 90, label = null } = {}) {
    await this.page.mouse.down(); await sleep(hold); await this.page.mouse.up();
    this.rec?.event('click', { x: Math.round(this.x), y: Math.round(this.y), label });
  }
  async clickTarget(target, options = {}) {
    await this.moveToTarget(target, options);
    await sleep(options.settle ?? 140);
    await this.click({ label: options.label ?? (typeof target === 'string' ? target : null) });
  }
  // Human-ish typing: per-character real key events with a little rhythm.
  async type(text, { cps = 13, jitter = 0.45 } = {}) {
    this.rec?.event('type', { text });
    const base = 1000 / cps;
    for (const ch of text) {
      await this.page.keyboard.type(ch);
      let wait = base * (1 - jitter / 2 + Math.random() * jitter);
      if (ch === ' ') wait *= 1.15;
      if (',.:'.includes(ch)) wait *= 2.2;
      await sleep(wait);
    }
  }
  async press(key, { label = null } = {}) {
    await this.page.keyboard.press(key);
    this.rec?.event('key', { key, label });
  }
  // A finger tap (phone takes): real touch events, shown as a soft disc by the overlay.
  async tapTarget(target, { dx = null, dy = null, label = null } = {}) {
    const box = await this.box(target);
    const x = box.x + (dx === null ? box.width / 2 : dx < 0 ? box.width + dx : dx), y = box.y + (dy === null ? box.height / 2 : dy);
    await this.page.touchscreen.tap(x, y);
    this.x = x; this.y = y;
    this.rec?.event('tap', { x: Math.round(x), y: Math.round(y), label: label ?? (typeof target === 'string' ? target : null) });
  }
  // After Enter the next draft opens while the previous save is in flight; wait for the empty editor.
  async waitEmpty(timeout = 3000) {
    await this.page.waitForFunction(() => {
      const el = document.activeElement;
      return !!el && el.getAttribute('contenteditable') === 'true' && (el.textContent ?? '') === '';
    }, null, { timeout }).catch(() => console.warn('  (editor did not clear in time)'));
  }
  async wheel(dy, { steps = 12, ms = 420 } = {}) {
    for (let i = 0; i < steps; i++) { await this.page.mouse.wheel(0, dy / steps); await sleep(ms / steps); }
  }
}

// ---- stills -------------------------------------------------------------------------------
export async function still(page, name, { cursor = false } = {}) {
  if (!cursor) await page.evaluate(() => window.__promoCursor?.hide(true));
  await sleep(260); // the cursor fades over 140 ms
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, animations: 'allow' });
  if (!cursor) await page.evaluate(() => window.__promoCursor?.hide(false));
  console.log(`  still ${name}`);
  return file;
}

export async function reseed() {
  execFileSync('python3', [path.join(HERE, 'seed_demo.py'), DB, String(PORT)], { stdio: 'inherit' });
}

export async function openApp(page, { url = '/', ready = true } = {}) {
  await page.goto(BASE + url, { waitUntil: 'networkidle' });
  if (ready) await page.getByRole('heading', { name: /to do/i }).or(page.getByText('to do').first()).first().waitFor({ timeout: 10000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
}
