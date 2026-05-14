import { Hono } from 'hono'
import { cors } from 'hono/cors'

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

function sanitizeTags(raw) {
  const arr = Array.isArray(raw) ? raw : []
  return JSON.stringify(arr.map(t => String(t).trim().toLowerCase()).filter(Boolean))
}

function sanitizeLinks(raw) {
  const arr = Array.isArray(raw) ? raw : []
  return JSON.stringify(
    arr.map(l => ({ label: String(l.label || '').slice(0, 200), url: String(l.url || '').slice(0, 500) }))
       .filter(l => l.url)
  )
}

function sanitizeFTS(q) {
  return String(q).replace(/["'()[\]{}^|&:]/g, ' ').trim()
    .split(/\s+/).filter(Boolean).map(w => w + '*').join(' ').slice(0, 200)
}

function stripHtml(html) {
  return (html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim().slice(0, 30000)
}

const pfx = id => `memo-${id}/`

async function syncSearchText(env, id, noteHtml, meta) {
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
    let snippets = []
    if (snippetsObj) { try { snippets = JSON.parse(await snippetsObj.text()) } catch {} }
    const files = meta?.files || {}
    const parts = [
      stripHtml(noteHtml),
      Object.keys(files).join(' '),
      Object.values(files).flatMap(f => f.tags || []).join(' '),
      Object.values(files).map(f => f.caption || '').filter(Boolean).join(' '),
      snippets.map(s => s.title + ' ' + stripHtml(s.content || '')).join(' '),
    ]
    const searchText = parts.filter(Boolean).join(' ').slice(0, 50000)
    await env.MEMO_D1.prepare('UPDATE memos SET search_text=? WHERE id=?').bind(searchText, id).run()
  } catch {}
}

// ── App ───────────────────────────────────────────────────────────────────────

const app = new Hono()

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
  maxAge: 86400,
}))

app.use('*', async (c, next) => {
  const token = c.req.query('t') || ''
  const tokenOk = !!c.env.MEMO_AUTH_TOKEN && token === c.env.MEMO_AUTH_TOKEN
  if (c.req.query('check') === '1') {
    return tokenOk ? c.json({ ok: true }) : c.json({ error: 'unauthorized' }, 401)
  }
  if (!tokenOk) return c.json({ error: 'unauthorized' }, 401)
  await next()
})

// ── Search ────────────────────────────────────────────────────────────────────

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
  for (const sql of stmts) {
    try { await c.env.MEMO_D1.prepare(sql).run() } catch {}
  }
  const { results: all } = await c.env.MEMO_D1.prepare('SELECT id FROM memos').all()
  await Promise.all((all || []).map(({ id }) => syncSearchText(c.env, id)))
  await c.env.MEMO_D1.prepare("INSERT INTO memos_fts(memos_fts) VALUES('rebuild')").run()
  return c.json({ ok: true, count: (all || []).length })
})

// ── Tags ──────────────────────────────────────────────────────────────────────

app.get('/tags', async (c) => {
  const { results } = await c.env.MEMO_D1.prepare(
    `SELECT tags FROM memos WHERE tags != '[]' AND (deleted_at IS NULL OR deleted_at='')`
  ).all()
  const counts = {}
  for (const r of results || []) {
    try { JSON.parse(r.tags).forEach(t => { counts[t] = (counts[t] || 0) + 1 }) } catch {}
  }
  return c.json(Object.keys(counts).sort().map(t => ({ tag: t, count: counts[t] })))
})

// ── Memos collection ──────────────────────────────────────────────────────────

app.get('/memos', async (c) => {
  try { await c.env.MEMO_D1.prepare('ALTER TABLE memos ADD COLUMN deleted_at TEXT DEFAULT NULL').run() } catch {}
  const trash = c.req.query('trash') === '1'
  const tag = c.req.query('tag') || ''
  const sort = c.req.query('sort') || 'newest'
  const order = sort === 'oldest' ? 'pinned DESC,created_at ASC'
              : sort === 'updated' ? 'pinned DESC,updated_at DESC'
              : 'pinned DESC,created_at DESC'
  let stmt
  if (trash) {
    stmt = c.env.MEMO_D1.prepare(
      `SELECT id,memo_id,uid,title,description,cover_file,tags,pinned,created_at,updated_at,deleted_at
       FROM memos WHERE deleted_at IS NOT NULL AND deleted_at!='' ORDER BY deleted_at DESC LIMIT 500`
    )
  } else if (tag) {
    stmt = c.env.MEMO_D1.prepare(
      `SELECT id,memo_id,uid,title,description,cover_file,tags,pinned,created_at,updated_at
       FROM memos WHERE (deleted_at IS NULL OR deleted_at='') AND tags LIKE ? ORDER BY ${order} LIMIT 500`
    ).bind('%' + tag.replace(/[%_]/g, '') + '%')
  } else {
    stmt = c.env.MEMO_D1.prepare(
      `SELECT id,memo_id,uid,title,description,cover_file,tags,pinned,created_at,updated_at
       FROM memos WHERE deleted_at IS NULL OR deleted_at='' ORDER BY ${order} LIMIT 500`
    )
  }
  const { results } = await stmt.all()
  return c.json(results || [])
})

