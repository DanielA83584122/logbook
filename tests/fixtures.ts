import { test as base, expect } from '@playwright/test';

export const test = base.extend<{ cleanDatabase: void }>({
  cleanDatabase: [async ({ request }, use) => {
    const response = await request.delete('/api/test/reset');
    expect(response.status()).toBe(204);
    await use();
  }, { auto: true }],
});

export { expect, type Locator, type Page } from '@playwright/test';
