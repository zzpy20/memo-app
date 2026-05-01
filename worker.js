// Memo Worker
// Bindings: MEMO_D1 (D1), MEMO_R2 (R2), MEMO_AUTH_TOKEN (secret)

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

function newId() {
  return crypto.randomUUID();
}

function nowISO() {
  return new Date().toISOString();
}

function sanitizeTags(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return JSON.stringify(arr.map(t => String(t).trim()).filter(Boolean));
}

function sanitizeFTS(q) {
  // Remove FTS5 special chars, add prefix wildcard to each word
  return String(q)
    .replace(/["'()\[\]{}^|&:]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w + '*')
    .join(' ')
    .slice(0, 200);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '*';
    const h = cors(origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });

    const token = url.searchParams.get('t') || '';
    const tokenOk = !!env.MEMO_AUTH_TOKEN && token === env.MEMO_AUTH_TOKEN;
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method;

    // Auth check
    if (url.searchParams.get('check') === '1') {
      return tokenOk ? json({ ok: true }, 200, h) : json({ error: 'unauthorized' }, 401, h);
    }

    if (!tokenOk) return json({ error: 'unauthorized' }, 401, h);

    // ── Search ────────────────────────────────────────────────────────────────
    if (path === '/search' && method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) return json([], 200, h);
      try {
        const ftsQ = sanitizeFTS(q);
        const { results } = await env.MEMO_D1.prepare(
          `SELECT m.id, m.title, m.tags, m.pinned, m.created_at, m.updated_at,
                  snippet(memos_fts, 2, '<mark>', '</mark>', '…', 24) AS snippet
           FROM memos_fts
           JOIN memos m ON memos_fts.id = m.id
           WHERE memos_fts MATCH ?
           ORDER BY rank LIMIT 50`
        ).bind(ftsQ).all();
        return json(results || [], 200, h);
      } catch {
        return json([], 200, h);
      }
    }

    // ── Tags ──────────────────────────────────────────────────────────────────
    if (path === '/tags' && method === 'GET') {
      const { results } = await env.MEMO_D1.prepare(
        `SELECT DISTINCT tags FROM memos WHERE tags != '[]' ORDER BY updated_at DESC`
      ).all();
      const set = new Set();
      for (const row of results || []) {
        try { JSON.parse(row.tags).forEach(t => set.add(t)); } catch {}
      }
      return json([...set].sort(), 200, h);
    }

    // ── List memos ────────────────────────────────────────────────────────────
    if (path === '/memos' && method === 'GET') {
      const tag = url.searchParams.get('tag') || '';
      let stmt;
      if (tag) {
        stmt = env.MEMO_D1.prepare(
          `SELECT id, title, tags, pinned, created_at, updated_at FROM memos
           WHERE tags LIKE ? ORDER BY pinned DESC, updated_at DESC LIMIT 500`
        ).bind('%' + tag.replace(/[%_]/g, '') + '%');
      } else {
        stmt = env.MEMO_D1.prepare(
          `SELECT id, title, tags, pinned, created_at, updated_at FROM memos
           ORDER BY pinned DESC, updated_at DESC LIMIT 500`
        );
      }
      const { results } = await stmt.all();
      return json(results || [], 200, h);
    }

    // ── Get memo ──────────────────────────────────────────────────────────────
    if (path.startsWith('/memos/') && method === 'GET') {
      const id = path.slice(7);
      const row = await env.MEMO_D1.prepare('SELECT * FROM memos WHERE id = ?').bind(id).first();
      if (!row) return json({ error: 'not_found' }, 404, h);
      return json(row, 200, h);
    }

    // ── Create memo ───────────────────────────────────────────────────────────
    if (path === '/memos' && method === 'POST') {
      const body = await request.json();
      const id = newId();
      const ts = nowISO();
      await env.MEMO_D1.prepare(
        'INSERT INTO memos (id,title,body,tags,pinned,created_at,updated_at) VALUES (?,?,?,?,?,?,?)'
      ).bind(
        id,
        String(body.title || '').slice(0, 500),
        String(body.body || ''),
        sanitizeTags(body.tags),
        body.pinned ? 1 : 0,
        ts, ts
      ).run();
      return json({ ok: true, id }, 200, h);
    }

    // ── Update memo ───────────────────────────────────────────────────────────
    if (path.startsWith('/memos/') && method === 'PUT') {
      const id = path.slice(7);
      const body = await request.json();
      const result = await env.MEMO_D1.prepare(
        'UPDATE memos SET title=?,body=?,tags=?,pinned=?,updated_at=? WHERE id=?'
      ).bind(
        String(body.title || '').slice(0, 500),
        String(body.body || ''),
        sanitizeTags(body.tags),
        body.pinned ? 1 : 0,
        nowISO(), id
      ).run();
      if (!result.meta?.changes) return json({ error: 'not_found' }, 404, h);
      return json({ ok: true }, 200, h);
    }

    // ── Delete memo ───────────────────────────────────────────────────────────
    if (path.startsWith('/memos/') && method === 'DELETE') {
      const id = path.slice(7);
      await env.MEMO_D1.prepare('DELETE FROM memos WHERE id = ?').bind(id).run();
      return json({ ok: true }, 200, h);
    }

    // ── Upload file ───────────────────────────────────────────────────────────
    if (path === '/media' && method === 'POST') {
      const ct = request.headers.get('Content-Type') || '';
      if (!ct.includes('multipart/form-data')) return json({ error: 'multipart required' }, 400, h);
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) return json({ error: 'no_file' }, 400, h);
      const ext = (file.name.split('.').pop() || 'bin').slice(0, 10);
      const key = newId() + '.' + ext;
      await env.MEMO_R2.put(key, file.stream(), {
        httpMetadata: { contentType: file.type || 'application/octet-stream' },
      });
      return json({ ok: true, key }, 200, h);
    }

    // ── Serve / delete file ───────────────────────────────────────────────────
    if (path.startsWith('/media/')) {
      const key = path.slice(7);
      if (method === 'GET') {
        const obj = await env.MEMO_R2.get(key);
        if (!obj) return json({ error: 'not_found' }, 404, h);
        return new Response(obj.body, {
          headers: {
            ...h,
            'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
            'Cache-Control': 'private, max-age=86400',
          },
        });
      }
      if (method === 'DELETE') {
        await env.MEMO_R2.delete(key);
        return json({ ok: true }, 200, h);
      }
    }

    return json({ error: 'not_found' }, 404, h);
  },
};
