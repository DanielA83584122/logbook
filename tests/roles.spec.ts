import { expect, test, type Page } from './fixtures';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { errors.set(page, []); page.on('pageerror', error => errors.get(page)!.push(error.message)); });
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

type Row = { id: number; content: string; role: string; parent_id: number | null; completed_at: string | null };
const exported = async (request: Parameters<Parameters<typeof test>[2]>[0]['request']) =>
  (await (await request.get('/api/export')).json()).entries as Row[];

test('two slashes fold a journal bullet into a scratch strip that opens on hover and pins on click', async ({ page, request }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'New journal bullet', exact: true });
  await composer.pressSequentially('wrote the intro'); await composer.press('Enter'); await expect(composer).toHaveText('');
  await composer.pressSequentially('//');
  await expect(composer).toHaveText('');
  await composer.pressSequentially('maybe reuse the old text'); await composer.press('Enter'); await expect(composer).toHaveText('');
  await composer.pressSequentially('ask Sam about line 4'); await composer.press('Enter'); await expect(composer).toHaveText('');
  await composer.press('Meta+Shift+Period');
  await composer.pressSequentially('call Mira at 3'); await composer.press('Enter'); await expect(composer).toHaveText('');
  await expect(page.getByRole('group', { name: 'call Mira at 3', exact: true })).toBeVisible();

  const rows = await exported(request);
  expect(rows.map(row => [row.content, row.role])).toEqual([
    ['wrote the intro', ''], ['maybe reuse the old text', 'scratch'], ['ask Sam about line 4', 'scratch'], ['call Mira at 3', ''],
  ]);
  const strip = page.getByRole('button', { name: '2 scratch notes', exact: true });
  await expect(strip).toBeVisible();
  await expect(strip).toHaveAttribute('aria-expanded', 'false');
  const scratch = page.getByRole('group', { name: 'ask Sam about line 4', exact: true });
  await expect(scratch.locator('xpath=ancestor::li[1]')).not.toHaveAttribute('data-scratch-open');
  await strip.hover();
  await expect(strip).toHaveAttribute('aria-expanded', 'true');
  await expect(scratch.locator('xpath=ancestor::li[1]')).toHaveAttribute('data-scratch-open', 'true');
  await expect(scratch).toHaveCSS('font-size', '14px');
  await strip.click();
  await page.mouse.move(640, 950);
  await expect(strip).toHaveAttribute('aria-expanded', 'true');
  await strip.click();
  await page.mouse.move(640, 950);
  await expect(strip).toHaveAttribute('aria-expanded', 'false');
});

test('a to-do can say what it waits on, stays dotted until that settles, and takes a follow-up step', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add to-do', exact: true }).click();
  const todo = page.getByRole('textbox', { name: 'New to-do', exact: true });
  await todo.pressSequentially('fence quote'); await todo.press('Enter'); await expect(todo).toHaveText('');
  const box = page.getByRole('button', { name: 'Complete fence quote', exact: true });
  await box.hover();
  const option = page.getByRole('button', { name: 'Note what fence quote waits on', exact: true });
  await expect(option).toHaveCSS('opacity', '1');
  await option.click();
  const waiting = page.getByRole('textbox', { name: 'New waiting row', exact: true });
  await expect(page.locator('[data-hint-text]')).toBeVisible();
  await waiting.pressSequentially("the neighbour's answer"); await waiting.press('Enter'); await expect(waiting).toHaveText('');
  await waiting.press('Enter');
  await expect(waiting).toHaveCount(0);
  await expect(box).toHaveCSS('color', 'rgb(98, 103, 98)');
  const settle = page.getByRole('button', { name: "Settle waiting on the neighbour's answer", exact: true });
  await expect(settle).toBeVisible();
  let rows = await exported(request);
  const parent = rows.find(row => row.content === 'fence quote')!;
  expect(rows.find(row => row.content === "the neighbour's answer")).toMatchObject({ role: 'wait', parent_id: parent.id, completed_at: null });

  await page.getByRole('group', { name: "the neighbour's answer", exact: true }).hover();
  await page.getByRole('button', { name: 'follow up', exact: true }).click();
  await todo.pressSequentially('ring the neighbour again'); await todo.press('Enter'); await expect(todo).toHaveText('');
  rows = await exported(request);
  expect(rows.filter(row => row.parent_id === parent.id).map(row => [row.content, row.role])).toEqual([["the neighbour's answer", 'wait'], ['ring the neighbour again', '']]);
  await expect(page.getByRole('button', { name: /^(Expand|Collapse) fence quote$/ })).toHaveAttribute('aria-description', '0 of 1 children completed');

  await settle.click();
  await expect(page.getByRole('button', { name: "Reopen waiting on the neighbour's answer", exact: true })).toBeVisible();
  rows = await exported(request);
  expect(rows.find(row => row.content === 'fence quote')!.completed_at).toBeNull();
  expect(rows.find(row => row.content === "the neighbour's answer")!.completed_at).not.toBeNull();
  await page.getByRole('button', { name: 'Complete ring the neighbour again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Complete ring the neighbour again', exact: true })).toHaveCount(0);
  await expect.poll(async () => (await exported(request)).find(row => row.content === 'fence quote')!.completed_at).not.toBeNull();
});

test('the cheat sheet opens with the question-mark shortcut and explains the features', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'New journal bullet', exact: true })).toBeVisible();
  await page.keyboard.press('Meta+Shift+?');
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts and how things work', exact: true });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'Scratch and waiting' })).toBeVisible();
  await expect(sheet.getByText('start a section', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});
