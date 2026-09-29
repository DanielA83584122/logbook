// Replays each take (same seed, same viewport, same steps) and records where the UI
// elements sit at each mark, in the recording's device pixels, for HUD overlays and camera moves.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TAKES } from './takes.mjs';
import { openBrowser, closeBrowsers, newPage, openApp, Hand, sleep, reseed } from './lib.mjs';

const FIND = `(() => {
  const today = document.querySelector('section[aria-label="Logbook"] [aria-label^="Today"]');
  const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(v => Math.round(v * 10) / 10); };
  // Deepest element whose text contains the needle.
  const byText = (needle, root = document.body) => {
    let best = null;
    for (const el of root.querySelectorAll('*')) {
      if (el.closest('#promo-cursor')) continue;
      const text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (text.includes(needle) && el.getClientRects().length) best = el;
    }
    return best;
  };
  const exact = (needle, root = document.body) => {
    let best = null;
    for (const el of root.querySelectorAll('*')) {
      const text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (text === needle && el.getClientRects().length) best = el;
    }
    return best;
  };
  return { today, rect, byText, exact };
})()`;

const WANT = {
  'rec-01-write-and-tag': {
    ready: `({ todayBlock: rect(today), date: rect(today.querySelector('time')), caretRow: rect(document.activeElement) })`,
    'tag-suggest': `({ row: rect(document.activeElement), chip: rect(byText('#la', document.activeElement)) })`,
    'tag-chip': `({ row: rect(document.activeElement), chip: rect(exact('#launch', document.activeElement)) })`,
    'section-chip': `({ row: rect(document.activeElement), chip: rect(exact('#design', document.activeElement)) })`,
    'inherited-hover': `({ todayBlock: rect(today), shipped: rect(byText('shipped the new pricing page', today)), launchChip: rect(exact('#launch', today)),
      section: rect(byText('afternoon', today)), designChip: rect(exact('#design', today)), onboarding: rect(byText('onboarding copy', today)) })`,
  },
  'rec-02-check-off-todo': {
    'leaf-logged': `({ todayBlock: rect(today), landed: rect(byText('book flights to lisbon', today)), todo: rect(document.querySelector('[aria-label="Complete ship onboarding v2"], [aria-label="Expand ship onboarding v2"]')) })`,
    expanded: `({ finalQa: rect(byText('final qa pass')), finalBox: rect(document.querySelector('[aria-label="Complete final qa pass"]')), parent: rect(byText('ship onboarding v2')) })`,
    done: `({ todayBlock: rect(today), tree: rect(byText('ship onboarding v2', today)), lisbon: rect(byText('book flights to lisbon', today)), finalQa: rect(byText('final qa pass', today)) })`,
  },
  'rec-03-focus-timer': {
    'timer-running': `({ timer: rect(document.querySelector('[aria-label="Stop focus timer"]')), clock: rect(document.querySelector('[data-testid="compact-timer-time"]')), date: rect(today.querySelector('button')) })`,
    'typed-focused': `({ row: rect(byText('drafting the launch post', today)), date: rect(today.querySelector('button')) })`,
    'sessions-open': `({ dialog: rect(document.querySelector('dialog[open]')) })`,
  },
  'rec-04-tags-and-night': {
    'sidebar-open': `({ panel: rect(document.querySelector('[data-testid="tag-panel"]')), launch: rect(exact('#launch', document.querySelector('[data-testid="tag-panel"]'))), moon: rect(document.querySelector('[aria-label="Night mode"]')) })`,
    filtered: `({ log: rect(document.querySelector('[data-testid="log-scroll"]')), launchPrep: rect(byText('launch prep')), fix: rect(byText('fix signup redirect loop')) })`,
    night: `({ todayBlock: rect(today) })`,
  },
  'rec-05-search-and-stats': {
    'search-results': `({ dialog: rect(document.querySelector('dialog[open]')) })`,
    'search-landed': `({ row: rect(byText('lisbon: stay near the 28 tram line')) })`,
    'stats-7': `({ dialog: rect(document.querySelector('dialog[open]')), graph: rect(document.querySelector('[role="img"][aria-label^="Daily focus"]')) })`,
    'stats-30-open': `({ dialog: rect(document.querySelector('dialog[open]')), graph: rect(document.querySelector('[role="img"][aria-label^="Daily focus"]')),
      bars: [...document.querySelectorAll('[role="img"][aria-label^="Daily focus"] > *')].map(rect) })`,
    'cheatsheet-open': `({ dialog: rect(document.querySelector('dialog[open]')) })`,
  },
  'rec-06-phone-night': {
    ready: `({ timer: rect(document.querySelector('[aria-label="Start focus timer"]')), lisbonBox: rect(document.querySelector('[aria-label="Complete book flights to lisbon"]')), todayBlock: rect(today) })`,
    checked: `({ landed: rect(byText('book flights to lisbon', today)), todayBlock: rect(today) })`,
    typed: `({ row: rect(byText('gate b32', today)), chip: rect(exact('#travel', today)) })`,
  },
};

const out = {};
for (const [name, take] of Object.entries(TAKES)) {
  const dpr = take.viewport.dpr ?? 2;
  await reseed();
  const { context, page } = await newPage(await openBrowser(dpr), take.viewport);
  await openApp(page);
  await sleep(500);
  const hand = new Hand(page);
  out[name] = { dpr };
  await take.run({ page, hand, mark: async label => {
    const expr = WANT[name]?.[label];
    if (!expr) return;
    const value = await page.evaluate(`(() => { const { today, rect, byText, exact } = ${FIND}; return ${expr}; })()`);
    const scale = v => Array.isArray(v) ? (typeof v[0] === 'number' ? v.map(n => Math.round(n * dpr)) : v.map(scale)) : v;
    out[name][label] = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, v && scale(v)]));
  } });
  await context.close();
  console.log(name, JSON.stringify(out[name]).slice(0, 300));
}
await closeBrowsers();
const target = process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/layout.json');
fs.writeFileSync(target, JSON.stringify(out, null, 1));
