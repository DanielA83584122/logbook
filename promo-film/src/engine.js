// Frame engine: every visual is a pure function of time. window.seek(frame) sets the whole
// stage for that frame and resolves once every footage image it needs is decoded.
'use strict';

const Q = new URLSearchParams(location.search);
const FORMAT = Q.get('format') === '9x16' ? '9x16' : '16x9';
const P = FORMAT === '9x16';                       // portrait
const W = P ? 1080 : 1920, H = P ? 1920 : 1080;
// The same 32-beat film at two lengths: 15 s (128 bpm) or 30 s (64 bpm, everything paced at half speed).
const DURATION = Q.get('length') === '30' ? 30 : 15;
const TIMING = window.__TIMING[DURATION];           // footage retime keys and per-length beats
const FPS = 60, BPM = TIMING.bpm, BEAT = 60 / BPM;
const b = n => n * BEAT;                           // beats → seconds
const NAVY = '#011627', DEEP = '#000d18', PAPER = '#f1efea', TEAL = '#75d1c4', SLATE = '#8ca0b0';

// ---- math -------------------------------------------------------------------------------
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const lerp = (a, c, t) => a + (c - a) * t;
const inv = (a, c, x) => clamp((x - a) / (c - a));
const E = {
  linear: t => t,
  inQuad: t => t * t, outQuad: t => 1 - (1 - t) * (1 - t),
  inCubic: t => t * t * t, outCubic: t => 1 - Math.pow(1 - t, 3),
  inOutCubic: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  outQuart: t => 1 - Math.pow(1 - t, 4), inQuart: t => t * t * t * t,
  outExpo: t => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t), inExpo: t => t <= 0 ? 0 : Math.pow(2, 10 * t - 10),
  inOutExpo: t => t <= 0 ? 0 : t >= 1 ? 1 : t < .5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
  outBack: t => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
};
const tw = (t, t0, t1, from, to, ease = E.outCubic) => lerp(from, to, ease(inv(t0, t1, t)));

// Damped spring, closed form. dt = seconds since the spring was released.
const SPRING = {
  snap: { stiffness: 320, damping: 26 },   // quick, barely overshoots
  pop: { stiffness: 420, damping: 17 },    // lively overshoot
  soft: { stiffness: 140, damping: 19 },   // slow settle
  wobble: { stiffness: 260, damping: 9 },  // bouncy
};
function spring(dt, { from = 0, to = 1, stiffness = 320, damping = 26, mass = 1, velocity = 0 } = {}) {
  if (dt <= 0) return from;
  const w0 = Math.sqrt(stiffness / mass), zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const x0 = from - to, v0 = -velocity;
  let x;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    x = Math.exp(-zeta * w0 * dt) * (x0 * Math.cos(wd * dt) + (v0 + zeta * w0 * x0) / wd * Math.sin(wd * dt));
  } else {
    x = (x0 + (v0 + w0 * x0) * dt) * Math.exp(-w0 * dt);
  }
  return to + x;
}
const sp = (t, t0, preset = 'snap', from = 0, to = 1) => spring(t - t0, { ...SPRING[preset], from, to });

// Deterministic randomness.
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const hash = (n, s = 1) => rng((n * 2654435761 + s * 97) >>> 0)();

// Piecewise-linear retime: [[filmTime, sourceTime], ...]
function retime(keys, t) {
  if (t <= keys[0][0]) return keys[0][1] + (t - keys[0][0]);
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) return lerp(keys[i - 1][1], keys[i][1], (t - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]));
  }
  const last = keys[keys.length - 1];
  return last[1] + (t - last[0]);
}
// Film time at which the source reaches srcTime (for syncing HUD to footage events).
function untime(keys, s) {
  for (let i = 1; i < keys.length; i++) {
    if (s <= keys[i][1]) return lerp(keys[i - 1][0], keys[i][0], (s - keys[i - 1][1]) / (keys[i][1] - keys[i - 1][1]));
  }
  return keys[keys.length - 1][0];
}

// ---- fonts ------------------------------------------------------------------------------
const FONTS_READY = Promise.all(['800 100px Inter', '600 100px Inter', '500 100px Inter', 'italic 400 100px Serif', '400 100px Serif', '400 100px Mono', '700 100px Mono']
  .map(f => document.fonts.load(f)));

