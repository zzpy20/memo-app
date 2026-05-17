/// <reference types="@cloudflare/workers-types" />

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { drizzle } from 'drizzle-orm/d1'
import { and, asc, desc, eq, isNotNull, isNull, like, ne, or, sql } from 'drizzle-orm'
import { memos } from './src/db/schema'

// ── Types ─────────────────────────────────────────────────────────────────────

type Bindings = {
  MEMO_D1: D1Database
  MEMO_R2: R2Bucket
  MEMO_AUTH_TOKEN: string
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function newId() { return crypto.randomUUID() }

function newMemoId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const arr = new Uint8Array(7)
  crypto.getRandomValues(arr)
  return date + '-' + Array.from(arr, b => chars[b % 36]).join('')
}

function nowISO() { return new Date().toISOString() }

const IMG_RE = /\.(jpe?g|png|gif|webp|avif|bmp|svg)$/i
function isImageKey(key: string) { return IMG_RE.test(key) }

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', bmp: 'image/bmp',
  pdf: 'application/pdf',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4', webm: 'video/webm',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg',
  txt: 'text/plain', md: 'text/markdown',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}
// Reverse map: mime type → preferred extension
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'image/bmp': 'bmp',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/wav': 'wav', 'audio/ogg': 'ogg',
  'text/plain': 'txt', 'text/markdown': 'md',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
}
function mimeFromFilename(filename: string, fallback: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return MIME_MAP[ext] || fallback
}
function resolveFileKey(rawFilename: string, mimeStr: string, ts: string): string {
  // Sanitise and strip leading/trailing dots
  const safe = String(rawFilename || '').replace(/[^a-zA-Z0-9._\-]/g, '_').replace(/^[._]+|[._]+$/g, '')
  const base = safe || `capture-${ts}`
  // Check if the name already has a recognised extension
  const existingExt = base.includes('.') ? base.split('.').pop()!.toLowerCase() : ''
  const knownExt = existingExt && MIME_MAP[existingExt]
  if (knownExt) return base
  // No valid extension — derive from mime type
  const ext = MIME_EXT[mimeStr] || 'bin'
  return `${base}.${ext}`
}

function sanitizeTags(raw: unknown): string {
  const arr = Array.isArray(raw) ? raw : []
  return JSON.stringify(arr.map(t => String(t).trim().toLowerCase()).filter(Boolean))
}

function sanitizeLinks(raw: unknown): string {
  const arr = Array.isArray(raw) ? raw : []
  return JSON.stringify(
    arr.map((l: any) => ({ label: String(l.label || '').slice(0, 200), url: String(l.url || '').slice(0, 500) }))
       .filter((l: any) => l.url)
  )
}

function sanitizeFTS(q: string): string {
  return String(q).replace(/["'()[\]{}^|&:]/g, ' ').trim()
    .split(/\s+/).filter(Boolean).map(w => w + '*').join(' ').slice(0, 200)
}

function stripHtml(html: string): string {
  return (html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim().slice(0, 30000)
}

const pfx = (id: string) => `memo-${id}/`

// Reusable condition: memo is not soft-deleted
const notDeleted = or(isNull(memos.deleted_at), eq(memos.deleted_at, ''))!

async function syncSearchText(env: Bindings, id: string, noteHtml?: string, meta?: any) {
  try {
    if (noteHtml === undefined) {
      const o = await env.MEMO_R2.get(pfx(id) + '_note')
      noteHtml = o ? await o.text() : ''
    }
    if (meta === undefined) {
      const o = await env.MEMO_R2.get(pfx(id) + '_meta')
      meta = { files: {} }
      if (o) { try { meta = JSON.parse(await o.text()) } catch {} }
    }
    const snippetsObj = await env.MEMO_R2.get(pfx(id) + '_snippets')
    let snippets: any[] = []
    if (snippetsObj) { try { snippets = JSON.parse(await snippetsObj.text()) } catch {} }
    const files = meta?.files || {}
    const parts = [
      stripHtml(noteHtml),
      Object.keys(files).join(' '),
      Object.values(files).flatMap((f: any) => f.tags || []).join(' '),
      Object.values(files).map((f: any) => f.caption || '').filter(Boolean).join(' '),
      snippets.map((s: any) => s.title + ' ' + stripHtml(s.content || '')).join(' '),
    ]
    const searchText = parts.filter(Boolean).join(' ').slice(0, 50000)
    const db = drizzle(env.MEMO_D1)
    await db.update(memos).set({ search_text: searchText }).where(eq(memos.id, id))
  } catch {}
}

// ── App ───────────────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
  maxAge: 86400,
}))

