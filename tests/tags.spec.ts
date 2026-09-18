import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { errors.set(page, []); page.on('pageerror', error => errors.get(page)!.push(error.message)); });
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

for (const kind of ['notes', 'tasks'] as const) {
  test(`typed tags become removable chips and separate metadata in ${kind}`, async ({ page, request }) => {
    await page.goto('/');
    const composer = page.getByRole('textbox', { name: kind === 'notes' ? 'New journal bullet' : 'New to-do', exact: true });
    await composer.pressSequentially(`A tagged ${kind} #unique-${kind}`);
    await composer.press('Enter');
    await expect(composer).toHaveText('');
    const preview = page.getByRole('group', { name: `A tagged ${kind}`, exact: true });
    await expect(preview.locator(`[data-tag="unique-${kind}"]`)).toHaveText(`#unique-${kind}`);
    let data = await (await request.get('/api/export')).json();
    const row = data[kind].find((item: { content: string }) => item.content === `A tagged ${kind}`);
    expect(row.tags).toEqual([`unique-${kind}`]);
    expect(row.content).not.toContain('#');
    await page.reload();
    await expect(preview.locator('[data-tag]')).toBeVisible();
    await preview.click();
    const editor = page.getByRole('textbox', { name: kind === 'notes' ? 'Edit note' : 'Edit to-do', exact: true });
    await editor.locator('[data-tag]').click();
    await page.keyboard.press('Backspace');
    await expect(editor.locator('[data-tag]')).toHaveCount(0);
    await editor.press('Enter');
    await expect(preview).toBeVisible();
    data = await (await request.get('/api/export')).json();
    expect(data[kind].find((item: { id: number }) => item.id === row.id).tags).toEqual([]);
    expect((await (await request.get('/api/tags')).json()).some((tag: { name: string }) => tag.name === `unique-${kind}`)).toBe(false);
  });
}

test('autocomplete cycles existing tags with arrows and keeps code literal', async ({ page, request }) => {
  const { today } = await (await request.get('/api/journal')).json();
  await request.post('/api/notes', { data: { date: today, content: 'Tag vocabulary', tags: ['alpha', 'alpine', 'beta'] } });
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'New journal bullet', exact: true });
  await composer.pressSequentially('Read #');
  const suggestions = page.getByRole('listbox', { name: 'Tags', exact: true });
  await expect(suggestions.getByRole('option')).toHaveCount(3);
  await composer.pressSequentially('al');
  await expect(suggestions.getByRole('option')).toHaveCount(2);
  await composer.press('ArrowDown');
  await expect(suggestions.getByRole('option', { name: '#alpine', exact: true })).toHaveAttribute('aria-selected', 'true');
  await composer.press('ArrowUp');
  await expect(suggestions.getByRole('option', { name: '#alpha', exact: true })).toHaveAttribute('aria-selected', 'true');
  await composer.press('ArrowDown'); await composer.press('Enter');
  await expect(suggestions).toHaveCount(0);
  await expect(composer.locator('[data-tag="alpine"]')).toBeVisible();
  await composer.press('Enter');
  await expect(page.getByRole('group', { name: 'Read', exact: true }).locator('[data-tag="alpine"]')).toBeVisible();
  const data = await (await request.get('/api/export')).json();
  expect(data.notes.find((item: { content: string }) => item.content === 'Read').tags).toEqual(['alpine']);
  await composer.pressSequentially('Literal '); await composer.press('Meta+Shift+c');
  await composer.pressSequentially('#not-a-tag'); await composer.press('Meta+Shift+c'); await composer.press('Enter');
  const literal = page.getByRole('group', { name: 'Literal #not-a-tag', exact: true });
  await expect(literal.locator('code')).toHaveText('#not-a-tag');
  await expect(literal.locator('[data-tag]')).toHaveCount(0);
  const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(a11y.violations).toEqual([]);
});

