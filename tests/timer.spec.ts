import { expect, test } from '@playwright/test';

test('timer shows ticking seconds, running colors in both themes, and resets on stop', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-16T10:02:03-07:00') });
  await page.clock.pauseAt(new Date('2026-09-16T10:02:03-07:00'));
  let running = true;
  const session = { id: 500, started_at: '2026-09-16T09:00:00-07:00', ended_at: null, duration_seconds: 3723 };
  await page.route('**/api/journal?*', async route => route.fulfill({ json: {
    today: '2026-09-16', server_time: await page.evaluate(() => new Date().toISOString()),
    active_session: running ? session : null, next_cursor: null, tasks: [], tags: [],
    days: [{ date: '2026-09-16', focused_seconds: 3723, session_count: 1, longest_session_seconds: 3723, notes: [] }],
  } }));
  await page.route('**/api/timer/stop?*', route => { running = false; return route.fulfill({ json: session }); });
  await page.goto('/');
  const timer = page.getByRole('button', { name: 'Stop focus timer', exact: true });
  await expect(timer).toHaveText('01:02:03');
  await expect(timer).toHaveAttribute('aria-pressed', 'true');
  await expect(timer).toHaveCSS('background-color', 'rgb(72, 103, 94)');
  expect(await timer.evaluate(el => getComputedStyle(el, '::before').borderColor)).toBe('rgb(107, 137, 128)');
  await page.clock.runFor(1000);
  await expect(timer).toHaveText('01:02:04');
  await page.getByRole('switch', { name: 'Night mode', exact: true }).click();
  await page.clock.runFor(200);
  await expect(timer).toHaveCSS('background-color', 'rgb(51, 94, 98)');
  await timer.click();
  await page.mouse.move(0, 0);
  await page.clock.runFor(200);
  const stopped = page.getByRole('button', { name: 'Start focus timer', exact: true });
  await expect(stopped).toHaveText('00:00:00');
  await expect(stopped).toHaveAttribute('aria-pressed', 'false');
  await expect(stopped).toHaveCSS('background-color', 'rgb(36, 57, 74)');
  await page.getByRole('switch', { name: 'Night mode', exact: true }).click();
  await page.clock.runFor(200);
  await expect(stopped).toHaveCSS('background-color', 'rgb(89, 99, 107)');
  await page.setViewportSize({ width: 260, height: 180 });
  await expect(stopped).toBeVisible();
  await expect(stopped).toHaveText('00:00:00');
});