app.use('*', async (c, next) => {
  if (c.req.path.startsWith('/share/') || c.req.path === '/share') { await next(); return }
  const token = c.req.query('t') || ''
  const tokenOk = !!c.env.MEMO_AUTH_TOKEN && token === c.env.MEMO_AUTH_TOKEN
  if (c.req.query('check') === '1') {
    return tokenOk ? c.json({ ok: true }) : c.json({ error: 'unauthorized' }, 401)
  }
  if (!tokenOk) return c.json({ error: 'unauthorized' }, 401)
  await next()
})

// ── Public share routes (no auth) ─────────────────────────────────────────────
app.get('/share/:token', async (c) => {
  const db = drizzle(c.env.MEMO_D1)
  const [row] = await db.select({
    id: memos.id, memo_id: memos.memo_id, title: memos.title,
    description: memos.description, tags: memos.tags, uid: memos.uid,
    cover_file: memos.cover_file, created_at: memos.created_at, updated_at: memos.updated_at,
  }).from(memos).where(and(eq(memos.share_token, c.req.param('token')), notDeleted)).limit(1)
  if (!row) return c.json({ error: 'not_found' }, 404)
  return c.json(row)
})

app.get('/share/:token/note', async (c) => {
  const db = drizzle(c.env.MEMO_D1)
  const [row] = await db.select({ id: memos.id }).from(memos)
    .where(and(eq(memos.share_token, c.req.param('token')), notDeleted)).limit(1)
  if (!row) return c.json({ error: 'not_found' }, 404)
  const obj = await c.env.MEMO_R2.get(pfx(row.id) + '_note')
  return new Response(obj?.body ?? '', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
})

app.get('/share/:token/files', async (c) => {
  const db = drizzle(c.env.MEMO_D1)
  const [row] = await db.select({ id: memos.id }).from(memos)
    .where(and(eq(memos.share_token, c.req.param('token')), notDeleted)).limit(1)
  if (!row) return c.json({ error: 'not_found' }, 404)
  const p = pfx(row.id)
  const listed = await c.env.MEMO_R2.list({ prefix: p, limit: 1000 })
  const files = listed.objects
    .map(o => ({ key: o.key.slice(p.length), size: o.size, uploaded: o.uploaded }))
    .filter(f => f.key && !f.key.startsWith('_'))
  return c.json(files)
})

app.get('/share/:token/files/:filename{.+}', async (c) => {
  const db = drizzle(c.env.MEMO_D1)
  const [row] = await db.select({ id: memos.id }).from(memos)
    .where(and(eq(memos.share_token, c.req.param('token')), notDeleted)).limit(1)
  if (!row) return c.json({ error: 'not_found' }, 404)
  const obj = await c.env.MEMO_R2.get(pfx(row.id) + c.req.param('filename'))
  if (!obj) return c.json({ error: 'not_found' }, 404)
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600',
    },
  })
})

app.get('/share/:token/snippets', async (c) => {
  const db = drizzle(c.env.MEMO_D1)
  const [row] = await db.select({ id: memos.id }).from(memos)
    .where(and(eq(memos.share_token, c.req.param('token')), notDeleted)).limit(1)
  if (!row) return c.json({ error: 'not_found' }, 404)
  const obj = await c.env.MEMO_R2.get(pfx(row.id) + '_snippets')
  if (!obj) return c.json([])
  try { return c.json(JSON.parse(await obj.text())) } catch { return c.json([]) }
})

// ── Share management (auth required) ──────────────────────────────────────────
app.get('/memos/:id/share', async (c) => {
  const db = drizzle(c.env.MEMO_D1)
  const [row] = await db.select({ share_token: memos.share_token }).from(memos).where(eq(memos.id, c.req.param('id'))).limit(1)
  return c.json({ token: row?.share_token ?? null })
})