// ---- DOM --------------------------------------------------------------------------------
const stage = document.getElementById('stage');
stage.style.width = W + 'px'; stage.style.height = H + 'px';
function el(tag, cls, parent, style) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (style) Object.assign(node.style, style);
  if (parent) parent.appendChild(node);
  return node;
}
const px = v => v + 'px';
function place(node, x, y, { s = 1, sx = s, sy = s, r = 0, o = 1, ox = 0, oy = 0, extra = '' } = {}) {
  node.style.transform = `translate(${x}px, ${y}px) translate(${-ox * 100}%, ${-oy * 100}%) rotate(${r}deg) scale(${sx}, ${sy}) ${extra}`;
  node.style.opacity = o;
}
const svgNS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, parent) { const n = document.createElementNS(svgNS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (parent) parent.appendChild(n); return n; }

// ---- footage ----------------------------------------------------------------------------
// Frames are pre-extracted from promo-capture/*.mp4: /cache/<take>/<index>.jpg, index = round(t * 60).
const TAKES = {
  'rec-01-write-and-tag': { w: 2560, h: 1600, frames: 978 },
  'rec-02-check-off-todo': { w: 2560, h: 1600, frames: 808 },
  'rec-03-focus-timer': { w: 2560, h: 1600, frames: 1032 },
  'rec-04-tags-and-night': { w: 2560, h: 1600, frames: 931 },
  'rec-05-search-and-stats': { w: 2560, h: 1600, frames: 797 },
  'rec-06-phone-night': { w: 1170, h: 2532, frames: 697 },
};
const pending = [];
class Footage {
  constructor(take, { small = false } = {}) {
    this.take = take; this.small = small; this.info = TAKES[take]; this.cur = -1;
    this.img = el('img');
    this.img.width = small ? Math.round(this.info.w / 4) : this.info.w;
    this.img.height = small ? Math.round(this.info.h / 4) : this.info.h;
    if (small) { this.img.style.width = this.info.w + 'px'; this.img.style.height = this.info.h + 'px'; }
  }
  at(src) {
    const i = Math.round(clamp(src * FPS, 0, this.info.frames - 1));
    if (i !== this.cur) {
      this.cur = i;
      this.img.src = `/cache/${this.take}${this.small ? '-s' : ''}/${String(i).padStart(5, '0')}.jpg`;
      pending.push(this.img.decode().catch(() => {}));
    }
  }
}

// A clipped viewport onto a footage image with a camera: centre (x, y) in source px and zoom z
// (screen px per source px). Overlays inside .ov use the view's own coordinates.
class View {
  constructor(parent, take, w, h, opts = {}) {
    this.w = w; this.h = h;
    this.el = el('div', 'view', parent, { width: px(w), height: px(h) });
    this.cam = el('div', 'cam', this.el);
    this.footage = new Footage(take, opts);
    this.cam.appendChild(this.footage.img);
    this.ov = el('div', 'ov', this.el);
    this.c = { x: this.footage.info.w / 2, y: this.footage.info.h / 2, z: w / this.footage.info.w };
  }
  set(src, x, y, z) {
    this.footage.at(src);
    const { w: fw, h: fh } = this.footage.info;
    // keep the frame covered: no empty edges
    z = Math.max(z, this.w / fw, this.h / fh);
    x = clamp(x, this.w / 2 / z, fw - this.w / 2 / z);
    y = clamp(y, this.h / 2 / z, fh - this.h / 2 / z);
    this.c = { x, y, z };
    this.cam.style.transform = `translate(${this.w / 2 - x * z}px, ${this.h / 2 - y * z}px) scale(${z})`;
  }
  // source px → view px
  map(sx, sy) { return [this.w / 2 + (sx - this.c.x) * this.c.z, this.h / 2 + (sy - this.c.y) * this.c.z]; }
  mapRect([x, y, w, h]) { const [a, c] = this.map(x, y); return [a, c, w * this.c.z, h * this.c.z]; }
}

// ---- mockups ----------------------------------------------------------------------------
class Browser {
  constructor(parent, take, w, h, { title = 'logbook', bar = 44 } = {}) {
    this.w = w; this.h = h; this.barH = bar;
    this.el = el('div', 'browser', parent, { width: px(w), height: px(h + bar) });
    this.bar = el('div', 'bar', this.el, { height: px(bar) });
    ['#ff5f57', '#febc2e', '#28c840'].forEach(c => el('div', 'dot', this.bar, { background: c }));
    this.title = el('div', 'title', this.bar, { color: '#6c7176' });
    this.title.textContent = title;
    this.view = new View(this.el, take, w, h);
    this.view.el.style.top = px(bar);
    this.night(false);
  }
  night(on) {
    this.el.style.background = on ? '#0a2233' : '#e8e6e0';
    this.title.style.color = on ? '#8ca0b0' : '#6c7176';
  }
}

class Phone {
  constructor(parent, take, h) {
    const { w: fw, h: fh } = TAKES[take];
    const sh = h - 36, sw = sh * fw / fh, bezel = 18;
    this.w = sw + bezel * 2; this.h = h;
    this.el = el('div', 'phone', parent, { width: px(this.w), height: px(this.h), borderRadius: px(this.w * .16) });
    this.glass = el('div', 'glass', this.el, { left: px(bezel), top: px(bezel), width: px(sw), height: px(h - bezel * 2), borderRadius: px(this.w * .13) });
    this.view = new View(this.glass, take, sw, h - bezel * 2);
    el('div', 'island', this.glass, { width: px(sw * .3), height: px(sw * .085), left: px(sw * .35), top: px(sw * .03) });
  }
}

// ---- kinetic type -----------------------------------------------------------------------
// A line made of words; each word rises out of its own mask.
class Line {
  constructor(parent, parts, { size = 120, color = PAPER, weight = 800 } = {}) {
    this.el = el('div', 'kt', parent, { fontSize: px(size), color, fontWeight: weight });
    this.words = parts.map(part => {
      const [text, cls = '', style = {}] = Array.isArray(part) ? part : [part];
      const wrap = el('span', 'w ' + cls, this.el, style);
      const inner = el('span', '', wrap);
      inner.textContent = text;
      wrap.after(document.createTextNode(' '));
      return inner;
    });
  }
  // Words enter at t0 + i*stagger with a spring, exit at t1 by dropping away.
  run(t, t0, { stagger = .07, preset = 'pop', t1 = Infinity, exit = 'down', from = 110 } = {}) {
    this.words.forEach((w, i) => {
      // hidden outside its life so no glyph edge peeks out of the mask
      w.style.visibility = t < t0 + i * stagger || t > t1 + .2 ? 'hidden' : 'visible';
      const y = sp(t, t0 + i * stagger, preset, from, 0);
      let out = 0;
      if (t >= t1) out = exit === 'up' ? -tw(t, t1, t1 + .18, 0, 115, E.inCubic) : tw(t, t1, t1 + .18, 0, 115, E.inCubic);
      const r = sp(t, t0 + i * stagger, preset, 6, 0);
      w.style.transform = `translateY(${y + out}%) rotate(${r}deg)`;
    });
  }
  at(x, y, opts = {}) { place(this.el, x, y, opts); return this; }
  width() { return this.el.offsetWidth; }
}

// Characters typed one by one with a block caret.
class Typer {
  constructor(parent, text, { size = 28, color = TEAL, cls = 'mono' } = {}) {
    this.text = text;
    this.el = el('div', cls, parent, { position: 'absolute', left: 0, top: 0, fontSize: px(size), color, whiteSpace: 'nowrap', textTransform: 'none', letterSpacing: '.02em' });
    this.span = el('span', '', this.el);
    this.caret = el('span', '', this.el, { display: 'inline-block', width: '.6em', height: '1.05em', background: color, verticalAlign: '-.15em', marginLeft: '.08em' });
  }
  run(t, t0, t1, blink = true) {
    const n = Math.floor(clamp((t - t0) / (t1 - t0)) * this.text.length);
    this.span.textContent = this.text.slice(0, n);
    this.caret.style.opacity = t < t1 || !blink ? 1 : (Math.floor((t - t1) / .266) % 2 ? 0 : 1);
  }
}

// ---- global chrome: backdrop, HUD, grain, flash --------------------------------------------
const back = el('div', 'layer', stage);
const backGlow = el('div', 'layer', back);
const grid = el('div', 'layer', back, { opacity: .5 });
const scenesLayer = el('div', 'layer', stage);
const vignette = el('div', 'layer', stage, { background: `radial-gradient(ellipse ${P ? '120% 80%' : '85% 95%'} at 50% 50%, transparent 55%, rgba(0,6,12,.55) 100%)` });
const grain = el('div', 'layer', stage, { mixBlendMode: 'overlay', opacity: .15 });
const hud = el('div', 'layer', stage);
const flashEl = el('div', 'layer', stage, { opacity: 0 });

// Grain tiles.
const GRAIN = [];
for (let k = 0; k < 8; k++) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), img = g.createImageData(256, 256), r = rng(1000 + k);
  for (let i = 0; i < img.data.length; i += 4) { const v = r() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  GRAIN.push(`url(${c.toDataURL()})`);
}

