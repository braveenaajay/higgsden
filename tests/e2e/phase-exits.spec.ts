import { expect, test, type Page } from '@playwright/test';

const password = 'correct-horse';
const stamp = Date.now();
const email = `owner-${stamp}@example.test`;

async function signUp(page: Page, name: string, userEmail: string) {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(userEmail);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
}

test.describe('HiggsDEN foundation CRUD', () => {
  test('sign up, open an Agency, and create a Client, project, and story', async ({ page }) => {
    await signUp(page, 'Ada Owner', email);
    await expect(page.getByRole('heading', { name: 'Open your Agency' })).toBeVisible();
    await page.getByLabel('Agency name').fill('North Star');
    await page.getByRole('button', { name: 'Create Agency' }).click();
    await expect(page.getByRole('heading', { name: 'North Star' })).toBeVisible();

    await page.getByLabel('New Client').fill('Acme Outdoor');
    await page.getByRole('button', { name: 'Create Client' }).click();
    await expect(page.getByRole('heading', { name: 'Acme Outdoor' })).toBeVisible();

    await page.getByLabel('New project').fill('Storefront rebuild');
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.getByRole('link', { name: /Storefront rebuild/ }).click();
    await expect(page.getByRole('heading', { name: 'Storefront rebuild' })).toBeVisible();

    await page.getByRole('button', { name: 'Backlog' }).click();
    await page.getByLabel('New epic').fill('Catalogue');
    await page.getByRole('button', { name: 'Create epic' }).click();
    await expect(page.getByRole('heading', { name: 'Catalogue' })).toBeVisible();

    await page.getByLabel('New story').fill('Filter collections');
    await page.getByLabel('Description').fill('Shoppers filter collections by activity.');
    await page.getByLabel('Acceptance criterion').fill('Activity filters appear on collection pages');
    await page.getByRole('button', { name: 'Create story' }).click();
    await expect(page.getByText('Filter collections')).toBeVisible();
    await expect(page.getByText(/STOREFRONT-1|PRJ-1/).first()).toBeVisible();
  });

  test('sign in returns to the Agency workspace', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'North Star' })).toBeVisible();
    await page.getByRole('link', { name: 'Members' }).click();
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });
});