app.post('/memos', async (c) => {
  const id = newId(), memo_id = newMemoId(), ts = nowISO()
  await c.env.MEMO_D1.prepare(
    `INSERT INTO memos(id,memo_id,uid,title,description,cover_file,tags,pinned,links,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, memo_id, '', '', '', '', '[]', 0, '[]', ts, ts).run()
  return c.json({ ok: true, id, memo_id })
})

// ── Single memo ───────────────────────────────────────────────────────────────

app.get('/memos/:id', async (c) => {
  const row = await c.env.MEMO_D1.prepare('SELECT * FROM memos WHERE id=?').bind(c.req.param('id')).first()
  if (!row) return c.json({ error: 'not_found' }, 404)
  return c.json(row)
})

app.put('/memos/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const result = await c.env.MEMO_D1.prepare(
    `UPDATE memos SET title=?,description=?,uid=?,cover_file=?,tags=?,pinned=?,links=?,updated_at=?,created_at=COALESCE(?,created_at) WHERE id=?`
  ).bind(
    String(body.title || '').slice(0, 500),
    String(body.description || '').slice(0, 2000),
    String(body.uid || '').slice(0, 100),
    String(body.cover_file || ''),
    sanitizeTags(body.tags),
    body.pinned ? 1 : 0,
    sanitizeLinks(body.links),
    nowISO(),
    (() => { if (!body.created_at) return null; const d = new Date(body.created_at + 'T00:00:00+10:00'); return isNaN(d) ? null : d.toISOString() })(),
    id
  ).run()
  if (!result.meta?.changes) return c.json({ error: 'not_found' }, 404)
  return c.json({ ok: true })
})

app.delete('/memos/:id', async (c) => {
  const id = c.req.param('id')
  if (c.req.query('permanent') === '1') {
    const p = pfx(id)
    const listed = await c.env.MEMO_R2.list({ prefix: p, limit: 1000 })
    for (const obj of listed.objects) await c.env.MEMO_R2.delete(obj.key)
    await c.env.MEMO_D1.prepare('DELETE FROM memos WHERE id=?').bind(id).run()
  } else {
    await c.env.MEMO_D1.prepare('UPDATE memos SET deleted_at=? WHERE id=?').bind(nowISO(), id).run()
  }
  return c.json({ ok: true })
})

// ── Memo actions ──────────────────────────────────────────────────────────────

app.post('/memos/:id/untrash', async (c) => {
  await c.env.MEMO_D1.prepare('UPDATE memos SET deleted_at=NULL WHERE id=?').bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

app.post('/memos/:id/duplicate', async (c) => {
  const srcId = c.req.param('id')
  const src = await c.env.MEMO_D1.prepare(
    "SELECT * FROM memos WHERE id=? AND (deleted_at IS NULL OR deleted_at='')"
  ).bind(srcId).first()
  if (!src) return c.json({ error: 'not_found' }, 404)
  const newId_ = newId(), newMemoId_ = newMemoId(), ts = nowISO()
  await c.env.MEMO_D1.prepare(
    `INSERT INTO memos(id,memo_id,uid,title,description,cover_file,tags,pinned,links,search_text,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,0,?,?,?,?)`
  ).bind(newId_, newMemoId_, src.uid, src.title + ' (copy)', src.description,
    src.cover_file, src.tags, src.links, src.search_text, ts, ts).run()
  const listed = await c.env.MEMO_R2.list({ prefix: pfx(srcId), limit: 1000 })
  for (const obj of listed.objects) {
    const relKey = obj.key.slice(pfx(srcId).length)
    const r2obj = await c.env.MEMO_R2.get(obj.key)
    if (r2obj) await c.env.MEMO_R2.put(pfx(newId_) + relKey, r2obj.body, { httpMetadata: r2obj.httpMetadata })
  }
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

// Serve / delete a specific file — wildcard captures keys with slashes (e.g. folder/file.jpg)
app.get('/memos/:id/files/*', async (c) => {
  const obj = await c.env.MEMO_R2.get(pfx(c.req.param('id')) + c.req.param('*'))
  if (!obj) return c.json({ error: 'not_found' }, 404)
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'private, max-age=86400',
    },
  })
})

app.delete('/memos/:id/files/*', async (c) => {
  await c.env.MEMO_R2.delete(pfx(c.req.param('id')) + c.req.param('*'))
  return c.json({ ok: true })
})

export default app
