import { expect, test } from '@playwright/test'
import { TEST_TOKEN, mockWorkerApi } from './helpers'

test('shows the passphrase screen when logged out', async ({ page }) => {
  await mockWorkerApi(page)
  await page.goto('/')
  await expect(page.getByPlaceholder('Passphrase')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Unlock' })).toBeVisible()
})

test('rejects the wrong passphrase', async ({ page }) => {
  await mockWorkerApi(page)
  await page.goto('/')
  await page.getByPlaceholder('Passphrase').fill('wrong-token')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.locator('.auth-error')).toHaveText('Wrong passphrase.')
  await expect(page.getByPlaceholder('Passphrase')).toBeVisible()
})

test('unlocks with the correct passphrase', async ({ page }) => {
  await mockWorkerApi(page)
  await page.goto('/')
  await page.getByPlaceholder('Passphrase').fill(TEST_TOKEN)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByPlaceholder('Passphrase')).toBeHidden()
  await expect(page.getByPlaceholder('Search memos…')).toBeVisible()
})
