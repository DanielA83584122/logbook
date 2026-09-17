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
    const [button, first, text, controls] = await Promise.all([
      timer.boundingBox(), task.boundingBox(), note.boundingBox(), page.getByRole('group', { name: 'Page controls' }).boundingBox(),
    ]);
    // The concentric ring extends eight pixels beyond the button.
    expect(button!.y - 8).toBeCloseTo(first!.y, 0);
    expect(button!.x + button!.width + 8).toBeCloseTo(text!.x + text!.width, 0);
    expect(controls!.y + controls!.height).toBeLessThan(button!.y - 8);
    await page.getByTestId('log-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
    expect(await timer.boundingBox()).toEqual(button);
    expect(await task.boundingBox()).toEqual(first);
    await page.getByTestId('log-scroll').evaluate(el => { el.scrollTop = 0; });
  }
  await page.screenshot({ path: '/tmp/still-layout-desktop.png' });
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
