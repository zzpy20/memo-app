import { expect, test } from '@playwright/test'
import { mockWorkerApi, unlockAsTestUser } from './helpers'

test('lists memos from the API and creates a new one', async ({ page }) => {
  const { calls, memo } = await mockWorkerApi(page, { memo: { title: 'My test memo' } })
  await unlockAsTestUser(page)
  await page.goto('/')

  await expect(page.getByText('My test memo')).toBeVisible()

  await page.getByRole('button', { name: '+ New Memo' }).click()
  await page.waitForURL(/\/memo\/?\?id=/)
  expect(page.url()).toContain(`id=${memo.id}`)

  expect(calls.some(c => c.method === 'POST' && c.path.startsWith('/memos?'))).toBe(true)
})
