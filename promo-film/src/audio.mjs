// Soundtrack, synthesized from scratch: 48 kHz stereo, 32-bit float WAV, on the picture's beat grid.
// 15 s: 128 bpm four-on-the-floor. 30 s: the same grid played half-time, one film beat = two music beats.
//   node src/audio.mjs out/soundtrack.wav [15|30]
import fs from 'node:fs';

const LENGTH = process.argv[3] === '30' ? 30 : 15, HALF = LENGTH === 30;
const TIMING = JSON.parse(fs.readFileSync(new URL('../assets/timing.json', import.meta.url), 'utf8'))[LENGTH];
const SR = 48000, DUR = LENGTH, N = SR * DUR;
const BPM = TIMING.bpm, BEAT = 60 / BPM, b = n => n * BEAT;   // film beats, as in scenes.js
const TAU = Math.PI * 2;

// ---- buses ----------------------------------------------------------------------------------
const bus = () => ({ L: new Float32Array(N), R: new Float32Array(N) });
const drums = bus(), music = bus(), fx = bus(), verb = bus(), delayBus = bus();

let seed = 12345;
const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296); };
const noise = () => rand() * 2 - 1;
const clampi = (x, a, c) => Math.max(a, Math.min(c, x));
const midi = n => 440 * Math.pow(2, (n - 69) / 12);

// add a mono signal (function of local time, sample index) into a bus with equal-power pan
function voice(target, t0, dur, fn, { gain = 1, pan = 0, send = 0, delay = 0 } = {}) {
  const s0 = Math.max(0, Math.round(t0 * SR)), s1 = Math.min(N, Math.round((t0 + dur) * SR));
  const pl = Math.cos((pan + 1) * Math.PI / 4), pr = Math.sin((pan + 1) * Math.PI / 4);
  for (let s = s0; s < s1; s++) {
    const v = fn((s - Math.round(t0 * SR)) / SR, s) * gain;
    target.L[s] += v * pl; target.R[s] += v * pr;
    if (send) { verb.L[s] += v * pl * send; verb.R[s] += v * pr * send; }
    if (delay) { delayBus.L[s] += v * pl * delay; delayBus.R[s] += v * pr * delay; }
  }
}

