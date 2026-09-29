// The film: 15.00 s at 128 bpm = 32 beats = 8 bars. Hard cuts land on beats.
'use strict';

const LAYOUT = window.__LAYOUT;      // UI element boxes in each take, in source pixels
const JOURNAL = window.__JOURNAL;    // the app's own /journal.md for the demo logbook
const STATS = window.__STATS;        // /api/stats/daily for the last 30 days
const T1 = 'rec-01-write-and-tag', T2 = 'rec-02-check-off-todo', T3 = 'rec-03-focus-timer',
  T4 = 'rec-04-tags-and-night', T5 = 'rec-05-search-and-stats', T6 = 'rec-06-phone-night';

// ---- shared pieces -------------------------------------------------------------------------
// Where the browser window sits in the scenes that use one.
const WIN = P ? { x: 40, y: 800, w: 1000, h: 900 } : { x: 548, y: 118, w: 1320, h: 825 };
const TYPE = P ? { x: 88, y: 290, size: 132 } : { x: 108, y: 300, size: 116 };

// Legibility wash behind type that sits on top of footage.
function wash(root, dir = 'left') {
  const bg = dir === 'left' ? 'linear-gradient(90deg, rgba(1,22,39,.92) 0%, rgba(1,22,39,.75) 30%, rgba(1,22,39,0) 55%)'
    : 'linear-gradient(180deg, rgba(1,22,39,.94) 0%, rgba(1,22,39,.8) 35%, rgba(1,22,39,0) 52%)';
  return el('div', 'layer', root, { background: bg, opacity: 0 });
}

function perspectiveWrap(root) {
  return el('div', 'layer', root, { perspective: '2400px', perspectiveOrigin: P ? '50% 40%' : '30% 50%' });
}
// Window entrance: swings in from depth with a spring, then drifts.
function swingIn(node, t, t0, { x = WIN.x, y = WIN.y, ry0 = -26, ry1 = -6, rx0 = 16, rx1 = 3, s0 = .8, dy = 140 } = {}) {
  const e = sp(t, t0, 'snap', 0, 1);
  const drift = (t - t0) * .9;
  node.style.transformOrigin = '50% 50%';
  node.style.transform = `translate(${x}px, ${y + lerp(dy, 0, e)}px) rotateY(${lerp(ry0, ry1, e) + drift}deg) rotateX(${lerp(rx0, rx1, e)}deg) scale(${lerp(s0, 1, e)})`;
}

// Corner-bracket reticle drawn in a view's overlay, springing onto a rect.
class Reticle {
  constructor(parent, label, { color = TEAL } = {}) {
    this.svg = svg('svg', { width: 10, height: 10 }, parent);
    Object.assign(this.svg.style, { position: 'absolute', left: 0, top: 0, overflow: 'visible' });
    this.corners = [0, 1, 2, 3].map(() => svg('path', { fill: 'none', stroke: color, 'stroke-width': 3, 'stroke-linecap': 'square' }, this.svg));
    this.lead = svg('path', { fill: 'none', stroke: color, 'stroke-width': 2 }, this.svg);
    this.tag = el('div', 'hud-label', parent, { color: NAVY, background: color, padding: '5px 10px 4px', fontWeight: 700, fontSize: '15px', letterSpacing: '.1em' });
    this.tag.textContent = label;
  }
  draw(t, t0, [x, y, w, h], { t1 = Infinity, side = 'right', pad = 10, arm = 16 } = {}) {
    const on = t >= t0 && t < t1 + .2;
    this.svg.style.display = this.tag.style.display = on ? '' : 'none';
    if (!on) return;
    const grow = sp(t, t0, 'pop', 1.9, 1), fade = t > t1 ? 1 - inv(t1, t1 + .2, t) : 1;
    const cx = x + w / 2, cy = y + h / 2, hw = (w / 2 + pad) * grow, hh = (h / 2 + pad) * grow;
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    this.corners.forEach((c, i) => {
      const [sx, sy] = pts[i], px0 = cx + sx * hw, py0 = cy + sy * hh;
      c.setAttribute('d', `M ${px0 - sx * arm} ${py0} L ${px0} ${py0} L ${px0} ${py0 - sy * arm}`);
    });
    const k = E.outCubic(inv(t0 + .08, t0 + .3, t));
    const ax = side === 'right' ? cx + hw : cx - hw, lx = ax + (side === 'right' ? 60 : -60) * k;
    this.lead.setAttribute('d', `M ${ax} ${cy} L ${lx} ${cy}`);
    this.svg.style.opacity = fade;
    place(this.tag, lx + (side === 'right' ? 8 : -8), cy, { oy: .5, ox: side === 'right' ? 0 : 1, o: fade * k, s: lerp(.6, 1, k) });
  }
}

// Expanding rings, e.g. around the timer.
class Rings {
  constructor(parent, n = 3, color = TEAL) {
    this.svg = svg('svg', { width: 10, height: 10 }, parent);
    Object.assign(this.svg.style, { position: 'absolute', left: 0, top: 0, overflow: 'visible' });
    this.c = Array.from({ length: n }, () => svg('circle', { fill: 'none', stroke: color }, this.svg));
  }
  draw(t, t0, x, y, r0 = 30, r1 = 260) {
    this.c.forEach((c, i) => {
      const k = inv(t0 + i * .09, t0 + i * .09 + .7, t);
      const on = k > 0 && k < 1;
      c.setAttribute('cx', x); c.setAttribute('cy', y);
      c.setAttribute('r', lerp(r0, r1, E.outCubic(k)));
      c.setAttribute('stroke-width', lerp(6, .5, k));
      c.setAttribute('opacity', on ? (1 - k) : 0);
    });
  }
}

