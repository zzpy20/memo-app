<script lang="ts">
import { onMount } from 'svelte'
import { WORKER } from '$lib/api'

const IMG_EXTS  = new Set(['jpg','jpeg','png','gif','webp','avif','bmp','svg','tiff'])
const VIDEO_EXTS = new Set(['mp4','mov','webm','avi','mkv','m4v'])
const AUDIO_EXTS = new Set(['mp3','m4a','wav','ogg','flac','aac','opus','wma'])
const ext    = (n: string) => (n.split('.').pop() || '').toLowerCase()
const isImg  = (n: string) => IMG_EXTS.has(ext(n))
const isVideo = (n: string) => VIDEO_EXTS.has(ext(n))
const isAudio = (n: string) => AUDIO_EXTS.has(ext(n))
const isPdf  = (n: string) => ext(n) === 'pdf'
const isPreviewable = (n: string) => isImg(n) || isVideo(n) || isAudio(n) || isPdf(n)
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
const fmtSize = (b: number) => b < 1024 ? b + ' B' : b < 1048576 ? (b/1024).toFixed(1) + ' KB' : (b/1048576).toFixed(1) + ' MB'
const basename = (p: string) => p.split('/').pop() || p

let token = ''
let memo: any = null
let noteHtml = ''
let files: any[] = []
let snippets: any[] = []
let expanded = $state<Record<number, boolean>>({})
let allExpanded = $state(false)
let loading = $state(true)
let error = $state('')

function toggleClip(i: number) { expanded = { ...expanded, [i]: !expanded[i] } }
function toggleAll() {
  allExpanded = !allExpanded
  const next: Record<number, boolean> = {}
  snippets.forEach((_, i) => { next[i] = allExpanded })
  expanded = next
}

// lightbox
let lbOpen = $state(false)
let lbIdx = $state(0)
let lbFiles: any[] = []

function fileUrl(key: string) {
  return WORKER + '/share/' + token + '/files/' + key.split('/').map(encodeURIComponent).join('/')
}

function openLightbox(key: string) {
  lbFiles = files.filter(f => isPreviewable(f.key) && !f.key.startsWith('_'))
  lbIdx = lbFiles.findIndex(f => f.key === key)
  if (lbIdx === -1) lbIdx = 0
  lbOpen = true
  document.body.style.overflow = 'hidden'
}

function closeLightbox() {
  const media = document.querySelector('#lb-content video, #lb-content audio') as HTMLMediaElement | null
  if (media) { media.pause(); media.src = '' }
  lbOpen = false
  document.body.style.overflow = ''
}

function lbNav(dir: number) {
  const media = document.querySelector('#lb-content video, #lb-content audio') as HTMLMediaElement | null
  if (media) { media.pause(); media.src = '' }
  lbIdx = (lbIdx + dir + lbFiles.length) % lbFiles.length
}

$effect(() => {
  if (!lbOpen) return
  const f = lbFiles[lbIdx]
  if (!f) return
  const c = document.getElementById('lb-content')
  if (!c) return
  const url = fileUrl(f.key)
  if (isVideo(f.key))       c.innerHTML = `<video src="${url}" controls autoplay playsinline style="max-width:90vw;max-height:85vh;border-radius:4px;display:block;background:#000"></video>`
  else if (isAudio(f.key))  c.innerHTML = `<audio src="${url}" controls autoplay style="width:min(400px,80vw);display:block;margin:auto;outline:none"></audio>`
  else if (isPdf(f.key))    c.innerHTML = `<iframe src="${url}" style="width:80vw;height:85vh;border:none;border-radius:4px;background:#fff;display:block"></iframe>`
  else                      c.innerHTML = `<img src="${url}" alt="${basename(f.key)}" style="max-width:90vw;max-height:85vh;object-fit:contain;border-radius:4px;display:block">`
})