// RBJ biquad, coefficients can be updated on the fly
class Biquad {
  constructor(type = 'lp', f = 1000, q = .707) { this.type = type; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(f, q); }
  set(f, q = this.q) {
    this.q = q; f = clampi(f, 10, SR * .45);
    const w = TAU * f / SR, cs = Math.cos(w), sn = Math.sin(w), a = sn / (2 * q);
    let b0, b1, b2;
    if (this.type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; }
    else if (this.type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; }
    else { b0 = a; b1 = 0; b2 = -a; }                 // band-pass, 0 dB peak
    const a0 = 1 + a;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = -2 * cs / a0; this.a2 = (1 - a) / a0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// band-limited saw (polyBLEP)
function sawOsc() {
  let ph = rand();
  return f => {
    const dt = f / SR; ph += dt; if (ph >= 1) ph -= 1;
    let v = 2 * ph - 1;
    if (ph < dt) { const x = ph / dt; v -= x + x - x * x - 1; }
    else if (ph > 1 - dt) { const x = (ph - 1) / dt; v -= x * x + x + x + 1; }
    return v;
  };
}
function sineOsc(ph = 0) { return f => { ph += f / SR; return Math.sin(TAU * ph); }; }
const env = (t, a, d) => t < a ? t / a : Math.exp(-(t - a) / d);

// ---- instruments ------------------------------------------------------------------------------
const kicks = [];
function kick(t0, g = 1) {
  kicks.push(t0);
  const osc = sineOsc(), hp = new Biquad('hp', 2500, .7);
  voice(drums, t0, .5, t => {
    const f = 46 + 120 * Math.exp(-t / .03) + 30 * Math.exp(-t / .004);
    const body = osc(f) * Math.exp(-t / .26) * (t < .002 ? t / .002 : 1);
    const click = hp.run(noise()) * Math.exp(-t / .004) * .5;
    return Math.tanh((body + click) * 1.7) * .9;
  }, { gain: .8 * g });
}
function clap(t0, g = 1) {
  const bp = new Biquad('bp', 1300, .9), bp2 = new Biquad('bp', 2600, 1.2);
  voice(drums, t0, .45, t => {
    let e = 0;
    for (const o of [0, .011, .022]) if (t >= o) e = Math.max(e, Math.exp(-(t - o) / .006));
    e = Math.max(e * .9, t > .022 ? Math.exp(-(t - .022) / .09) * .55 : 0);
    const n = noise();
    return (bp.run(n) * 1.3 + bp2.run(n) * .6) * e;
  }, { gain: .42 * g, pan: .05, send: .35 });
}
function hat(t0, open = false, g = 1, pan = .18) {
  const hp = new Biquad('hp', 7500, .8), hp2 = new Biquad('hp', 9000, .7);
  voice(drums, t0, open ? .3 : .06, t => hp2.run(hp.run(noise())) * Math.exp(-t / (open ? .09 : .016)), { gain: .11 * g, pan, send: open ? .06 : 0 });
}
function bassNote(t0, dur, note, g = 1) {
  const s1 = sawOsc(), sub = sineOsc(), lp = new Biquad('lp', 400, 1.1);
  const f = midi(note);
  voice(music, t0, dur + .05, t => {
    lp.set(180 + 900 * Math.exp(-t / .07));
    const a = Math.min(1, t / .004) * (t > dur ? Math.exp(-(t - dur) / .015) : 1) * (.75 + .25 * Math.exp(-t / .15));
    return (lp.run(s1(f)) * .7 + sub(f) * .55) * a;
  }, { gain: .36 * g });
}
function pluck(t0, note, g = 1, pan = 0) {
  const s1 = sawOsc(), s2 = sawOsc(), lp = new Biquad('lp', 3000, 1.4);
  const f = midi(note);
  voice(music, t0, .45, t => {
    lp.set(500 + 4200 * Math.exp(-t / .045));
    return lp.run(s1(f) * .6 + s2(f * 1.006) * .5) * Math.min(1, t / .002) * Math.exp(-t / .16);
  }, { gain: .11 * g, pan, send: .22, delay: .32 });
}
function pad(t0, t1, notes, { g = 1, cut = 1600, bright = 0 } = {}) {
  const voices = notes.flatMap(n => [-11, -4, 0, 5, 12].map(c => ({ osc: sawOsc(), f: midi(n) * Math.pow(2, c / 1200), pan: (rand() * 2 - 1) * .8 })));
  const lpL = new Biquad('lp', cut, .8), lpR = new Biquad('lp', cut, .8);
  const s0 = Math.round(t0 * SR), s1 = Math.min(N, Math.round((t1 + .6) * SR));
  for (let s = s0; s < s1; s++) {
    const t = s / SR - t0;
    if ((s & 31) === 0) { const c = cut * (1 + bright * Math.min(1, t / (t1 - t0))); lpL.set(c); lpR.set(c); }
    let l = 0, r = 0;
    for (const v of voices) { const x = v.osc(v.f); l += x * (1 - v.pan) * .5; r += x * (1 + v.pan) * .5; }
    const a = Math.min(1, t / .25) * (s / SR > t1 ? Math.exp(-(s / SR - t1) / .22) : 1) * .055 * g / Math.sqrt(voices.length / 5);
    const L = lpL.run(l) * a, R = lpR.run(r) * a;
    music.L[s] += L; music.R[s] += R; verb.L[s] += L * .4; verb.R[s] += R * .4;
  }
}
function impact(t0, size = 1) {
  const sub = sineOsc(), lp = new Biquad('lp', 5000, .7), hp = new Biquad('hp', 250, .7);
  voice(fx, t0, 2.2, t => {
    const boom = sub(38 + 60 * Math.exp(-t / .06)) * Math.exp(-t / (.35 + .35 * size)) * Math.min(1, t / .002);
    lp.set(1200 + 9000 * Math.exp(-t / .25));
    const crash = hp.run(lp.run(noise())) * Math.exp(-t / (.18 + .22 * size)) * .32;
    return Math.tanh((boom * 1.2 + crash) * 1.3);
  }, { gain: .55 * size, send: .5 * size });
}
function whoosh(t0, dur, { up = true, g = 1, pan0 = -.6, pan1 = .6 } = {}) {
  const bp = new Biquad('bp', 800, 1.6);
  const s0 = Math.round(t0 * SR), s1 = Math.min(N, Math.round((t0 + dur) * SR));
  for (let s = s0; s < s1; s++) {
    const k = (s - s0) / (s1 - s0);
    if ((s & 15) === 0) bp.set(up ? 300 * Math.pow(20, k) : 6000 * Math.pow(1 / 20, k), 1.8);
    const a = Math.sin(Math.PI * Math.pow(k, up ? 1.4 : .7)) ** 2 * .9 * g;
    const v = bp.run(noise()) * a, p = pan0 + (pan1 - pan0) * k;
    const pl = Math.cos((p + 1) * Math.PI / 4), pr = Math.sin((p + 1) * Math.PI / 4);
    fx.L[s] += v * pl; fx.R[s] += v * pr; verb.L[s] += v * pl * .3; verb.R[s] += v * pr * .3;
  }
}
function riser(t0, t1, g = 1) {
  const bp = new Biquad('bp', 400, 2.2), osc = sawOsc(), lp = new Biquad('lp', 800, 1);
  const s0 = Math.round(t0 * SR), s1 = Math.min(N, Math.round(t1 * SR));
  for (let s = s0; s < s1; s++) {
    const k = (s - s0) / (s1 - s0);
    if ((s & 15) === 0) { bp.set(300 * Math.pow(30, k), 2.5); lp.set(400 + 5000 * k * k); }
    const v = (bp.run(noise()) * .9 + lp.run(osc(110 * Math.pow(8, k))) * .25) * k * k * g;
    fx.L[s] += v; fx.R[s] += v; verb.L[s] += v * .25; verb.R[s] += v * .25;
  }
}
function tick(t0, g = 1, pan = 0, tone = 2600) {
  const hp = new Biquad('hp', 2000, .7), osc = sineOsc();
  voice(fx, t0, .05, t => (hp.run(noise()) * Math.exp(-t / .0035) * .8 + osc(tone) * Math.exp(-t / .012) * .35), { gain: .2 * g, pan });
}
function key(t0, g = 1) {   // a soft mechanical key
  const bp = new Biquad('bp', 2200 + rand() * 1600, 1.1), low = new Biquad('lp', 700, .8);
  voice(fx, t0, .06, t => bp.run(noise()) * Math.exp(-t / .006) + low.run(noise()) * Math.exp(-t / .012) * .6, { gain: .3 * g, pan: rand() * .5 - .25 });
}
function thock(t0, g = 1) {  // a big keycap bottoming out
  const osc = sineOsc(), bp = new Biquad('bp', 1100, 1.2);
  voice(fx, t0, .25, t => Math.tanh(osc(180 + 220 * Math.exp(-t / .01)) * Math.exp(-t / .05) * 1.4 + bp.run(noise()) * Math.exp(-t / .01)), { gain: .55 * g, send: .15 });
}
function pop(t0, note, g = 1, pan = 0) {
  const osc = sineOsc(), f = midi(note);
  voice(fx, t0, .25, t => osc(f * (1 + .9 * Math.exp(-t / .018))) * Math.min(1, t / .002) * Math.exp(-t / .07), { gain: .3 * g, pan, send: .2 });
}
function bell(t0, note, g = 1, pan = 0) {
  const car = sineOsc(), mod = sineOsc(), f = midi(note);
  voice(fx, t0, 2.2, t => {
    const i = 3.2 * Math.exp(-t / .35) + .4;
    return car(f + i * f * Math.sin(TAU * f * 3.5 * t)) * Math.min(1, t / .002) * Math.exp(-t / .9);
  }, { gain: .14 * g, pan, send: .45 });
}
function chatter(t0, t1, g = 1) {  // data streaming past
  for (let t = t0; t < t1; t += BEAT / 8) {
    if (rand() < .35) continue;
    const f = 900 + rand() * 2600, len = .012 + rand() * .025, pan = rand() * 1.2 - .6;
    const bp = new Biquad('bp', f, 3);
    let ph = 0;
    voice(fx, t, len + .01, u => { ph += f / SR; return bp.run(ph % 1 < .5 ? 1 : -1) * (u < len ? 1 : Math.exp(-(u - len) / .003)); }, { gain: .09 * g, pan });
  }
}
function downSweep(t0, dur, g = 1) {  // the page dimming: a deep sub drop
  const osc = sineOsc();
  voice(fx, t0, dur, t => osc(90 * Math.exp(-t / .25) + 30) * Math.sin(Math.PI * Math.min(1, t / dur)) * .9, { gain: .5 * g });
}

// ---- arrangement ------------------------------------------------------------------------------
// bars: Am | F | C | G | Am | F | G | Cadd9   (one chord per bar)
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55, 60], [55, 59, 62], [57, 60, 64], [53, 57, 60], [55, 59, 62], [48, 52, 55, 62]];
const ROOTS = [45, 41, 48, 43, 45, 41, 43, 36];