// A stack of kinetic lines.
function stack(root, lines, { x = TYPE.x, y = TYPE.y, size = TYPE.size, gap = .98, color = PAPER } = {}) {
  return lines.map((parts, i) => new Line(root, parts, { size, color }).at(x, y + i * size * gap));
}
function runStack(lines, t, t0, opts = {}) {
  lines.forEach((line, i) => line.run(t, t0 + i * (opts.lineStagger ?? .08), opts));
}

// Keycap that slams down and bounces.
class Keycap {
  constructor(parent, label, size = 150) {
    this.el = el('div', 'key', parent, { width: px(size), height: px(size), fontSize: px(size * .52) });
    this.el.textContent = label;
    this.size = size;
  }
  draw(t, t0, x, y, { t1 = Infinity, press = t0 + .12, fall = 260 } = {}) {
    const on = t >= t0 && t < t1 + .25;
    this.el.style.display = on ? '' : 'none';
    if (!on) return;
    const drop = sp(t, t0, 'pop', -fall, 0);
    const down = t >= press ? Math.exp(-(t - press) * 18) * 14 : 0;
    const out = t > t1 ? tw(t, t1, t1 + .25, 0, 1, E.inCubic) : 0;
    this.el.style.boxShadow = `0 ${14 - down}px 0 #9d9a93, 0 30px 60px rgba(0,0,0,.45), inset 0 2px 0 #fff`;
    place(this.el, x, y + drop + down + out * 240, { ox: .5, oy: .5, r: sp(t, t0, 'wobble', -12, 0) + out * 25, o: 1 - out, s: sp(t, t0, 'pop', 1.3, 1) });
  }
}

