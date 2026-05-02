# Memo App

A personal memo and note-taking app with file attachments, rich text, and full-text search. Built on Cloudflare Workers, D1 (SQLite), and R2 (object storage). Frontend is static HTML served by Caddy.

Live at: `https://memo.1000600.xyz`

---

## Architecture

| Layer | Technology |
|---|---|
| Frontend | Static HTML/CSS/JS (no framework) |
| Backend | Cloudflare Worker (`worker.js`) |
| Database | Cloudflare D1 (SQLite + FTS5) |
| File storage | Cloudflare R2 |
| Web server | Caddy (Mac mini, serves static files) |

The frontend talks directly to the Worker API. All auth, file ops, and search go through the Worker.

---

## Features

### Home page
- **Grid and list view** toggle, persisted across sessions
- **Tag filter bar** with per-tag counts — tags are case-insensitive (stored lowercase)
- **Full-text search** across titles, descriptions, notes, tags, UID, file names, captions, and clip content
- **Timeline scrubber** on the right edge (grid view) — drag to jump by date
- **Duplicate memo** — copies all metadata and files to a new memo
- **Trash bin** — soft delete, restore, permanent delete, empty trash

### Memo detail page
- **Rich-text notes** — bold, italic, underline, strikethrough, highlight, colour, font size, heading styles, bullet/numbered lists
- **Clips** — paste large blocks of text into titled collapsible cards stored separately from the note; exportable as individual `.md` files (downloads as a `.zip`)
- **File browser** — upload, folders (single-level), drag-and-drop to move, image gallery with lightbox
- **File metadata** — per-file captions and tags; shown inline in list view
- **Soft-delete files** — trash per memo with restore/permanent delete
- **Cover image** — set any uploaded image as the memo cover
- **QR label** — generates a printable label with QR code, memo ID, and UID
- **Memo info** — UID, tags (auto-saved), links, cover image, created date (editable)

### Search
FTS5 full-text search across: `memo_id`, `uid`, `title`, `description`, `tags`, and a `search_text` column that is a denormalised blob of note content + file names + file captions + file tags + clip titles + clip content. Updated automatically on every save.

---

## Data Model

### D1 — `memos` table

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID |
| `memo_id` | TEXT UNIQUE | `YYYYMMDD-XXXXXXX` format |
| `uid` | TEXT | Optional human identifier e.g. `STOR-001` |
| `title` | TEXT | |
| `description` | TEXT | |
| `cover_file` | TEXT | R2 key relative to memo prefix |
| `tags` | TEXT | JSON array, lowercase |
| `pinned` | INTEGER | 0 or 1 |
| `links` | TEXT | JSON array of `{label, url}` |
| `search_text` | TEXT | Denormalised FTS blob |
| `created_at` | TEXT | ISO 8601 |
| `updated_at` | TEXT | ISO 8601 |
| `deleted_at` | TEXT | Soft delete — NULL when active |

### R2 — keys per memo (prefix `memo-{uuid}/`)

| Key | Content |
|---|---|
| `filename` or `folder/filename` | Uploaded file |
| `_note` | Rich-text HTML note |
| `_meta` | JSON: `{ files: {key: {caption, tags}}, folders: [], trash: [...] }` |
| `_snippets` | JSON array of clips: `[{id, title, content, created_at}]` |
| `_trash/filename` | Soft-deleted files |

---

## Deployment

### Worker

```sh
sh deploy.sh
```

> Deploys from a temp directory to prevent wrangler detecting `index.html` and switching to static-assets mode (which disables D1/R2 bindings).

### Frontend (Mac mini)

```sh
sudo cp index.html /opt/homebrew/var/www/memo/index.html
sudo cp memo/index.html /opt/homebrew/var/www/memo/memo/index.html
sudo cp favicon.svg /opt/homebrew/var/www/memo/favicon.svg
```

After any frontend change, do a **hard refresh** in the browser (Cmd+Shift+R) — Caddy caches aggressively.

### Database schema

Apply to D1 once on initial setup:

```sh
wrangler d1 execute memo-db --file=schema.sql
```

After deploying a new worker with schema changes, click **⟳ Reindex** on the home page to rebuild the FTS5 search index.

---

## Auth

A single passphrase protects all routes. Set it as a secret in the Cloudflare dashboard:

**Workers & Pages → memo-worker → Settings → Variables and Secrets → `MEMO_AUTH_TOKEN`**

> Do not use `wrangler secret put` — it had an interactive prompt issue in this setup.

The token is appended as `?t={token}` on every API request and stored in `localStorage` on the frontend.

---

## Cloudflare Resources

| Resource | Name | ID |
|---|---|---|
| Worker | `memo-worker` | — |
| D1 database | `memo-db` | `2554e206-c3d9-45a9-a5b6-96e06e428e1d` |
| R2 bucket | `memo-files` | — |

> GitHub integration is **disconnected** from the Cloudflare dashboard to prevent auto-deploys overwriting the worker.