// Intro: pad swell, the mono line typing, "is a" / "text file." hits, riser into the drop.
pad(0, b(4), CHORDS[0].map(n => n - 12).concat([69]), { g: 1.1, cut: 500, bright: 2.2 });
for (let i = 0; i < 31; i++) key(.06 + i * (b(1.8) - .06) / 31, .7);
pop(b(2), 69, .9); kick(b(2), .55);
impact(b(2.5), .45); pop(b(2.5), 76, .8);
riser(b(1.5), b(4), .5);
for (let i = 0; i < 8; i++) clap(b(3) + i * BEAT / 8, .25 + i * .08);

// Groove from the drop to the end card.
if (!HALF) {
  for (let k = 4; k < 28; k++) kick(b(k), k % 4 === 0 ? 1 : .88);
  for (let k = 5; k < 28; k += 2) clap(b(k), 1);
  for (let k = 4; k < 28; k++) for (let s = 0; s < 4; s++) {
    const t = b(k + s / 4);
    if (s === 2) hat(t, true, .7, -.15); else hat(t, false, s === 0 ? .5 : .8);
  }
  for (let bar = 1; bar < 7; bar++) {
    const root = ROOTS[bar];
    for (let e = 0; e < 8; e++) bassNote(b(bar * 4 + e / 2), BEAT / 2 * .8, root + (e % 2 ? 12 : 0), e % 2 ? .9 : 1);
    pad(b(bar * 4), b(bar * 4 + 4), CHORDS[bar], { g: .9, cut: 1400 + bar * 180 });
    const tones = CHORDS[bar].map(n => n + 12).concat([CHORDS[bar][0] + 24]);
    for (let s = 0; s < 16; s++) pluck(b(bar * 4 + s / 4), tones[(s * 3) % tones.length] + (s % 8 === 7 ? 12 : 0), s % 4 === 0 ? 1 : .75, s % 2 ? .35 : -.35);
  }
} else {
  // Half-time on a 128 bpm grid: kick on 1, clap on 3, eighth-note hats; two music bars per chord.
  const MB = 60 / 128, m = n => n * MB;       // music beats → seconds; m(2k) === b(k)
  const first = 8, last = 56;                   // film beats 4 → 28
  for (let q = first; q < last; q++) {
    if (q % 4 === 0) kick(m(q), q % 16 === 0 ? 1 : .92);
    if (q % 4 === 2) clap(m(q), 1);
  }
  for (let bar = first / 4; bar < last / 4; bar++) if (bar % 2) kick(m(bar * 4 + 1.5), .5);
  for (let e = first * 2; e < last * 2; e++) {
    const pos = (e / 2) % 4;
    if (pos === 3.5) hat(m(e / 2), true, .6, -.15); else hat(m(e / 2), false, e % 2 ? .7 : .4);
  }
  for (let fbar = 1; fbar < 7; fbar++) {
    const root = ROOTS[fbar], q0 = fbar * 8;
    for (const [off, dur, n, g] of [[0, 1.6, 0, 1], [2.5, .4, 0, .8], [3, .8, 12, .85], [4, 1.6, 0, 1], [6.5, .4, 7, .8], [7, .8, 12, .85]])
      bassNote(m(q0 + off), MB * dur, root + n, g);
    pad(m(q0), m(q0 + 8), CHORDS[fbar], { g: .95, cut: 1300 + fbar * 160 });
    const tones = CHORDS[fbar].map(n => n + 12).concat([CHORDS[fbar][0] + 24]);
    for (let s = 0; s < 16; s++) pluck(m(q0 + s / 2), tones[(s * 3) % tones.length] + (s % 8 === 7 ? 12 : 0), s % 2 ? .7 : .95, s % 2 ? .35 : -.35);
  }
}