// ---- 00 · intro: "the best productivity system is a text file." ----------------------------
scene(0, b(4), root => {
  const x = P ? 90 : 150;
  // a faint editor view of the demo logbook's own journal.md, line numbers and all
  const paper = el('div', 'abs', root, { left: px(x - 70), top: 0, width: px(W), maskImage: 'linear-gradient(180deg, transparent, #000 18%, #000 70%, transparent)' });
  const source = JOURNAL.split('\n').filter(l => l.trim() && !l.startsWith('```') && !/Metadata:/.test(l) && !/^\s*[{}"]/.test(l));
  const rows = [];
  while (rows.length < (P ? 70 : 44)) rows.push(...source);
  const listing = el('pre', '', paper, { margin: 0, font: `400 ${P ? 22 : 19}px/1.75 Mono`, color: SLATE, whiteSpace: 'pre' });
  listing.innerHTML = rows.slice(0, P ? 70 : 44).map((l, i) => `<span style="color:#2e4a60">${String(i + 1).padStart(3, ' ')}</span>   ${l.replace(/&/g, '&amp;').replace(/</g, '&lt;').slice(0, 90)}`).join('\n');
  const current = el('div', 'abs', root, { left: 0, width: px(W), height: px(P ? 58 : 52), background: 'rgba(117,209,196,.07)', borderTop: '1px solid rgba(117,209,196,.12)', borderBottom: '1px solid rgba(117,209,196,.12)' });
  const typer = new Typer(root, '// the best productivity system', { size: P ? 36 : 32 });
  const l1 = new Line(root, ['is', 'a'], { size: P ? 170 : 150 });
  const l2 = new Line(root, [['text', 'serif', { color: TEAL }], ['file.', 'serif', { color: TEAL }]], { size: P ? 280 : 250 });
  const caret = el('div', 'abs', root, { width: px(P ? 30 : 26), background: TEAL });
  const scan = el('div', 'abs', root, { width: px(W), height: '2px', background: 'linear-gradient(90deg, transparent, rgba(117,209,196,.8), transparent)' });
  flash(b(4), .1, PAPER, 1);
  glitch(b(2.5), .1, 12);
  glitch(b(4), .08, 18);
  return t => {
    setHud(t, '00 · boot', .1);
    const y0 = P ? 640 : 250;
    typer.run(t, .06, b(1.8));
    place(typer.el, x, y0);
    place(paper, 0, -t * 26 - (P ? 60 : 40), { o: tw(t, 0, .45, 0, .16) * (1 - tw(t, b(2), b(2.4), 0, .45)) });
    place(current, 0, y0 - (P ? 12 : 10), { o: tw(t, .05, .3, 0, 1) * (1 - inv(b(1.9), b(2.1), t)) });
    l1.at(x, y0 + (P ? 70 : 62)); l1.run(t, b(2), { stagger: .07 });
    l2.at(x - 10, y0 + (P ? 250 : 215)); l2.run(t, b(2.5), { stagger: .1, preset: 'wobble' });
    // caret after "file."
    const cw = l2.width();
    const blink = Math.floor((t - b(3)) / (BEAT / 2)) % 2 === 0;
    caret.style.height = px(P ? 220 : 196);
    place(caret, x - 10 + cw + 6, y0 + (P ? 285 : 240), { o: t > b(3) ? (blink ? 1 : 0) : 0 });
    place(scan, 0, lerp(-10, H + 10, (t * .9) % 1), { o: .35 });
    // the whole thought rushes into the lens before the cut
    const k = tw(t, b(3.4), b(4), 0, 1, E.inExpo);
    root.style.transformOrigin = P ? '40% 50%' : '32% 55%';
    root.style.transform = `scale(${1 + k * 1.6})`;
    root.style.filter = k > .02 ? `blur(${k * 10}px)` : 'none';
    root.style.opacity = 1 - k * .6;
  };
});

// ---- 01 · write: typing, a #tag chip forms --------------------------------------------------
scene(b(4), b(8), root => {
  const keys = TIMING.S1, chipAt = TIMING.chipAt;
  const wrap = perspectiveWrap(root);
  const br = new Browser(wrap, T1, WIN.w, WIN.h);
  const ret = new Reticle(br.view.ov, 'tag · #launch');
  const lines = stack(root, [['write'], ['it'], [['down.', 'serif', { color: TEAL }]]]);
  // keycaps for "#", "l", "a", "⏎" — at the moments they are typed in the footage
  const caps = [['#', 3.754], ['l', 4.169], ['a', 4.24], ['⏎', 4.984]].map(([k, s]) => ({ cap: new Keycap(root, k, P ? 100 : 96), at: untime(keys, s) }));
  glitch(b(6.5), .06, 10);
  return (t, lt) => {
    setHud(t, '01 · write', b(4));
    swingIn(br.el, t, b(4));
    const src = retime(keys, t);
    // camera: whole page → the line being written
    const k = E.inOutCubic(inv(b(4.4), b(7.1), t));
    const z0 = P ? .66 : WIN.w / 2560, z1 = P ? 1.02 : .98;
    const bump = t > chipAt ? Math.exp(-(t - chipAt) * 7) * Math.sin((t - chipAt) * 30) * .025 : 0;
    br.view.set(src, lerp(P ? 1320 : 1280, P ? 1180 : 1300, k), lerp(P ? 640 : 800, 790, k), lerp(z0, z1, k) * (1 + bump));
    if (t >= chipAt) ret.draw(t, chipAt, br.view.mapRect([1183, 772, 135, 35]), { t1: b(8) });
    else ret.draw(t, 99, [0, 0, 0, 0]);
    runStack(lines, t, b(4.25), { t1: b(7.75), exit: 'up' });
    caps.forEach(({ cap, at }, i) => {
      const cx = P ? 620 + i * 116 : TYPE.x + 48 + i * 112, cy = P ? 420 : 760;
      cap.draw(t, at - .03, cx, cy, { t1: b(7.8), press: at, fall: 40 });
    });
  };
});

// ---- 02 · check it off → it logs itself -----------------------------------------------------
scene(b(8), b(12), root => {
  const keys = TIMING.S2, land = TIMING.landBeat, [f0, f1] = TIMING.follow;
  const wrap = perspectiveWrap(root);
  const br = new Browser(wrap, T2, WIN.w, WIN.h);
  const tracer = svg('svg', { width: 10, height: 10 }, br.view.ov);
  Object.assign(tracer.style, { position: 'absolute', left: 0, top: 0, overflow: 'visible' });
  const path = svg('path', { fill: 'none', stroke: TEAL, 'stroke-width': 4, 'stroke-linecap': 'round' }, tracer);
  const comet = svg('circle', { r: 9, fill: TEAL }, tracer);
  const glow = svg('circle', { r: 26, fill: TEAL, opacity: .25 }, tracer);
  const ret = new Reticle(br.view.ov, 'logged · today');
  const lines1 = stack(root, [['check'], ['it', 'off.']]);
  const strikes = [0, 1].map(() => el('div', 'abs', root, { height: px(P ? 11 : 9), background: TEAL, transformOrigin: '0 50%', borderRadius: '6px' }));
  const lines2 = stack(root, [['it', 'logs'], [['itself.', 'serif', { color: TEAL }]]]);
  flash(b(8), .08, TEAL, .55);
  glitch(b(8), .07, 16);
  return t => {
    setHud(t, '02 · done → today', b(8));
    swingIn(br.el, t, b(8), { ry0: 18, ry1: -5, rx0: -10, dy: -120 });
    const src = retime(keys, t);
    // camera: tight on the to-do, then follow it down into today
    const follow = E.inOutCubic(inv(b(f0), b(f1), t));
    const out = E.inOutCubic(inv(b(10), b(11.5), t));
    const z = lerp(lerp(P ? 1.05 : 1.12, P ? 1.05 : 1.12, follow), P ? .82 : .9, out);
    const cy = lerp(lerp(420, 700, follow), 560, out), cx = lerp(P ? 1150 : 1200, P ? 1250 : 1250, out);
    br.view.set(src, cx, cy, z);
    const blur = Math.sin(Math.PI * inv(b(f0), b(f1), t)) * TIMING.blur;
    br.view.cam.style.filter = blur > .5 ? `url(#mblur)` : 'none';
    if (blur > .5) mblurG.setAttribute('stdDeviation', `0 ${blur.toFixed(1)}`);
    // tracer from the to-do checkbox down to where it lands
    const [ax, ay] = br.view.map(744, 380), [bx, by] = br.view.map(750, 732);
    const d = `M ${ax} ${ay} C ${ax - 170} ${ay + 60}, ${bx - 170} ${by - 60}, ${bx} ${by}`;
    path.setAttribute('d', d);
    const len = path.getTotalLength();
    const draw = E.outCubic(inv(b(9), b(land + .05), t)), fadeOut = 1 - inv(b(10.5), b(11), t);
    path.setAttribute('stroke-dasharray', `${len}`);
    path.setAttribute('stroke-dashoffset', `${len * (1 - draw)}`);
    tracer.style.opacity = t >= b(9) ? fadeOut : 0;
    const p = path.getPointAtLength(len * draw);
    comet.setAttribute('cx', p.x); comet.setAttribute('cy', p.y);
    glow.setAttribute('cx', p.x); glow.setAttribute('cy', p.y);
    glow.setAttribute('r', 26 + 30 * Math.max(0, 1 - Math.abs(draw - 1) * 6) * (t > b(land) ? Math.exp(-(t - b(land)) * 6) : 0));
    ret.draw(t, b(land + .05), br.view.mapRect([730, 712, 340, 40]), { t1: b(11.8) });
    // type: "check it off." gets struck through on the click, then "it logs itself."
    runStack(lines1, t, b(8.2), { t1: b(10), exit: 'up' });
    strikes.forEach((strike, i) => {
      const s = E.outExpo(inv(b(9) + i * .06, b(9.3) + i * .06, t)) * (t < b(10) ? 1 : 0);
      Object.assign(strike.style, { width: px(lines1[i].width() + 12) });
      place(strike, TYPE.x - 6, TYPE.y + i * TYPE.size * .98 + TYPE.size * .5, { sx: s, sy: 1 });
    });
    runStack(lines2, t, b(10), { t1: b(11.85), exit: 'up' });
  };
});

// ---- 03 · focus: the timer dims the whole page ------------------------------------------------
scene(b(12), b(14), root => {
  const keys = TIMING.S3;
  const dim = el('div', 'layer', root, { background: NAVY, opacity: 0 });
  let views;
  if (P) {
    // split screen: the timer up top, the dimming log below
    const a = el('div', 'abs', root, { left: '40px', top: '250px', width: '1000px', height: '440px', borderRadius: '22px', overflow: 'hidden' });
    const c = el('div', 'abs', root, { left: '40px', top: '1010px', width: '1000px', height: '760px', borderRadius: '22px', overflow: 'hidden' });
    views = [new View(a, T3, 1000, 440), new View(c, T3, 1000, 760)];
  } else {
    const box = el('div', 'abs', root, { left: '90px', top: '90px', width: px(W - 180), height: px(H - 180), borderRadius: '24px', overflow: 'hidden', boxShadow: '0 40px 120px rgba(0,0,0,.5)' });
    views = [new View(box, T3, W - 180, H - 180)];
  }
  const rings = new Rings(views[0].ov, 4);
  const word = new Line(root, [['focus.', 'serif', { color: PAPER }]], { size: P ? 250 : 330 });
  word.el.style.textShadow = '0 0 60px rgba(117,209,196,.55)';
  const tag = el('div', 'hud-label', root, { color: TEAL, fontSize: '18px' });
  flash(b(12), .08, PAPER, .6);
  flash(b(12.5), .18, NAVY, .5);
  glitch(b(12.5), .08, 12);
  return t => {
    setHud(t, '03 · focus', b(12));
    const src = retime(keys, t);
    const push = E.inOutCubic(inv(b(12.6), b(13.6), t));
    if (P) {
      views[0].set(src, lerp(2200, 2380, push), 160, lerp(.95, 1.25, push));
      views[1].set(src, 1250, 760, .84);
    } else {
      views[0].set(src, lerp(1560, 2060, push), lerp(820, 520, push), lerp(.68, 1.08, push));
    }
    const [tx, ty] = views[0].map(2468, 84);
    rings.draw(t, b(12.5), tx, ty, 40, P ? 420 : 520);
    dim.style.opacity = tw(t, b(12.9), b(13.3), 0, P ? .45 : .3);
    views.forEach(v => { const k = inv(b(12.9), b(13.3), t); v.cam.style.filter = k > 0 ? `blur(${(k * (P ? 3 : 2)).toFixed(1)}px)` : 'none'; });
    word.at(P ? 90 : 820, P ? 840 : 640, { oy: .5 });
    word.run(t, b(13), { preset: 'wobble', from: 120 });
    tag.textContent = '● focus on · timer running';
    place(tag, P ? 104 : 836, P ? 968 : 830, { o: tw(t, b(13.2), b(13.5), 0, 1) });
  };
});

// ---- 04 · tags: topics, not folders ---------------------------------------------------------
scene(b(14), b(16), root => {
  const keys = TIMING.S4, pick = TIMING.filterBeat;
  const wrap = perspectiveWrap(root);
  const br = new Browser(wrap, T4, WIN.w, WIN.h);
  const names = ['#design', '#health', '#ideas', '#launch', '#reading', '#research', '#travel'];
  const pills = names.map(n => { const p = el('div', 'pill', root); p.textContent = n; return p; });
  const spots = P
    ? [[110, 270], [470, 250], [270, 360], [620, 350], [110, 450], [430, 460], [800, 260]]
    : [[110, 330], [300, 250], [120, 470], [330, 420], [150, 610], [330, 700], [120, 760]];
  const lines = stack(root, [['topics,'], [['not folders.', 'serif', { color: TEAL }]]], P ? { y: 560, size: 100 } : { y: 860, size: 64 });
  const ret = new Reticle(br.view.ov, 'filter · #launch');
  flash(b(14), .08, TEAL, .45);
  return t => {
    setHud(t, '04 · tags', b(14));
    swingIn(br.el, t, b(14), { ry0: -30, ry1: -8 });
    const src = retime(keys, t);
    const k = E.inOutCubic(inv(b(pick), b(pick + .8), t));
    br.view.set(src, lerp(P ? 700 : 1000, P ? 1300 : 1250, k), lerp(P ? 600 : 780, P ? 820 : 820, k), lerp(P ? .9 : .7, P ? .82 : .74, k));
    ret.draw(t, b(pick + .3), br.view.mapRect([770, 930, 430, 44]), { t1: b(15.95) });
    pills.forEach((p, i) => {
      const t0 = b(14.1) + i * BEAT * TIMING.pillStagger;
      const [x, y] = spots[i];
      const chosen = names[i] === '#launch';
      const pop = sp(t, t0, 'pop', 0, 1);
      const after = t > b(pick) ? (chosen ? 1 : 1 - E.inCubic(inv(b(pick), b(pick + .3), t))) : 1;
      p.style.borderColor = chosen && t > b(pick) ? TEAL : 'rgba(241,239,234,.55)';
      p.style.color = chosen && t > b(pick) ? NAVY : PAPER;
      p.style.background = chosen && t > b(pick) ? TEAL : 'rgba(1,22,39,.55)';
      const lift = chosen && t > b(pick) ? sp(t, b(pick), 'wobble', 1, 1.25) : 1;
      place(p, x + Math.sin(t * 2 + i) * 6, y + Math.cos(t * 2.3 + i) * 5 - (1 - pop) * 60, { s: pop * lift, o: Math.min(pop, 1) * after, r: (1 - pop) * (i % 2 ? 20 : -20) });
      p.style.display = t >= t0 ? '' : 'none';
    });
    runStack(lines, t, b(14.5), { t1: b(15.9), exit: 'up' });
  };
});

// ---- 05 · search: ⌘F, jump, highlight ------------------------------------------------------
// Landscape: the window on the right and type in the left column. Portrait: a framed crop below the type.
function framedView(root, take, portraitBox, t0) {
  if (P) {
    const box = el('div', 'abs', root, { left: px(portraitBox.x), top: px(portraitBox.y), width: px(portraitBox.w), height: px(portraitBox.h), borderRadius: '24px', overflow: 'hidden', boxShadow: '0 40px 120px rgba(0,0,0,.5)' });
    return { view: new View(box, take, portraitBox.w, portraitBox.h), enter: t => { const e = sp(t, t0, 'snap', 0, 1); place(box, 0, lerp(160, 0, e), { o: 1 }); box.style.transform += ` scale(${lerp(.9, 1, e)})`; } };
  }
  const br = new Browser(perspectiveWrap(root), take, WIN.w, WIN.h);
  return { view: br.view, enter: t => swingIn(br.el, t, t0, { ry0: -30, ry1: -7 }) };
}

scene(b(16), b(18), root => {
  const keys = TIMING.S5, jumpAt = TIMING.jumpBeat;
  const { view, enter } = framedView(root, T5, { x: 40, y: 760, w: 1000, h: 1000 }, b(16));
  const shade = el('div', 'layer', root, { background: NAVY });
  const cmd = new Keycap(root, '⌘', P ? 220 : 200), fkey = new Keycap(root, 'F', P ? 220 : 200);
  const ret = new Reticle(view.ov, 'jump · sep 26');
  const lines = stack(root, [['find'], [['anything.', 'serif', { color: TEAL }]]], P ? { y: 330, size: 150 } : { size: 104 });
  flash(b(16), .06, PAPER, .5);
  flash(b(jumpAt), .1, TEAL, .35);
  glitch(b(jumpAt), .08, 14);
  return t => {
    setHud(t, '05 · search', b(16));
    enter(t);
    const src = retime(keys, t);
    const jump = E.inOutCubic(inv(b(jumpAt), b(jumpAt + .4), t));
    view.set(src, P ? 1280 : lerp(1280, 1330, jump), lerp(800, 1000, jump), P ? lerp(.95, .9, jump) : lerp(.8, .86, jump));
    shade.style.opacity = tw(t, b(16), b(16.55), .82, 0, E.inCubic);
    const cx = W / 2, cy = P ? 560 : H / 2;
    cmd.draw(t, b(16) - .02, cx - (P ? 130 : 120), cy, { t1: b(16.5), press: b(16.12) });
    fkey.draw(t, b(16.06), cx + (P ? 130 : 120), cy, { t1: b(16.5), press: b(16.18) });
    ret.draw(t, b(jumpAt + .05), view.mapRect([784, 1058, 900, 40]), { t1: b(18) });
    runStack(lines, t, b(16.6), { t1: b(17.9), exit: 'up' });
  };
});

// ---- 06 · stats: watch focus grow -----------------------------------------------------------
scene(b(18), b(20), root => {
  const keys = TIMING.S6;
  const { view, enter } = framedView(root, T5, { x: 40, y: 720, w: 1000, h: 1040 }, b(18));
  const line = svg('svg', { width: 10, height: 10 }, view.ov);
  Object.assign(line.style, { position: 'absolute', left: 0, top: 0, overflow: 'visible' });
  const trend = svg('path', { fill: 'none', stroke: TEAL, 'stroke-width': 6, 'stroke-linecap': 'round' }, line);
  const head = svg('circle', { r: 10, fill: TEAL }, line);
  const label = el('div', 'hud-label', view.ov, { color: NAVY, background: TEAL, padding: '6px 12px 5px', fontWeight: 700, fontSize: '17px' });
  label.textContent = 'trend · 30 days';
  // least-squares fit over the real daily focus, drawn over the real bars
  const bars = LAYOUT[T5]['stats-30-open'].bars, fs = STATS.daily.map(d => d.focused_seconds);
  const n = fs.length, mx = (n - 1) / 2, my = fs.reduce((a, v) => a + v, 0) / n;
  const slope = fs.reduce((a, v, i) => a + (i - mx) * (v - my), 0) / fs.reduce((a, v, i) => a + (i - mx) ** 2, 0);
  const max = Math.max(...fs), base = bars[0][1] + bars[0][3], full = 256;
  const fitAt = i => [bars[i][0] + bars[i][2] / 2, base - (my + slope * (i - mx)) / max * full];
  const lines = stack(root, [['watch'], ['focus'], [['grow.', 'serif', { color: TEAL }]]], P ? { y: 300, size: 124 } : {});
  flash(b(18), .08, PAPER, .5);
  glitch(b(19), .06, 10);
  return t => {
    setHud(t, '06 · stats', b(18));
    enter(t);
    const src = retime(keys, t);
    const k = E.inOutCubic(inv(b(19.1), b(19.9), t));
    view.set(src, 1280, lerp(800, 930, k), P ? lerp(.8, .9, k) : lerp(.86, 1.12, k));
    const draw = E.outCubic(inv(b(19.2), b(19.8), t));
    const [x0, y0] = view.map(...fitAt(0)), [x1, y1] = view.map(...fitAt(n - 1));
    const xe = lerp(x0, x1, draw), ye = lerp(y0, y1, draw);
    trend.setAttribute('d', `M ${x0} ${y0} L ${xe} ${ye}`);
    head.setAttribute('cx', xe); head.setAttribute('cy', ye);
    line.style.display = t >= b(19.2) ? '' : 'none';
    trend.style.filter = 'drop-shadow(0 0 10px rgba(117,209,196,.8))';
    place(label, xe - 10, ye - 44, { o: E.outCubic(inv(b(19.6), b(19.8), t)), ox: 1, oy: .5 });
    runStack(lines, t, b(18.2), { t1: b(19.9), exit: 'up' });
  };
});

// ---- 07 · day / night / desk / pocket ---------------------------------------------------------
scene(b(20), b(24), root => {
  const keysA = TIMING.S7A, keysB = TIMING.S7B, keysP = TIMING.S7P;
  const wrap = perspectiveWrap(root);
  const br = new Browser(wrap, T4, WIN.w, WIN.h);
  const phoneH = P ? 1120 : 860;
  const phone = new Phone(root, T6, phoneH);
  const size = P ? 190 : 150;
  const words = {
    day: new Line(root, ['day.'], { size, color: NAVY }),
    night: new Line(root, [['night.', 'serif', { color: TEAL }]], { size: size * 1.12 }),
    desk: new Line(root, ['desk.'], { size: size * .7 }),
    pocket: new Line(root, [['pocket.', 'serif', { color: TEAL }]], { size: size * .8 }),
  };
  flash(b(20), .08, PAPER, .8);
  flash(b(20.5), .12, TEAL, .5);
  glitch(b(20.5), .1, 22);
  flash(b(22), .06, PAPER, .35);
  return t => {
    setHud(t, t < b(22) ? '07 · day / night' : '07 · desk / pocket', t < b(22) ? b(20) : b(22));
    const night = t >= b(20.5);
    setBackdrop(night ? 'dark' : 'light');
    br.night(night);
    const src = t < b(21) ? retime(keysA, t) : retime(keysB, t);
    // desk window: big until the phone arrives, then steps aside
    const aside = sp(t, b(22), 'snap', 0, 1);
    const wx = P ? lerp(WIN.x, 40, aside) : lerp(WIN.x, 90, aside), wy = P ? lerp(WIN.y, 250, aside) : lerp(WIN.y, 150, aside);
    const ws = lerp(1, P ? .5 : .62, aside);
    br.el.style.transformOrigin = '0 0';
    const e = sp(t, b(20), 'snap', 0, 1);
    br.el.style.transform = `translate(${wx}px, ${wy + lerp(80, 0, e)}px) rotateY(${lerp(-18, -4, e) * (1 - aside) + aside * 6}deg) scale(${ws * lerp(.9, 1, e)})`;
    br.view.set(src, lerp(1280, 1280, 0), 800, WIN.w / 2560 * (P ? 1.25 : 1));
    // phone rises in
    const up = sp(t, b(22), 'snap', 0, 1);
    if (t >= b(22)) phone.view.set(retime(keysP, t), 585, 1266, phone.view.w / 1170);
    const px0 = P ? W / 2 - phone.w / 2 + 170 : 1300, py0 = P ? 690 : 120;
    phone.el.style.display = t >= b(22) ? '' : 'none';
    phone.el.style.transform = `translate(${px0}px, ${py0 + (1 - up) * (P ? 1200 : 900)}px) rotate(${(1 - up) * 14 + 4}deg)`;
    // words, one per beat
    const wordAt = (line, t0, t1, x, y) => { line.at(x, y); line.run(t, t0, { t1, exit: 'up', preset: 'pop' }); line.el.style.display = t >= t0 && t < t1 + .2 ? '' : 'none'; };
    wordAt(words.day, b(20), b(20.5), P ? 90 : TYPE.x, P ? 380 : 420);
    wordAt(words.night, b(20.5), b(22), P ? 90 : TYPE.x - 6, P ? 360 : 400);
    wordAt(words.desk, b(22.1), b(24), P ? 60 : 110, P ? 770 : 760);
    wordAt(words.pocket, b(23), b(24), P ? 60 : 930, P ? 960 : 560);
  };
});

// ---- 08 · one page, every day — and plain text for your AI ----------------------------------------
scene(b(24), b(28), root => {
  const cols = P ? 3 : 5, rows = P ? 7 : 4, tw0 = 640, th0 = 400, gap = 36;
  const planeW = cols * tw0 + (cols - 1) * gap, planeH = rows * th0 + (rows - 1) * gap;
  const persp = el('div', 'layer', root, { perspective: '1600px' });
  const plane = el('div', 'abs', persp, { width: px(planeW), height: px(planeH), transformOrigin: '50% 50%' });
  const feeds = [[T1, 1.2], [T2, 2.2], [T3, 2.4], [T4, 4.1], [T5, 3.8], [T2, 10.8], [T1, 7.2], [T5, 9.3], [T3, 11.2], [T4, 12.9], [T6, 3.2], [T1, 12.6], [T5, 2.6], [T2, 5.9], [T4, 2.3], [T3, 6.5], [T6, 8.9], [T1, 4.9], [T5, 11.4], [T2, 7.3], [T4, 14.2]];
  const labels = ['write', 'done', 'focus', '#tags', 'search', 'logged', 'sections', 'stats', 'sessions', 'night', 'phone', 'today', 'find', 'expand', 'filter', 'type', 'travel', 'chips', 'cheat sheet', 'steps', 'all'];
  const heroIndex = P ? 10 : 7;   // the tile the camera starts inside: today's page, being written
  feeds[heroIndex] = [T1, 1.4]; labels[heroIndex] = 'today';
  const tiles = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, [take, off] = feeds[i % feeds.length];
    const tile = el('div', 'abs', plane, { left: px(c * (tw0 + gap)), top: px(r * (th0 + gap)), width: px(tw0), height: px(th0), borderRadius: '14px', overflow: 'hidden',
      boxShadow: '0 0 0 1px rgba(117,209,196,.25), 0 20px 50px rgba(0,0,0,.5)', background: '#0b2233' });
    const isHero = i === heroIndex;
    const f = new Footage(take, { small: !isHero });
    const info = TAKES[take];
    const cover = Math.max(tw0 / info.w, th0 / info.h);
    Object.assign(f.img.style, { position: 'absolute', width: px(info.w * cover), height: px(info.h * cover), left: px((tw0 - info.w * cover) / 2), top: px(take === T6 ? -info.h * cover * .18 : (th0 - info.h * cover) / 2) });
    tile.appendChild(f.img);
    const lab = el('div', 'hud-label', tile, { left: '14px', top: '12px', fontSize: '14px', color: NAVY, background: TEAL, padding: '3px 8px 2px', fontWeight: 700 });
    lab.textContent = `${String(i + 1).padStart(2, '0')} ${labels[i % labels.length]}`;
    tiles.push({ f, off, tile, lab });
  }
  const hero = heroIndex;
  const scrim = el('div', 'layer', root, { background: 'radial-gradient(ellipse 70% 60% at 50% 50%, rgba(1,22,39,.78), rgba(1,22,39,.2) 75%)' });
  const lines = stack(root, [['every', 'day.'], [['one page.', 'serif', { color: TEAL }]]], P ? { x: 90, y: 700, size: 150 } : { x: 250, y: 330, size: 150 });
  // the app's own /journal.md, as an agent would read it
  const panel = el('div', 'code', root, { width: px(P ? 960 : 1060), height: px(P ? 820 : 700) });
  const head = el('div', 'hud-label', panel, { position: 'relative', zIndex: 1, padding: '18px 24px', color: TEAL, fontSize: '17px', borderBottom: '1px solid rgba(117,209,196,.25)', background: 'rgba(0,13,24,.98)' });
  head.innerHTML = 'GET /journal.md &nbsp;<span style="color:#5d7386">→ 200 · text/markdown</span>';
  const clip = el('div', 'abs', panel, { left: 0, top: '58px', right: 0, bottom: 0, overflow: 'hidden' });
  const scroller = el('div', 'abs', clip, { left: '26px', top: '16px' });
  const pre = el('pre', '', scroller);
  pre.innerHTML = JOURNAL.split('\n').filter(l => l.trim() && !l.startsWith('```')).map(line => {
    const esc = line.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    if (/^#/.test(line)) return `<span class="h">${esc}</span>`;
    if (/Metadata:/.test(line)) return `<span class="d">${esc.length > 92 ? esc.slice(0, 92) + '…' : esc}</span>`;
    if (/^\s*- \[/.test(line)) return `<span class="k">${esc}</span>`;
    return esc.length > 92 ? esc.slice(0, 92) + '…' : esc;
  }).join('\n');
  const lines2 = stack(root, [['plain', 'text.'], [['your AI', 'serif', { color: TEAL }]], [['can read it.', 'serif', { color: TEAL }]]], P ? { x: 90, y: 300, size: 116 } : { x: 110, y: 330, size: 96 });
  flash(b(24), .1, PAPER, .7);
  glitch(b(26), .08, 16);
  return t => {
    setHud(t, t < b(26) ? '08 · one page' : '09 · /journal.md', t < b(26) ? b(24) : b(26));
    const reveal = inv(b(24.9), b(25.4), t);
    tiles.forEach(({ f, off, lab }, i) => { f.at(off + (t - b(24)) * (i === hero ? 1 : .8)); lab.style.opacity = reveal; });
    // camera starts inside one tile, pulls back to the whole wall
    const k = E.inOutExpo(inv(b(24), b(25.6), t));
    const r = Math.floor(hero / cols), c = hero % cols;
    const hx = c * (tw0 + gap) + tw0 / 2, hy = r * (th0 + gap) + th0 / 2;
    const fill = Math.max(W / tw0, H / th0) * 1.02, wide = P ? .62 : .62;
    const s = lerp(fill, wide, k);
    const cx = lerp(hx, planeW / 2, k), cy = lerp(hy, planeH / 2, k);
    const rx = lerp(0, P ? 18 : 30, k), rz = lerp(0, P ? -8 : -12, k);
    const drift = (t - b(24)) * 40;
    plane.style.transform = `translate(${W / 2 - cx}px, ${H / 2 - cy - drift * .3}px) scale(${s}) rotateX(${rx}deg) rotateZ(${rz}deg)`;
    plane.style.transformOrigin = `${cx}px ${cy}px`;
    const toPanel = E.inOutCubic(inv(b(26), b(26.4), t));
    persp.style.filter = toPanel > .01 ? `blur(${toPanel * 8}px) brightness(${1 - toPanel * .45})` : 'none';
    scrim.style.opacity = tw(t, b(24.8), b(25.2), 0, 1) * (1 - toPanel * .3);
    runStack(lines, t, b(24.75), { t1: b(26), exit: 'up' });
    // the markdown panel slides up and scrolls
    const up = sp(t, b(26), 'snap', 0, 1);
    panel.style.display = t >= b(26) ? '' : 'none';
    const pxp = P ? 60 : 800, pyp = P ? 800 : 170;
    place(panel, pxp, pyp + (1 - up) * 700, { r: (1 - up) * 6 });
    scroller.style.transform = `translateY(${-Math.max(0, t - b(26.3)) * TIMING.scroll}px)`;
    runStack(lines2, t, b(26.2), { t1: b(27.85), exit: 'up' });
  };
});

// ---- 09 · logbook ---------------------------------------------------------------------------
scene(b(28), DURATION + 1, root => {
  const size = P ? 220 : 250;
  const glowEl = el('div', 'layer', root, { background: 'radial-gradient(ellipse 50% 40% at 50% 50%, rgba(117,209,196,.28), transparent 70%)' });
  const word = el('div', 'kt', root, { fontSize: px(size), fontWeight: 800, letterSpacing: '-.055em' });
  const letters = [...'logbook'].map(ch => { const s = el('span', '', word, { display: 'inline-block' }); s.textContent = ch; return s; });
  const caret = el('span', '', word, { position: 'absolute', top: '.2em', width: '.09em', height: '.78em', background: TEAL });
  const tagline = new Line(root, [['the', 'serif'], ['text', 'serif'], ['file', 'serif'], ['that', 'serif'], ['remembers.', 'serif', { color: TEAL }]], { size: P ? 64 : 58, weight: 400 });
  const feats = el('div', 'hud-label', root, { fontSize: P ? '22px' : '20px', letterSpacing: '.2em' });
  const items = ['write', 'check', 'focus', 'tag', 'search'];
  const spans = items.flatMap((f, i) => { const s = el('span', '', feats); s.textContent = f; const d = el('span', '', feats, { opacity: .4 }); d.textContent = i < items.length - 1 ? '  ·  ' : ''; return [s]; });
  flash(b(28), .16, PAPER, 1);
  glitch(b(28), .1, 20);
  return t => {
    setHud(t, 'logbook', b(28), { visible: 1 - inv(DURATION - .45, DURATION - .05, t) });
    const cx = W / 2, cy = P ? H / 2 - 40 : H / 2 - 50;
    letters.forEach((s, i) => {
      const t0 = b(28) + i * BEAT / 4;
      const y = sp(t, t0, 'pop', 38, 0), o = t >= t0 ? 1 : 0, sc = sp(t, t0, 'wobble', 1.3, 1);
      s.style.transform = `translateY(${y}%) scale(${sc})`; s.style.opacity = o;
    });
    const shown = letters.filter((_, i) => t >= b(28) + i * BEAT / 4);
    const last = shown[shown.length - 1] || letters[0];
    caret.style.left = px(last.offsetLeft + (shown.length ? last.offsetWidth : 0) + size * .05);
    caret.style.opacity = t < b(30) ? 1 : (Math.floor((t - b(30)) / (BEAT)) % 2 ? 0 : 1);
    place(word, cx, cy, { ox: .5, oy: .5, s: 1 + (t - b(28)) * .012 });
    tagline.at(cx, cy + size * (P ? .62 : .6), { ox: .5 });
    tagline.run(t, b(29.5), { stagger: .05, preset: 'snap' });
    place(feats, cx, cy + size * (P ? 1.05 : .98), { ox: .5, o: tw(t, b(30.5), b(30.9), 0, .9) });
    spans.forEach((s, i) => { s.style.color = t >= b(30.5) + i * BEAT / 4 && t < b(30.5) + i * BEAT / 4 + BEAT / 2 ? TEAL : PAPER; });
    glowEl.style.opacity = .6 + .4 * Math.sin(t * 3);
  };
});
