/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

const T = 'test-token'
const auth = (path: string) => path + (path.includes('?') ? '&' : '?') + 't=' + T

describe('auth', () => {
  it('rejects requests with no token', async () => {
    const res = await SELF.fetch('https://x/memos')
    expect(res.status).toBe(401)
  })

  it('rejects a wrong token on the check endpoint', async () => {
    const res = await SELF.fetch('https://x/?check=1&t=wrong')
    expect(res.status).toBe(401)
  })

  it('accepts the right token on the check endpoint', async () => {
    const res = await SELF.fetch('https://x/?check=1&t=' + T)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('lets /share/* through without a token', async () => {
    const res = await SELF.fetch('https://x/share/nonexistent-token')
    expect(res.status).toBe(404) // auth passes; falls through to "not found" for a bogus token
  })
})

describe('memo CRUD', () => {
  it('creates, reads, updates, trashes, and permanently deletes a memo', async () => {
    const created = await SELF.fetch(auth('https://x/memos'), { method: 'POST' })
    expect(created.status).toBe(200)
    const { id, memo_id } = await created.json<{ id: string; memo_id: string }>()
    expect(id).toBeTruthy()
    expect(memo_id).toMatch(/^\d{8}-[A-Z0-9]{7}$/)

    const got = await SELF.fetch(auth(`https://x/memos/${id}`))
    expect(got.status).toBe(200)
    const memo = await got.json<any>()
    expect(memo.id).toBe(id)
    expect(memo.title).toBe('')
    expect(memo.deleted_at).toBeNull()

    const updated = await SELF.fetch(auth(`https://x/memos/${id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test memo', tags: ['Foo', 'bar'] }),
    })
    expect(updated.status).toBe(200)

    const gotAgain = await SELF.fetch(auth(`https://x/memos/${id}`))
    const updatedMemo = await gotAgain.json<any>()
    expect(updatedMemo.title).toBe('Test memo')
    expect(JSON.parse(updatedMemo.tags)).toEqual(['foo', 'bar']) // tags are lowercased

    const list = await SELF.fetch(auth('https://x/memos'))
    const listBody = await list.json<any[]>()
    expect(listBody.some((m: any) => m.id === id)).toBe(true)

    const trashed = await SELF.fetch(auth(`https://x/memos/${id}`), { method: 'DELETE' })
    expect(trashed.status).toBe(200)

    const listAfterTrash = await SELF.fetch(auth('https://x/memos'))
    expect((await listAfterTrash.json<any[]>()).some((m: any) => m.id === id)).toBe(false)

    const trashList = await SELF.fetch(auth('https://x/memos?trash=1'))
    expect((await trashList.json<any[]>()).some((m: any) => m.id === id)).toBe(true)

    const permaDeleted = await SELF.fetch(auth(`https://x/memos/${id}?permanent=1`), { method: 'DELETE' })
    expect(permaDeleted.status).toBe(200)

    const finalGet = await SELF.fetch(auth(`https://x/memos/${id}`))
    const finalBody = await finalGet.json<any>()
    expect(finalBody.error).toBe('not_found')
  })

  it('returns 404 for a memo that does not exist', async () => {
    const res = await SELF.fetch(auth('https://x/memos/does-not-exist'))
    expect(res.status).toBe(404)
  })
})

describe('file upload size limit', () => {
  it('rejects a file over the 100MB cap with 413', async () => {
    const created = await SELF.fetch(auth('https://x/memos'), { method: 'POST' })
    const { id } = await created.json<{ id: string }>()

    // A sparse-ish blob just over the limit — avoid actually allocating 100MB+ of real memory pressure where possible.
    const oversized = new Uint8Array(100 * 1024 * 1024 + 1)
    const form = new FormData()
    form.set('file', new File([oversized], 'big.bin', { type: 'application/octet-stream' }))

    const res = await SELF.fetch(auth(`https://x/memos/${id}/files`), { method: 'POST', body: form })
    expect(res.status).toBe(413)
    expect((await res.json<any>()).error).toBe('file_too_large')

    const files = await SELF.fetch(auth(`https://x/memos/${id}/files`))
    expect(await files.json<any[]>()).toEqual([])
  })

  it('accepts a small file under the cap', async () => {
    const created = await SELF.fetch(auth('https://x/memos'), { method: 'POST' })
    const { id } = await created.json<{ id: string }>()

    const form = new FormData()
    form.set('file', new File(['hello world'], 'small.txt', { type: 'text/plain' }))

    const res = await SELF.fetch(auth(`https://x/memos/${id}/files`), { method: 'POST', body: form })
    expect(res.status).toBe(200)
    expect((await res.json<any>()).key).toBe('small.txt')
  })
})
