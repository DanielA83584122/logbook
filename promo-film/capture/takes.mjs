// The six recorded takes. Each runs twice from a freshly seeded database:
// once recorded (video + timing log + moment clips), once for clean PNG stills.
//
// Never point this at the personal journal. Start a scratch server in test mode first:
//   export PROMO_DB=/tmp/logbook-promo.sqlite3
//   STILL_DB_PATH=$PROMO_DB STILL_TEST_MODE=1 STILL_SEED_ON_FIRST_RUN=0 \
//     .venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8020
// then, from the repo root:
//   node promo-film/capture/takes.mjs [rec-01 …]   writes promo-capture/
//   node promo-film/capture/measure.mjs            writes promo-film/assets/layout.json
// Env: PROMO_DB, PROMO_PORT (8020), PROMO_WORK (raw frames), FFMPEG (needs libx264).
// New takes change the timing: update the retime keys in promo-film/assets/timing.json.
import path from 'node:path';
import fs from 'node:fs';
import { openBrowser, closeBrowsers, newPage, openApp, Recorder, Hand, sleep, still, reseed, OUT, BASE } from './lib.mjs';

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Stockholm' }).format(new Date());
const todayBlock = page => page.locator(`section[aria-label="Logbook"] [aria-label="Today, ${TODAY}"]`);

async function openSidebar(hand, page) {
  await hand.moveTo(640, 430, { duration: 260 });
  await hand.moveTo(22, 420, { duration: 520 });
  await page.getByTestId('tag-panel').locator('button').first().waitFor({ state: 'visible' });
  await sleep(380);
}

async function newTodayBullet(hand, page) {
  const target = todayBlock(page).getByRole('button', { name: 'Add journal bullet' });
  await hand.clickTarget(target, { dx: 60, label: 'blank space under today' });
  await page.locator('[aria-label="New journal bullet"]').waitFor();
  await sleep(250);
}

