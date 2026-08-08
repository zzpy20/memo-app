Language: **English** | [简体中文](README.zh-CN.md)

# Memo App

A personal memo and note-taking app with file attachments, rich text, clips, and full-text search. Built entirely on Cloudflare — SvelteKit + Workers + D1 (SQLite) + R2 (object storage) + Pages.

Live at: `https://memo.1000600.xyz`

---

## Architecture

| Layer | Technology |
|---|---|
| Frontend | SvelteKit 2 + Svelte 5 (runes), hosted on Cloudflare Pages |
| Backend | Cloudflare Worker, TypeScript + [Hono](https://hono.dev) 4 (`worker.ts`) |
| ORM | [Drizzle ORM](https://orm.drizzle.team) for D1 CRUD; raw SQL only where Drizzle can't help (FTS5 virtual table, `settings` upsert) |
| Database | Cloudflare D1 (SQLite + FTS5) |
| File storage | Cloudflare R2 |

The frontend talks directly to the Worker API (`https://memo-worker.ausz.workers.dev`), authenticated on every request via a `?t=` query token. The Worker and the frontend are deployed **independently** — see [Deployment](#deployment).

---

## Features

### Home page
- **Grid and list view** toggle, persisted across sessions
- **Tag filter bar** with per-tag counts — tags are case-insensitive (stored lowercase)
- **Full-text search** across titles, descriptions, notes, tags, UID, file names, captions, and clip content (FTS5)
- **Timeline scrubber** on the right edge (grid view) — drag to jump by date
- **Sort**: Newest / Oldest / Recently updated; pinned memos always sort first
- **Duplicate memo** — copies all metadata and files to a new memo
- **Trash bin** — soft delete, restore, permanent delete (purges R2 objects too), empty trash
- **Storage usage indicator** — total R2 usage vs. a display-only 10 GB label (not an enforced limit)
- **⟳ Reindex** — rebuilds the FTS5 search index after a schema change
- **iOS Shortcuts Setup** — a built-in guide with your Worker URL, token, and memo IDs for wiring up the Shortcuts app (see [iOS Shortcuts quick-capture](#ios-shortcuts-quick-capture))

### Memo detail page — Notes
Rich-text note editor (`contenteditable`, `document.execCommand`-driven), autosaves 2s after typing stops or on blur (⌘S also saves explicitly). Toolbar:
- Text style (Heading / Subheading / Body), Bold, Italic, Underline, Strikethrough
- Font size +/−, text colour picker, highlight colour (4 presets + remove)
- **Menlo monospace font** dropdown (11px / 12px / Default) — wraps the current selection in Menlo, useful when pasted terminal/code text arrives without its original formatting
- Bullet/numbered lists, page break, indent/outdent, checkbox tasks, Clear
- Pasted images are inlined as base64 `data:` images directly in the note

### Memo detail page — Clips
A lightweight capture panel, separate from the main note, stored in R2 as its own `_snippets` JSON array. Click **📋 Clip**, paste content, give it a title:
- **Auto-saves** 1200ms after you stop typing/pasting, or immediately on blur or image paste — no need to remember to click Save
- **Save clip** still exists as an explicit "flush and close" action; **Cancel** discards the in-progress draft
- Accepts pasted images (inlined as base64, same as Notes)
- Has its own **Menlo monospace font** toolbar (11px / 12px / Default)
- Renders as a list of collapsible cards with expand/collapse-all, inline rename, delete, and "copy as plain text"
- **Export clips as .md** — downloads every clip as an individual Markdown file in a `.zip`
- Can also be created remotely via the [iOS Shortcuts quick-capture](#ios-shortcuts-quick-capture) endpoint

> **Note on paste fidelity**: neither Notes nor Clips ever sanitize pasted content — whatever HTML the OS clipboard provides is kept as-is. Whether fonts/colours/tables survive a paste depends entirely on the source app (e.g. Warp renders AI output as real HTML and preserves everything; Terminal.app and Claude Code sessions in most terminals only put plain text on the clipboard). The Menlo font tool above is a manual fallback for when a paste arrives unstyled.

### Memo detail page — Files
- Drag-and-drop, click-to-browse, or **upload folder** (bulk `webkitdirectory` upload)
- Virtual folders (key prefixes) — create, rename, remove; drag files between folders
- Grid/list view, sortable by name/type/date/size
- **Lightbox** for images/video/audio/PDF with keyboard navigation
- Per-file **captions and tags** (feed into full-text search)
- Soft-delete per file (trash → restore or permanent delete)
- **Multi-select bulk actions**: tag, move, delete, download (as a zip)
- Upload progress bar with cancel; **100 MB per-file limit**, enforced client-side only (Cloudflare Free plan R2 cap)

### Memo detail page — Memo Info & other tools
- UID, tags (autocomplete from all existing tags), links (label + URL), created date, cover image selector — all autosaved
- **Cover image** auto-set from the first uploaded image if none is set
- **QR label** — printable label with a QR code (via `api.qrserver.com`), memo ID, and UID
- **Export note as standalone HTML** — a self-contained, styled HTML document with title/description/links/clips/files
- **Email note to myself** — sends the note via [Resend](https://resend.com), with the full HTML export attached
- **Add to Google Calendar** — deep-links to `calendar.google.com` with the memo's title/note prefilled; supports separate "Call" and "SMS" calendar IDs, remembered via the `settings` table

### Share page
Public, unauthenticated read-only view at `/share?token={share_token}` (generate/revoke the link from the memo detail page). Shows cover, title/description/tags, the note, clips (read-only, collapsible), and files (with its own lightbox and download links).

### Dark mode
Toggled via a floating button, persisted in `localStorage`. Fully CSS-custom-property driven.

### iOS Shortcuts quick-capture
Two auth-gated Worker endpoints let a Shortcuts.app automation push content straight into a memo:
- `POST /quick-capture` — JSON body, `type: "text"` creates a new clip, `type: "image"|"file"` uploads a base64-encoded file
- `POST /quick-capture-file` — raw binary body upload (no base64 overhead), for the iOS Share Sheet

---

## Data Model

### D1 — `memos` table (current runtime shape, `src/db/schema.ts`)

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
| `share_token` | TEXT | Nullable — set when a public share link is generated |
| `deleted_at` | TEXT | Soft delete — NULL when active |
| `created_at` | TEXT | ISO 8601 |
| `updated_at` | TEXT | ISO 8601 |

### D1 — `settings` table

| Column | Type | Notes |
|---|---|---|
| `key` | TEXT PK | e.g. `gcal_call_id`, `gcal_sms_id` |
| `value` | TEXT | |

Plus a `memos_fts` FTS5 virtual table with sync triggers, managed via raw SQL (see `schema.sql` and `POST /search/rebuild`).

> ⚠️ `schema.sql` (root) and `drizzle/0000_lethal_colonel_america.sql` are both **behind** `src/db/schema.ts` — `share_token` and the `settings` table exist in the live database and in `schema.ts` but were never captured in a generated Drizzle migration. Treat `src/db/schema.ts` as the source of truth; don't bootstrap a fresh D1 database from `schema.sql` alone without also applying the missing columns/table by hand.

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

This app has **two independently deployed parts** — don't conflate them.

### Frontend (Cloudflare Pages)

Push to `main` — GitHub Actions (`.github/workflows/deploy-pages.yml`) automatically builds and deploys.

- Triggers on changes to `src/**`, `static/**`, `svelte.config.js`, `vite.config.ts`, `package.json`, `package-lock.json`
- Runs `npm ci && npm run build`, then `wrangler pages deploy .svelte-kit/cloudflare --project-name=memo-frontend`

Required GitHub secrets:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | API token with Cloudflare Pages edit permission |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |

### Worker

There is **no CI workflow for the Worker** — deploy it manually:

```sh
sh deploy.sh
```

This bundles `worker.ts` with esbuild, copies the bundle plus `wrangler.toml` into a temp directory, and runs `wrangler deploy` from there.

> **Never run `wrangler deploy` directly from the repo root.** `wrangler.jsonc` (auto-generated by `@sveltejs/adapter-cloudflare` for the Pages build) has no D1/R2 bindings — if wrangler picks it up instead of `wrangler.toml`, it deploys a broken worker with no database access. `deploy.sh` exists specifically to avoid this.

### Database schema

Apply to D1 once on initial setup:

```sh
wrangler d1 execute memo-db --file=schema.sql
```

Then apply the `share_token` column and `settings` table by hand (see the data-model warning above) — `schema.sql` alone is not sufficient for a from-scratch setup.

After deploying a worker with schema changes, click **⟳ Reindex** on the home page to rebuild the FTS5 search index.

---

## Auth

A single shared passphrase protects all routes except `/share/*`. Set it as a Worker secret in the Cloudflare dashboard:

**Workers & Pages → memo-worker → Settings → Variables and Secrets → `MEMO_AUTH_TOKEN`**

The token is appended as `?t={token}` on every API request and stored in `localStorage` on the frontend. A `401` response anywhere clears the stored token and re-prompts.

Email (`OWNER_EMAIL`, `RESEND_API_KEY`, `RESEND_FROM`) is configured the same way — as Worker secrets, not through any settings UI. There is no dedicated Settings page; the `settings` D1 table is currently only used for the two Google Calendar IDs.

---

## Cloudflare Resources

| Resource | Name | ID |
|---|---|---|
| Worker | `memo-worker` | — |
| Worker URL | `memo-worker.ausz.workers.dev` | — |
| Pages project | `memo-frontend` | — |
| D1 database | `memo-db` | `2554e206-c3d9-45a9-a5b6-96e06e428e1d` |
| R2 bucket | `memo-files` | — |

---

## Known gaps

- The 100 MB upload limit is enforced client-side only; there's no server-side size check in `worker.ts`.
- The 10 GB storage figure shown on the home page is a display label, not an enforced quota.