app.post('/memos/:id/share', async (c) => {
  const db = drizzle(c.env.MEMO_D1)
  const id = c.req.param('id')
  const token = crypto.randomUUID()
  await db.update(memos).set({ share_token: token }).where(eq(memos.id, id))
  return c.json({ token })
})

app.delete('/memos/:id/share', async (c) => {
  const db = drizzle(c.env.MEMO_D1)
  await db.update(memos).set({ share_token: null }).where(eq(memos.id, c.req.param('id')))
  return c.json({ ok: true })
})

// ── Storage usage ─────────────────────────────────────────────────────────────

app.get('/storage', async (c) => {
  let cursor: string | undefined
  let totalBytes = 0
  let objectCount = 0
  do {
    const listed = await c.env.MEMO_R2.list({ limit: 1000, cursor })
    for (const obj of listed.objects) { totalBytes += obj.size; objectCount++ }
    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor)
  return c.json({ bytes: totalBytes, objects: objectCount })
})

// ── Search ────────────────────────────────────────────────────────────────────

// FTS5 requires raw SQL — Drizzle does not support virtual tables
app.get('/search', async (c) => {
  const q = (c.req.query('q') || '').trim()
  if (!q) return c.json([])
  try {
    const { results } = await c.env.MEMO_D1.prepare(
      `SELECT m.id,m.memo_id,m.uid,m.title,m.description,m.cover_file,m.tags,m.pinned,m.created_at,m.updated_at
       FROM memos_fts JOIN memos m ON memos_fts.id=m.id
       WHERE memos_fts MATCH ? AND (m.deleted_at IS NULL OR m.deleted_at='') ORDER BY rank LIMIT 50`
    ).bind(sanitizeFTS(q)).all()
    return c.json(results || [])
  } catch {
    return c.json([])
  }
})

// FTS5 rebuild — DDL and triggers must stay as raw SQL
app.post('/search/rebuild', async (c) => {
  try { await c.env.MEMO_D1.prepare("ALTER TABLE memos ADD COLUMN search_text TEXT NOT NULL DEFAULT ''").run() } catch {}
  const stmts = [
    'DROP TRIGGER IF EXISTS memos_ai',
    'DROP TRIGGER IF EXISTS memos_ad',
    'DROP TRIGGER IF EXISTS memos_au',
    'DROP TABLE IF EXISTS memos_fts',
    `CREATE VIRTUAL TABLE memos_fts USING fts5(id UNINDEXED,memo_id,uid,title,description,tags,search_text,content='memos',content_rowid='rowid')`,
    `CREATE TRIGGER memos_ai AFTER INSERT ON memos BEGIN INSERT INTO memos_fts(rowid,id,memo_id,uid,title,description,tags,search_text) VALUES(new.rowid,new.id,new.memo_id,new.uid,new.title,new.description,new.tags,new.search_text); END`,
    `CREATE TRIGGER memos_ad AFTER DELETE ON memos BEGIN INSERT INTO memos_fts(memos_fts,rowid,id,memo_id,uid,title,description,tags,search_text) VALUES('delete',old.rowid,old.id,old.memo_id,old.uid,old.title,old.description,old.tags,old.search_text); END`,
    `CREATE TRIGGER memos_au AFTER UPDATE ON memos BEGIN INSERT INTO memos_fts(memos_fts,rowid,id,memo_id,uid,title,description,tags,search_text) VALUES('delete',old.rowid,old.id,old.memo_id,old.uid,old.title,old.description,old.tags,old.search_text); INSERT INTO memos_fts(rowid,id,memo_id,uid,title,description,tags,search_text) VALUES(new.rowid,new.id,new.memo_id,new.uid,new.title,new.description,new.tags,new.search_text); END`,
  ]
  for (const s of stmts) {
    try { await c.env.MEMO_D1.prepare(s).run() } catch {}
  }
  const db = drizzle(c.env.MEMO_D1)
  const all = await db.select({ id: memos.id }).from(memos)
  await Promise.all(all.map(({ id }) => syncSearchText(c.env, id)))
  await c.env.MEMO_D1.prepare("INSERT INTO memos_fts(memos_fts) VALUES('rebuild')").run()
  return c.json({ ok: true, count: all.length })
})

// ── Tags ──────────────────────────────────────────────────────────────────────

