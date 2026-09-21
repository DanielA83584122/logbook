import { expect, test } from '@playwright/test';

test('parent progress retains completed children, finishes automatically, and can be undone', async ({ page, request }) => {
  const parent = await (await request.post('/api/tasks', { data: { content: 'Progress project' } })).json();
  const first = await (await request.post('/api/tasks', { data: { content: 'Progress first', parent_id: parent.id } })).json();
  await request.post('/api/tasks', { data: { content: 'Progress last', parent_id: parent.id } });
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Expand Progress project', exact: true });
  await expect(page.getByRole('button', { name: 'Complete Progress project', exact: true })).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-description', '0 of 2 children completed');
  await toggle.click();
  await page.getByRole('button', { name: 'Complete Progress first', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Progress first', exact: true })).toHaveCSS('text-decoration-line', 'line-through');
  await expect(page.getByRole('button', { name: 'Reopen Progress first', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const progress = page.getByRole('button', { name: 'Collapse Progress project', exact: true });
  await expect(progress).toHaveAttribute('aria-description', '1 of 2 children completed');
  await expect.poll(() => progress.evaluate(el => getComputedStyle(el, '::before').backgroundImage)).toContain('180deg');
  await expect(page.getByRole('group', { name: 'Progress first', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Complete Progress last', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Progress project', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reopen Progress project', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Undo task completion', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Progress project', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reopen Progress first', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Complete Progress last', exact: true })).toBeVisible();
  const data = await (await request.get('/api/export')).json();
  expect(data.notes.filter((note: { source_task_id: number | null }) => note.source_task_id === first.id)).toHaveLength(0);
});

test('reopening a completed nested task returns its whole tree to to-dos', async ({ page, request }) => {
  const parent = await (await request.post('/api/tasks', { data: { content: 'Return project' } })).json();
  const first = await (await request.post('/api/tasks', { data: { content: 'Return first', parent_id: parent.id } })).json();
  const second = await (await request.post('/api/tasks', { data: { content: 'Return second', parent_id: parent.id } })).json();
  await request.post(`/api/tasks/${first.id}/complete`);
  await request.post(`/api/tasks/${second.id}/complete`);
  await page.goto('/');
  await page.getByRole('button', { name: 'Reopen Return first', exact: true }).click();
  const todos = page.getByRole('region', { name: 'to do', exact: true });
  await expect(todos.getByRole('group', { name: 'Return project', exact: true })).toBeVisible();
  await todos.getByRole('button', { name: 'Expand Return project', exact: true }).click();
  await expect(todos.getByRole('button', { name: 'Complete Return first', exact: true })).toBeVisible();
  await expect(todos.getByRole('button', { name: 'Reopen Return second', exact: true })).toBeVisible();
});

test('a reopened root task animates into its saved position ahead of the composer', async ({ page, request }) => {
  await request.post('/api/tasks', { data: { content: 'Reopen anchor' } });
  const task = await (await request.post('/api/tasks', { data: { content: 'Reopen arrival' } })).json();
  await request.post(`/api/tasks/${task.id}/complete`);
  await page.goto('/');
  await page.getByRole('button', { name: 'Reopen Reopen arrival', exact: true }).click();

  const todos = page.getByRole('region', { name: 'to do', exact: true });
  const row = todos.locator(`[data-item-id="${task.id}"]`);
  const composer = todos.locator('[data-item-id="draft"]');
  await expect(row).toBeVisible();
  await expect(row).not.toHaveCSS('animation-name', 'none');
  expect(await row.evaluate((element, draft) =>
    !!(element.compareDocumentPosition(draft as Node) & Node.DOCUMENT_POSITION_FOLLOWING), await composer.elementHandle())).toBe(true);
  await row.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  const rowBox = (await row.boundingBox())!;
  const composerBox = (await composer.boundingBox())!;
  expect(composerBox.y - (rowBox.y + rowBox.height)).toBeLessThan(2);
});

test('a new subtask added in the logbook starts checked and can reopen its tree', async ({ page, request }) => {
  const parent = await (await request.post('/api/tasks', { data: { content: 'Extended project' } })).json();
  await request.post(`/api/tasks/${parent.id}/complete`);
  await page.goto('/');
  await page.getByRole('group', { name: 'Extended project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit to-do', exact: true }).press('Meta+ArrowDown');
  await page.getByRole('textbox', { name: 'Edit to-do', exact: true }).press('Enter');
  const composer = page.getByRole('textbox', { name: 'New journal bullet', exact: true });
  await composer.fill('Finished follow-up');
  await composer.press('Meta+ArrowDown');
  await composer.press('Tab');
  const subtask = page.getByRole('textbox', { name: 'New completed subtask', exact: true });
  await expect(subtask).toBeFocused();
  await subtask.press('Meta+ArrowDown');
  await subtask.press('Enter');
  await expect(page.getByRole('button', { name: 'Reopen Finished follow-up', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Reopen Finished follow-up', exact: true }).click();
  const todos = page.getByRole('region', { name: 'to do', exact: true });
  await expect(todos.getByRole('group', { name: 'Extended project', exact: true })).toBeVisible();
});

test('completed tasks share note ordering and normal logbook text editing', async ({ page, request }) => {
  const { today } = await (await request.get('/api/journal')).json();
  await request.post('/api/notes', { data: { date: today, content: 'Mixed before' } });
  const task = await (await request.post('/api/tasks', { data: { content: 'Mixed completed task' } })).json();
  await request.post(`/api/tasks/${task.id}/complete`);
  await new Promise(resolve => setTimeout(resolve, 10));
  await request.post('/api/notes', { data: { date: today, content: 'Mixed after' } });
  await page.goto('/');
  const before = page.getByRole('group', { name: 'Mixed before', exact: true });
  const completed = page.getByRole('group', { name: 'Mixed completed task', exact: true });
  const after = page.getByRole('group', { name: 'Mixed after', exact: true });
  expect((await before.boundingBox())!.y).toBeLessThan((await completed.boundingBox())!.y);
  expect((await completed.boundingBox())!.y).toBeLessThan((await after.boundingBox())!.y);
  await expect(completed).toHaveCSS('text-decoration-line', 'none');
  expect(await completed.evaluate(el => getComputedStyle(el).color)).toBe(await before.evaluate(el => getComputedStyle(el).color));
  await completed.click();
  const editor = page.getByRole('textbox', { name: 'Edit to-do', exact: true });
  await editor.fill('Mixed edited task'); await editor.press('Enter');
  await expect(page.getByRole('group', { name: 'Mixed edited task', exact: true })).toBeVisible();
  await page.getByRole('group', { name: 'Mixed edited task', exact: true }).click();
  await editor.fill(''); await editor.press('Enter');
  await expect(page.getByRole('group', { name: 'Mixed edited task', exact: true })).toHaveCount(0);
});

test('arrow navigation, merging, grouped selection, and document undo cross bullet boundaries', async ({ page, request }) => {
  const { today } = await (await request.get('/api/journal')).json();
  const parent = await (await request.post('/api/notes', { data: { date: today, content: 'Navigation root', tags: ['navigation'] } })).json();
  await request.post('/api/notes', { data: { date: today, content: 'Alpha', parent_id: parent.id, tags: ['navigation'] } });
  await request.post('/api/notes', { data: { date: today, content: 'Beta', parent_id: parent.id, tags: ['navigation'] } });
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Tags' }).hover();
  await page.getByRole('button', { name: '#navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Expand Navigation root', exact: true }).click();
  await page.getByRole('group', { name: 'Alpha', exact: true }).click();
  let editor = page.getByRole('textbox', { name: 'Edit note', exact: true });
  await editor.press('Meta+ArrowDown'); await editor.press('ArrowDown');
  await expect(editor).toHaveText('Beta');
  await editor.press('Meta+ArrowUp'); await editor.press('Backspace');
  await expect(editor).toHaveText('AlphaBeta');
  await editor.press('Meta+ArrowDown');
  await editor.press('Enter');
  const composer = page.getByRole('textbox', { name: 'New journal bullet', exact: true });
  await composer.press('Meta+z');
  await expect(page.getByRole('group', { name: 'Alpha', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Beta', exact: true })).toBeVisible();
  await page.getByRole('group', { name: 'Alpha', exact: true }).click();
  editor = page.getByRole('textbox', { name: 'Edit note', exact: true });
  await editor.press('Meta+a'); await editor.press('Meta+a');
  await page.keyboard.press('Meta+b');
  await expect(page.getByRole('group', { name: 'Alpha', exact: true }).locator('strong')).toHaveText('Alpha');
  await expect(page.getByRole('group', { name: 'Beta', exact: true }).locator('strong')).toHaveText('Beta');
  await page.keyboard.press('Meta+z');
  await expect(page.getByRole('group', { name: 'Alpha', exact: true }).locator('strong')).toHaveCount(0);
  await page.keyboard.press('Meta+Shift+z');
  await expect(page.getByRole('group', { name: 'Beta', exact: true }).locator('strong')).toHaveText('Beta');
  await page.getByRole('group', { name: 'Alpha', exact: true }).click();
  await editor.press('Meta+a'); await editor.press('Meta+a');
  await page.evaluate(() => {
    const data = new DataTransfer(); data.setData('text/plain', 'Replacement'); data.setData('text/html', '<p><strong>Replacement</strong></p>');
    document.activeElement?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(editor.locator('strong')).toHaveText('Replacement');
  await editor.press('Meta+ArrowDown'); await editor.press('Enter'); await composer.press('Meta+z');
  await expect(page.getByRole('group', { name: 'Alpha', exact: true }).locator('strong')).toHaveText('Alpha');
  await expect(page.getByRole('group', { name: 'Beta', exact: true }).locator('strong')).toHaveText('Beta');
});

test('a tag shortcut settles at the end without leaving a gap in the text', async ({ page, request }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'New journal bullet', exact: true });
  await composer.pressSequentially('Start #stable-chip finish');
  await expect(composer).toHaveText('Start finish #stable-chip');
  await composer.press('Enter');
  await expect(page.getByRole('group', { name: 'Start finish', exact: true })).toHaveText('Start finish #stable-chip');
  const data = await (await request.get('/api/export')).json();
  expect(data.notes.find((row: { content: string }) => row.content === 'Start finish').tags).toEqual(['stable-chip']);
});

test('search opens an unloaded historical match and its collapsed ancestors', async ({ page, request }) => {
  const parent = await (await request.post('/api/notes', { data: { date: '2010-01-01', content: 'Archived parent' } })).json();
  await request.post('/api/notes', { data: { date: '2010-01-01', content: 'A unique archival needle', parent_id: parent.id } });
  await page.goto('/');
  await expect(page.getByRole('group', { name: 'A unique archival needle', exact: true })).toHaveCount(0);
  await page.keyboard.press('Meta+f');
  const search = page.getByRole('dialog', { name: 'Search journal', exact: true });
  await search.getByRole('textbox').fill('archival needle');
  await search.getByRole('button', { name: /A unique archival needle/ }).click();
  await expect(search).toBeHidden();
  const hit = page.getByRole('group', { name: 'A unique archival needle', exact: true });
  await expect(hit).toBeVisible(); await expect(hit).toBeInViewport();
});

test('medium layouts stay readable and selected tags stay in the hover sidebar', async ({ page, request }) => {
  const { today } = await (await request.get('/api/journal')).json();
  await request.post('/api/notes', { data: { date: today, content: 'Visible filter context', tags: ['visible-filter'] } });
  await page.setViewportSize({ width: 641, height: 900 }); await page.goto('/');
  expect((await page.getByRole('main').boundingBox())!.width).toBeGreaterThan(550);
  await page.getByRole('navigation', { name: 'Tags' }).hover();
  const tag = page.getByRole('button', { name: '#visible-filter', exact: true });
  await tag.click();
  await page.getByRole('textbox', { name: 'New journal bullet', exact: true }).click();
  await page.mouse.move(620, 800);
  await expect(tag).toBeHidden();
  await page.getByRole('navigation', { name: 'Tags' }).hover();
  await expect(tag).toBeVisible();
  await expect(tag).toHaveAttribute('aria-pressed', 'true');
  const bounds = (await tag.boundingBox())!;
  expect(bounds.width).toBeGreaterThan(40); expect(bounds.x + bounds.width).toBeLessThan(280);
});

test('short sessions have exact totals, inline editing, add/delete controls, and no labels', async ({ page, request }) => {
  const today = '2026-09-03'; // Use a past day so sessions cannot accidentally be in the future.
  await request.post('/api/sessions', { data: { started_at: new Date(`${today}T05:00:13`).toISOString(), duration_seconds: 30 } });
  await page.goto('/');
  await page.getByRole('button', { name: `Focus sessions for ${today}`, exact: true }).click();
  const modal = page.getByRole('dialog', { name: `Sessions for ${today}`, exact: true });
  await expect(modal.locator('label, th')).toHaveCount(0);
  await expect(modal.getByRole('button', { name: 'Close dialog' })).toHaveCount(0);
  await expect(modal.getByRole('button', { name: 'Open focus statistics' })).toHaveCount(0);
  const durationButton = modal.getByRole('button', { name: /Edit duration of session/ });
  await expect(durationButton).toHaveText('30s');
  await durationButton.click(); await modal.getByLabel('Duration', { exact: true }).fill('45s');
  await modal.getByLabel('Duration', { exact: true }).press('Enter');
  await expect(durationButton).toHaveText('45s');
  const rows = await (await request.get(`/api/sessions?date=${today}`)).json();
  expect(new Date(rows[0].started_at).getSeconds()).toBe(13);
  await modal.getByRole('button', { name: 'Add session', exact: true }).click();
  await modal.getByLabel('Start time', { exact: true }).fill('05:05');
  await modal.getByLabel('Duration', { exact: true }).fill('1m');
  await modal.getByLabel('Duration', { exact: true }).press('Enter');
  await expect(modal.getByText('1m 45s', { exact: true })).toBeVisible();
  const remove = modal.getByRole('button', { name: /Delete session/ }).first();
  await remove.hover(); expect(await remove.locator('span').evaluate(el => getComputedStyle(el).transform)).not.toBe('none');
  await remove.click(); await expect(modal.getByRole('button', { name: /Delete session/ })).toHaveCount(1);
  await page.mouse.click(5, 5); await expect(modal).toBeHidden();
});

test('zero days have no bars and statistics expose the averaging period', async ({ page }) => {
  await page.route('**/api/stats?*', route => route.fulfill({ json: {
    start: '2026-09-10', end: '2026-09-16', day_count: 7, active_days: 1, total_focused_seconds: 30, session_count: 1,
    daily: Array.from({ length: 7 }, (_, i) => ({ date: `2026-09-${10 + i}`, focused_seconds: i === 6 ? 30 : 0, longest_session_seconds: i === 6 ? 30 : 0, completed_task_count: 0 })),
  } }));
  await page.goto('/'); await page.getByRole('button', { name: 'Open focus statistics', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Statistics', exact: true });
  await expect(modal.getByText('30s', { exact: true }).first()).toBeVisible();
  const heights = await modal.getByRole('img').locator('div').evaluateAll(els => els.map(el => el.getBoundingClientRect().height));
  expect(heights.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]); expect(heights[6]).toBeGreaterThan(100);
  await modal.getByRole('combobox', { name: 'Average over', exact: true }).selectOption('active');
  await expect(modal.getByText('Average daily focus', { exact: true }).locator('..').getByText('30s', { exact: true })).toBeVisible();
});
