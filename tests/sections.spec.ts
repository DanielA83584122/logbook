import { expect, test, type Page } from './fixtures';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { errors.set(page, []); page.on('pageerror', error => errors.get(page)!.push(error.message)); });
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

const exported = async (request: Parameters<Parameters<typeof test>[2]>[0]['request']) =>
  (await (await request.get('/api/export')).json()).entries as { id: number; content: string; tags: string[]; parent_id: number | null }[];

test('a space after # opens a section row whose tags reach the rows after it', async ({ page, request }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'New journal bullet', exact: true });
  await composer.pressSequentially('# fence and hedge #garden');
  await expect(composer.locator('h1')).toContainText('fence and hedge');
  await expect(page.locator('[data-section]')).toHaveCount(1);
  await composer.press('Enter'); await expect(composer).toHaveText('');
  await composer.pressSequentially('moved the bench'); await composer.press('Enter'); await expect(composer).toHaveText('');
  await composer.pressSequentially('# other'); await composer.press('Enter'); await expect(composer).toHaveText('');
  await composer.pressSequentially('after the section'); await composer.press('Enter'); await expect(composer).toHaveText('');
  await expect(page.getByRole('group', { name: 'after the section', exact: true })).toBeVisible();

  const section = page.getByRole('group', { name: 'fence and hedge #garden', exact: true });
  await expect(section.locator('h1')).toHaveCSS('font-weight', '400');
  await expect(section.locator('[data-tag="garden"]')).toBeVisible();
  const inside = page.getByRole('group', { name: 'moved the bench', exact: true });
  const ghost = inside.locator('[data-inherited]');
  await expect(ghost).toHaveText('#garden');
  await expect(ghost).toHaveCSS('opacity', '0');
  await inside.hover();
  await expect(ghost).toHaveCSS('opacity', '1');
  await expect(page.getByRole('group', { name: 'after the section', exact: true }).locator('[data-inherited]')).toHaveCount(0);
  await expect(page.locator('[data-section]')).toHaveCount(2);

  let rows = await exported(request);
  expect(rows.find(row => row.content === '# fence and hedge #garden')!.tags).toEqual(['garden']);
  expect(rows.find(row => row.content === 'moved the bench')!.tags).toEqual([]);
  expect(rows.find(row => row.content === '# other')!.tags).toEqual([]);

  const rail = page.getByRole('navigation', { name: 'Tags', exact: true });
  await rail.hover();
  await rail.getByRole('button', { name: '#garden', exact: true }).click();
  await expect(inside).toBeVisible();
  await expect(section).toBeVisible();
  await expect(page.getByRole('group', { name: 'after the section', exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'other', exact: true })).toHaveCount(0);
  await composer.pressSequentially('new inside the section'); await composer.press('Enter'); await expect(composer).toHaveText('');
  await expect(page.getByRole('group', { name: 'new inside the section', exact: true })).toBeVisible();
  rows = await exported(request);
  expect(rows.find(row => row.content === 'new inside the section')!.tags).toEqual([]);
  await page.reload();
  await rail.hover();
  await rail.getByRole('button', { name: '#garden', exact: true }).click();
  await expect(page.getByRole('group', { name: 'new inside the section', exact: true })).toBeVisible();
});

test('a section row stays at the root and nothing nests under it', async ({ page, request }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'New journal bullet', exact: true });
  await composer.pressSequentially('# planning #work'); await composer.press('Enter'); await expect(composer).toHaveText('');
  await composer.pressSequentially('first row'); await composer.press('Enter'); await expect(composer).toHaveText('');
  const row = page.getByRole('group', { name: 'first row', exact: true });
  await expect(row).toBeVisible();
  await row.click();
  const editor = page.getByRole('textbox', { name: 'Edit note', exact: true });
  await editor.press('Tab');
  await editor.press('Enter');
  await expect(row).toBeVisible();
  await expect(row.locator('xpath=ancestor::li[1]')).toHaveAttribute('data-depth', '0');
  await page.getByRole('group', { name: 'planning #work', exact: true }).click();
  await editor.press('Tab');
  await editor.press('Escape');
  const rows = await exported(request);
  expect(rows.map(item => item.parent_id)).toEqual([null, null]);
  expect(rows[0].content).toBe('# planning #work');
});

test('an untitled section row needs a tag to be kept', async ({ page, request }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'New journal bullet', exact: true });
  await composer.pressSequentially('# ');
  await expect(composer.locator('h1')).toHaveCount(1);
  await expect(page.locator('[data-section]')).toHaveCount(1);
  await composer.press('Enter');
  await expect(composer).toHaveCount(1);
  await composer.evaluate(element => (element as HTMLElement).blur());
  await expect.poll(async () => (await exported(request)).length).toBe(0);
  await page.getByRole('button', { name: 'Add journal bullet', exact: true }).click();
  await composer.pressSequentially('# #garden'); await composer.press('Enter'); await expect(composer).toHaveText('');
  await expect(page.getByRole('group', { name: '#garden', exact: true })).toBeVisible();
  const rows = await exported(request);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ content: '# #garden', tags: ['garden'] });
});
