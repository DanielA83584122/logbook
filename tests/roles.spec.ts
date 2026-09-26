import { expect, test, type Page } from './fixtures';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { errors.set(page, []); page.on('pageerror', error => errors.get(page)!.push(error.message)); });
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

type Row = { id: number; content: string; role: string; parent_id: number | null; completed_at: string | null };
const exported = async (request: Parameters<Parameters<typeof test>[2]>[0]['request']) =>
  (await (await request.get('/api/export')).json()).entries as Row[];

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
  await expect(sheet.getByRole('heading', { name: 'Waiting' })).toBeVisible();
  await expect(sheet.getByText('start a section', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});
