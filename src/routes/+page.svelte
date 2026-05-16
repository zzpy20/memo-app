<script lang="ts">
  import { onMount } from 'svelte'
  import { api, tokenStore, logout, safeJson, fmtDate, fmtDateTime, fileUrl } from '$lib/api'

  interface Memo {
    id: string
    memo_id: string
    title: string
    description: string
    tags: string | string[]
    links: string | unknown[]
    uid: string
    pinned: number
    cover_file: string
    created_at: string
    updated_at: string
  }

  interface Tag {
    tag: string
    count: number
  }

  let allMemos = $state<Memo[]>([])
  let displayedMemos = $state<Memo[]>([])
  let tags = $state<Tag[]>([])
  let totalMemoCount = $state(0)
  let currentTag = $state('')
  let viewMode = $state(typeof localStorage !== 'undefined' ? (localStorage.getItem('memo_view') || 'grid') : 'grid')
  let currentSort = $state(typeof localStorage !== 'undefined' ? (localStorage.getItem('memo_sort') || 'newest') : 'newest')
  let inTrash = $state(false)
  let searchQuery = $state('')
  let searchTimer: ReturnType<typeof setTimeout>
  let trashCount = $state(0)
  let trashBarLabel = $state('Trashed memos')
  let timelineVisible = $state(false)
  let tlThumbTop = $state('14px')
  let tlDragging = false
  let tlTooltipText = $state('')
  let tlTooltipTop = $state('0px')
  let tlTooltipVisible = $state(false)
  let rebuildLabel = $state('⟳ Reindex')
  let rebuildDisabled = $state(false)
  let storageText = $state('')

  onMount(() => {
    loadTags()
    loadMemos()
    updateTrashCount()
    api('/storage').then((r: Response) => r.json()).then((d: any) => {
      const gb = d.bytes / 1024 / 1024 / 1024
      storageText = gb < 0.01 ? `${Math.round(d.bytes / 1024 / 1024)} MB` : `${gb.toFixed(2)} GB`
      storageText += ' / 10 GB'
    }).catch(() => {})

    const scrollHandler = () => updateThumb()
    window.addEventListener('scroll', scrollHandler, { passive: true })
    const mouseupHandler = () => { tlDragging = false; tlTooltipVisible = false }
    document.addEventListener('mouseup', mouseupHandler)
    return () => {
      window.removeEventListener('scroll', scrollHandler)
      document.removeEventListener('mouseup', mouseupHandler)
    }
  })

  $effect(() => {
    if ($tokenStore === '') {
      // token cleared externally — layout will show auth overlay
    }
  })

  async function loadTags() {
    try {
      const data: Tag[] = await (await api('/tags')).json()
      tags = data
      totalMemoCount = data.reduce((s, t) => s + t.count, 0)
    } catch {}
  }

  async function loadMemos(tag?: string) {
    const t = tag ?? currentTag
    try {
      let path = t ? '/memos?tag=' + encodeURIComponent(t) : '/memos'
      path += (path.includes('?') ? '&' : '?') + 'sort=' + currentSort
      const memos: Memo[] = await (await api(path)).json()
      allMemos = memos
      displayedMemos = memos
      if (viewMode === 'grid') buildTimeline()
    } catch {}
  }

  async function updateTrashCount() {
    try {
      const memos: Memo[] = await (await api('/memos?trash=1')).json()
      trashCount = memos.length
    } catch {}
  }

  async function loadTrash() {
    try {
      const memos: Memo[] = await (await api('/memos?trash=1')).json()
      trashBarLabel = memos.length
        ? `${memos.length} trashed memo${memos.length !== 1 ? 's' : ''}`
        : 'Trash is empty'
      displayedMemos = memos
    } catch {}
  }

  function setSort(val: string) {
    currentSort = val
    localStorage.setItem('memo_sort', val)
    loadMemos()
  }

  function setViewMode(mode: string) {
    viewMode = mode
    localStorage.setItem('memo_view', mode)
    if (mode === 'list') timelineVisible = false
    else if (displayedMemos.length && !inTrash) buildTimeline()
  }

  function filterTag(tag: string) {
    currentTag = tag
    searchQuery = ''
    loadMemos(tag)
  }

  function onSearch(q: string) {
    clearTimeout(searchTimer)
    const trimmed = q.trim()
    if (!trimmed) { displayedMemos = allMemos; return }
    searchTimer = setTimeout(async () => {
      try {
        displayedMemos = await (await api('/search?q=' + encodeURIComponent(trimmed))).json()
        timelineVisible = false
      } catch {}
    }, 300)
  }

  async function newMemo() {
    try {
      const r = await api('/memos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const { id } = await r.json()
      window.location.href = '/memo/?id=' + id
    } catch {}
  }

  async function togglePin(e: Event, id: string, pinned: number) {
    e.stopPropagation()
    const m = allMemos.find(x => x.id === id)
    if (!m) return
    try {
      await api('/memos/' + id, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: m.title, description: m.description, uid: m.uid, cover_file: m.cover_file,
          tags: safeJson(m.tags, [] as string[]), links: safeJson(m.links, [] as unknown[]),
          pinned: pinned ? 0 : 1
        })
      })
      loadMemos()
    } catch {}
  }

  async function deleteMemo(e: Event, id: string) {
    e.stopPropagation()
    try { await api('/memos/' + id, { method: 'DELETE' }); loadMemos(); updateTrashCount() } catch {}
  }

  async function duplicateMemo(e: Event, id: string) {
    e.stopPropagation()
    try {
      const r = await (await api('/memos/' + id + '/duplicate', { method: 'POST' })).json()
      await loadMemos()
      window.location.href = '/memo/?id=' + r.id
    } catch {}
  }

  function toggleTrash() {
    inTrash = !inTrash
    searchQuery = ''
    if (inTrash) {
      timelineVisible = false
      loadTrash()
    } else {
      loadMemos()
    }
  }

  async function restoreMemo(e: Event, id: string) {
    e.stopPropagation()
    try { await api('/memos/' + id + '/untrash', { method: 'POST' }); loadTrash(); updateTrashCount() } catch {}
  }

  async function permanentDelete(e: Event, id: string) {
    e.stopPropagation()
    if (!confirm('Permanently delete this memo and all its files? This cannot be undone.')) return
    try { await api('/memos/' + id + '?permanent=1', { method: 'DELETE' }); loadTrash(); updateTrashCount() } catch {}
  }

  async function restoreAll() {
    try {
      const memos: Memo[] = await (await api('/memos?trash=1')).json()
      await Promise.all(memos.map(m => api('/memos/' + m.id + '/untrash', { method: 'POST' })))
      loadTrash(); updateTrashCount()
    } catch {}
  }

  async function emptyTrash() {
    if (!confirm('Permanently delete all trashed memos and their files? This cannot be undone.')) return
    try {
      const memos: Memo[] = await (await api('/memos?trash=1')).json()
      await Promise.all(memos.map(m => api('/memos/' + m.id + '?permanent=1', { method: 'DELETE' })))
      loadTrash(); updateTrashCount(); loadTags()
    } catch {}
  }

  async function rebuildIndex() {
    rebuildLabel = '…'; rebuildDisabled = true
    try {
      await api('/search/rebuild', { method: 'POST' })
      rebuildLabel = '✓'
      setTimeout(() => { rebuildLabel = '⟳ Reindex'; rebuildDisabled = false }, 2000)
    } catch {
      rebuildLabel = '⟳ Reindex'; rebuildDisabled = false
      alert('Rebuild failed — check console.')
    }
  }

  // ── Timeline ────────────────────────────────────────────────────────────────
  function buildTimeline() {
    setTimeout(() => {
      const cards = [...document.querySelectorAll<HTMLElement>('.memo-card[data-date]')]
      if (!cards.length) { timelineVisible = false; return }

      const docH = document.documentElement.scrollHeight
      const entries = cards.map(c => ({
        date: new Date(c.dataset.date!),
        top: c.getBoundingClientRect().top + window.scrollY,
      }))

      const yearMap = new Map<number, number>()
      entries.forEach(({ date, top }) => {
        const y = date.getFullYear()
        if (!yearMap.has(y)) yearMap.set(y, top)
      })

      const labelsEl = document.getElementById('tl-labels')
      if (!labelsEl) return
      labelsEl.innerHTML = ''
      yearMap.forEach((top, year) => {
        const pct = Math.min(96, Math.max(4, (top / docH) * 100))
        const el = document.createElement('div')
        el.className = 'tl-year'
        el.style.top = pct + '%'
        el.textContent = String(year)
        labelsEl.appendChild(el)
      })

      timelineVisible = true
      updateThumb()
    }, 150)
  }

  function updateThumb() {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight
    if (maxScroll <= 0) { tlThumbTop = '14px'; return }
    const pct = Math.min(1, window.scrollY / maxScroll)
    const tl = document.getElementById('timeline')
    if (!tl) return
    tlThumbTop = (14 + pct * (tl.offsetHeight - 28)) + 'px'
  }

  function tlDateAtPct(pct: number) {
    const cards = [...document.querySelectorAll<HTMLElement>('.memo-card[data-date]')]
    if (!cards.length) return null
    const docH = document.documentElement.scrollHeight
    const targetTop = pct * docH
    let best = cards[0], bestDist = Infinity
    cards.forEach(c => {
      const dist = Math.abs(c.getBoundingClientRect().top + window.scrollY - targetTop)
      if (dist < bestDist) { bestDist = dist; best = c }
    })
    return new Date(best.dataset.date!)
  }

  function tlScrollToPct(pct: number) {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight
    window.scrollTo({ top: pct * maxScroll, behavior: 'auto' })
  }

  function tlPctFromEvent(e: MouseEvent) {
    const tl = document.getElementById('timeline')!
    const rect = tl.getBoundingClientRect()
    return rect.height ? Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)) : 0
  }

  function tlShowTooltip(e: MouseEvent, pct: number) {
    const date = tlDateAtPct(pct)
    if (!date) return
    tlTooltipText = date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    tlTooltipTop = (e.clientY - 10) + 'px'
    tlTooltipVisible = true
  }

  function tlMousedown(e: MouseEvent) {
    tlDragging = true
    const pct = tlPctFromEvent(e)
    tlScrollToPct(pct)
    tlShowTooltip(e, pct)
    e.preventDefault()
  }

  function tlMousemove(e: MouseEvent) {
    const pct = tlPctFromEvent(e)
    tlShowTooltip(e, pct)
    if (tlDragging) tlScrollToPct(pct)
  }