app.get('/tags', async (c) => {
  const db = drizzle(c.env.MEMO_D1)
  const rows = await db.select({ tags: memos.tags }).from(memos)
    .where(and(ne(memos.tags, '[]'), notDeleted))
  const counts: Record<string, number> = {}
  for (const r of rows) {
    try { JSON.parse(r.tags).forEach((t: string) => { counts[t] = (counts[t] || 0) + 1 }) } catch {}
  }
  return c.json(Object.keys(counts).sort().map(t => ({ tag: t, count: counts[t] })))
})

// ── Memos collection ──────────────────────────────────────────────────────────

app.get('/memos', async (c) => {
  const db = drizzle(c.env.MEMO_D1)
  const trash = c.req.query('trash') === '1'
  const tag = c.req.query('tag') || ''
  const sort = c.req.query('sort') || 'newest'

  const orderExpr = sort === 'oldest'
    ? [desc(memos.pinned), asc(memos.created_at)]
    : sort === 'updated'
    ? [desc(memos.pinned), desc(memos.updated_at)]
    : [desc(memos.pinned), desc(memos.created_at)]

  const cols = {
    id: memos.id, memo_id: memos.memo_id, uid: memos.uid,
    title: memos.title, description: memos.description,
    cover_file: memos.cover_file, tags: memos.tags,
    pinned: memos.pinned, created_at: memos.created_at, updated_at: memos.updated_at,
  }

  let results
  if (trash) {
    results = await db.select({ ...cols, deleted_at: memos.deleted_at }).from(memos)
      .where(and(isNotNull(memos.deleted_at), ne(memos.deleted_at, '')))
      .orderBy(desc(memos.deleted_at)).limit(500)
  } else if (tag) {
    results = await db.select(cols).from(memos)
      .where(and(notDeleted, like(memos.tags, `%${tag.replace(/[%_]/g, '')}%`)))
      .orderBy(...orderExpr).limit(500)
  } else {
    results = await db.select(cols).from(memos)
      .where(notDeleted)
      .orderBy(...orderExpr).limit(500)
  }
  return c.json(results)
})

app.post('/memos', async (c) => {
  const db = drizzle(c.env.MEMO_D1)
  const id = newId(), memo_id = newMemoId(), ts = nowISO()
  await db.insert(memos).values({
    id, memo_id, uid: '', title: '', description: '', cover_file: '',
    tags: '[]', pinned: 0, links: '[]', search_text: '', created_at: ts, updated_at: ts,
  })
  return c.json({ ok: true, id, memo_id })
})

// ── Single memo ───────────────────────────────────────────────────────────────

app.get('/memos/:id', async (c) => {
  const db = drizzle(c.env.MEMO_D1)
  const [row] = await db.select().from(memos).where(eq(memos.id, c.req.param('id'))).limit(1)
  if (!row) return c.json({ error: 'not_found' }, 404)
  return c.json(row)
})

app.put('/memos/:id', async (c) => {
  const db = drizzle(c.env.MEMO_D1)
  const id = c.req.param('id')
  const body = await c.req.json()

  const parsedCreatedAt = (() => {
    if (!body.created_at) return null
    const d = new Date(body.created_at + 'T00:00:00+10:00')
    return isNaN(d.getTime()) ? null : d.toISOString()
  })()

  const setValues: Partial<typeof memos.$inferInsert> = {
    title:       String(body.title || '').slice(0, 500),
    description: String(body.description || '').slice(0, 2000),
    uid:         String(body.uid || '').slice(0, 100),
    cover_file:  String(body.cover_file || ''),
    tags:        sanitizeTags(body.tags),
    pinned:      body.pinned ? 1 : 0,
    links:       sanitizeLinks(body.links),
    updated_at:  nowISO(),
  }
  if (parsedCreatedAt) setValues.created_at = parsedCreatedAt

  const updated = await db.update(memos).set(setValues).where(eq(memos.id, id)).returning({ id: memos.id })
  if (!updated.length) return c.json({ error: 'not_found' }, 404)
  return c.json({ ok: true })
})

app.patch('/memos/:id/cover', async (c) => {
  const db = drizzle(c.env.MEMO_D1)
  const { cover_file } = await c.req.json()
  await db.update(memos).set({ cover_file: String(cover_file || '') }).where(eq(memos.id, c.req.param('id')))
  return c.json({ ok: true })
})