// ---- hits on the cuts ------------------------------------------------------------------------------
impact(b(4), 1.25); whoosh(b(3.2), b(.8), { g: .8 });
impact(b(8), .8);   whoosh(b(7.4), b(.6), { g: .6, pan0: .6, pan1: -.6 });
impact(b(12), .7);
impact(b(14), .55);
impact(b(16), .7);
impact(b(18), .55);
impact(b(20), 1);   pad(b(20), b(20.5), [64, 67, 72, 76], { g: 1.1, cut: 3000 });
impact(b(20.5), 1.2); whoosh(b(20.05), b(.45), { up: true, g: .7 });
impact(b(22), .5);
impact(b(24), 1.1); whoosh(b(24), b(1.4), { up: false, g: .5 });
impact(b(26), .75);
impact(b(28), 1.6); kick(b(28), 1.25); clap(b(28), .9);

// ---- 01 write: every keystroke in the footage, the chip pops ----------------------------------------
const untime = (keys, s) => { for (let i = 1; i < keys.length; i++) if (s <= keys[i][1]) return keys[i - 1][0] + (keys[i][0] - keys[i - 1][0]) * (s - keys[i - 1][1]) / (keys[i][1] - keys[i - 1][1]); return keys.at(-1)[0]; };
const KEYS1 = TIMING.S1;
for (const s of [1.526, 1.622, 1.703, 1.791, 1.891, 1.986, 2.066, 2.15, 2.243, 2.337, 2.403, 2.499, 2.561, 2.685, 2.757, 2.821, 2.92, 2.992, 3.089, 3.18, 3.253, 3.341, 3.428, 3.492, 3.587, 3.674, 3.754, 4.169, 4.24])
  key(untime(KEYS1, s), .9);
