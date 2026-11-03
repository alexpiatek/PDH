import { expect, test } from '@playwright/test';

test('practice teaches all three discards without an account and can restart', async ({ page }) => {
  await page.goto('/practice');
  await expect(page.getByRole('button', { name: 'Discard one card' })).toBeDisabled();
  for (const [card, next] of [
    ['10 of spades', 'Turn betting is finished.'],
    ['J of diamonds', 'River betting is finished.'],
    ['Q of clubs', 'Your hand:'],
  ] as const) {
    await page.getByRole('button', { name: `Select ${card} to discard` }).click();
    await page.getByRole('button', { name: /^Discard / }).click();
    await expect(page.getByRole('heading', { name: new RegExp(next) })).toBeVisible();
  }
  await expect(page.getByText('Your hand · 2 cards')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Create a table for friends', exact: true })
  ).toHaveAttribute('href', '/play?action=create');
  await page.getByRole('button', { name: 'Try different discards' }).click();
  await expect(page.getByText('Your hand · 5 cards')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Discard one card' })).toBeDisabled();
});