app.delete('/memos/:id', async (c) => {
  const db = drizzle(c.env.MEMO_D1)
  const id = c.req.param('id')
  if (c.req.query('permanent') === '1') {
    const p = pfx(id)
    const listed = await c.env.MEMO_R2.list({ prefix: p, limit: 1000 })
    await Promise.all(listed.objects.map(obj => c.env.MEMO_R2.delete(obj.key)))
    await db.delete(memos).where(eq(memos.id, id))
  } else {
    await db.update(memos).set({ deleted_at: nowISO() }).where(eq(memos.id, id))
  }
  return c.json({ ok: true })
})

// ── Memo actions ──────────────────────────────────────────────────────────────

app.post('/memos/:id/untrash', async (c) => {
  const db = drizzle(c.env.MEMO_D1)
  await db.update(memos).set({ deleted_at: null }).where(eq(memos.id, c.req.param('id')))
  return c.json({ ok: true })
})

app.post('/memos/:id/duplicate', async (c) => {
  const db = drizzle(c.env.MEMO_D1)
  const srcId = c.req.param('id')
  const [src] = await db.select().from(memos).where(and(eq(memos.id, srcId), notDeleted)).limit(1)
  if (!src) return c.json({ error: 'not_found' }, 404)

  const newId_ = newId(), newMemoId_ = newMemoId(), ts = nowISO()
  await db.insert(memos).values({
    ...src,
    id: newId_,
    memo_id: newMemoId_,
    title: src.title + ' (copy)',
    pinned: 0,
    created_at: ts,
    updated_at: ts,
  })
  const listed = await c.env.MEMO_R2.list({ prefix: pfx(srcId), limit: 1000 })
  await Promise.all(listed.objects.map(async obj => {
    const relKey = obj.key.slice(pfx(srcId).length)
    const r2obj = await c.env.MEMO_R2.get(obj.key)
    if (r2obj) await c.env.MEMO_R2.put(pfx(newId_) + relKey, r2obj.body, { httpMetadata: r2obj.httpMetadata })
  }))
  return c.json({ id: newId_, memo_id: newMemoId_ })
})

// ── Note ──────────────────────────────────────────────────────────────────────

app.get('/memos/:id/note', async (c) => {
  const obj = await c.env.MEMO_R2.get(pfx(c.req.param('id')) + '_note')
  return c.html(obj ? await obj.text() : '')
})

app.put('/memos/:id/note', async (c) => {
  const id = c.req.param('id')
  const noteHtml = await c.req.text()
  await c.env.MEMO_R2.put(pfx(id) + '_note', noteHtml, { httpMetadata: { contentType: 'text/html' } })
  await syncSearchText(c.env, id, noteHtml, undefined)
  return c.json({ ok: true })
})

// ── Meta ──────────────────────────────────────────────────────────────────────

app.get('/memos/:id/meta', async (c) => {
  const obj = await c.env.MEMO_R2.get(pfx(c.req.param('id')) + '_meta')
  if (!obj) return c.json({ files: {}, folders: [], trash: [] })
  try { return c.json(JSON.parse(await obj.text())) }
  catch { return c.json({ files: {}, folders: [], trash: [] }) }
})

app.put('/memos/:id/meta', async (c) => {
  const id = c.req.param('id')
  const metaBody = await c.req.json()
  await c.env.MEMO_R2.put(pfx(id) + '_meta', JSON.stringify(metaBody), { httpMetadata: { contentType: 'application/json' } })
  await syncSearchText(c.env, id, undefined, metaBody)
  return c.json({ ok: true })
})

// ── Snippets ──────────────────────────────────────────────────────────────────

app.get('/memos/:id/snippets', async (c) => {
  const obj = await c.env.MEMO_R2.get(pfx(c.req.param('id')) + '_snippets')
  if (!obj) return c.json([])
  try { return c.json(JSON.parse(await obj.text())) }
  catch { return c.json([]) }
})

app.put('/memos/:id/snippets', async (c) => {
  const id = c.req.param('id')
  await c.env.MEMO_R2.put(pfx(id) + '_snippets', JSON.stringify(await c.req.json()), { httpMetadata: { contentType: 'application/json' } })
  return c.json({ ok: true })
})

