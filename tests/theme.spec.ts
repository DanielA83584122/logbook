import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function checkAccessibility(page: Page) {
  const audit = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']);
  // The requested night palette intentionally uses teal links without bold or
  // underlines. Color-only link differentiation is a known design exception;
  // keep every other accessibility rule enabled, and audit this rule in light mode.
  if (await page.locator('html').getAttribute('data-theme') === 'night') audit.disableRules(['link-in-text-block']);
  expect((await audit.analyze()).violations).toEqual([]);
}

test('reference typography, wider margins and persistent night mode', async ({ page }) => {
  await page.route('**/api/journal?*', route => route.fulfill({ json: {
    today: '2026-09-16', server_time: new Date().toISOString(), active_session: null, next_cursor: null,
    tags: [{ name: 'work', note_count: 1, task_count: 0 }], tag: null,
    tasks: [{ id: 101, content: 'Review the draft', tags: [], parent_id: null, position: 0 }],
    days: [{ date: '2026-09-16', focused_seconds: 5400, longest_session_seconds: 5400, session_count: 1,
      notes: [{ id: 102, content: 'Read the [project notes](https://example.com/notes).', tags: ['work'], parent_id: null, position: 0 }] }],
  } }));
  await page.route('**/api/sessions?*', route => route.fulfill({ json: [] }));
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('body')).toHaveCSS('font-family', /Sohne/);
  expect(await page.evaluate(() => document.fonts.check('300 18px Sohne'))).toBe(true);
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(228, 231, 233)');
  await expect(page.getByTestId('page')).toHaveCSS('background-color', 'color(srgb 0.849412 0.860588 0.868039)');
  await expect(page.getByRole('button', { name: 'Focus sessions for 2026-09-16', exact: true })).toHaveCSS('opacity', '0.78');
  await expect(page.locator('time[datetime="2026-09-16"]')).toHaveCSS('background-color', 'rgb(196, 207, 215)');
  const shortcuts = page.getByRole('button', { name: 'Keyboard shortcuts', exact: true });
  await shortcuts.hover();
  await expect(shortcuts).toHaveCSS('color', 'rgb(33, 105, 176)');
  await shortcuts.click();
  const shortcutDialog = page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true });
  await expect(shortcutDialog).toBeVisible();
  await expect(shortcutDialog.getByText('move entry right', { exact: true })).toBeVisible();
  await expect(shortcutDialog.getByText('sound controls', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(shortcutDialog).toBeHidden();
  const main = (await page.getByRole('main').boundingBox())!;
  const timer = (await page.getByRole('button', { name: 'Start focus timer', exact: true }).boundingBox())!;
  const task = (await page.getByRole('group', { name: 'Review the draft', exact: true }).boundingBox())!;
  expect(main.x).toBeGreaterThanOrEqual(300);
  expect(timer.x - 8 - (task.x + task.width)).toBeCloseTo(38, 0);
  expect(timer.x + timer.width + 8).toBeLessThanOrEqual(main.x + main.width - 12);
  const ring = await page.getByRole('button', { name: 'Start focus timer', exact: true }).evaluate(el => {
    const style = getComputedStyle(el, '::before'); return { border: style.borderWidth, radius: style.borderRadius, inset: style.top };
  });
  expect(ring).toEqual({ border: '1px', radius: '50%', inset: '-8px' });
  await expect(page.getByRole('link', { name: 'project notes', exact: true })).toHaveCSS('color', 'rgb(33, 105, 176)');
  await expect(page.getByRole('link', { name: 'project notes', exact: true })).toHaveCSS('text-decoration-line', 'none');
  const toggle = page.getByRole('switch', { name: 'Night mode', exact: true });
  const toggleBox = (await toggle.boundingBox())!;
  expect(toggleBox.x).toBeGreaterThan(main.x + main.width);
  expect(toggleBox.y).toBe(20);
  expect(toggleBox.x + toggleBox.width).toBe(1280 - 24);
  await expect(toggle.locator('[data-icon="sun"]')).toHaveCSS('opacity', '1');
  await expect(toggle.locator('[data-icon="moon"]')).toHaveCSS('opacity', '0');
  const checkLinkEditor = async (textColor: string, urlColor: string) => {
    await page.getByRole('link', { name: 'project notes', exact: true }).click({ button: 'right' });
    const dialog = page.getByRole('dialog', { name: 'Link', exact: true });
    const textField = dialog.getByRole('textbox', { name: 'Link text', exact: true });
    const urlField = dialog.getByRole('textbox', { name: 'Link URL', exact: true });
    await expect(textField).toHaveCSS('color', textColor);
    await expect(urlField).toHaveCSS('color', urlColor);
    await expect(textField).toHaveCSS('border-width', '0px');
    await expect(textField).toHaveCSS('outline-style', 'none');
    await expect(dialog).toHaveCSS('opacity', '1');
    await checkAccessibility(page);
    await urlField.focus();
    await expect(urlField).toHaveCSS('border-width', '0px');
    await expect(urlField).toHaveCSS('outline-style', 'none');
    await checkAccessibility(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.keyboard.press('Escape');
  };
  await checkLinkEditor('rgb(33, 105, 176)', 'rgb(109, 85, 151)');
  await page.screenshot({ path: 'test-results/day-mode.png' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(toggle.locator('[data-icon="moon"]')).toHaveCSS('opacity', '1');
  await expect(toggle.locator('[data-icon="sun"]')).toHaveCSS('opacity', '0');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(1, 22, 39)');
  await expect(page.locator('body')).toHaveCSS('color', 'rgb(192, 199, 209)');
  await expect(page.getByRole('link', { name: 'project notes', exact: true })).toHaveCSS('color', 'rgb(117, 209, 196)');
  await checkLinkEditor('rgb(117, 209, 196)', 'rgb(183, 164, 221)');
  await page.getByRole('navigation', { name: 'Tags' }).hover();
  await expect(page.getByRole('button', { name: '#work', exact: true })).toHaveCSS('opacity', '1');
  await expect(page.getByRole('navigation', { name: 'Tags' }).locator(':scope > div')).toHaveCSS('opacity', '1');
  await checkAccessibility(page);
  await page.screenshot({ path: 'test-results/night-mode.png' });
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(1, 22, 39)');
  await page.getByRole('button', { name: 'Focus sessions for 2026-09-16', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCSS('background-color', 'rgb(10, 33, 51)');
  await expect(page.getByRole('dialog')).toHaveCSS('opacity', '1');
  await checkAccessibility(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await toggle.click();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(228, 231, 233)');
  await page.setViewportSize({ width: 440, height: 700 });
  await expect(toggle).toBeHidden();
  const smallTimer = (await page.getByRole('button', { name: 'Start focus timer', exact: true }).boundingBox())!;
  expect(smallTimer.x + smallTimer.width / 2).toBe(220);
  expect(smallTimer.y - 8).toBe(24);
});
