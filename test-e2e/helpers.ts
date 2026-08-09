import type { Page, Route } from '@playwright/test'

export const WORKER = 'https://memo-worker.ausz.workers.dev'
export const TEST_TOKEN = 'e2e-test-token'

export interface MockedCall {
  method: string
  path: string
  body: string | null
}

/**
 * Intercepts every request to the real production Worker and answers from
 * canned responses instead — these tests never touch the live backend.
 */
export async function mockWorkerApi(page: Page, opts: { memo?: Record<string, unknown> } = {}) {
  const calls: MockedCall[] = []
  const memo = {
    id: 'memo-1',
    memo_id: '20260101-TESTMEM',
    uid: '',
    title: '',
    description: '',
    cover_file: '',
    tags: '[]',
    pinned: 0,
    links: '[]',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    share_token: null,
    ...opts.memo,
  }

  await page.route(`${WORKER}/**`, async (route: Route) => {
    const req = route.request()
    const url = new URL(req.url())
    const method = req.method()
    calls.push({ method, path: url.pathname + url.search, body: req.postData() })

    if (url.searchParams.get('check') === '1') {
      const ok = url.searchParams.get('t') === TEST_TOKEN
      return route.fulfill({ status: ok ? 200 : 401, json: ok ? { ok: true } : { error: 'unauthorized' } })
    }

    const path = url.pathname

    if (method === 'GET' && path === '/memos') return route.fulfill({ json: [memo] })
    if (method === 'GET' && path === '/tags') return route.fulfill({ json: [] })
    if (method === 'GET' && path === '/storage') return route.fulfill({ json: { bytes: 0 } })
    if (method === 'POST' && path === '/memos') return route.fulfill({ json: { ok: true, id: memo.id, memo_id: memo.memo_id } })

    if (method === 'GET' && path === `/memos/${memo.id}`) return route.fulfill({ json: memo })
    if (method === 'GET' && path === `/memos/${memo.id}/files`) return route.fulfill({ json: [] })
    if (method === 'GET' && path === `/memos/${memo.id}/meta`) return route.fulfill({ json: { files: {}, folders: [], trash: [] } })
    if (method === 'GET' && path === `/memos/${memo.id}/note`) return route.fulfill({ contentType: 'text/html', body: '' })
    if (method === 'GET' && path === `/memos/${memo.id}/snippets`) return route.fulfill({ json: [] })

    if (['PUT', 'POST', 'PATCH', 'DELETE'].includes(method)) return route.fulfill({ json: { ok: true } })
    return route.fulfill({ status: 404, json: { error: 'not_found_in_mock' } })
  })

  return { calls, memo }
}

/** Seeds a valid auth token before the app's first script runs, skipping the passphrase screen. */
export async function unlockAsTestUser(page: Page) {
  await page.addInitScript((token) => {
    window.localStorage.setItem('memo_token', token)
  }, TEST_TOKEN)
}
