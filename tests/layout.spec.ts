import { expect, test } from '@playwright/test';

const today = '2026-09-17';
test.beforeEach(async ({ page }) => {
  await page.route('**/api/journal?*', route => route.fulfill({ json: {
    today, server_time: new Date().toISOString(), active_session: null, next_cursor: null, tags: [], tag: null,
    tasks: [{ id: 9001, content: 'First to-do', tags: [], parent_id: null, position: 0 }],
    days: [
      { date: today, focused_seconds: 0, notes: Array.from({ length: 30 }, (_, i) => ({ id: 9100 + i, content: `Current note ${i}`, tags: [], parent_id: null, position: i })) },
      { date: '2026-09-16', focused_seconds: 0, notes: [{ id: 9200, content: 'Older note', tags: [], parent_id: null, position: 0 }] },
    ],
  } }));
});

test('timer aligns to the first task and journal text without overlapping page controls', async ({ page }) => {
  await page.goto('/');
  const timer = page.getByRole('button', { name: 'Start focus timer', exact: true });
  const task = page.getByRole('group', { name: 'First to-do', exact: true });
  const note = page.getByRole('group', { name: 'Current note 0', exact: true });
  for (const width of [1440, 1280, 1024, 900, 760, 641]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(async () => {
      const settled = (await timer.boundingBox())!;
      return settled.x + settled.width / 2;
    }).toBeGreaterThanOrEqual(width / 2 - 4);
    const [button, first, text, controls] = await Promise.all([
      timer.boundingBox(), task.boundingBox(), note.boundingBox(), page.getByRole('group', { name: 'Page controls' }).boundingBox(),
    ]);
    // The concentric ring extends eight pixels beyond the button.
    expect(button!.y - 8).toBeCloseTo(first!.y, 0);
    expect(button!.x - 8 - (first!.x + first!.width)).toBeGreaterThanOrEqual(37);
    expect(button!.x + button!.width / 2).toBeGreaterThanOrEqual(width / 2 - 4);
    expect(button!.x + button!.width + 8).toBeLessThanOrEqual(text!.x + text!.width);
    expect(controls!.y + controls!.height).toBeLessThan(button!.y - 8);
    await page.getByTestId('log-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
    const scrolledTimer = (await timer.boundingBox())!;
    expect(Math.abs(scrolledTimer.x - button!.x)).toBeLessThan(4);
    expect(scrolledTimer.y).toBe(button!.y);
    const scrolledTask = (await task.boundingBox())!;
    expect(scrolledTask.x).toBeCloseTo(first!.x, 0);
    expect(scrolledTask.y).toBeCloseTo(first!.y, 0);
    expect(Math.abs(scrolledTask.width - first!.width)).toBeLessThan(2);
    expect(scrolledTask.height).toBeCloseTo(first!.height, 0);
    await page.getByTestId('log-scroll').evaluate(el => { el.scrollTop = 0; });
  }
  await page.screenshot({ path: '/tmp/still-layout-desktop.png' });
});

test('timer follows task content, long tasks wrap at its outer limit, and the empty area starts a focused task', async ({ page }) => {
  await page.unroute('**/api/journal?*');
  let tasks: Array<{ id: number; content: string; tags: string[]; parent_id: null; position: number }> = [];
  await page.route('**/api/journal?*', route => route.fulfill({ json: {
    today, server_time: new Date().toISOString(), active_session: null, next_cursor: null, tags: [], tag: null, tasks,
    days: [{ date: today, focused_seconds: 0, notes: [{ id: 9300, content: 'Width reference', tags: [], parent_id: null, position: 0 }] }],
  } }));
  await page.goto('/');
  const emptyArea = page.getByRole('button', { name: 'Add to-do', exact: true });
  await expect(emptyArea).toBeVisible();
  expect((await emptyArea.boundingBox())!.height).toBeGreaterThan(80);
  await expect(page.getByRole('textbox', { name: 'New to-do', exact: true })).toHaveCount(0);
  await emptyArea.click({ position: { x: 20, y: (await emptyArea.boundingBox())!.height - 10 } });
  await expect(page.getByRole('textbox', { name: 'New to-do', exact: true })).toBeFocused();

  tasks = [{ id: 9301, content: 'A deliberately very long to-do entry that keeps going until it has to wrap before reaching the timer at the established outer edge of the document', tags: [], parent_id: null, position: 0 }];
  await page.reload();
  const note = (await page.getByRole('group', { name: 'Width reference', exact: true }).boundingBox())!;
  await expect.poll(async () => {
    const box = (await page.getByRole('button', { name: 'Start focus timer', exact: true }).boundingBox())!;
    return note.x + note.width - (box.x + box.width + 8);
  }).toBeLessThan(24);
  const timer = (await page.getByRole('button', { name: 'Start focus timer', exact: true }).boundingBox())!;
  const task = (await page.getByRole('group', { name: tasks[0].content, exact: true }).boundingBox())!;
  expect(task.height).toBeGreaterThan(28);
  expect(task.x + task.width).toBeLessThan(timer.x - 8);

  tasks = [{ id: 9302, content: 'A reasonably long introductory phrase pneumonoultramicroscopicsilicovolcanoconiosisextended', tags: [], parent_id: null, position: 0 }];
  await page.reload();
  const wordTask = (await page.getByRole('group', { name: tasks[0].content, exact: true }).boundingBox())!;
  const wordNote = (await page.getByRole('group', { name: 'Width reference', exact: true }).boundingBox())!;
  expect(wordTask.height).toBeGreaterThan(28);
  await expect.poll(async () => {
    const box = (await page.getByRole('button', { name: 'Start focus timer', exact: true }).boundingBox())!;
    return wordNote.x + wordNote.width - (box.x + box.width + 8);
  }).toBeGreaterThan(40);
});

test('compact view centers the timer above today and gives remaining height to notes', async ({ page }) => {
  await page.goto('/');
  for (const size of [{ width: 640, height: 800 }, { width: 440, height: 700 }, { width: 260, height: 700 }, { width: 1000, height: 400 }]) {
    await page.setViewportSize(size);
    await page.getByTestId('log-scroll').evaluate(el => { el.scrollTop = 0; });
    await expect(page.getByRole('group', { name: 'Page controls' })).toBeHidden();
    await expect(page.getByRole('region', { name: 'to do', exact: true })).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Tags' })).toBeHidden();
    await expect(page.getByRole('group', { name: 'Older note', exact: true })).toBeHidden();
    const timer = (await page.getByRole('button', { name: 'Start focus timer', exact: true }).boundingBox())!;
    const log = (await page.getByTestId('log-scroll').boundingBox())!;
    const date = (await page.getByRole('button', { name: `Focus sessions for ${today}`, exact: true }).boundingBox())!;
    expect(timer.x + timer.width / 2).toBeCloseTo(size.width / 2, 0);
    expect(timer.y - 8).toBe(24);
    expect(log.y).toBeGreaterThan(timer.y + timer.height + 8);
    expect(date.y).toBeGreaterThanOrEqual(log.y);
    expect(log.y + log.height).toBeCloseTo(size.height, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(size.height);
    await page.getByTestId('log-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
    expect(await page.getByRole('button', { name: 'Start focus timer', exact: true }).boundingBox()).toEqual(timer);
    await page.getByTestId('log-scroll').evaluate(el => { el.scrollTop = 0; });
  }
  await page.setViewportSize({ width: 440, height: 700 });
  await page.screenshot({ path: '/tmp/still-layout-compact.png' });
  await page.setViewportSize({ width: 260, height: 180 });
  await expect(page.getByTestId('log-scroll')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Start focus timer', exact: true })).toBeInViewport();
});

test('journal ink wash appears only after content is clipped', async ({ page }) => {
  await page.goto('/');
  const journal = page.getByTestId('log-scroll');
  const wash = page.getByTestId('log-top-ink-wash');
  await expect(journal).not.toHaveAttribute('data-top-fade', 'true');
  await expect(wash).toHaveCSS('opacity', '0');
  await journal.evaluate(el => { el.scrollTop = 80; });
  await expect(journal).toHaveAttribute('data-top-fade', 'true');
  await expect(wash).toHaveCSS('backdrop-filter', 'none');
  await expect(wash).toHaveCSS('background-image', /linear-gradient/);
  expect((await wash.evaluate(element => getComputedStyle(element, '::after').backgroundImage)).match(/radial-gradient/g)?.length).toBe(5);
  const [journalBox, washBox] = await Promise.all([journal.boundingBox(), wash.boundingBox()]);
  expect(washBox!.x).toBeLessThan(journalBox!.x);
  expect(washBox!.x + washBox!.width).toBeGreaterThan(journalBox!.x + journalBox!.width);
  await page.screenshot({ path: '/tmp/still-log-top-ink-wash.png' });
  await journal.evaluate(el => { el.scrollTop = 0; });
  await expect(journal).not.toHaveAttribute('data-top-fade', 'true');
});

test('task checkmarks preview completion and reopening on hover', async ({ page }) => {
  await page.unroute('**/api/journal?*');
  await page.route('**/api/journal?*', route => route.fulfill({ json: {
    today, server_time: new Date().toISOString(), active_session: null, next_cursor: null, tags: [], tag: null,
    tasks: [{ id: 9401, content: 'Preview completion', tags: [], parent_id: null, position: 0 }],
    days: [{ date: today, focused_seconds: 0, notes: [], tasks: [{ id: 9402, content: 'Preview reopening', tags: [], parent_id: null, position: 0, completed_at: new Date().toISOString() }] }],
  } }));
  await page.goto('/');
  const unfinished = page.getByRole('button', { name: 'Complete Preview completion', exact: true });
  const finished = page.getByRole('button', { name: 'Reopen Preview reopening', exact: true });
  expect(await unfinished.evaluate(el => getComputedStyle(el, '::after').opacity)).toBe('0');
  await unfinished.hover();
  await expect.poll(() => unfinished.evaluate(el => getComputedStyle(el, '::after').opacity)).toBe('1');
  await expect.poll(() => unfinished.evaluate(el => getComputedStyle(el, '::before').borderColor)).toBe('rgb(33, 105, 176)');
  expect(await unfinished.evaluate(el => getComputedStyle(el, '::before').backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  expect(await unfinished.evaluate(el => getComputedStyle(el, '::after').backgroundColor)).toBe('rgb(33, 105, 176)');
  await unfinished.click();
  await expect(unfinished).toHaveAttribute('data-preview-suppressed', 'true');
  await expect.poll(() => unfinished.evaluate(el => getComputedStyle(el, '::after').opacity)).toBe('0');
  await page.mouse.move(0, 0);
  await unfinished.hover();
  await expect.poll(() => unfinished.evaluate(el => getComputedStyle(el, '::after').opacity)).toBe('1');
  expect(await finished.evaluate(el => getComputedStyle(el, '::after').opacity)).toBe('1');
  await finished.hover();
  await expect.poll(() => finished.evaluate(el => getComputedStyle(el, '::after').opacity)).toBe('0');
});