export const TAKES = {
  // 01 — open the page and write: a tagged note, a section row, a bullet that inherits its tag.
  'rec-01-write-and-tag': {
    viewport: {},
    what: 'Open the logbook and write: inline #tag autocomplete becomes a chip, "# " turns a bullet into a section row, and the next bullet inherits its tag.',
    clips: [
      { name: 'clip-01-tag-chip', from: 'tag-hash', pre: 0.5, to: 'tag-chip', post: 0.9 },
      { name: 'clip-02-section-row', from: 'section-start', pre: 0.3, to: 'section-chip', post: 1.4 },
    ],
    async run({ page, hand, mark }) {
      await hand.park(1010, 575);
      await sleep(1100);
      await mark('ready', 'screen-home.png');
      mark('type-note');
      await hand.type('shipped the new pricing page ');
      mark('tag-hash');
      await hand.type('#');
      await sleep(320);
      await hand.type('la');
      await sleep(650);
      await mark('tag-suggest', 'screen-tag-suggest.png');
      await hand.press('Enter', { label: 'accept #launch' });
      await sleep(700);
      await mark('tag-chip', 'screen-tag-chip.png');
      await hand.press('Enter', { label: 'save bullet' });
      await hand.waitEmpty();
      await sleep(650);
      mark('section-start');
      await hand.type('# ');
      await sleep(450);
      await hand.type('afternoon ');
      await hand.type('#');
      await sleep(250);
      await hand.type('de');
      await sleep(550);
      await hand.press('Enter', { label: 'accept #design' });
      await sleep(550);
      mark('section-chip');
      await hand.press('Enter', { label: 'save section' });
      await hand.waitEmpty();
      await sleep(450);
      await hand.type('onboarding copy: shorter, warmer');
      await sleep(350);
      await hand.press('Enter', { label: 'save bullet' });
      await hand.waitEmpty();
      await sleep(500);
      await hand.press('Escape');
      await sleep(250);
      await hand.moveToTarget(page.getByText('onboarding copy: shorter, warmer'), { dx: 120, duration: 650 });
      await sleep(900);
      await mark('inherited-hover', 'screen-section-row.png');
      await sleep(900);
    },
  },

  // 02 — the hero moment: checking off a to-do logs it under today, and finishing a last step moves the whole tree.
  'rec-02-check-off-todo': {
    viewport: {},
    what: 'Check off a to-do and it lands under today’s date; expand a parent, finish its last step, and the whole tree moves into the log.',
    clips: [
      { name: 'clip-03-todo-to-log', from: 'leaf-click', pre: 0.7, to: 'leaf-click', post: 1.9 },
      { name: 'clip-04-tree-to-log', from: 'tree-click', pre: 0.7, to: 'tree-open', post: 1.2 },
    ],
    async run({ page, hand, mark }) {
      await hand.park(1040, 470);
      await sleep(900);
      await hand.moveToTarget('[aria-label="Complete book flights to lisbon"]', { duration: 800 });
      await sleep(250);
      mark('leaf-click');
      await hand.click({ label: 'complete book flights to lisbon' });
      await sleep(260);
      // Follow the row down into today's log, off to its right.
      const landed = todayBlock(page).getByText('book flights to lisbon');
      await landed.waitFor();
      await hand.moveToTarget(landed, { dx: -1, dy: null, duration: 650 }).then(() => hand.moveTo(hand.x + 150, hand.y, { duration: 250 }));
      await sleep(1000);
      await mark('leaf-logged', 'screen-todo-logged.png');
      await hand.moveToTarget('[aria-label="Expand ship onboarding v2"]', { duration: 700 });
      await sleep(200);
      await hand.click({ label: 'expand ship onboarding v2' });
      await sleep(250);
      await hand.moveToTarget(page.getByText('final qa pass'), { dx: -1, duration: 420 }).then(() => hand.moveTo(hand.x + 170, hand.y, { duration: 250 }));
      await sleep(650);
      await mark('expanded', 'screen-todo-expanded.png');
      await hand.moveToTarget('[aria-label="Complete final qa pass"]', { duration: 600 });
      await sleep(250);
      mark('tree-click');
      await hand.click({ label: 'complete final qa pass' });
      await sleep(260);
      const tree = todayBlock(page).getByRole('button', { name: /ship onboarding v2/ });
      await tree.waitFor();
      await hand.moveToTarget(page.getByText('ship onboarding v2'), { dx: -1, duration: 650 }).then(() => hand.moveTo(hand.x + 140, hand.y, { duration: 250 }));
      await sleep(700);
      await hand.moveToTarget(tree, { duration: 650 });
      await sleep(300);
      if (await tree.getAttribute('aria-label').then(label => label?.startsWith('Expand'))) await hand.click({ label: 'expand the logged tree' });
      mark('tree-open');
      await sleep(300);
      await hand.moveTo(hand.x + 520, hand.y + 30, { duration: 650 });
      await sleep(1000);
      await mark('done', 'screen-todo-done.png');
      await sleep(500);
    },
  },

  // 03 — focus timer: start it, the page dims and the day total ticks, write while focused, stop, open the day's sessions.
  'rec-03-focus-timer': {
    viewport: {},
    what: 'Start the focus timer: the page dims, the clock and today’s total tick. Write a note while focused, stop the timer, and open today’s sessions.',
    clips: [
      { name: 'clip-05-focus-on', from: 'timer-start', pre: 0.7, to: 'timer-start', post: 2.4 },
      { name: 'clip-06-focus-off', from: 'timer-stop', pre: 0.5, to: 'sessions', post: 1.3 },
    ],
    async run({ page, hand, mark }) {
      await hand.park(900, 470);
      await sleep(800);
      await hand.moveToTarget('[aria-label="Start focus timer"]', { duration: 850 });
      await sleep(250);
      mark('timer-start');
      await hand.click({ label: 'start focus timer' });
      await sleep(400);
      await hand.moveTo(1000, 300, { duration: 700 });
      await sleep(1200);
      await mark('timer-running', 'screen-timer-running.png');
      await newTodayBullet(hand, page);
      mark('type-focused');
      await hand.type('drafting the launch post, phone in the other room');
      await sleep(300);
      await hand.press('Enter', { label: 'save bullet' });
      await hand.waitEmpty();
      await sleep(1500);
      await mark('typed-focused', 'screen-timer-writing.png');
      await hand.moveToTarget('[aria-label="Stop focus timer"]', { duration: 850 });
      await sleep(250);
      mark('timer-stop');
      await hand.click({ label: 'stop focus timer' });
      await sleep(900);
      await hand.moveToTarget(`[aria-label="Focus sessions for ${TODAY}"]`, { dx: -30, duration: 800 });
      await sleep(200);
      await hand.click({ label: 'open today’s sessions' });
      mark('sessions');
      await sleep(900);
      await mark('sessions-open', 'screen-sessions.png');
      await sleep(900);
      await hand.press('Escape');
      await sleep(600);
    },
  },

  // 04 — organise by topic: the tag sidebar, a filter across days, and the night theme.
  'rec-04-tags-and-night': {
    viewport: {},
    what: 'Hover the left margin for the tag sidebar, filter to #launch across every day, scroll it, then switch to night mode and back to all entries.',
    clips: [
      { name: 'clip-07-tag-filter', from: 'sidebar', pre: 0.4, to: 'launch-click', post: 1.8 },
      { name: 'clip-08-night-mode', from: 'night-click', pre: 0.6, to: 'night-click', post: 1.8 },
    ],
    async run({ page, hand, mark }) {
      await hand.park(900, 470);
      await sleep(800);
      await openSidebar(hand, page);
      mark('sidebar');
      await sleep(250);
      await mark('sidebar-open', 'screen-tag-sidebar.png');
      await hand.moveToTarget(page.getByTestId('tag-panel').getByRole('button', { name: '#reading' }), { duration: 450 });
      await sleep(300);
      await hand.moveToTarget(page.getByTestId('tag-panel').getByRole('button', { name: '#launch' }), { duration: 420 });
      await sleep(250);
      mark('launch-click');
      await hand.click({ label: 'filter #launch' });
      await sleep(350);
      await hand.moveTo(900, 520, { duration: 700 });
      await sleep(900);
      await mark('filtered', 'screen-tag-filter.png');
      await hand.wheel(420, { ms: 700 });
      await sleep(900);
      await hand.wheel(-420, { ms: 600 });
      await sleep(500);
      await openSidebar(hand, page);
      await hand.moveToTarget('[aria-label="Night mode"]', { duration: 520 });
      await sleep(250);
      mark('night-click');
      await hand.click({ label: 'night mode' });
      await sleep(700);
      await mark('night-sidebar', 'screen-night-sidebar.png');
      await hand.moveToTarget(page.getByTestId('tag-panel').getByRole('button', { name: 'all' }), { duration: 480 });
      await sleep(200);
      await hand.click({ label: 'all entries' });
      mark('all');
      await sleep(300);
      await hand.moveTo(1000, 440, { duration: 700 });
      await sleep(1200);
      await mark('night', 'screen-home-night.png');
      await sleep(600);
    },
  },

  // 05 — find and review: search the whole archive and jump to a result, then the focus statistics.
  'rec-05-search-and-stats': {
    viewport: {},
    what: '⌘F searches every note and to-do; Enter jumps to the date and highlights the row. Then the focus statistics: 7 days, 30 days. Ends on the ⌘? cheat sheet.',
    clips: [
      { name: 'clip-09-search-jump', from: 'search-open', pre: 0.3, to: 'search-jump', post: 1.5 },
      { name: 'clip-10-stats', from: 'stats-click', pre: 0.4, to: 'stats-30', post: 1.6 },
    ],
    async run({ page, hand, mark }) {
      await hand.park(1000, 470);
      await sleep(900);
      mark('search-open');
      await hand.press('Meta+f', { label: '⌘F' });
      await sleep(550);
      await hand.type('lisbon', { cps: 9 });
      await sleep(700);
      await mark('search-results', 'screen-search.png');
      await hand.press('ArrowDown', { label: '↓' });
      await sleep(450);
      await hand.press('Enter', { label: 'open result' });
      mark('search-jump');
      await sleep(1500);
      await mark('search-landed', 'screen-search-jump.png');
      await openSidebar(hand, page);
      await hand.moveToTarget('[aria-label="Open focus statistics"]', { duration: 520 });
      await sleep(250);
      mark('stats-click');
      await hand.click({ label: 'statistics' });
      await sleep(1100);
      await mark('stats-7', 'screen-stats-7-days.png');
      await hand.moveToTarget(page.getByRole('button', { name: '30 days' }), { duration: 650 });
      await sleep(200);
      await hand.click({ label: '30 days' });
      mark('stats-30');
      await sleep(1300);
      await mark('stats-30-open', 'screen-stats-30-days.png');
      await hand.press('Escape');
      await sleep(600);
      mark('cheatsheet');
      await hand.press('Meta+Shift+Slash', { label: '⌘?' });
      await sleep(1100);
      await mark('cheatsheet-open', 'screen-cheatsheet.png');
      await sleep(600);
      await hand.press('Escape');
      await sleep(500);
    },
  },

  // 06 — the same logbook on a phone, night theme, driven by taps.
  'rec-06-phone-night': {
    viewport: { width: 390, height: 844, dpr: 3, mobile: true, theme: 'night' },
    what: 'Phone layout in night mode, driven by taps: start the timer, check off a to-do (it drops into today’s log), write a tagged note, stop the timer.',
    clips: [
      { name: 'clip-11-phone-check', from: 'check', pre: 0.6, to: 'check', post: 1.9 },
    ],
    async run({ page, hand, mark }) {
      await sleep(1200);
      await mark('ready', 'screen-phone-night.png');
      mark('timer-start');
      await hand.tapTarget('[aria-label="Start focus timer"]', { label: 'start focus timer' });
      await sleep(1500);
      mark('check');
      await hand.tapTarget('[aria-label="Complete book flights to lisbon"]', { label: 'complete book flights to lisbon' });
      await sleep(1600);
      await mark('checked', 'screen-phone-focus.png');
      const add = todayBlock(page).getByRole('button', { name: 'Add journal bullet' });
      await hand.tapTarget(add, { dx: 60, label: 'blank space under today' });
      await page.locator('[aria-label="New journal bullet"]').waitFor();
      await sleep(400);
      mark('type');
      await hand.type('gate b32, boarding at 18:40 ');
      await hand.type('#');
      await sleep(250);
      await hand.type('tr');
      await sleep(550);
      await hand.press('Enter', { label: 'accept #travel' });
      await sleep(450);
      await hand.press('Enter', { label: 'save bullet' });
      await hand.waitEmpty();
      await sleep(1200);
      await mark('typed', 'screen-phone-note.png');
      mark('timer-stop');
      await hand.tapTarget('[aria-label="Stop focus timer"]', { label: 'stop focus timer' });
      await sleep(1400);
    },
  },
};

