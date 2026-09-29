// Renders the promo frame by frame: headless Chrome calls window.seek(frame) on src/index.html,
// screenshots the stage and pipes PNGs into ffmpeg; then muxes the synthesized soundtrack.
//
//   node render.mjs                      both formats, full length, with sound
//   node render.mjs --format 16x9        one format
//   node render.mjs --stills 1.2,3.5     PNG stills at those times (seconds) into out/stills/
//   node render.mjs --from 3 --to 5      a partial video (seconds), no sound
//   node render.mjs --length 30          the 30 s cut (same film at half pace); default 15
//
// Env: FFMPEG (default: ffmpeg on PATH), PROMO_CACHE (extracted footage frames),
//      PROMO_CAPTURE (default ../promo-capture).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(ROOT, '..');
const require = createRequire(path.join(REPO, 'package.json'));
const { chromium } = require('playwright-core');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const CAPTURE = process.env.PROMO_CAPTURE || path.join(REPO, 'promo-capture');
const CACHE = process.env.PROMO_CACHE || path.join(os.tmpdir(), 'logbook-promo-cache');
const OUT = path.join(ROOT, 'out');
const FPS = 60;
const SIZES = { '16x9': [1920, 1080], '9x16': [1080, 1920] };

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : null; };
const DURATION = opt('length') === '30' ? 30 : 15, FRAMES = FPS * DURATION;
const suffix = DURATION === 15 ? '' : `-${DURATION}s`;
const formats = opt('format') ? [opt('format')] : ['16x9', '9x16'];
const stills = opt('stills')?.split(',').map(Number);
const from = opt('from') !== null ? Math.round(Number(opt('from')) * FPS) : 0;
const to = opt('to') !== null ? Math.round(Number(opt('to')) * FPS) : FRAMES;
fs.mkdirSync(OUT, { recursive: true });

// 1. Footage frames, extracted once from the approved captures.
const TAKES = ['rec-01-write-and-tag', 'rec-02-check-off-todo', 'rec-03-focus-timer', 'rec-04-tags-and-night', 'rec-05-search-and-stats', 'rec-06-phone-night'];
for (const take of TAKES) {
  for (const small of [false, true]) {
    const dir = path.join(CACHE, take + (small ? '-s' : ''));
    if (fs.existsSync(dir) && fs.readdirSync(dir).length > 10) continue;
    fs.mkdirSync(dir, { recursive: true });
    console.log('extracting', path.basename(dir));
    execFileSync(FFMPEG, ['-loglevel', 'error', '-y', '-i', path.join(CAPTURE, take + '.mp4'),
      ...(small ? ['-vf', 'scale=iw/4:-2:flags=lanczos'] : []), '-q:v', '3', '-start_number', '0', path.join(dir, '%05d.jpg')]);
  }
}

// 2. Data the film reads: element positions, the app's own /journal.md, 30-day stats.
const asset = f => fs.readFileSync(path.join(ROOT, 'assets', f), 'utf8');
fs.writeFileSync(path.join(ROOT, 'assets', 'data.js'),
  `window.__LAYOUT = ${asset('layout.json')};\nwindow.__JOURNAL = ${JSON.stringify(asset('journal.md'))};\nwindow.__STATS = ${asset('stats-30.json')};\nwindow.__TIMING = ${asset('timing.json')};\n`);

// 3. A tiny static server: the film at /, footage frames at /cache/.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json', '.md': 'text/markdown' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = url.startsWith('/cache/') ? path.join(CACHE, url.slice(7)) : path.join(ROOT, url);
  if (!file.startsWith(CACHE) && !file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'max-age=3600' }).end(data);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force-device-scale-factor=1', '--force-color-profile=srgb', '--hide-scrollbars', '--font-render-hinting=none'] });

async function openFilm(format) {
  const [w, h] = SIZES[format];
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('[console]', m.text()); });
  await page.goto(`${base}/src/index.html?format=${format}&length=${DURATION}`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const cdp = await page.context().newCDPSession(page);
  const shot = async frame => {
    await page.evaluate(async f => { await window.seek(f); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }, frame);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
    return Buffer.from(data, 'base64');
  };
  return { page, shot, w, h };
}

for (const format of formats) {
  const film = await openFilm(format);
  if (stills) {
    const dir = path.join(OUT, 'stills');
    fs.mkdirSync(dir, { recursive: true });
    for (const s of stills) {
      const frame = Math.min(FRAMES - 1, Math.round(s * FPS));
      fs.writeFileSync(path.join(dir, `${format}${suffix}-${s.toFixed(2)}.png`), await film.shot(frame));
    }
    console.log(`stills ${format}: ${stills.length}`);
    await film.page.close();
    continue;
  }
  const partial = from !== 0 || to !== FRAMES;
  const video = path.join(OUT, partial ? `part-${format}${suffix}.mp4` : `video-${format}${suffix}.mp4`);
  const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-maxrate', '40M', '-bufsize', '80M', '-pix_fmt', 'yuv420p', '-tune', 'film',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', video], { stdio: ['pipe', 'inherit', 'inherit'] });
  const started = Date.now();
  for (let frame = from; frame < to; frame++) {
    const png = await film.shot(frame);
    if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r));
    if (frame % 60 === 0) process.stdout.write(`\r${format} ${frame}/${to} ${((Date.now() - started) / 1000).toFixed(0)}s   `);
  }
  ff.stdin.end();
  await new Promise((resolve, reject) => ff.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg ' + code))));
  console.log(`\n${format} video in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  await film.page.close();
  if (!partial) {
    const wav = path.join(OUT, `soundtrack${suffix}.wav`);
    if (!fs.existsSync(wav)) execFileSync(process.execPath, [path.join(ROOT, 'src', 'audio.mjs'), wav, String(DURATION)], { stdio: 'inherit' });
    const [w, h] = SIZES[format];
    const final = path.join(OUT, `logbook-promo${suffix}-${w}x${h}.mp4`);
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', video, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-t', String(DURATION), '-movflags', '+faststart', final]);
    console.log('wrote', final);
    // For the README: GitHub's video upload takes at most 10 MB on a free plan; 1080p at 30 fps lands near 7 MB.
    if (format === '16x9' && DURATION === 15) {
      const web = path.join(OUT, 'logbook-promo-web.mp4');
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', final, '-vf', 'fps=30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24',
        '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', web]);
      console.log('wrote', web, `${(fs.statSync(web).size / 1e6).toFixed(1)} MB`);
    }
  }
}
await browser.close();
server.close();