// HUD furniture.
const HUD_INSET = P ? 44 : 40;
const hudSvg = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, hud);
hudSvg.style.position = 'absolute';
const corners = [[0, 0, 1, 1], [W, 0, -1, 1], [0, H, 1, -1], [W, H, -1, -1]].map(([x, y, dx, dy]) => {
  const g = svg('g', {}, hudSvg);
  svg('path', { d: `M ${dx * 34} 0 L 0 0 L 0 ${dy * 34}`, fill: 'none', stroke: PAPER, 'stroke-width': 2, 'stroke-opacity': .7 }, g);
  return { g, x, y, dx, dy };
});
const tlLabel = el('div', 'hud-label', hud, { opacity: .85 });
const trLabel = el('div', 'hud-label', hud, { opacity: .85 });
const blLabel = el('div', 'hud-label', hud, { color: TEAL });
const brLabel = el('div', 'hud-label', hud, { opacity: .85 });
const recDot = el('span', '', null, { display: 'inline-block', width: '9px', height: '9px', borderRadius: '50%', background: '#ff4d4d', marginRight: '10px', verticalAlign: '1px' });
const beatDots = [0, 1, 2, 3].map(() => el('span', '', null, { display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', marginLeft: '7px', verticalAlign: '1px' }));
const progTrack = el('div', 'abs', hud, { height: '2px', background: 'rgba(241,239,234,.18)' });
const progFill = el('div', 'abs', progTrack, { height: '2px', background: TEAL, transformOrigin: '0 0' });
for (let k = 1; k < 8; k++) el('div', 'abs', progTrack, { left: `${k * 12.5}%`, top: '-4px', width: '1px', height: '10px', background: 'rgba(241,239,234,.35)' });

const SCRAMBLE = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#/_·';
function scramble(text, t, t0, frame) {
  const k = clamp((t - t0) / .28);
  if (k >= 1) return text;
  const r = rng(frame * 7 + text.length);
  return [...text].map((ch, i) => (i / text.length < k || ch === ' ') ? ch : SCRAMBLE[Math.floor(r() * SCRAMBLE.length)]).join('');
}

const hudState = { label: '', labelAt: 0, visible: 1, tone: 'dark', hide: [] };
function setHud(t, label, at, { visible = 1 } = {}) { hudState.label = label; hudState.labelAt = at; hudState.visible = visible; }

function timecode(frame) {
  const s = Math.floor(frame / FPS), f = frame % FPS;
  return `00:00:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

// Flashes and glitches are declared as events on the timeline.
const FLASHES = [];   // { t, dur, color, peak }
const GLITCHES = [];  // { t, dur, amp }
const flash = (t, dur = .12, color = PAPER, peak = .9) => FLASHES.push({ t, dur, color, peak });
const glitch = (t, dur = .1, amp = 14) => GLITCHES.push({ t, dur, amp });
const rgbR = document.getElementById('rgb-r'), rgbB = document.getElementById('rgb-b');
const mblurG = document.getElementById('mblur-g');

// Page tone per time: 'dark' (navy) or 'light' (paper) backdrops, chosen by scenes.
let backdropTone = 'dark';
function setBackdrop(tone) { backdropTone = tone; }

function updateChrome(t, frame) {
  // backdrop
  const light = backdropTone === 'light';
  back.style.background = light ? PAPER : NAVY;
  backGlow.style.background = light
    ? 'radial-gradient(ellipse 70% 60% at 50% 45%, #ffffff 0%, rgba(255,255,255,0) 70%)'
    : `radial-gradient(ellipse 60% 55% at ${50 + Math.sin(t * .6) * 6}% ${42 + Math.cos(t * .5) * 5}%, rgba(117,209,196,.13) 0%, rgba(1,22,39,0) 70%)`;
  const gs = 64, drift = (t * 18) % gs;
  grid.style.backgroundImage = `linear-gradient(${light ? 'rgba(1,22,39,.07)' : 'rgba(117,209,196,.07)'} 1px, transparent 1px), linear-gradient(90deg, ${light ? 'rgba(1,22,39,.07)' : 'rgba(117,209,196,.07)'} 1px, transparent 1px)`;
  grid.style.backgroundSize = `${gs}px ${gs}px`;
  grid.style.backgroundPosition = `${-drift}px ${-drift * .5}px`;
  vignette.style.opacity = light ? .25 : 1;

  // grain
  const g2 = Math.floor(frame / 2), gr = rng(g2 + 11);   // grain moves at 30 Hz
  grain.style.backgroundImage = GRAIN[g2 % GRAIN.length];
  grain.style.backgroundSize = '384px 384px';
  grain.style.backgroundPosition = `${Math.floor(gr() * 384)}px ${Math.floor(gr() * 384)}px`;

  // HUD
  const beatIndex = Math.floor(t / BEAT + 1e-6), inBeat = t - beatIndex * BEAT;
  const pulse = Math.exp(-inBeat * 9) * (beatIndex % 4 === 0 ? 1 : .55);
  const ink = light ? NAVY : PAPER;
  hud.style.opacity = hudState.visible;
  const boot = spring(t - .02, { ...SPRING.pop, from: 1, to: 0 });
  corners.forEach(({ g, x, y, dx, dy }) => {
    const push = 6 * pulse - boot * 160;
    g.setAttribute('transform', `translate(${x + dx * (HUD_INSET - push)}, ${y + dy * (HUD_INSET - push)})`);
    g.firstChild.setAttribute('stroke', ink);
  });
  for (const label of [tlLabel, trLabel, brLabel]) label.style.color = ink;
  const top = HUD_INSET + (P ? 14 : 12), bottom = H - HUD_INSET - (P ? 30 : 26);
  tlLabel.textContent = 'logbook / promo_15s';
  place(tlLabel, HUD_INSET + 50, top);
  trLabel.textContent = timecode(frame);
  place(trLabel, W - HUD_INSET - 50, top, { ox: 1 });
  blLabel.textContent = scramble(hudState.label, t, hudState.labelAt, frame);
  blLabel.style.color = light ? '#0b7a6c' : TEAL;
  place(blLabel, HUD_INSET + 50, bottom);
  brLabel.textContent = '';
  recDot.style.opacity = Math.floor(t / (BEAT * 2)) % 2 ? .35 : 1;
  brLabel.append(recDot, document.createTextNode(`${BPM} bpm`));
  beatDots.forEach((dot, i) => { dot.style.background = i === beatIndex % 4 ? TEAL : (light ? 'rgba(1,22,39,.25)' : 'rgba(241,239,234,.25)'); brLabel.append(dot); });
  place(brLabel, W - HUD_INSET - 50, bottom, { ox: 1 });
  const trackW = P ? W - 2 * HUD_INSET - 100 : 520;
  Object.assign(progTrack.style, { width: px(trackW) });
  place(progTrack, P ? HUD_INSET + 50 : (W - trackW) / 2, P ? bottom - 30 : bottom + 9);
  progFill.style.width = px(trackW);
  progFill.style.transform = `scaleX(${t / DURATION})`;
  progTrack.style.background = light ? 'rgba(1,22,39,.15)' : 'rgba(241,239,234,.18)';

  // flash
  let fo = 0, fc = PAPER;
  for (const f of FLASHES) if (t >= f.t && t < f.t + f.dur) { const v = f.peak * (1 - (t - f.t) / f.dur); if (v > fo) { fo = v; fc = f.color; } }
  flashEl.style.opacity = fo; flashEl.style.background = fc;

  // glitch
  let g = 0;
  for (const e of GLITCHES) if (t >= e.t && t < e.t + e.dur) g = Math.max(g, e.amp * (1 - (t - e.t) / e.dur));
  if (g > .5) {
    const r = rng(frame * 13);
    rgbR.setAttribute('dx', (g * (r() - .2)).toFixed(1)); rgbB.setAttribute('dx', (-g * (r() - .2)).toFixed(1));
    rgbR.setAttribute('dy', (g * .2 * (r() - .5)).toFixed(1));
    scenesLayer.style.filter = 'url(#rgb)';
    scenesLayer.style.transform = `translateX(${(r() - .5) * g * .8}px)`;
  } else { scenesLayer.style.filter = 'none'; scenesLayer.style.transform = 'none'; }
}

// ---- timeline -----------------------------------------------------------------------------
const SCENES = [];
function scene(start, end, build) {
  const root = el('div', 'layer scene', scenesLayer);
  const s = { start, end, root, update: null };
  s.update = build(root, s);
  SCENES.push(s);
  return s;
}

window.seek = async function seek(frame) {
  await FONTS_READY;
  const t = frame / FPS;
  pending.length = 0;
  setBackdrop('dark');
  for (const s of SCENES) {
    const on = t >= s.start && t < s.end;
    s.root.style.display = on ? '' : 'none';
    if (on) s.update(t, t - s.start, frame);
  }
  updateChrome(t, frame);
  await FONTS_READY;
  await Promise.all(pending);
};
window.FILM = { W, H, FPS, DURATION, FORMAT };
