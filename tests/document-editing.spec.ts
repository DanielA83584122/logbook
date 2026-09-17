import { expect, test } from '@playwright/test';

for (const kind of ['notes', 'tasks'] as const) {
  test(`Enter keeps new ${kind} siblings focused and in order at root and nested levels`, async ({ page, request }) => {
    const { today } = await (await request.get('/api/journal')).json();
    for (const nested of [false, true]) {
      const parent = nested ? await (await request.post(`/api/${kind}`, { data: { date: today, content: `Enter parent ${kind}` } })).json() : null;
      const data = { date: today, parent_id: parent?.id ?? null };
      const first = await (await request.post(`/api/${kind}`, { data: { ...data, content: `Enter first ${kind}` } })).json();
      const last = await (await request.post(`/api/${kind}`, { data: { ...data, content: `Enter last ${kind}`, after_id: first.id } })).json();
      await page.goto('/');
      if (nested) await page.getByRole('button', { name: `Expand Enter parent ${kind}`, exact: true }).click();
      const row = (id: number) => page.locator(`[data-kind="${kind}"][data-item-id="${id}"] [role="group"]`).first();
      await row(first.id).focus(); await row(first.id).press('Enter');
      const editor = page.getByRole('textbox', { name: kind === 'notes' ? 'Edit note' : 'Edit to-do', exact: true });
      await expect(editor).toBeFocused(); await editor.press('Meta+ArrowDown'); await editor.press('Enter');
      const composer = page.getByRole('textbox', { name: kind === 'notes' ? 'New journal bullet' : 'New to-do', exact: true });
      await expect(composer).toBeFocused(); await expect(composer).toBeEditable();
      await expect(composer.locator('xpath=ancestor::li[1]')).toHaveAttribute('data-depth', nested ? '1' : '0');
      const text = `Inserted ${nested ? 'nested' : 'root'} ${kind}`;
      await composer.pressSequentially(text); await composer.press('Enter');
      await expect(composer).toHaveText(''); await expect(composer).toBeFocused();
      const rows = (await (await request.get('/api/export')).json())[kind] as { id: number; parent_id: number | null; position: number; content: string }[];
      const inserted = rows.find(item => item.content === text)!;
      expect(inserted.parent_id).toBe(parent?.id ?? null);
      expect(inserted.position).toBeGreaterThan(rows.find(item => item.id === first.id)!.position);
      expect(inserted.position).toBeLessThan(rows.find(item => item.id === last.id)!.position);
      await page.getByRole('button', { name: 'Start focus timer', exact: true }).focus();
      await expect(composer).toBeHidden();
      await row(inserted.id).focus(); await row(inserted.id).press('Enter');
      await expect(editor).toBeFocused(); await editor.fill('');
      await page.getByRole('button', { name: 'Start focus timer', exact: true }).focus();
      await expect(editor).toBeHidden(); await expect(composer).toBeHidden();
      await expect.poll(async () => (await (await request.get('/api/export')).json())[kind].some((item: { id: number }) => item.id === inserted.id)).toBe(false);
    }
  });

  test(`Backspace joins ${kind} and continues into the preceding bullet from an empty draft`, async ({ page, request }) => {
    const { today } = await (await request.get('/api/journal')).json();
    const first = await (await request.post(`/api/${kind}`, { data: { date: today, content: `First ${kind}` } })).json();
    const second = await (await request.post(`/api/${kind}`, { data: { date: today, content: 'Second', after_id: first.id } })).json();
    await page.goto('/');
    const saved = (id: number) => page.locator(`[data-kind="${kind}"][data-item-id="${id}"] [role="group"]`).first();
    await saved(second.id).focus(); await saved(second.id).press('Enter');
    const editor = page.getByRole('textbox', { name: kind === 'notes' ? 'Edit note' : 'Edit to-do', exact: true });
    await expect(editor).toBeFocused();
    await editor.press('Meta+ArrowUp'); await editor.press('Backspace');
    await expect(editor).toHaveText(`First ${kind}Second`);
    await expect(editor).toBeEditable(); await expect(editor).toBeFocused();
    await editor.press('Backspace');
    await expect(editor).toHaveText(`First ${kind.slice(0, -1)}Second`);
    await editor.press('Meta+ArrowDown');
    await editor.press('Enter');
    const composer = page.getByRole('textbox', { name: kind === 'notes' ? 'New journal bullet' : 'New to-do', exact: true });
    await expect(composer).toBeFocused(); await composer.press('Backspace');
    await expect(editor).toBeFocused();
    await editor.press('Backspace');
    await expect(editor).toHaveText(`First ${kind.slice(0, -1)}Secon`);
    await editor.press('Enter');
    await expect(saved(first.id)).toBeVisible();
    const rows = (await (await request.get('/api/export')).json())[kind];
    expect(rows.some((row: { id: number }) => row.id === second.id)).toBe(false);
    expect(rows.find((row: { id: number }) => row.id === first.id).content).toBe(`First ${kind.slice(0, -1)}Secon`);
  });
}

test('clicking beneath a past date opens an end bullet and abandoned empty drafts disappear', async ({ page, request }) => {
  const date = '2026-09-01';
  await request.post('/api/notes', { data: { date, content: 'Historical starting point' } });
  await page.goto('/');
  const day = page.getByRole('region', { name: new RegExp(`, ${date}$`) });
  const add = day.getByRole('button', { name: 'Add journal bullet', exact: true });
  const editor = day.getByRole('textbox', { name: 'New journal bullet', exact: true });
  await add.click(); await expect(editor).toBeFocused();
  await page.getByRole('button', { name: 'Start focus timer', exact: true }).focus();
  await expect(editor).toBeHidden();
  await add.click(); await editor.fill('Temporary historical draft');
  await expect.poll(async () => (await (await request.get('/api/export')).json()).notes.some((row: { content: string }) => row.content === 'Temporary historical draft')).toBe(true);
  await editor.fill('');
  await page.getByRole('button', { name: 'Start focus timer', exact: true }).focus();
  await expect(editor).toBeHidden();
  await expect.poll(async () => (await (await request.get('/api/export')).json()).notes.some((row: { content: string }) => row.content === 'Temporary historical draft')).toBe(false);
  await add.click(); await editor.fill('A new historical note'); await editor.press('Enter');
  await expect(day.getByRole('group', { name: 'A new historical note', exact: true })).toBeVisible();
  const { days } = await (await request.get(`/api/journal?on=${date}`)).json();
  const notes = days.find((day: { date: string }) => day.date === date).notes;
  expect(notes.at(-1).content).toBe('A new historical note');
});