function seconds(file) {
  const log = fs.readFileSync(file + '.json', 'utf8');
  return JSON.parse(log).duration;
}

export async function runTake(name, { record = true, stills = true } = {}) {
  const take = TAKES[name];
  const browser = await openBrowser(take.viewport.dpr ?? 2);
  const results = { name, what: take.what };
  if (record) {
    await reseed();
    const { context, page } = await newPage(browser, take.viewport);
    await openApp(page);
    await sleep(500);
    const rec = new Recorder(page, name);
    const hand = new Hand(page, rec);
    await rec.start();
    await take.run({ page, hand, mark: async (label) => rec.mark(label) });
    await rec.stop();
    const file = path.join(OUT, `${name}.mp4`);
    rec.encode(file);
    rec.writeLog(path.join(OUT, 'logs', `${name}.json`));
    results.stats = rec.stats();
    results.clips = [];
    for (const clip of take.clips) {
      const from = rec.marks.find(m => m.label === clip.from)?.t, to = rec.marks.find(m => m.label === clip.to)?.t;
      if (from === undefined || to === undefined) { console.warn(`  clip ${clip.name}: missing mark`); continue; }
      const start = Math.max(0, from - clip.pre), end = Math.min(rec.t1 - rec.t0, to + clip.post);
      rec.encode(path.join(OUT, 'clips', `${clip.name}.mp4`), { trimStart: start, trimEnd: end });
      results.clips.push({ name: clip.name, start: +start.toFixed(2), end: +end.toFixed(2) });
    }
    console.log(name, results.stats);
    await context.close();
  }
  if (stills) {
    await reseed();
    const { context, page } = await newPage(browser, take.viewport);
    await openApp(page);
    await sleep(500);
    const hand = new Hand(page);
    await take.run({ page, hand, mark: async (label, stillName) => { if (stillName) await still(page, stillName); } });
    await context.close();
  }
  return results;
}

// Loose stills that are not part of a take.
export async function extraStills() {
  await reseed();
  {
    const { context, page } = await newPage(await openBrowser(3), { width: 390, height: 844, dpr: 3, mobile: true });
    await openApp(page); await sleep(900);
    await still(page, 'screen-phone-day.png');
    await context.close();
  }
  {
    const { context, page } = await newPage(await openBrowser(2), {});
    await page.goto(`${BASE}/journal.md?timezone=Europe%2FStockholm&tag=launch`);
    await sleep(500);
    await still(page, 'screen-agent-markdown.png');
    await context.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv.slice(2);
  fs.mkdirSync(path.join(OUT, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'clips'), { recursive: true });
  const summary = [];
  for (const name of Object.keys(TAKES)) {
    if (only.length && !only.some(o => name.includes(o))) continue;
    console.log(`== ${name}`);
    summary.push(await runTake(name, { record: !process.env.STILLS_ONLY, stills: !process.env.RECORD_ONLY }));
  }
  if (!only.length || only.includes('extras')) await extraStills();
  await closeBrowsers();
  console.log(JSON.stringify(summary, null, 1));
}
