<script lang="ts">
import { onMount } from 'svelte'
import { WORKER } from '$lib/api'

const IMG_EXTS = new Set(['jpg','jpeg','png','gif','webp','avif','bmp','svg','tiff'])
const isImg = (n: string) => IMG_EXTS.has(n.split('.').pop()?.toLowerCase() || '')
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
const fmtSize = (b: number) => b < 1024 ? b + ' B' : b < 1048576 ? (b/1024).toFixed(1) + ' KB' : (b/1048576).toFixed(1) + ' MB'
const basename = (p: string) => p.split('/').pop() || p
const esc = (s: unknown) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')

let token = ''
let memo: any = null
let noteHtml = ''
let files: any[] = []
let loading = $state(true)
let error = $state('')

function fileUrl(key: string) {
  return WORKER + '/share/' + token + '/files/' + key.split('/').map(encodeURIComponent).join('/')
}

onMount(async () => {
  token = new URLSearchParams(location.search).get('token') || ''
  if (!token) { error = 'No share token in URL.'; loading = false; return }
  try {
    memo = await (await fetch(WORKER + '/share/' + token)).json()
    if (memo.error) { error = 'This link is invalid or has been revoked.'; loading = false; return }
    const [noteRes, filesRes] = await Promise.all([
      fetch(WORKER + '/share/' + token + '/note'),
      fetch(WORKER + '/share/' + token + '/files'),
    ])
    noteHtml = await noteRes.text()
    files = await filesRes.json()
  } catch { error = 'Failed to load memo.' }
  loading = false
})
</script>

<svelte:head>
  <title>{memo?.title || 'Shared Memo'}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
</svelte:head>

{#if loading}
  <div class="center">Loading…</div>
{:else if error}
  <div class="center error">{error}</div>
{:else}
<div class="page">
  <div class="memo-header">
    {#if memo.cover_file}
    <div class="cover" style="background-image:url('{fileUrl(memo.cover_file)}')"></div>
    {/if}
    <div class="header-body">
      <div class="shared-badge">Shared memo · read-only</div>
      <h1>{memo.title || 'Untitled'}</h1>
      {#if memo.description}<p class="desc">{memo.description}</p>{/if}
      <div class="meta">
        {#if memo.uid}<span>🏷 {memo.uid}</span>{/if}
        <span>📅 {fmtDate(memo.created_at)}</span>
        {#each JSON.parse(memo.tags || '[]') as tag}<span class="tag">{tag}</span>{/each}
      </div>
    </div>
  </div>

  {#if noteHtml}
  <div class="card">
    <div class="section-label">Notes</div>
    <div class="note-content">{@html noteHtml}</div>
  </div>
  {/if}

  {#if files.length}
  <div class="card">
    <div class="section-label">Files ({files.length})</div>
    <div class="file-list">
      {#each files.filter((f: any) => !f.key.startsWith('_')) as f}
      <div class="file-row">
        {#if isImg(f.key)}
        <img class="file-thumb" src={fileUrl(f.key)} loading="lazy" alt="" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}>
        {:else}
        <div class="file-icon">📄</div>
        {/if}
        <div class="file-info">
          <div class="file-name">{basename(f.key)}</div>
          <div class="file-meta">{fmtSize(f.size)} · {fmtDate(f.uploaded)}</div>
        </div>
        <a class="file-dl" href={fileUrl(f.key)} download={basename(f.key)}>↓</a>
      </div>
      {/each}
    </div>
  </div>
  {/if}

  <div class="footer">Shared with Memo</div>
</div>
{/if}

<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'DM Sans',sans-serif;background:#f5f5f4;color:#1c1917;min-height:100vh}
.center{display:flex;align-items:center;justify-content:center;min-height:100vh;font-size:1rem;color:#78716c}
.error{color:#ef4444}
.page{max-width:720px;margin:0 auto;padding:32px 20px 80px}
.memo-header{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);margin-bottom:20px}
.cover{height:180px;background-size:cover;background-position:center}
.header-body{padding:24px 28px}
.shared-badge{font-size:.7rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#78716c;margin-bottom:8px}
h1{font-size:1.6rem;font-weight:700;line-height:1.2;margin-bottom:8px}
.desc{font-size:.95rem;color:#57534e;margin-bottom:12px;line-height:1.5}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:.8rem;color:#78716c}
.tag{background:#ede9fe;color:#6366f1;padding:2px 8px;border-radius:10px;font-size:.75rem}
.card{background:#fff;border-radius:14px;padding:24px 28px;box-shadow:0 1px 4px rgba(0,0,0,.08);margin-bottom:16px}
.section-label{font-size:.7rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#78716c;margin-bottom:16px}
.note-content{font-size:.93rem;line-height:1.75}
.note-content :global(h2){font-size:1.3rem;font-weight:700;margin:14px 0 4px}
.note-content :global(h3){font-size:1.05rem;font-weight:600;margin:10px 0 3px}
.note-content :global(ul),.note-content :global(ol){padding-left:20px;margin:6px 0}
.note-content :global(hr){border:none;border-top:2px dashed #d4d4d4;margin:14px 0}
.note-content :global(input[type="checkbox"]){width:14px;height:14px;margin-right:4px;vertical-align:middle;accent-color:#6366f1}
.file-list{display:flex;flex-direction:column;gap:0}
.file-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #e7e5e4}
.file-row:last-child{border-bottom:none}
.file-thumb{width:40px;height:40px;border-radius:6px;object-fit:cover;flex-shrink:0}
.file-icon{width:40px;height:40px;display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0}
.file-info{flex:1;min-width:0}
.file-name{font-size:.85rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.file-meta{font-size:.72rem;color:#78716c;margin-top:2px}
.file-dl{padding:4px 10px;border:1px solid #e7e5e4;border-radius:6px;font-size:.78rem;color:#78716c;text-decoration:none;flex-shrink:0}
.file-dl:hover{border-color:#6366f1;color:#6366f1}
.footer{text-align:center;font-size:.75rem;color:#a8a29e;margin-top:32px}
</style>
