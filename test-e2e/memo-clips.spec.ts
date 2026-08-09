import { expect, test } from '@playwright/test'
import { mockWorkerApi, unlockAsTestUser } from './helpers'

test('pasting content into a clip autosaves on blur', async ({ page }) => {
  const { calls, memo } = await mockWorkerApi(page)
  await unlockAsTestUser(page)
  await page.goto(`/memo?id=${memo.id}`)

  await page.getByTitle('Capture a clip').click()
  const pasteArea = page.locator('#clip-paste-area')
  await pasteArea.click()
  await pasteArea.type('a clipped thought')
  await page.locator('#clip-title-input').click() // blur -> immediate autosave

  await expect.poll(() =>
    calls.some(c => c.method === 'PUT' && c.path.startsWith(`/memos/${memo.id}/snippets`))
  ).toBe(true)

  const saveCall = calls.find(c => c.method === 'PUT' && c.path.startsWith(`/memos/${memo.id}/snippets`))
  expect(saveCall?.body).toContain('a clipped thought')
})

test('Menlo font tool wraps the clip selection in monospace styling', async ({ page }) => {
  const { memo } = await mockWorkerApi(page)
  await unlockAsTestUser(page)
  await page.goto(`/memo?id=${memo.id}`)

  await page.getByTitle('Capture a clip').click()
  const pasteArea = page.locator('#clip-paste-area')
  await pasteArea.click()
  await pasteArea.type('$ echo hello')
  await pasteArea.selectText()

  await page.locator('.clip-toolbar').getByTitle('Monospace font').click()
  await page.getByRole('button', { name: 'Menlo 11' }).click()

  const span = pasteArea.locator('span')
  await expect(span).toHaveCSS('font-size', '11px')
  await expect(span).toHaveCSS('font-family', /Menlo/)
})
