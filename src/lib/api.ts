import { writable } from 'svelte/store'
import { browser } from '$app/environment'

export const WORKER = 'https://memo-worker.ausz.workers.dev'

function createTokenStore() {
  const initial = browser ? (localStorage.getItem('memo_token') || '') : ''
  const { subscribe, set } = writable(initial)
  return {
    subscribe,
    set(t: string) {
      set(t)
      if (browser) localStorage.setItem('memo_token', t)
    },
    clear() {
      set('')
      if (browser) localStorage.removeItem('memo_token')
    },
  }
}

export const tokenStore = createTokenStore()

let _token = ''
tokenStore.subscribe(t => { _token = t })

export function api(path: string, opts: RequestInit = {}): Promise<Response> {
  const sep = path.includes('?') ? '&' : '?'
  return fetch(WORKER + path + sep + 't=' + encodeURIComponent(_token), opts).then(r => {
    if (r.status === 401) { tokenStore.clear(); throw new Error('unauthorized') }
    return r
  })
}

export function logout(): void {
  tokenStore.clear()
}

export function safeJson<T>(s: unknown, fallback: T): T {
  try { return typeof s === 'string' ? JSON.parse(s) : ((s as T) || fallback) } catch { return fallback }
}

export function esc(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function fileUrl(memoId: string, key: string): string {
  return WORKER + '/memos/' + memoId + '/files/' + key.split('/').map(encodeURIComponent).join('/') + '?t=' + encodeURIComponent(_token)
}