</script>

<header>
  <div class="logo">Memo</div>
  <div class="search-wrap">
    <input
      type="search"
      placeholder="Search memos…"
      bind:value={searchQuery}
      oninput={(e) => onSearch((e.target as HTMLInputElement).value)}
    >
  </div>
  <button id="rebuild-btn" class="rebuild-btn" title="Rebuild search index" onclick={rebuildIndex} disabled={rebuildDisabled}>{rebuildLabel}</button>
  <select class="sort-select" value={currentSort} onchange={(e) => setSort((e.target as HTMLSelectElement).value)}>
    <option value="newest">Newest</option>
    <option value="oldest">Oldest</option>
    <option value="updated">Recently updated</option>
  </select>
  <div class="view-btns">
    <button class="view-btn" class:active={viewMode === 'grid'} title="Grid view" onclick={() => setViewMode('grid')}>⊞</button>
    <button class="view-btn" class:active={viewMode === 'list'} title="List view" onclick={() => setViewMode('list')}>☰</button>
  </div>
  <button class="trash-btn" class:active={inTrash} title="Trash" onclick={toggleTrash}>
    🗑 {#if trashCount}<span class="trash-count">{trashCount}</span>{/if}
  </button>
  {#if !inTrash}<button class="new-btn" onclick={newMemo}>+ New Memo</button>{/if}
  {#if storageText}<span class="storage-label">{storageText}</span>{/if}
  <button class="signout-btn" onclick={logout}>Sign out</button>
</header>

{#if inTrash}
<div class="trash-bar">
  <span class="trash-bar-label">{trashBarLabel}</span>
  <button onclick={restoreAll}>↩ Restore all</button>
  <button class="empty-btn" onclick={emptyTrash}>Empty trash</button>
  <button onclick={toggleTrash}>← Back</button>
</div>
{:else}
<div class="tag-bar">
  <button class="tag-pill" class:active={currentTag === ''} onclick={() => filterTag('')}>
    All <span class="tag-count">{totalMemoCount}</span>
  </button>
  {#each tags as t (t.tag)}
    <button class="tag-pill" class:active={currentTag === t.tag} onclick={() => filterTag(t.tag)}>
      {t.tag} <span class="tag-count">{t.count}</span>
    </button>
  {/each}
</div>
{/if}

<main id="grid" class:view-list={viewMode === 'list'}>
  {#if displayedMemos.length === 0}
    <div class="empty">
      <h2>{inTrash ? 'Trash is empty' : 'No memos yet'}</h2>
      {#if !inTrash}<p>Click "+ New Memo" to get started.</p>{/if}
    </div>
  {:else if viewMode === 'list'}
    <div class="list-container">
      {#each displayedMemos as m (m.id)}
        {@const tags = safeJson(m.tags, [] as string[])}
        {@const cover = m.cover_file ? fileUrl(m.id, m.cover_file) : ''}
        {@const sub = [m.memo_id, m.description].filter(Boolean).join(' · ')}
        <div class="list-row" data-date={m.created_at} onclick={!inTrash ? () => window.location.href = '/memo/?id=' + m.id : undefined}>
          <div class="lr-cover" class:no-cover={!cover} style={cover ? `background-image:url('${cover}')` : ''}></div>
          <div class="lr-main">
            <div class="lr-title" class:untitled={!m.title}>{m.pinned ? '📌 ' : ''}{m.title || 'Untitled'}</div>
            <div class="lr-sub">{sub}</div>
            <div class="lr-dates-mobile">
              <div class="lr-date-mobile">Created: {fmtDateTime(m.created_at)}</div>
              <div class="lr-date-mobile">Modified: {fmtDateTime(m.updated_at || m.created_at)}</div>
            </div>
          </div>
          <div class="lr-tags">
            {#each tags as tag}<span class="card-tag">{tag}</span>{/each}
          </div>
          <div class="lr-right">
            <div class="lr-date-label">Created</div>
            <div class="lr-date">{fmtDateTime(m.created_at)}</div>
            <div class="lr-date-label">Modified</div>
            <div class="lr-date">{fmtDateTime(m.updated_at || m.created_at)}</div>
            {#if m.uid}<div class="lr-uid">{m.uid}</div>{/if}
          </div>
          {#if inTrash}
            <div class="lr-trash-actions">
              <button class="restore-btn" onclick={(e) => restoreMemo(e, m.id)}>↩ Restore</button>
              <button class="perm-btn" onclick={(e) => permanentDelete(e, m.id)}>✕ Delete</button>
            </div>
          {:else}
            <div class="lr-actions">
              <button class="btn-icon" class:pinned={m.pinned} title={m.pinned ? 'Unpin' : 'Pin'} onclick={(e) => togglePin(e, m.id, m.pinned)}>📌</button>
              <button class="btn-icon" title="Duplicate" onclick={(e) => duplicateMemo(e, m.id)}>⧉</button>
              <button class="btn-icon" title="Move to trash" onclick={(e) => deleteMemo(e, m.id)}>🗑</button>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    {#each displayedMemos as m (m.id)}
      {@const tags = safeJson(m.tags, [] as string[])}
      {@const cover = m.cover_file ? fileUrl(m.id, m.cover_file) : ''}
      <div class="memo-card" data-date={m.created_at} onclick={!inTrash ? () => window.location.href = '/memo/?id=' + m.id : undefined}>
        <div class="card-cover" class:no-cover={!cover} style={cover ? `background-image:url('${cover}')` : ''}></div>
        <div class="card-body">
          <div class="card-memo-id">{m.memo_id}</div>
          <div class="card-title" class:untitled={!m.title}>{m.title || 'Untitled'}</div>
          {#if m.description}<div class="card-desc">{m.description}</div>{/if}
          {#if tags.length}
            <div class="card-tags">{#each tags as tag}<span class="card-tag">{tag}</span>{/each}</div>
          {/if}
          {#if inTrash}
            <div class="card-trash-actions">
              <button class="restore-btn" onclick={(e) => restoreMemo(e, m.id)}>↩ Restore</button>
              <button class="perm-btn" onclick={(e) => permanentDelete(e, m.id)}>Delete forever</button>
            </div>
          {:else}
            <div class="card-footer">
              <span class="card-date">{fmtDate(m.created_at)}</span>
              {#if m.uid}<span class="card-uid" title={m.uid}>{m.uid}</span>{/if}
              <button class="btn-icon" class:pinned={m.pinned} title={m.pinned ? 'Unpin' : 'Pin'} onclick={(e) => togglePin(e, m.id, m.pinned)}>📌</button>
              <button class="btn-icon" title="Duplicate memo" onclick={(e) => duplicateMemo(e, m.id)}>⧉</button>
              <button class="btn-icon" title="Move to trash" onclick={(e) => deleteMemo(e, m.id)}>🗑</button>
            </div>
          {/if}
        </div>
      </div>
    {/each}
  {/if}
</main>

{#if timelineVisible}
<div id="timeline">
  <div id="tl-track"></div>
  <div id="tl-labels"></div>
  <div id="tl-thumb" style="top:{tlThumbTop}"></div>
  <div id="tl-hit"
    onmousedown={tlMousedown}
    onmousemove={tlMousemove}
    onmouseleave={() => { if (!tlDragging) tlTooltipVisible = false }}
  ></div>
</div>
{/if}
{#if tlTooltipVisible}
<div id="tl-tooltip" style="top:{tlTooltipTop}">{tlTooltipText}</div>
{/if}

<style>
  header{background:var(--surface);border-bottom:1px solid var(--border);padding:0 24px;height:60px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:100}
  .logo{font-size:1.2rem;font-weight:600;flex-shrink:0}
  .search-wrap{flex:1}
  .search-wrap input{width:100%;padding:8px 14px;border:1px solid var(--border);border-radius:8px;font-size:.9rem;font-family:inherit;background:var(--bg);color:var(--text)}
  .search-wrap input:focus{outline:none;border-color:var(--accent)}
  .new-btn{padding:8px 18px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:.9rem;font-family:inherit;cursor:pointer;font-weight:500;white-space:nowrap;flex-shrink:0}
  .new-btn:hover{background:var(--accent-hover)}
  .rebuild-btn{background:none;border:1px solid var(--border);border-radius:8px;padding:6px 12px;font-size:.82rem;cursor:pointer;color:var(--muted);flex-shrink:0;line-height:1;font-family:inherit}
  .rebuild-btn:hover{border-color:var(--accent);color:var(--accent)}
  .trash-btn{background:none;border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:.9rem;cursor:pointer;color:var(--muted);flex-shrink:0;line-height:1;position:relative;display:inline-flex;align-items:center;gap:5px}
  .trash-btn:hover{border-color:var(--danger);color:var(--danger)}
  .trash-btn.active{border-color:var(--danger);color:var(--danger);background:#fef2f2}
  .trash-count{background:var(--danger);color:#fff;font-size:.65rem;font-weight:700;border-radius:10px;padding:1px 5px;line-height:1.4}
  .signout-btn{background:none;border:1px solid var(--border);border-radius:8px;padding:6px 12px;font-size:.82rem;cursor:pointer;color:var(--muted);flex-shrink:0;font-family:inherit}
  .signout-btn:hover{border-color:var(--text);color:var(--text)}
  .storage-label{font-size:.75rem;color:var(--muted);white-space:nowrap}
  .sort-select{border:1px solid var(--border);border-radius:8px;padding:5px 8px;font-size:.82rem;font-family:inherit;background:var(--surface);color:var(--muted);cursor:pointer;flex-shrink:0}
  .sort-select:focus{outline:none;border-color:var(--accent)}

  .tag-bar{padding:10px 24px;display:flex;gap:8px;flex-wrap:wrap;background:var(--surface);border-bottom:1px solid var(--border)}
  .tag-pill{padding:4px 12px;border-radius:20px;border:1px solid var(--border);background:transparent;font-size:.82rem;font-family:inherit;cursor:pointer;color:var(--muted);transition:all .1s;display:inline-flex;align-items:center;gap:5px}
  .tag-pill:hover{border-color:var(--accent);color:var(--accent)}
  .tag-pill.active{background:var(--accent);color:#fff;border-color:var(--accent)}
  .tag-count{font-size:.72rem;background:rgba(0,0,0,.08);border-radius:10px;padding:0 5px;line-height:1.6}
  .tag-pill.active .tag-count{background:rgba(255,255,255,.25)}

  main{padding:24px 52px 24px 24px;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
  main.view-list{display:block;padding:16px 24px}

  .empty{grid-column:1/-1;text-align:center;padding:80px 20px;color:var(--muted)}
  .empty h2{font-size:1.1rem;margin-bottom:8px;font-weight:500}

  .trash-bar{display:flex;padding:10px 24px;background:#fef2f2;border-bottom:1px solid #fecaca;align-items:center;gap:12px}
  .trash-bar-label{font-size:.88rem;color:#991b1b;flex:1}
  .trash-bar button{padding:6px 14px;border-radius:7px;font-size:.82rem;cursor:pointer;font-family:inherit;border:1px solid #fecaca;background:transparent;color:#991b1b}
  .trash-bar .empty-btn{background:#ef4444;color:#fff;border-color:#ef4444;font-weight:500}

  #timeline{position:fixed;right:0;top:60px;bottom:0;width:44px;z-index:50;user-select:none}
  #tl-track{position:absolute;right:13px;top:14px;bottom:14px;width:2px;background:var(--border);border-radius:2px}
  #tl-labels{position:absolute;inset:0}
  #tl-thumb{position:absolute;right:8px;width:12px;height:12px;border-radius:50%;background:var(--accent);transform:translateY(-50%);pointer-events:none;box-shadow:0 0 0 3px rgba(99,102,241,.2);transition:top .08s}
  #tl-hit{position:absolute;inset:0;cursor:ns-resize}
  #tl-tooltip{position:fixed;right:50px;background:var(--text);color:#fff;font-size:11px;font-weight:600;padding:4px 9px;border-radius:7px;pointer-events:none;white-space:nowrap;z-index:200;box-shadow:0 2px 8px rgba(0,0,0,.15)}

  :global(.tl-year){position:absolute;right:20px;font-size:10px;font-weight:700;color:var(--muted);transform:translateY(-50%);pointer-events:none;letter-spacing:.03em}

  .memo-card{background:var(--surface);border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.06);overflow:hidden;cursor:pointer;transition:transform .15s,box-shadow .15s;display:flex;flex-direction:column}
  .memo-card:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.12)}
  .card-cover{height:140px;background-size:cover;background-position:center}
  .card-cover.no-cover{background:linear-gradient(135deg,#e0e7ff 0%,#ede9fe 100%)}
  .card-body{padding:16px;flex:1;display:flex;flex-direction:column;gap:6px}
  .card-memo-id{font-family:'DM Mono',monospace;font-size:.73rem;color:var(--accent);font-weight:500;letter-spacing:.03em}
  .card-title{font-weight:600;font-size:.95rem;line-height:1.3}
  .card-title.untitled{color:var(--muted);font-weight:400;font-style:italic}
  .card-desc{font-size:.82rem;color:var(--muted);line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .card-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:2px}
  .card-tag{font-size:.72rem;padding:2px 8px;background:#ede9fe;color:var(--accent);border-radius:10px}
  .card-footer{display:flex;align-items:center;gap:6px;margin-top:auto;padding-top:8px;border-top:1px solid var(--border)}
  .card-date{font-size:.75rem;color:var(--muted);flex:1}
  .card-uid{font-size:.72rem;color:var(--muted);font-family:'DM Mono',monospace;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .btn-icon{background:none;border:none;cursor:pointer;padding:4px 5px;border-radius:6px;font-size:.85rem;opacity:.45;line-height:1;transition:opacity .1s}
  .btn-icon:hover{opacity:1;background:var(--bg)}
  .btn-icon.pinned{opacity:1}
  .card-trash-actions{display:flex;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)}
  .card-trash-actions button{flex:1;padding:6px 0;border-radius:7px;font-size:.8rem;cursor:pointer;font-family:inherit;border:1px solid var(--border);background:transparent;color:var(--muted)}
  .card-trash-actions .restore-btn{border-color:var(--accent);color:var(--accent)}
  .card-trash-actions .restore-btn:hover{background:var(--accent);color:#fff}
  .card-trash-actions .perm-btn:hover{border-color:var(--danger);color:var(--danger)}

  .view-btns{display:flex;gap:3px;flex-shrink:0}
  .view-btn{background:none;border:1px solid var(--border);border-radius:6px;padding:5px 9px;font-size:.85rem;cursor:pointer;color:var(--muted);line-height:1;font-family:inherit}
  .view-btn:hover{border-color:var(--accent);color:var(--accent)}
  .view-btn.active{background:var(--accent);color:#fff;border-color:var(--accent)}

  .list-container{background:var(--surface);border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.06);overflow:hidden}
  .list-row{display:flex;align-items:center;gap:12px;padding:10px 16px;cursor:pointer;border-bottom:1px solid var(--border);transition:background .1s}
  .list-row:last-child{border-bottom:none}
  .list-row:hover{background:var(--bg)}
  .lr-cover{width:34px;height:34px;border-radius:6px;flex-shrink:0;background-size:cover;background-position:center}
  .lr-cover.no-cover{background:linear-gradient(135deg,#e0e7ff 0%,#ede9fe 100%)}
  .lr-main{flex:1;min-width:0}
  .lr-title{font-weight:600;font-size:.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lr-title.untitled{color:var(--muted);font-weight:400;font-style:italic}
  .lr-sub{font-size:.73rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
  .lr-tags{display:flex;gap:4px;flex-shrink:0;max-width:220px;overflow:hidden}
  .lr-right{flex-shrink:0;text-align:right;min-width:130px}
  .lr-date{font-size:.73rem;color:var(--muted)}
  .lr-date-label{font-size:.65rem;color:var(--muted);opacity:.6;text-transform:uppercase;letter-spacing:.04em;margin-top:5px}
  .lr-uid{font-size:.68rem;color:var(--muted);font-family:'DM Mono',monospace;margin-top:2px}
  .lr-dates-mobile{display:none;margin-top:4px}
  .lr-date-mobile{font-size:.68rem;color:var(--muted)}
  .lr-actions{display:flex;gap:2px;flex-shrink:0;opacity:0;transition:opacity .1s}
  .list-row:hover .lr-actions{opacity:1}
  .lr-trash-actions{display:flex;gap:6px;flex-shrink:0}
  .lr-trash-actions button{padding:4px 10px;border-radius:6px;font-size:.75rem;cursor:pointer;font-family:inherit;border:1px solid var(--border);background:transparent;color:var(--muted);white-space:nowrap}
  .lr-trash-actions .restore-btn{border-color:var(--accent);color:var(--accent)}
  .lr-trash-actions .restore-btn:hover{background:var(--accent);color:#fff}
  .lr-trash-actions .perm-btn:hover{border-color:var(--danger);color:var(--danger)}

  @media (max-width:640px){
    header{height:auto;padding:8px 16px;flex-wrap:wrap;gap:6px}
    .rebuild-btn{display:none}
    .trash-btn{margin-left:auto}
    .search-wrap{order:10;flex:1 1 100%}
    .sort-select{order:20;font-size:.8rem;padding:5px 6px}
    .view-btns{order:21}
    .new-btn{font-size:.85rem;padding:7px 12px}
    .signout-btn{font-size:.8rem;padding:5px 10px}
    .tag-bar{padding:8px 16px}
    .trash-bar{padding:8px 16px}
    main,main.view-list{padding:12px 16px;gap:12px}
    #timeline{display:none !important}
    .lr-tags{display:none}
    .lr-right{display:none}
    .lr-dates-mobile{display:block}
    .lr-actions{opacity:1}
    .memo-card{box-shadow:0 1px 2px rgba(0,0,0,.06)}
  }
</style>
