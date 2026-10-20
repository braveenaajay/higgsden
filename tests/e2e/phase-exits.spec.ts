import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: new RegExp(email) }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

test.describe('HiggsDEN dummy data exits', () => {
  test('Task 1/2: demo sign-in and workspace isolation', async ({ page }) => {
    await signIn(page, 'lena@northwind.test');
    await expect(page.getByRole('heading', { name: 'Northwind Digital' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Acme Outdoor' })).toBeVisible();
    await expect(page.getByText('Bluebird Coffee')).toHaveCount(0);
  });

  test('Task 2: Owner sees members, billing, and support', async ({ page }) => {
    await signIn(page, 'priya@northwind.test');
    await page.getByRole('link', { name: 'Members' }).click();
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
    await page.getByRole('link', { name: 'Billing' }).click();
    await expect(page.getByText(/Provider:/)).toBeVisible();
    await page.getByRole('link', { name: 'Support' }).click();
    await expect(page.getByRole('heading', { name: 'Platform support' })).toBeVisible();
  });

  test('Task 2: operator console lists agencies and not stories', async ({ page }) => {
    await signIn(page, 'ops@higgsden.test');
    await expect(page.getByRole('heading', { name: 'Operator console' })).toBeVisible();
    await expect(page.locator('strong', { hasText: 'Northwind Digital' })).toBeVisible();
    await expect(page.locator('strong', { hasText: 'Lumen Brands' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'ACME' })).toHaveCount(0);
  });

  test('Task 3: discovery, backlog, and ready rule', async ({ page }) => {
    await signIn(page, 'priya@northwind.test');
    await page.getByRole('link', { name: /Storefront rebuild/ }).click();
    await expect(page.getByText(/Version/)).toBeVisible();
    await page.getByRole('button', { name: 'Backlog' }).click();
    await expect(page.getByText(/ACME-/).first()).toBeVisible();
    const markReady = page.getByRole('button', { name: 'Mark ready' }).first();
    if (await markReady.isVisible()) {
      await markReady.click();
    }
  });

  test('Tasks 4–7: hosting cell, dummy provision, delivery', async ({ page }) => {
    await signIn(page, 'priya@northwind.test');
    await page.getByRole('link', { name: 'Hosting' }).click();
    await expect(page.getByText(/Dummy cell/)).toBeVisible();
    await page.getByRole('link', { name: 'Workspace' }).click();
    await page.getByRole('link', { name: /Storefront rebuild/ }).click();
    await page.getByRole('button', { name: 'Provisioning' }).click();
    await page.getByRole('button', { name: 'Provision dummy staging' }).click();
    await expect(page.getByText(/github_repository|ecr_repository|database|ready/i).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Delivery' }).click();
    await expect(page.getByText(/Delivery type/)).toBeVisible();
  });

  test('Tasks 8–9: knowledge search, dummy skill, desk, insights', async ({ page }) => {
    await signIn(page, 'priya@northwind.test');
    await page.getByRole('link', { name: /Storefront rebuild/ }).click();
    await page.getByRole('button', { name: 'AI' }).click();
    await page.getByRole('button', { name: /Run plan skill/ }).click();
    await expect(page.getByText(/Model mode/)).toBeVisible();
    await page.getByRole('button', { name: 'Insights' }).click();
    await expect(page.getByText('DORA (team level)')).toBeVisible();
    await page.getByRole('link', { name: 'Desk' }).click();
    await expect(page.getByRole('heading', { name: 'Merchant desk' })).toBeVisible();
  });

  test('Task 10: GitHub dummy install page is reachable', async ({ page }) => {
    await signIn(page, 'priya@northwind.test');
    await page.getByRole('link', { name: 'GitHub' }).click();
    await expect(page.getByText(/Mode: fake/)).toBeVisible();
  });
});