// ── Files ─────────────────────────────────────────────────────────────────────

app.get('/memos/:id/files', async (c) => {
  const id = c.req.param('id')
  const p = pfx(id)
  const listed = await c.env.MEMO_R2.list({ prefix: p, limit: 1000 })
  const files = listed.objects
    .map(o => ({ key: o.key.slice(p.length), size: o.size, uploaded: o.uploaded }))
    .filter(f => f.key && !f.key.startsWith('_'))
  return c.json(files)
})

app.post('/memos/:id/files', async (c) => {
  const id = c.req.param('id')
  const ct = c.req.header('Content-Type') || ''
  if (!ct.includes('multipart/form-data')) return c.json({ error: 'multipart required' }, 400)
  const form = await c.req.formData()
  const file = form.get('file')
  const folder = String(form.get('folder') || '').replace(/[^a-zA-Z0-9_\- ]/g, '').trim().slice(0, 50)
  if (!(file instanceof File)) return c.json({ error: 'no_file' }, 400)
  const safeName = file.name.replace(/\//g, '_')
  const relKey = (folder ? folder + '/' : '') + safeName
  await c.env.MEMO_R2.put(pfx(id) + relKey, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } })

  if (isImageKey(relKey)) {
    const db = drizzle(c.env.MEMO_D1)
    const [row] = await db.select({ cover_file: memos.cover_file }).from(memos).where(eq(memos.id, id)).limit(1)
    if (row && !row.cover_file) {
      await db.update(memos).set({ cover_file: relKey }).where(eq(memos.id, id))
    }
  }

  return c.json({ ok: true, key: relKey })
})

// File ops: move, trash, restore — must be defined before the files/* wildcard
app.post('/memos/:id/move', async (c) => {
  const id = c.req.param('id')
  const { srcKey, dstFolder } = await c.req.json()
  if (!srcKey) return c.json({ error: 'invalid' }, 400)
  const name = srcKey.split('/').pop()
  const dstKey = dstFolder ? dstFolder + '/' + name : name
  if (srcKey === dstKey) return c.json({ ok: true, key: dstKey })
  const obj = await c.env.MEMO_R2.get(pfx(id) + srcKey)
  if (!obj) return c.json({ error: 'not_found' }, 404)
  await c.env.MEMO_R2.put(pfx(id) + dstKey, obj.body, { httpMetadata: obj.httpMetadata })
  await c.env.MEMO_R2.delete(pfx(id) + srcKey)
  return c.json({ ok: true, key: dstKey })
})

app.post('/memos/:id/trash', async (c) => {
  const id = c.req.param('id')
  const { key } = await c.req.json()
  if (!key || key.startsWith('_')) return c.json({ error: 'invalid' }, 400)
  const trashName = key.replace(/\//g, '__')
  const obj = await c.env.MEMO_R2.get(pfx(id) + key)
  if (!obj) return c.json({ error: 'not_found' }, 404)
  await c.env.MEMO_R2.put(pfx(id) + '_trash/' + trashName, obj.body, { httpMetadata: obj.httpMetadata })
  await c.env.MEMO_R2.delete(pfx(id) + key)

  const db = drizzle(c.env.MEMO_D1)
  const [row] = await db.select({ cover_file: memos.cover_file }).from(memos).where(eq(memos.id, id)).limit(1)
  if (row?.cover_file === key) {
    await db.update(memos).set({ cover_file: '' }).where(eq(memos.id, id))
  }

  return c.json({ ok: true, trashKey: '_trash/' + trashName })
})

app.post('/memos/:id/restore', async (c) => {
  const id = c.req.param('id')
  const { trashKey, origKey } = await c.req.json()
  if (!trashKey || !origKey) return c.json({ error: 'invalid' }, 400)
  const obj = await c.env.MEMO_R2.get(pfx(id) + trashKey)
  if (!obj) return c.json({ error: 'not_found' }, 404)
  await c.env.MEMO_R2.put(pfx(id) + origKey, obj.body, { httpMetadata: obj.httpMetadata })
  await c.env.MEMO_R2.delete(pfx(id) + trashKey)
  return c.json({ ok: true })
})

// Serve / delete a specific file
app.get('/memos/:id/files/:filename{.+}', async (c) => {
  const obj = await c.env.MEMO_R2.get(pfx(c.req.param('id')) + c.req.param('filename'))
  if (!obj) return c.json({ error: 'not_found' }, 404)
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'private, max-age=86400',
    },
  })
})