test('hover tabs filter nested notes and tasks, hide the active tag, and preserve it during edits', async ({ page, request }) => {
  const { today } = await (await request.get('/api/journal')).json();
  const createNote = async (content: string, tags: string[] = [], parent_id: number | null = null) =>
    (await request.post('/api/notes', { data: { date: today, content, tags, parent_id } })).json();
  const parent = await createNote('Focus parent', ['focused']);
  const child = await createNote('Included child', [], parent.id);
  await createNote('Included grandchild', ['secondary'], child.id);
  const unrelated = await createNote('Unmatched ancestor');
  await createNote('Matched nested root', ['focused'], unrelated.id);
  await createNote('Unmatched sibling', [], unrelated.id);
  const task = await (await request.post('/api/tasks', { data: { content: 'Focus task', tags: ['focused'] } })).json();
  await request.post('/api/tasks', { data: { content: 'Included subtask', parent_id: task.id } });
  await request.post('/api/tasks', { data: { content: 'Unmatched task' } });
  await page.goto('/');
  const rail = page.getByRole('navigation', { name: 'Tags', exact: true });
  await rail.hover();
  await rail.getByRole('button', { name: '#focused', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Unmatched ancestor', exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Unmatched sibling', exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Unmatched task', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand Focus parent', exact: true }).click();
  await page.getByRole('button', { name: 'Expand Included child', exact: true }).click();
  await page.getByRole('button', { name: 'Expand Focus task', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Included grandchild', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Included subtask', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Matched nested root', exact: true }).locator('xpath=ancestor::li[1]')).toHaveAttribute('data-depth', '0');
  await expect(page.locator('[data-tag="focused"]')).toHaveCount(0);
  await expect(page.locator('[data-tag="secondary"]')).toHaveCount(1);
  await page.getByRole('group', { name: 'Focus parent', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Edit note', exact: true });
  await expect(editor.locator('[data-tag]')).toHaveCount(0);
  await editor.fill('Focus parent edited'); await editor.press('Enter');
  await expect(page.getByRole('group', { name: 'Focus parent edited', exact: true })).toBeVisible();
  let data = await (await request.get('/api/export')).json();
  expect(data.notes.find((item: { id: number }) => item.id === parent.id).tags).toEqual(['focused']);
  const composer = page.getByRole('textbox', { name: 'New journal bullet', exact: true });
  await composer.fill('New filtered note'); await composer.press('Enter');
  await expect(page.getByRole('group', { name: 'New filtered note', exact: true })).toBeVisible();
  data = await (await request.get('/api/export')).json();
  expect(data.notes.find((item: { content: string }) => item.content === 'New filtered note').tags).toEqual(['focused']);
  await rail.hover(); await rail.getByRole('button', { name: 'logbook', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Unmatched ancestor', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'New filtered note', exact: true }).locator('[data-tag="focused"]')).toBeVisible();
});

test('completion animates out and in while preserving tag metadata', async ({ page, request }) => {
  const task = await (await request.post('/api/tasks', { data: { content: 'Animated task', tags: ['animation'] } })).json();
  await page.goto('/');
  await page.evaluate(() => {
    (window as unknown as { bulletAnimations: string[] }).bulletAnimations = [];
    document.addEventListener('animationstart', event => {
      if ((event.target as Element).tagName === 'LI') (window as unknown as { bulletAnimations: string[] }).bulletAnimations.push((event as AnimationEvent).animationName);
    });
  });
  await page.getByRole('button', { name: 'Complete Animated task', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Complete Animated task', exact: true })).toHaveCount(0);
  const completed = page.getByRole('group', { name: 'Animated task', exact: true });
  await expect(completed.locator('[data-tag="animation"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { bulletAnimations: string[] }).bulletAnimations.length)).toBeGreaterThanOrEqual(1);
  const data = await (await request.get('/api/export')).json();
  expect(data.tasks.find((item: { id: number }) => item.id === task.id).tags).toEqual(['animation']);
});

test('to-do region expands for all rows and leaves a usable journal below', async ({ page, request }) => {
  for (let i = 0; i < 28; i++) await request.post('/api/tasks', { data: { content: `Expanding task ${i}` } });
  await page.goto('/');
  const todos = page.getByRole('region', { name: 'to do', exact: true });
  await expect(todos).toHaveCSS('overflow-y', 'visible');
  const dimensions = await todos.evaluate(el => ({ client: el.clientHeight, scroll: el.scrollHeight }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
  await page.getByRole('group', { name: 'Expanding task 27', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('group', { name: 'Expanding task 27', exact: true })).toBeVisible();
  const journal = page.getByTestId('log-scroll');
  expect((await journal.boundingBox())!.height).toBeGreaterThanOrEqual(240);
  await journal.scrollIntoViewIfNeeded();
  await expect(page.getByRole('textbox', { name: 'New journal bullet', exact: true })).toBeVisible();
});

test('a tag-only bullet is metadata, and deleting the final tagged bullet removes its tab', async ({ page, request }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'New journal bullet', exact: true });
  await composer.pressSequentially('#only-chip'); await composer.press('Enter');
  await expect(composer).toHaveText('');
  const preview = page.getByRole('group', { name: '#only-chip', exact: true });
  await expect(preview.locator('[data-tag="only-chip"]')).toBeVisible();
  const data = await (await request.get('/api/export')).json();
  const stored = data.notes.find((row: { tags: string[] }) => row.tags.includes('only-chip'));
  expect(stored.content).toBe('');
  await preview.click();
  const editor = page.getByRole('textbox', { name: 'Edit note', exact: true });
  await editor.locator('[data-tag]').click(); await page.keyboard.press('Backspace'); await editor.press('Enter');
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole('button', { name: '#only-chip', exact: true })).toHaveCount(0);
});