thock(untime(KEYS1, 3.754) - .01, .35);     // '#'
pop(TIMING.chipAt, 79, 1.1, .2); bell(TIMING.chipAt, 84, .5, .2);   // #launch chip

// ---- 02 check it off: click, the to-do travels, lands in today ---------------------------------------
tick(b(9) - .05, 1.4, -.2, 1800);
whoosh(b(9), b(TIMING.landBeat - 9 + .05), { up: false, g: .7, pan0: -.3, pan1: .1 });
bell(b(TIMING.landBeat + .05), 79, .8, .1); pop(b(TIMING.landBeat + .05), 91, .6, .1);
for (const [i, n] of [72, 76, 79].entries()) pop(b(10) + i * .07, n, .45, -.2 + i * .2);

// ---- 03 focus: the page dims, the sound dims with it; the app's own noise bed --------------------------
tick(b(12.5) - .04, 1.2, .5, 1500);
downSweep(b(12.5), .9, 1);
bell(b(12.5), 60, .5, .4);
{
  const lp = new Biquad('lp', 900, .5);
  const s0 = Math.round(b(12.6) * SR), s1 = Math.round(b(14) * SR);
  for (let s = s0; s < s1; s++) {
    const k = (s - s0) / (s1 - s0);
    const v = lp.run(noise()) * Math.min(1, k * 4) * .08;
    fx.L[s] += v; fx.R[s] += v * .95;
  }
}

// ---- 04 tags: one pop per pill, the chosen one rings -------------------------------------------------
[72, 74, 76, 79, 81, 84, 86].forEach((n, i) => pop(b(14.1) + i * BEAT * TIMING.pillStagger, n, .55, -.6 + i * .2));
tick(b(TIMING.filterBeat) - .03, 1.2, -.3); bell(b(TIMING.filterBeat), 81, .6, -.2);