app.delete('/memos/:id/files/:filename{.+}', async (c) => {
  const id = c.req.param('id')
  const filename = c.req.param('filename')
  await c.env.MEMO_R2.delete(pfx(id) + filename)
  const db = drizzle(c.env.MEMO_D1)
  const [row] = await db.select({ cover_file: memos.cover_file }).from(memos).where(eq(memos.id, id)).limit(1)
  if (row?.cover_file === filename) {
    await db.update(memos).set({ cover_file: '' }).where(eq(memos.id, id))
  }
  return c.json({ ok: true })
})

// ── iOS Shortcut quick-capture ────────────────────────────────────────────────
// POST /quick-capture?t=TOKEN  { memo_id, type:"text"|"image", content?, data?, filename?, mime? }

app.post('/quick-capture', async (c) => {
  const db = drizzle(c.env.MEMO_D1)
  const body = await c.req.json()
  const { memo_id, type, content, data, filename, mime } = body

  const [row] = await db.select({ id: memos.id, cover_file: memos.cover_file })
    .from(memos).where(and(eq(memos.memo_id, String(memo_id || '')), notDeleted)).limit(1)
  if (!row) return c.json({ error: 'not_found' }, 404)
  const id = row.id

  if (type === 'text' && content) {
    const raw = String(content).trim()
    const firstLine = raw.split('\n')[0].trim().slice(0, 60) || 'Capture'
    const htmlContent = raw.split('\n').map(l => l.trim() ? `<p>${l.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>` : '<br>').join('')

    const obj = await c.env.MEMO_R2.get(pfx(id) + '_snippets')
    let snippets: any[] = []
    if (obj) { try { snippets = JSON.parse(await obj.text()) } catch {} }
    snippets.unshift({ id: crypto.randomUUID(), title: firstLine, content: htmlContent, created_at: nowISO() })
    await c.env.MEMO_R2.put(pfx(id) + '_snippets', JSON.stringify(snippets), { httpMetadata: { contentType: 'application/json' } })
    return c.json({ ok: true, type: 'clip' })
  }

  if ((type === 'image' || type === 'file') && data) {
    const clean = String(data).replace(/\s/g, '')
    const binary = atob(clean)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const mimeStr = String(mime || 'application/octet-stream')
    const key = resolveFileKey(String(filename || ''), mimeStr, ts)
    await c.env.MEMO_R2.put(pfx(id) + key, bytes, { httpMetadata: { contentType: mimeStr } })
    if (!row.cover_file && isImageKey(key)) {
      await db.update(memos).set({ cover_file: key }).where(eq(memos.id, id))
    }
    return c.json({ ok: true, type: 'file', key })
  }

  return c.json({ error: 'missing type or content' }, 400)
})

// Raw binary file upload — avoids base64 entirely, called from Shortcuts Share Sheet
// POST /quick-capture-file?t=TOKEN&memo_id=...&mime=image/jpeg&filename=IMG_4599
app.post('/quick-capture-file', async (c) => {
  const db = drizzle(c.env.MEMO_D1)
  const memo_id = c.req.query('memo_id') || ''
  const mime    = c.req.query('mime') || 'application/octet-stream'
  const fname   = c.req.query('filename') || ''

  const [row] = await db.select({ id: memos.id, cover_file: memos.cover_file })
    .from(memos).where(and(eq(memos.memo_id, memo_id), notDeleted)).limit(1)
  if (!row) return c.json({ error: 'not_found' }, 404)

  const id  = row.id
  const ts  = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const key = resolveFileKey(fname, mime, ts)

  const buf = await c.req.arrayBuffer()
  await c.env.MEMO_R2.put(pfx(id) + key, buf, { httpMetadata: { contentType: mime } })

  if (!row.cover_file && isImageKey(key)) {
    await db.update(memos).set({ cover_file: key }).where(eq(memos.id, id))
  }

  return c.json({ ok: true, key })
})

export default app