onMount(async () => {
  token = new URLSearchParams(location.search).get('token') || ''
  if (!token) { error = 'No share token in URL.'; loading = false; return }
  try {
    memo = await (await fetch(WORKER + '/share/' + token)).json()
    if (memo.error) { error = 'This link is invalid or has been revoked.'; loading = false; return }
    const [noteRes, filesRes, snippetsRes] = await Promise.all([
      fetch(WORKER + '/share/' + token + '/note'),
      fetch(WORKER + '/share/' + token + '/files'),
      fetch(WORKER + '/share/' + token + '/snippets'),
    ])
    noteHtml = await noteRes.text()
    files = await filesRes.json()
    snippets = await snippetsRes.json().catch(() => [])
  } catch { error = 'Failed to load memo.' }
  loading = false

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!lbOpen) return
    if (e.key === 'Escape') closeLightbox()
    if (e.key === 'ArrowLeft')  { e.preventDefault(); lbNav(-1) }
    if (e.key === 'ArrowRight') { e.preventDefault(); lbNav(1) }
  })
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

  {#if snippets.length}
  <div class="card">
    <div class="section-hdr">
      <div class="section-label">Clips ({snippets.length})</div>
      <button class="expand-all-btn" onclick={toggleAll}>{allExpanded ? 'Collapse all' : 'Expand all'}</button>
    </div>
    {#each snippets as s, i}
    <div class="clip">
      <button class="clip-hdr" onclick={() => toggleClip(i)}>
        <span class="clip-icon">📋</span>
        <span class="clip-title">{s.title || 'Untitled clip'}</span>
        <span class="clip-chev">{expanded[i] ? '▾' : '▸'}</span>
      </button>
      {#if expanded[i]}
      <div class="clip-body">{@html s.content || ''}</div>
      {/if}
    </div>
    {/each}
  </div>
  {/if}

  {#if files.length}
  <div class="card">
    <div class="section-label">Files ({files.filter(f => !f.key.startsWith('_')).length})</div>
    <div class="file-list">
      {#each files.filter((f: any) => !f.key.startsWith('_')) as f}
      <div class="file-row">
        {#if isImg(f.key)}
          <img class="file-thumb clickable" src={fileUrl(f.key)} loading="lazy" alt=""
            onclick={() => openLightbox(f.key)}
            onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}>
        {:else if isVideo(f.key)}
          <div class="file-thumb media-thumb clickable" onclick={() => openLightbox(f.key)}>▶</div>
        {:else if isAudio(f.key)}
          <div class="file-thumb media-thumb clickable" onclick={() => openLightbox(f.key)}>♪</div>
        {:else if isPdf(f.key)}
          <div class="file-thumb media-thumb clickable" onclick={() => openLightbox(f.key)}>PDF</div>
        {:else}
          <div class="file-icon">📄</div>
        {/if}
        <div class="file-info">
          <div class="file-name">{basename(f.key)}</div>
          <div class="file-meta">{fmtSize(f.size)} · {fmtDate(f.uploaded)}</div>
        </div>
        {#if isPreviewable(f.key)}
          <button class="file-view" onclick={() => openLightbox(f.key)}>View</button>
        {/if}
        <a class="file-dl" href={fileUrl(f.key)} download={basename(f.key)}>↓</a>
      </div>
      {/each}
    </div>
  </div>
  {/if}

  <div class="footer">Shared with Memo</div>
</div>
{/if}

<!-- Lightbox -->
{#if lbOpen}
<div class="lb-overlay" onclick={closeLightbox}></div>
<div class="lb-wrap">
  <button class="lb-close" onclick={closeLightbox}>✕</button>
  {#if lbFiles.length > 1}
    <button class="lb-prev" onclick={(e) => { e.stopPropagation(); lbNav(-1) }}>‹</button>
    <button class="lb-next" onclick={(e) => { e.stopPropagation(); lbNav(1) }}>›</button>
  {/if}
  <div id="lb-content" onclick={(e) => e.stopPropagation()}></div>
  <div class="lb-caption">{basename(lbFiles[lbIdx]?.key || '')}</div>
  {#if lbFiles.length > 1}
    <div class="lb-counter">{lbIdx + 1} / {lbFiles.length}</div>
  {/if}
</div>
{/if}

<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'DM Sans',sans-serif;background:#f5f5f4;color:#1c1917;min-height:100vh}
.center{display:flex;align-items:center;justify-content:center;min-height:100vh;font-size:1rem;color:#78716c}
.error{color:#ef4444}
.page{max-width:1000px;margin:0 auto;padding:32px 20px 80px}
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
.file-list{display:flex;flex-direction:column}
.file-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #e7e5e4}
.file-row:last-child{border-bottom:none}
.file-thumb{width:40px;height:40px;border-radius:6px;object-fit:cover;flex-shrink:0}
.file-thumb.clickable{cursor:pointer;transition:opacity .15s}
.file-thumb.clickable:hover{opacity:.8}
.media-thumb{background:#f0f0f0;display:flex;align-items:center;justify-content:center;font-size:.85rem;font-weight:600;color:#78716c;border-radius:6px}
.file-icon{width:40px;height:40px;display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0}
.file-info{flex:1;min-width:0}
.file-name{font-size:.85rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.file-meta{font-size:.72rem;color:#78716c;margin-top:2px}
.file-view{padding:4px 10px;border:1px solid #e7e5e4;border-radius:6px;font-size:.78rem;color:#78716c;background:none;cursor:pointer;font-family:inherit;flex-shrink:0}
.file-view:hover{border-color:#6366f1;color:#6366f1}
.file-dl{padding:4px 10px;border:1px solid #e7e5e4;border-radius:6px;font-size:.78rem;color:#78716c;text-decoration:none;flex-shrink:0}
.file-dl:hover{border-color:#6366f1;color:#6366f1}
.section-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.section-hdr .section-label{margin-bottom:0}
.expand-all-btn{background:none;border:1px solid #e7e5e4;border-radius:6px;padding:3px 10px;font-size:.75rem;color:#78716c;cursor:pointer;font-family:inherit}
.expand-all-btn:hover{border-color:#6366f1;color:#6366f1}
.clip{border-bottom:1px solid #f0eeec}
.clip:last-child{border-bottom:none}
.clip-hdr{width:100%;display:flex;align-items:center;gap:8px;background:none;border:none;padding:10px 0;cursor:pointer;text-align:left;font-family:inherit}
.clip-hdr:hover .clip-title{color:#6366f1}
.clip-icon{font-size:1rem;flex-shrink:0}
.clip-title{flex:1;font-size:.88rem;font-weight:500;color:#1c1917;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.clip-chev{color:#78716c;font-size:.75rem;flex-shrink:0}
.clip-body{padding:4px 0 12px 28px;font-size:.85rem;line-height:1.65;color:#44403c;white-space:pre-wrap;word-break:break-word}
.footer{text-align:center;font-size:.75rem;color:#a8a29e;margin-top:32px}

/* Lightbox */
.lb-overlay{position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:1000}
.lb-wrap{position:fixed;inset:0;z-index:1001;display:flex;align-items:center;justify-content:center;pointer-events:none}
.lb-wrap>*{pointer-events:auto}
#lb-content{display:flex;align-items:center;justify-content:center}
.lb-close{position:fixed;top:16px;right:20px;background:none;border:none;color:#fff;font-size:1.6rem;cursor:pointer;opacity:.7;z-index:1002}
.lb-close:hover{opacity:1}
.lb-prev,.lb-next{position:fixed;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.12);border:none;color:#fff;font-size:2rem;cursor:pointer;padding:12px 16px;border-radius:8px;line-height:1}
.lb-prev{left:16px}.lb-next{right:16px}
.lb-prev:hover,.lb-next:hover{background:rgba(255,255,255,.22)}
.lb-caption{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,.75);font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:80vw}
.lb-counter{position:fixed;top:16px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,.55);font-size:.78rem}
</style>