// ---- 05 search: ⌘ and F bottom out, 'lisbon' typed, the jump --------------------------------------------
thock(b(16.12), 1); thock(b(16.18), .9);
for (let i = 0; i < 6; i++) key(untime(TIMING.S5, 1.61 + i * .111), .8);
pop(untime(TIMING.S5, 2.47), 88, .35);
tick(b(TIMING.jumpBeat) - .02, 1, 0, 2200); whoosh(b(TIMING.jumpBeat - .2), b(.6), { up: false, g: .6 });

// ---- 06 stats: the 30-day switch, the trend line draws upward --------------------------------------------
tick(b(19) - .03, 1.2, .3, 2000);
for (let i = 0; i < 8; i++) pluck(b(19.2) + i * BEAT * .6 / 8, 72 + [0, 2, 4, 7, 9, 12, 14, 16][i], .9, -.5 + i * .14);

// ---- 07 day / night / desk / pocket ---------------------------------------------------------------------
bell(b(20), 84, .5, -.3);
bell(b(21), 72, .6, .3);
pop(b(22), 76, .6, -.4);
tick(untime(TIMING.S7P, 2.892) - .01, 1.3, .4, 1600);
pop(b(23), 83, .6, .4);

// ---- 08 the wall, the markdown stream --------------------------------------------------------------------
pop(b(24.75), 72, .5, -.3); pop(b(25), 79, .5, .3);
chatter(b(26.3), b(27.8), 1);
riser(b(26.5), b(28), .6);
for (let i = 0; i < 8; i++) clap(b(27) + i * BEAT / 8, .2 + i * .09);

// ---- 09 logbook: the letters chime in, the chord rings out ------------------------------------------------
pad(b(28), DUR - .6, CHORDS[7], { g: 1.2, cut: 2400, bright: .6 });
bassNote(b(28), BEAT * 3, 36, 1.1);
[72, 74, 76, 79, 81, 84, 86].forEach((n, i) => bell(b(28) + i * BEAT / 4, n, .75, -.45 + i * .15));
bell(b(29.5), 88, .5, .3);
for (let i = 0; i < 5; i++) tick(b(30.5) + i * BEAT / 4, .5, -.4 + i * .2, 3000);

