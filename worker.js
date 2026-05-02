// Memo Worker v2 — Bindings: MEMO_D1, MEMO_R2, MEMO_AUTH_TOKEN

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });

const cors = (origin) => ({
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
});

function newId() { return crypto.randomUUID(); }

function newMemoId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const arr = new Uint8Array(7);
  crypto.getRandomValues(arr);
  return date + '-' + Array.from(arr, b => chars[b % 36]).join('');
}

function nowISO() { return new Date().toISOString(); }

function sanitizeTags(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return JSON.stringify(arr.map(t => String(t).trim()).filter(Boolean));
}

function sanitizeLinks(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return JSON.stringify(
    arr.map(l => ({ label: String(l.label || '').slice(0, 200), url: String(l.url || '').slice(0, 500) }))
       .filter(l => l.url)
  );
}

function sanitizeFTS(q) {
  return String(q).replace(/["'()\[\]{}^|&:]/g, ' ').trim()
    .split(/\s+/).filter(Boolean).map(w => w + '*').join(' ').slice(0, 200);
}

function stripHtml(html) {
  return (html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim().slice(0, 30000);
}

async function syncSearchText(env, id, noteHtml, meta) {
  try {
    if (noteHtml === undefined) {
      const o = await env.MEMO_R2.get(pfx(id) + '_note');
      noteHtml = o ? await o.text() : '';
    }
    if (meta === undefined) {
      const o = await env.MEMO_R2.get(pfx(id) + '_meta');
      meta = { files: {} };
      if (o) { try { meta = JSON.parse(await o.text()); } catch {} }
    }
    const files = meta?.files || {};
    const parts = [
      stripHtml(noteHtml),
      Object.keys(files).join(' '),
      Object.values(files).flatMap(f => f.tags || []).join(' '),
    ];
    const searchText = parts.filter(Boolean).join(' ').slice(0, 50000);
    await env.MEMO_D1.prepare('UPDATE memos SET search_text=? WHERE id=?').bind(searchText, id).run();
  } catch {}
}

const pfx = id => `memo-${id}/`;

function dec(s) { try { return decodeURIComponent(s); } catch { return s; } }

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '*';
    const h = cors(origin);
    const method = request.method;
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: h });

    const token = url.searchParams.get('t') || '';
    const tokenOk = !!env.MEMO_AUTH_TOKEN && token === env.MEMO_AUTH_TOKEN;

    if (url.searchParams.get('check') === '1')
      return tokenOk ? json({ ok: true }, 200, h) : json({ error: 'unauthorized' }, 401, h);
    if (!tokenOk) return json({ error: 'unauthorized' }, 401, h);

    let m;

    // ── Search ────────────────────────────────────────────────────────────────
    if (path === '/search' && method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) return json([], 200, h);
      try {
        const { results } = await env.MEMO_D1.prepare(
          `SELECT m.id,m.memo_id,m.uid,m.title,m.description,m.cover_file,m.tags,m.pinned,m.created_at,m.updated_at
           FROM memos_fts JOIN memos m ON memos_fts.id=m.id
           WHERE memos_fts MATCH ? ORDER BY rank LIMIT 50`
        ).bind(sanitizeFTS(q)).all();
        return json(results || [], 200, h);
      } catch { return json([], 200, h); }
    }

    // ── Tags ──────────────────────────────────────────────────────────────────
    if (path === '/tags' && method === 'GET') {
      const { results } = await env.MEMO_D1.prepare(
        `SELECT DISTINCT tags FROM memos WHERE tags != '[]'`
      ).all();
      const set = new Set();
      for (const r of results || []) { try { JSON.parse(r.tags).forEach(t => set.add(t)); } catch {} }
      return json([...set].sort(), 200, h);
    }

    // ── List memos ────────────────────────────────────────────────────────────
    if (path === '/memos' && method === 'GET') {
      const tag = url.searchParams.get('tag') || '';
      const stmt = tag
        ? env.MEMO_D1.prepare(
            `SELECT id,memo_id,uid,title,description,cover_file,tags,pinned,created_at,updated_at
             FROM memos WHERE tags LIKE ? ORDER BY pinned DESC,created_at DESC LIMIT 500`
          ).bind('%' + tag.replace(/[%_]/g, '') + '%')
        : env.MEMO_D1.prepare(
            `SELECT id,memo_id,uid,title,description,cover_file,tags,pinned,created_at,updated_at
             FROM memos ORDER BY pinned DESC,created_at DESC LIMIT 500`
          );
      const { results } = await stmt.all();
      return json(results || [], 200, h);
    }

    // ── Create memo ───────────────────────────────────────────────────────────
    if (path === '/memos' && method === 'POST') {
      const id = newId(), memo_id = newMemoId(), ts = nowISO();
      await env.MEMO_D1.prepare(
        `INSERT INTO memos(id,memo_id,uid,title,description,cover_file,tags,pinned,links,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(id, memo_id, '', '', '', '', '[]', 0, '[]', ts, ts).run();
      return json({ ok: true, id, memo_id }, 200, h);
    }

    // ── Note ──────────────────────────────────────────────────────────────────
    m = path.match(/^\/memos\/([^/]+)\/note$/);
    if (m) {
      const id = dec(m[1]);
      if (method === 'GET') {
        const obj = await env.MEMO_R2.get(pfx(id) + '_note');
        const content = obj ? await obj.text() : '';
        return new Response(content, { headers: { ...h, 'Content-Type': 'text/html; charset=utf-8' } });
      }
      if (method === 'PUT') {
        const noteHtml = await request.text();
        await env.MEMO_R2.put(pfx(id) + '_note', noteHtml, { httpMetadata: { contentType: 'text/html' } });
        await syncSearchText(env, id, noteHtml, undefined);
        return json({ ok: true }, 200, h);
      }
    }

    // ── Meta ──────────────────────────────────────────────────────────────────
    m = path.match(/^\/memos\/([^/]+)\/meta$/);
    if (m) {
      const id = dec(m[1]);
      if (method === 'GET') {
        const obj = await env.MEMO_R2.get(pfx(id) + '_meta');
        if (!obj) return json({ files: {}, folders: [], trash: [] }, 200, h);
        try { return json(JSON.parse(await obj.text()), 200, h); }
        catch { return json({ files: {}, folders: [], trash: [] }, 200, h); }
      }
      if (method === 'PUT') {
        const metaBody = await request.json();
        await env.MEMO_R2.put(pfx(id) + '_meta', JSON.stringify(metaBody), { httpMetadata: { contentType: 'application/json' } });
        await syncSearchText(env, id, undefined, metaBody);
        return json({ ok: true }, 200, h);
      }
    }

    // ── Files list + upload ───────────────────────────────────────────────────
    m = path.match(/^\/memos\/([^/]+)\/files$/);
    if (m) {
      const id = dec(m[1]);
      if (method === 'GET') {
        const p = pfx(id);
        const listed = await env.MEMO_R2.list({ prefix: p, limit: 1000 });
        const files = listed.objects
          .map(o => ({ key: o.key.slice(p.length), size: o.size, uploaded: o.uploaded }))
          .filter(f => f.key && !f.key.startsWith('_'));
        return json(files, 200, h);
      }
      if (method === 'POST') {
        const ct = request.headers.get('Content-Type') || '';
        if (!ct.includes('multipart/form-data')) return json({ error: 'multipart required' }, 400, h);
        const form = await request.formData();
        const file = form.get('file');
        const folder = String(form.get('folder') || '').replace(/[^a-zA-Z0-9_\- ]/g, '').trim().slice(0, 50);
        if (!(file instanceof File)) return json({ error: 'no_file' }, 400, h);
        const safeName = file.name.replace(/\//g, '_');
        const relKey = (folder ? folder + '/' : '') + safeName;
        await env.MEMO_R2.put(pfx(id) + relKey, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
        return json({ ok: true, key: relKey }, 200, h);
      }
    }

    // ── Move file ─────────────────────────────────────────────────────────────
    m = path.match(/^\/memos\/([^/]+)\/move$/);
    if (m && method === 'POST') {
      const id = dec(m[1]);
      const { srcKey, dstFolder } = await request.json();
      if (!srcKey) return json({ error: 'invalid' }, 400, h);
      const name = srcKey.split('/').pop();
      const dstKey = dstFolder ? dstFolder + '/' + name : name;
      if (srcKey === dstKey) return json({ ok: true, key: dstKey }, 200, h);
      const obj = await env.MEMO_R2.get(pfx(id) + srcKey);
      if (!obj) return json({ error: 'not_found' }, 404, h);
      await env.MEMO_R2.put(pfx(id) + dstKey, obj.body, { httpMetadata: obj.httpMetadata });
      await env.MEMO_R2.delete(pfx(id) + srcKey);
      return json({ ok: true, key: dstKey }, 200, h);
    }

    // ── Trash (soft delete) ───────────────────────────────────────────────────
    m = path.match(/^\/memos\/([^/]+)\/trash$/);
    if (m && method === 'POST') {
      const id = dec(m[1]);
      const { key } = await request.json();
      if (!key || key.startsWith('_')) return json({ error: 'invalid' }, 400, h);
      const trashName = key.replace(/\//g, '__');
      const obj = await env.MEMO_R2.get(pfx(id) + key);
      if (!obj) return json({ error: 'not_found' }, 404, h);
      await env.MEMO_R2.put(pfx(id) + '_trash/' + trashName, obj.body, { httpMetadata: obj.httpMetadata });
      await env.MEMO_R2.delete(pfx(id) + key);
      return json({ ok: true, trashKey: '_trash/' + trashName }, 200, h);
    }

    // ── Restore from trash ────────────────────────────────────────────────────
    m = path.match(/^\/memos\/([^/]+)\/restore$/);
    if (m && method === 'POST') {
      const id = dec(m[1]);
      const { trashKey, origKey } = await request.json();
      if (!trashKey || !origKey) return json({ error: 'invalid' }, 400, h);
      const obj = await env.MEMO_R2.get(pfx(id) + trashKey);
      if (!obj) return json({ error: 'not_found' }, 404, h);
      await env.MEMO_R2.put(pfx(id) + origKey, obj.body, { httpMetadata: obj.httpMetadata });
      await env.MEMO_R2.delete(pfx(id) + trashKey);
      return json({ ok: true }, 200, h);
    }

    // ── Serve / delete file ───────────────────────────────────────────────────
    m = path.match(/^\/memos\/([^/]+)\/files\/(.+)$/);
    if (m) {
      const id = dec(m[1]);
      const fileKey = dec(m[2]);
      if (method === 'GET') {
        const obj = await env.MEMO_R2.get(pfx(id) + fileKey);
        if (!obj) return json({ error: 'not_found' }, 404, h);
        return new Response(obj.body, {
          headers: { ...h, 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream', 'Cache-Control': 'private, max-age=86400' },
        });
      }
      if (method === 'DELETE') {
        await env.MEMO_R2.delete(pfx(id) + fileKey);
        return json({ ok: true }, 200, h);
      }
    }

    // ── Get / Update / Delete single memo ─────────────────────────────────────
    m = path.match(/^\/memos\/([^/]+)$/);
    if (m) {
      const id = dec(m[1]);
      if (method === 'GET') {
        const row = await env.MEMO_D1.prepare('SELECT * FROM memos WHERE id=?').bind(id).first();
        if (!row) return json({ error: 'not_found' }, 404, h);
        return json(row, 200, h);
      }
      if (method === 'PUT') {
        const body = await request.json();
        const result = await env.MEMO_D1.prepare(
          `UPDATE memos SET title=?,description=?,uid=?,cover_file=?,tags=?,pinned=?,links=?,updated_at=? WHERE id=?`
        ).bind(
          String(body.title || '').slice(0, 500),
          String(body.description || '').slice(0, 2000),
          String(body.uid || '').slice(0, 100),
          String(body.cover_file || ''),
          sanitizeTags(body.tags),
          body.pinned ? 1 : 0,
          sanitizeLinks(body.links),
          nowISO(), id
        ).run();
        if (!result.meta?.changes) return json({ error: 'not_found' }, 404, h);
        return json({ ok: true }, 200, h);
      }
      if (method === 'DELETE') {
        const p = pfx(id);
        const listed = await env.MEMO_R2.list({ prefix: p, limit: 1000 });
        for (const obj of listed.objects) await env.MEMO_R2.delete(obj.key);
        await env.MEMO_D1.prepare('DELETE FROM memos WHERE id=?').bind(id).run();
        return json({ ok: true }, 200, h);
      }
    }

    // ── Search index rebuild (one-time migration + backfill) ─────────────────
    if (path === '/search/rebuild' && method === 'POST') {
      // 1. Add search_text column if missing
      try { await env.MEMO_D1.prepare("ALTER TABLE memos ADD COLUMN search_text TEXT NOT NULL DEFAULT ''").run(); } catch {}

      // 2. Recreate FTS5 table and triggers to include search_text
      const stmts = [
        'DROP TRIGGER IF EXISTS memos_ai',
        'DROP TRIGGER IF EXISTS memos_ad',
        'DROP TRIGGER IF EXISTS memos_au',
        'DROP TABLE IF EXISTS memos_fts',
        `CREATE VIRTUAL TABLE memos_fts USING fts5(id UNINDEXED,memo_id,uid,title,description,tags,search_text,content='memos',content_rowid='rowid')`,
        `CREATE TRIGGER memos_ai AFTER INSERT ON memos BEGIN INSERT INTO memos_fts(rowid,id,memo_id,uid,title,description,tags,search_text) VALUES(new.rowid,new.id,new.memo_id,new.uid,new.title,new.description,new.tags,new.search_text); END`,
        `CREATE TRIGGER memos_ad AFTER DELETE ON memos BEGIN INSERT INTO memos_fts(memos_fts,rowid,id,memo_id,uid,title,description,tags,search_text) VALUES('delete',old.rowid,old.id,old.memo_id,old.uid,old.title,old.description,old.tags,old.search_text); END`,
        `CREATE TRIGGER memos_au AFTER UPDATE ON memos BEGIN INSERT INTO memos_fts(memos_fts,rowid,id,memo_id,uid,title,description,tags,search_text) VALUES('delete',old.rowid,old.id,old.memo_id,old.uid,old.title,old.description,old.tags,old.search_text); INSERT INTO memos_fts(rowid,id,memo_id,uid,title,description,tags,search_text) VALUES(new.rowid,new.id,new.memo_id,new.uid,new.title,new.description,new.tags,new.search_text); END`,
      ];
      for (const sql of stmts) {
        try { await env.MEMO_D1.prepare(sql).run(); } catch {}
      }

      // 3. Backfill search_text for all memos from R2
      const { results: all } = await env.MEMO_D1.prepare('SELECT id FROM memos').all();
      await Promise.all((all || []).map(({ id }) => syncSearchText(env, id)));

      // 4. Rebuild FTS5 content index
      await env.MEMO_D1.prepare("INSERT INTO memos_fts(memos_fts) VALUES('rebuild')").run();

      return json({ ok: true, count: (all || []).length }, 200, h);
    }

    return json({ error: 'not_found' }, 404, h);
  },
};
