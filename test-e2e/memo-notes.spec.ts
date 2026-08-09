import { expect, test } from '@playwright/test'
import { mockWorkerApi, unlockAsTestUser } from './helpers'

test('typing in the note editor autosaves on blur', async ({ page }) => {
  const { calls, memo } = await mockWorkerApi(page)
  await unlockAsTestUser(page)
  await page.goto(`/memo?id=${memo.id}`)

  const editor = page.locator('#note-editor')
  await editor.click()
  await editor.type('Hello from Playwright')
  await page.locator('#title-input').click() // blur the editor -> immediate save, no need to wait out the debounce

  await expect.poll(() =>
    calls.some(c => c.method === 'PUT' && c.path.startsWith(`/memos/${memo.id}/note`))
  ).toBe(true)

  const saveCall = calls.find(c => c.method === 'PUT' && c.path.startsWith(`/memos/${memo.id}/note`))
  expect(saveCall?.body).toContain('Hello from Playwright')
})