// ---- mixdown ---------------------------------------------------------------------------------------------------
// ping-pong delay for the plucks (dotted eighth)
{
  const d = Math.round(BEAT * .75 * SR);
  for (let s = d; s < N; s++) {
    delayBus.L[s] += delayBus.R[s - d] * .42;
    delayBus.R[s] += delayBus.L[s - d] * .42;
  }
  for (let s = 0; s < N; s++) { music.L[s] += delayBus.R[s] * .5; music.R[s] += delayBus.L[s] * .5; }
}
// sidechain: the music breathes with the kick
for (let s = 0, k = 0; s < N; s++) {
  const t = s / SR;
  while (k + 1 < kicks.length && kicks[k + 1] <= t) k++;
  const since = kicks.length && t >= kicks[k] ? t - kicks[k] : 9;
  const duck = 1 - .55 * Math.exp(-since / .11);
  music.L[s] *= duck; music.R[s] *= duck;
}
// focus section: drums and music heard through a wall, snapping back on the next cut
{
  const a = Math.round(b(12.5) * SR), z = Math.round(b(14) * SR), xf = 240;
  const filters = [drums, music].map(x => ({ x, l: new Biquad('lp', 18000, .7), r: new Biquad('lp', 18000, .7) }));
  for (let s = a - 2000; s < z + xf; s++) {
    const c = s < a ? 18000 : 420 + 17580 * Math.exp(-((s - a) / SR) / .03);
    const dry = s < z ? 0 : (s - z) / xf;          // short crossfade back to dry on the cut
    for (const f of filters) {
      if ((s & 15) === 0) { f.l.set(c); f.r.set(c); }
      const l = f.l.run(f.x.L[s]), r = f.r.run(f.x.R[s]);
      f.x.L[s] = l + (f.x.L[s] - l) * dry;
      f.x.R[s] = r + (f.x.R[s] - r) * dry;
    }
  }
}
// Freeverb-style reverb on the send bus
function freeverb(inL, inR, { room = .82, damp = .35, wet = .32 } = {}) {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(n => Math.round(n * SR / 44100));
  const aps = [556, 441, 341, 225].map(n => Math.round(n * SR / 44100));
  const out = [new Float32Array(N), new Float32Array(N)];
  [inL, inR].forEach((input, ch) => {
    const spread = ch ? Math.round(23 * SR / 44100) : 0;
    const cb = combs.map(n => ({ buf: new Float32Array(n + spread), i: 0, f: 0 }));
    const ab = aps.map(n => ({ buf: new Float32Array(n + spread), i: 0 }));
    for (let s = 0; s < N; s++) {
      const x = input[s] * .015;
      let y = 0;
      for (const c of cb) { const o = c.buf[c.i]; c.f = o * (1 - damp) + c.f * damp; c.buf[c.i] = x + c.f * room; c.i = (c.i + 1) % c.buf.length; y += o; }
      for (const a of ab) { const o = a.buf[a.i]; const v = -y + o; a.buf[a.i] = y + o * .5; a.i = (a.i + 1) % a.buf.length; y = v; }
      out[ch][s] = y * wet;
    }
  });
  return out;
}
const [rvL, rvR] = freeverb(verb.L, verb.R);
const rms = x => 20 * Math.log10(Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length) + 1e-9);
if (process.env.AUDIO_DEBUG) console.log('bus rms dB', { drums: rms(drums.L).toFixed(1), music: rms(music.L).toFixed(1), fx: rms(fx.L).toFixed(1), reverb: rms(rvL).toFixed(1) });
// a breath before the drop and before the end card: everything but the reverb tail steps back
for (const [from, to] of [[b(3.82), b(4)], [b(27.78), b(28)]]) {
  const s0 = Math.round(from * SR), s1 = Math.round(to * SR), fade = Math.round(.006 * SR);
  for (let s = s0 - fade; s < s1; s++) {
    const g = s < s0 ? 1 - (s - (s0 - fade)) / fade * .92 : .08;
    for (const x of [drums, music, fx]) { x.L[s] *= g; x.R[s] *= g; }
  }
}

const L = new Float32Array(N), R = new Float32Array(N);
for (let s = 0; s < N; s++) {
  L[s] = drums.L[s] * .9 + music.L[s] * 1.35 + fx.L[s] * .64 + rvL[s] * 1.6;
  R[s] = drums.R[s] * .9 + music.R[s] * 1.35 + fx.R[s] * .64 + rvR[s] * 1.6;
}
// gentle glue: soft clip, then normalize to -1 dBFS; short fades at both ends
let peak = 0;
for (let s = 0; s < N; s++) { L[s] = Math.tanh(L[s] * 1.15); R[s] = Math.tanh(R[s] * 1.15); peak = Math.max(peak, Math.abs(L[s]), Math.abs(R[s])); }
const norm = Math.pow(10, -1 / 20) / peak;
for (let s = 0; s < N; s++) {
  const fade = Math.min(1, s / (SR * .004), (N - s) / (SR * .35));
  L[s] *= norm * fade; R[s] *= norm * fade;
}

// ---- WAV (IEEE float) ----------------------------------------------------------------------------------------------------
const out = process.argv[2] || 'soundtrack.wav';
const data = Buffer.alloc(N * 8);
for (let s = 0; s < N; s++) { data.writeFloatLE(L[s], s * 8); data.writeFloatLE(R[s], s * 8 + 4); }
const head = Buffer.alloc(44);
head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(3, 20); head.writeUInt16LE(2, 22);
head.writeUInt32LE(SR, 24); head.writeUInt32LE(SR * 8, 28); head.writeUInt16LE(8, 32); head.writeUInt16LE(32, 34);
head.write('data', 36); head.writeUInt32LE(data.length, 40);
fs.writeFileSync(out, Buffer.concat([head, data]));
console.log(`soundtrack: ${out} · ${DUR}s · peak normalized from ${peak.toFixed(3)}`);
