<script lang="ts">
import { onMount, onDestroy, tick } from 'svelte'
import { api, fileUrl as apiFileUrl, safeJson, esc, fmtDate, getToken, logout, WORKER } from '$lib/api'

let memoId = ''
let memo: any = null
let meta: { files: Record<string, any>; folders: string[]; trash: any[] } = { files: {}, folders: [], trash: [] }
let allFiles: any[] = []
let currentFolder = ''
let lbFiles: any[] = []
let lbIdx = 0
let modalFile: string | null = null
let currentTags: string[] = []
let snippets: any[] = []
let viewMode = 'list'
let sortDir = 1
let dragKey: string | null = null
let allTagSuggestions: string[] = []
let _noteTimer: ReturnType<typeof setTimeout> | null = null
let _savedRange: Range | null = null
let _infoTimer: ReturnType<typeof setTimeout> | null = null
let _gs_timer: ReturnType<typeof setTimeout> | null = null
let _gs_results: any[] = []
let _gs_idx = -1
const selectedFiles = new Set<string>()
let noteEditor: HTMLDivElement
let clipTitleInput: HTMLInputElement
let clipPasteArea: HTMLDivElement
let uploadVisible = $state(false)
let uploadPercent = $state(0)
let uploadLabel = $state('')
let shareToken = $state<string | null>(null)
let shareOpen = $state(false)
let shareLoading = $state(false)

let calOpen = $state(false)
let calDate = $state('')
let calTime = $state('')
let calDur = $state('30')
let calCal = $state('default')
let calCallId = $state('')
let calSmsId = $state('')
let _uploadXhrs: XMLHttpRequest[] = []
const MAX_UPLOAD_MB = 100
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

const IMG_EXTS = new Set(['jpg','jpeg','png','gif','webp','heic','avif','bmp','svg','tiff'])
const VIDEO_EXTS = new Set(['mp4','mov','webm','avi','mkv','m4v'])
const AUDIO_EXTS = new Set(['mp3','m4a','wav','ogg','flac','aac','opus','wma'])
const isAudio = (n: string) => AUDIO_EXTS.has(ext(n))
const ext = (n: string) => (n.split('.').pop() || '').toLowerCase()
const basename = (n: string) => n.split('/').pop() || n
const isImg = (n: string) => IMG_EXTS.has(ext(n))
const isVideo = (n: string) => VIDEO_EXTS.has(ext(n))
const isPdf = (n: string) => ext(n) === 'pdf'
const isPreviewable = (n: string) => isImg(n) || isVideo(n) || isPdf(n) || isAudio(n)
const fu = (key: string) => apiFileUrl(memoId, key)
const fmtSize = (b: number) => b < 1024 ? b + ' B' : b < 1048576 ? (b/1024).toFixed(1) + ' KB' : (b/1048576).toFixed(1) + ' MB'

function fileIcon(name: string) {
  const e = ext(name)
  if (isPdf(name)) return '📄'
  if (['mp4','mov','avi','mkv','webm'].includes(e)) return '🎬'
  if (['mp3','wav','aac','flac'].includes(e)) return '🎵'
  if (['zip','tar','gz','rar'].includes(e)) return '📦'
  if (['doc','docx'].includes(e)) return '📝'
  if (['xls','xlsx','csv'].includes(e)) return '📊'
  return '📄'
}

function autoGrow(el: HTMLTextAreaElement) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' }

async function init() {
  if (!memoId) { location.href = '/'; return }
  setView(viewMode, false)
  await Promise.all([loadMemo(), loadMeta()])
  await loadFiles()
  loadNote()
  loadSnippets()
  loadTagSuggestions()
}

async function loadMemo() {
  memo = await (await api('/memos/' + memoId)).json()
  document.title = memo.memo_id
  const badge = document.getElementById('memo-id-badge'); if (badge) badge.textContent = memo.memo_id
  const ti = document.getElementById('title-input') as HTMLInputElement; if (ti) ti.value = memo.title || ''
  const di = document.getElementById('desc-input') as HTMLTextAreaElement
  if (di) { di.value = memo.description || ''; autoGrow(di) }
  document.getElementById('pin-btn')?.classList.toggle('active', !!memo.pinned)
  const ui = document.getElementById('uid-input') as HTMLInputElement; if (ui) ui.value = memo.uid || ''
  const cd = document.getElementById('created-date-input') as HTMLInputElement
  if (cd && memo.created_at) cd.value = memo.created_at.slice(0, 10)
  renderTags(safeJson(memo.tags, []))
  renderLinks(safeJson(memo.links, []))
}

async function loadFiles() {
  allFiles = await (await api('/memos/' + memoId + '/files')).json()
  renderFileList(); renderGallery(); renderCoverSelect()
  const total = allFiles.reduce((s: number, f: any) => s + f.size, 0)
  const fb = document.getElementById('fb-size'); if (fb) fb.textContent = allFiles.length ? fmtSize(total) : ''

  if (memo && !memo.cover_file) {
    const firstImg = allFiles.find((f: any) => !f.key.startsWith('_') && isImg(f.key))
    if (firstImg) {
      memo.cover_file = firstImg.key
      api('/memos/' + memoId + '/cover', { method: 'PATCH', body: JSON.stringify({ cover_file: firstImg.key }), headers: { 'Content-Type': 'application/json' } }).catch(() => {})
    }
  }
}

async function loadMeta() {
  meta = await (await api('/memos/' + memoId + '/meta')).json()
  meta.files = meta.files || {}; meta.folders = meta.folders || []; meta.trash = meta.trash || []
  renderTrashCount()
}

async function loadNote() {
  const r = await api('/memos/' + memoId + '/note')
  const html = await r.text()
  noteEditor.innerHTML = html
  const st = document.getElementById('note-status'); if (st) st.textContent = html ? 'Saved' : 'No note yet'
  const nh = document.getElementById('note-hint'); if (nh) nh.textContent = html ? '' : 'Click to expand…'
}

function setView(mode: string, save = true) {
  viewMode = mode
  if (save) localStorage.setItem('memo_view', mode)
  document.getElementById('view-list-btn')?.classList.toggle('active', mode === 'list')
  document.getElementById('view-grid-btn')?.classList.toggle('active', mode === 'grid')
  document.getElementById('file-list')?.classList.toggle('grid', mode === 'grid')
  renderFileList()
}

function toggleSortDir() {
  sortDir *= -1
  const b = document.getElementById('sort-dir-btn'); if (b) b.textContent = sortDir === 1 ? '▲' : '▼'
  renderFileList()
}

function getVisibleFiles() {
  let files = allFiles.filter((f: any) => !f.key.startsWith('_'))
  if (currentFolder === '') files = files.filter((f: any) => !f.key.includes('/'))
  else files = files.filter((f: any) => f.key.startsWith(currentFolder + '/') && !f.key.slice(currentFolder.length + 1).includes('/'))
  const sort = (document.getElementById('sort-select') as HTMLSelectElement | null)?.value || 'name'
  files.sort((a: any, b: any) => {
    const v = sort === 'date' ? new Date(a.uploaded).getTime() - new Date(b.uploaded).getTime()
            : sort === 'size' ? a.size - b.size
            : sort === 'type' ? ext(a.key).localeCompare(ext(b.key)) || a.key.localeCompare(b.key)
            : a.key.localeCompare(b.key)
    return v * sortDir
  })
  return files
}

function renderFileList() {
  const list = document.getElementById('file-list'); if (!list) return
  list.innerHTML = ''
  const bc = document.getElementById('breadcrumb')
  if (bc) { bc.style.display = currentFolder ? '' : 'none'; const bn = document.getElementById('bc-folder-name'); if (bn) bn.textContent = currentFolder }
  const files = getVisibleFiles()
  const folders: string[] = meta.folders || []
  if (viewMode === 'grid') {
    if (!currentFolder) folders.forEach(folder => {
      const count = allFiles.filter((f: any) => f.key.startsWith(folder + '/') && !f.key.startsWith('_')).length
      const card = document.createElement('div'); card.className = 'file-grid-card'; card.dataset.folder = folder
      card.innerHTML = `<div class="folder-grid-thumb" onclick="setFolder('${esc(folder)}')">📁</div><div class="grid-info"><div class="grid-name">${esc(folder)}</div><div class="grid-meta">${count} item${count !== 1 ? 's' : ''}</div></div><button class="grid-menu-btn" onclick="showFolderMenu(event,'${esc(folder)}')">⋯</button>`
      addFolderDropTarget(card, folder); list.appendChild(card)
    })
    files.forEach((f: any) => {
      const name = basename(f.key); const card = document.createElement('div')
      card.className = 'file-grid-card' + (selectedFiles.has(f.key) ? ' selected' : ''); card.dataset.key = f.key
      const th = isImg(f.key) ? `<img src="${fu(f.key)}" loading="lazy" alt="" data-preview="1" onerror="this.style.display='none';this.parentElement.innerHTML='<div class=\\'grid-icon\\'>${fileIcon(f.key)}</div>'">` : isVideo(f.key) ? `<div class="video-grid-preview">▶</div>` : isAudio(f.key) ? `<div class="video-grid-preview">♪</div>` : `<div class="grid-icon">${fileIcon(f.key)}</div>`
      card.innerHTML = `<div class="grid-cb" onclick="toggleSelect('${esc(f.key)}');event.stopPropagation()">✓</div><div class="grid-thumb" onclick="${isPreviewable(f.key) ? `openLightbox('${esc(f.key)}')` : `downloadFile('${esc(f.key)}')`}">${th}</div><div class="grid-info"><div class="grid-name" title="${esc(f.key)}">${esc(name)}</div><div class="grid-meta">${fmtSize(f.size)}</div></div><button class="grid-menu-btn" onclick="showFileMenu(event,'${esc(f.key)}')">⋯</button>`
      addFileDrag(card, f.key); list.appendChild(card)
    })
  } else {
    if (!currentFolder) folders.forEach(folder => {
      const count = allFiles.filter((f: any) => f.key.startsWith(folder + '/') && !f.key.startsWith('_')).length
      const row = document.createElement('div'); row.className = 'file-row folder-row'; row.dataset.folder = folder
      row.innerHTML = `<div style="width:20px;flex-shrink:0"></div><div class="folder-icon-box">📁</div><div class="file-row-info" style="cursor:pointer" onclick="setFolder('${esc(folder)}')"><div class="file-row-name">${esc(folder)}</div><div class="file-row-meta">${count} item${count !== 1 ? 's' : ''}</div></div><div class="file-row-actions"><button onclick="showFolderMenu(event,'${esc(folder)}')">⋯</button></div>`
      addFolderDropTarget(row, folder); list.appendChild(row)
    })
    files.forEach((f: any) => {
      const name = basename(f.key); const fm = meta.files[f.key] || {}
      const fp = f.key.includes('/') ? f.key.split('/').slice(0, -1).join('/') : ''
      const row = document.createElement('div'); row.className = 'file-row' + (selectedFiles.has(f.key) ? ' selected' : ''); row.dataset.key = f.key
      const th = isImg(f.key) ? `<img class="file-row-thumb" src="${fu(f.key)}" loading="lazy" alt="" data-preview="1" onclick="openLightbox('${esc(f.key)}')" onerror="this.outerHTML='<div class=\\'file-row-icon\\'>${fileIcon(f.key)}</div>'">` : isVideo(f.key) ? `<div class="file-row-thumb video-row-thumb" onclick="openLightbox('${esc(f.key)}')">▶</div>` : isAudio(f.key) ? `<div class="file-row-thumb video-row-thumb" onclick="openLightbox('${esc(f.key)}')">♪</div>` : `<div class="file-row-icon">${fileIcon(f.key)}</div>`
      row.innerHTML = `<div class="file-cb" onclick="toggleSelect('${esc(f.key)}')">✓</div>${th}<div class="file-row-info"><div class="file-row-name" title="${esc(name)}">${esc(name)}</div><div class="file-row-meta">${fp ? esc(fp) + ' · ' : ''}${fmtSize(f.size)} · ${fmtDate(f.uploaded)}${fm.caption ? ` · <em>${esc(fm.caption)}</em>` : ''}${fm.tags?.length ? ` · <span style="color:var(--accent)">Tags: ${(fm.tags as string[]).map(t => esc(t)).join(', ')}</span>` : ''}</div></div><div class="file-row-actions"><button onclick="showMoveMenu(event,'${esc(f.key)}')">Move ▾</button><button onclick="openFileInfo('${esc(f.key)}')">ⓘ</button>${isPreviewable(f.key) ? `<button onclick="openLightbox('${esc(f.key)}')">View</button>` : `<button onclick="downloadFile('${esc(f.key)}')">↓</button>`}<button class="del-btn" onclick="trashFile('${esc(f.key)}')">🗑</button></div>`
      addFileDrag(row, f.key); list.appendChild(row)
    })
  }
  const showEmpty = files.length === 0 && (currentFolder !== '' || folders.length === 0)
  const em = document.getElementById('file-list-empty'); if (em) em.style.display = showEmpty ? 'block' : 'none'
  updateSelectionUI()
}

function addFileDrag(el: HTMLElement, key: string) {
  el.draggable = true
  el.addEventListener('dragstart', (e: DragEvent) => { dragKey = key; e.dataTransfer!.effectAllowed = 'move'; e.dataTransfer!.setData('text/plain', key) })
  el.addEventListener('dragend', () => { dragKey = null })
}

function addFolderDropTarget(el: HTMLElement, folder: string) {
  el.addEventListener('dragover', (e: DragEvent) => { e.preventDefault(); e.dataTransfer!.dropEffect = 'move'; el.classList.add('drag-over') })
  el.addEventListener('dragleave', (e: Event) => { if (!el.contains((e as MouseEvent).relatedTarget as Node)) el.classList.remove('drag-over') })
  el.addEventListener('drop', async (e: Event) => {
    e.preventDefault(); el.classList.remove('drag-over')
    const key = dragKey || (e as DragEvent).dataTransfer!.getData('text/plain')
    if (key && !key.startsWith('_')) { dragKey = null; await moveFile(key, folder) }
  })
}

function setFolder(folder: string) { currentFolder = folder; selectedFiles.clear(); renderFileList() }

function renderGallery() {
  const images = allFiles.filter((f: any) => isImg(f.key) && !f.key.startsWith('_'))
  lbFiles = images
  const section = document.getElementById('gallery-section'); if (!section) return
  section.style.display = images.length ? '' : 'none'
  const hdr = document.getElementById('gallery-header'); if (hdr) hdr.textContent = `Images (${images.length})`
  const gallery = document.getElementById('image-gallery'); if (!gallery) return
  gallery.innerHTML = ''
  images.forEach((f: any) => {
    const div = document.createElement('div'); div.className = 'gallery-thumb'; div.onclick = () => openLightbox(f.key)
    div.innerHTML = `<img src="${fu(f.key)}" loading="lazy" alt="${esc(basename(f.key))}">`;
    gallery.appendChild(div)
  })
}

function renderCoverSelect() {
  const sel = document.getElementById('cover-select') as HTMLSelectElement; if (!sel) return
  const images = allFiles.filter((f: any) => isImg(f.key) && !f.key.startsWith('_'))
  sel.innerHTML = '<option value="">— None —</option>'
  images.forEach((f: any) => { const o = document.createElement('option'); o.value = f.key; o.textContent = f.key; if (memo?.cover_file === f.key) o.selected = true; sel.appendChild(o) })
}

function renderTrashCount() { const el = document.getElementById('trash-count-btn'); if (el) el.textContent = String((meta.trash || []).length) }

function openTrashModal() {
  const items = meta.trash || []; const n = items.length
  const sub = document.getElementById('trash-modal-sub'); if (sub) sub.textContent = n ? `${n} item${n !== 1 ? 's' : ''}` : 'Empty'
  const listEl = document.getElementById('trash-modal-list'); if (!listEl) return
  listEl.innerHTML = n ? '' : '<div style="padding:20px 0;text-align:center;color:var(--muted);font-size:.85rem">Trash is empty</div>'
  items.forEach((item: any) => {
    const div = document.createElement('div'); div.className = 'trash-item'
    const th = isImg(item.origKey) ? `<img class="trash-thumb" src="${fu(item.trashKey)}" loading="lazy" alt="" onerror="this.style.display='none'">` : `<div class="trash-icon">${fileIcon(item.origKey)}</div>`
    div.innerHTML = `${th}<div class="trash-info"><div class="trash-name">${esc(basename(item.origKey))}</div><div class="trash-meta">${item.origKey.includes('/') ? esc(item.origKey.split('/').slice(0,-1).join('/')) : 'root'} · ${fmtDate(item.deletedAt)}</div></div><div class="trash-acts"><button class="restore-btn" onclick="restoreFile('${esc(item.trashKey)}','${esc(item.origKey)}')">Restore</button><button class="perm-del-btn" onclick="permDelete('${esc(item.trashKey)}','${esc(item.origKey)}')">Delete</button></div>`
    listEl.appendChild(div)
  })
  document.getElementById('trash-modal')?.classList.remove('hidden')
}

function closeTrashModal() { document.getElementById('trash-modal')?.classList.add('hidden') }

async function emptyTrash() {
  const items = meta.trash || []; if (!items.length) return
  if (!confirm(`Permanently delete all ${items.length} items in trash? This cannot be undone.`)) return
  for (const item of items) { try { await api('/memos/' + memoId + '/files/' + item.trashKey.split('/').map(encodeURIComponent).join('/'), { method: 'DELETE' }) } catch {} }
  meta.trash = []; await saveMeta(); renderTrashCount(); closeTrashModal()
}

async function restoreAll() {
  const items = [...(meta.trash || [])]; if (!items.length) return
  for (const item of items) {
    try { await api('/memos/' + memoId + '/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashKey: item.trashKey, origKey: item.origKey }) }); meta.trash = meta.trash.filter((i: any) => i.trashKey !== item.trashKey) } catch {}
  }
  await saveMeta(); await loadFiles(); renderTrashCount(); closeTrashModal()
}

async function restoreFile(trashKey: string, origKey: string) {
  try {
    await api('/memos/' + memoId + '/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashKey, origKey }) })
    meta.trash = meta.trash.filter((i: any) => i.trashKey !== trashKey)
    await saveMeta(); await loadFiles(); renderTrashCount(); openTrashModal()
  } catch {}
}

async function permDelete(trashKey: string, origKey: string) {
  if (!confirm(`Permanently delete "${basename(origKey)}"?`)) return
  try {
    await api('/memos/' + memoId + '/files/' + trashKey.split('/').map(encodeURIComponent).join('/'), { method: 'DELETE' })
    meta.trash = meta.trash.filter((i: any) => i.trashKey !== trashKey)
    await saveMeta(); renderTrashCount(); openTrashModal()
  } catch {}
}

function toggleSelect(key: string) { if (selectedFiles.has(key)) selectedFiles.delete(key); else selectedFiles.add(key); updateSelectionUI() }
function selectAll() { getVisibleFiles().forEach((f: any) => selectedFiles.add(f.key)); updateSelectionUI() }
function deselectAll() { selectedFiles.clear(); updateSelectionUI() }
function updateSelectionUI() {
  const count = selectedFiles.size
  document.querySelectorAll('[data-key]').forEach(el => el.classList.toggle('selected', selectedFiles.has((el as HTMLElement).dataset.key!)))
  const sc = document.getElementById('sel-count'); if (sc) sc.textContent = count ? `${count} selected` : ''
  const bc = document.getElementById('bulk-count'); if (bc) bc.textContent = `${count} selected`
  document.getElementById('bulk-bar')?.classList.toggle('visible', count > 0)
}

function showFloatMenu(e: Event, items: any[]) {
  e.stopPropagation()
  const menu = document.getElementById('float-menu'); if (!menu) return
  menu.innerHTML = items.map((item: any) => item === '---' ? '<div class="menu-divider"></div>' : `<button class="${item.danger ? 'danger' : ''}" onclick="${item.fn}">${esc(item.label)}</button>`).join('')
  menu.style.display = 'block'
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  let left = rect.left, top = rect.bottom + 4
  if (left + 170 > window.innerWidth) left = window.innerWidth - 175
  if (top + items.length * 40 > window.innerHeight) top = rect.top - items.length * 40 - 4
  menu.style.left = left + 'px'; menu.style.top = top + 'px'
}

function showFloatMenuAt(rect: DOMRect, items: any[]) {
  const menu = document.getElementById('float-menu'); if (!menu) return
  menu.innerHTML = items.map((item: any) => `<button onclick="${item.fn}">${esc(item.label)}</button>`).join('')
  menu.style.display = 'block'
  let left = rect.left, top = rect.bottom + 4
  if (left + 170 > window.innerWidth) left = window.innerWidth - 175
  if (top + items.length * 40 > window.innerHeight) top = rect.top - items.length * 40 - 4
  menu.style.left = left + 'px'; menu.style.top = top + 'px'
}

function showMoveMenu(e: Event, key: string) {
  const folders: string[] = meta.folders || []; const cur = key.includes('/') ? key.split('/').slice(0,-1).join('/') : ''
  const items: any[] = []
  if (cur !== '') items.push({ label: '📁 Root', fn: `moveFile('${esc(key)}','')` })
  folders.forEach(f => { if (f !== cur) items.push({ label: '📁 ' + f, fn: `moveFile('${esc(key)}','${esc(f)}')` }) })
  if (!items.length) items.push({ label: 'No other folders', fn: 'void 0' })
  showFloatMenu(e, items)
}

function showBulkMoveMenu(e: Event) {
  if (!selectedFiles.size) return
  const folders: string[] = meta.folders || []
  const items: any[] = [{ label: '📁 Root', fn: `bulkMoveTo('')` }]
  folders.forEach(f => items.push({ label: '📁 ' + f, fn: `bulkMoveTo('${esc(f)}')` }))
  if (!folders.length) items.push({ label: 'No folders yet', fn: 'void 0' })
  showFloatMenu(e, items)
}

function showFileMenu(e: Event, key: string) {
  showFloatMenu(e, [
    { label: 'View / Preview', fn: `openLightbox('${esc(key)}')` },
    { label: 'File info', fn: `openFileInfo('${esc(key)}')` },
    { label: 'Move to…', fn: `showMoveMenu(event,'${esc(key)}')` },
    '---',
    { label: '🗑 Move to trash', fn: `trashFile('${esc(key)}')`, danger: true },
  ])
}

function showFolderMenu(e: Event, folder: string) {
  showFloatMenu(e, [
    { label: '✏️ Rename', fn: `renameFolder('${esc(folder)}')` },
    { label: '🗑 Remove folder', fn: `removeFolder('${esc(folder)}')`, danger: true },
  ])
}

async function moveFile(srcKey: string, dstFolder: string) {
  try {
    const r = await api('/memos/' + memoId + '/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ srcKey, dstFolder }) })
    const { key: newKey } = await r.json()
    if (meta.files[srcKey]) { meta.files[newKey] = meta.files[srcKey]; delete meta.files[srcKey] }
    if (memo?.cover_file === srcKey) { memo.cover_file = newKey; await saveInfo() }
    await saveMeta(); await loadFiles()
  } catch {}
}

async function bulkMoveTo(folder: string) {
  await Promise.all([...selectedFiles].map(async key => {
    try {
      const r = await api('/memos/' + memoId + '/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ srcKey: key, dstFolder: folder }) })
      const { key: newKey } = await r.json()
      if (meta.files[key]) { meta.files[newKey] = meta.files[key]; delete meta.files[key] }
    } catch {}
  }))
  selectedFiles.clear(); await saveMeta(); await loadFiles()
}

let _pickerActive = false

function _openPicker(folder: boolean) {
  if (_pickerActive) return
  _pickerActive = true
  const input = document.createElement('input'); input.type = 'file'
  if (folder) (input as any).webkitdirectory = true; else input.multiple = true
  input.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0'
  document.body.appendChild(input)
  const done = async (files: File[] = []) => {
    if (document.body.contains(input)) input.remove()
    setTimeout(() => { _pickerActive = false }, 200)
    if (files.length) await uploadFiles(files)
  }
  input.addEventListener('change', () => done(Array.from(input.files || []) as File[]))
  input.addEventListener('cancel', () => done())
  input.click()
}

function openFilePicker() { _openPicker(false) }
function openFolderPicker() { _openPicker(true) }

function cancelUpload() {
  _uploadXhrs.forEach(xhr => xhr.abort())
  _uploadXhrs = []
  uploadVisible = false
  uploadPercent = 0
  uploadLabel = ''
}

async function uploadFiles(files: File[]) {
  if (!files.length) return
  const oversized = files.filter(f => f.size > MAX_UPLOAD_BYTES)
  const toUpload = files.filter(f => f.size <= MAX_UPLOAD_BYTES)
  if (oversized.length) alert(`Skipped — over ${MAX_UPLOAD_MB}MB limit:\n${oversized.map(f => f.name).join('\n')}`)
  if (!toUpload.length) return

  uploadVisible = true
  _uploadXhrs = []
  await tick()

  const n = toUpload.length
  const progresses = new Array(n).fill(0)
  uploadLabel = n === 1 ? toUpload[0].name : `${n} files`
  uploadPercent = 0
  const errors: string[] = []

  await Promise.all(toUpload.map((file, i) => new Promise<void>(resolve => {
    const fd = new FormData(); fd.append('file', file)
    if (currentFolder) fd.append('folder', currentFolder)
    const xhr = new XMLHttpRequest()
    _uploadXhrs.push(xhr)
    xhr.open('POST', WORKER + '/memos/' + memoId + '/files?t=' + encodeURIComponent(getToken()))
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        progresses[i] = e.loaded / e.total
        uploadPercent = progresses.reduce((a, b) => a + b, 0) / n * 100
      }
    }
    xhr.onload = () => {
      if (xhr.status === 401) logout()
      else if (xhr.status >= 400) errors.push(file.name)
      progresses[i] = 1
      uploadPercent = progresses.reduce((a, b) => a + b, 0) / n * 100
      resolve()
    }
    xhr.onerror = () => { errors.push(file.name); resolve() }
    xhr.onabort = () => resolve()
    xhr.send(fd)
  })))

  uploadVisible = false
  uploadPercent = 0
  _uploadXhrs = []
  if (errors.length) alert(`Failed to upload:\n${errors.join('\n')}`)
  await loadFiles()
}

async function trashFile(key: string) {
  if (!confirm(`Move "${basename(key)}" to trash?`)) return
  try {
    const r = await api('/memos/' + memoId + '/trash', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) })
    const { trashKey } = await r.json()
    meta.trash.push({ trashKey, origKey: key, name: basename(key), deletedAt: new Date().toISOString() })
    delete meta.files[key]; await saveMeta(); await loadFiles(); renderTrashCount()
  } catch {}
}

async function bulkTrash() {
  const keys = [...selectedFiles]; if (!keys.length) return
  if (!confirm(`Move ${keys.length} file${keys.length > 1 ? 's' : ''} to trash?`)) return
  await Promise.all(keys.map(async key => {
    try {
      const r = await api('/memos/' + memoId + '/trash', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) })
      const { trashKey } = await r.json()
      meta.trash.push({ trashKey, origKey: key, name: basename(key), deletedAt: new Date().toISOString() }); delete meta.files[key]
    } catch {}
  }))
  selectedFiles.clear(); await saveMeta(); await loadFiles(); renderTrashCount()
}

async function clearAll() {
  const files = getVisibleFiles(); if (!files.length) return
  if (!confirm(`Move all ${files.length} visible files to trash?`)) return
  await Promise.all(files.map(async (f: any) => {
    try {
      const r = await api('/memos/' + memoId + '/trash', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: f.key }) })
      const { trashKey } = await r.json()
      meta.trash.push({ trashKey, origKey: f.key, name: basename(f.key), deletedAt: new Date().toISOString() }); delete meta.files[f.key]
    } catch {}
  }))
  await saveMeta(); await loadFiles(); renderTrashCount()
}

async function bulkDownload() {
  const keys = [...selectedFiles]; if (!keys.length) return
  if (keys.length === 1) { downloadFile(keys[0]); return }
  const btn = [...document.querySelectorAll('.bulk-action')].find(b => b.textContent?.includes('Download')) as HTMLButtonElement | undefined
  if (btn) { btn.textContent = '…'; btn.disabled = true }
  try {
    if (!(window as any).JSZip) {
      await new Promise<void>((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'; s.onload = () => res(); s.onerror = rej; document.head.appendChild(s) })
    }
    const zip = new (window as any).JSZip()
    await Promise.all(keys.map(async key => { const r = await fetch(fu(key)); if (r.ok) zip.file(basename(key), await r.blob()) }))
    const blob = await zip.generateAsync({ type: 'blob' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `files-${memo?.memo_id || memoId}.zip`; a.click(); URL.revokeObjectURL(a.href)
  } catch(e) { console.error('bulkDownload:', e) }
  if (btn) { btn.textContent = '↓ Download'; btn.disabled = false }
}

async function bulkTag() {
  const tag = prompt('Tag to add to selected files:'); if (!tag?.trim()) return
  const t = tag.trim()
  for (const key of selectedFiles) { const fm = meta.files[key] || {}; const tags = fm.tags || []; if (!tags.includes(t)) tags.push(t); meta.files[key] = { ...fm, tags } }
  selectedFiles.clear(); await saveMeta(); renderFileList()
}

async function addFolder() {
  const name = prompt('Folder name:'); if (!name) return
  const safe = name.replace(/[^a-zA-Z0-9_\- ]/g, '').trim()
  if (!safe || (meta.folders || []).includes(safe)) return
  meta.folders.push(safe); await saveMeta(); renderFileList()
}

async function renameFolder(oldName: string) {
  const newName = prompt('New folder name:', oldName); if (!newName || newName === oldName) return
  const safe = newName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim()
  if (!safe || meta.folders.includes(safe)) { alert('Invalid or duplicate name.'); return }
  for (const f of allFiles.filter((f: any) => f.key.startsWith(oldName + '/'))) {
    try {
      const r = await api('/memos/' + memoId + '/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ srcKey: f.key, dstFolder: safe }) })
      const { key: newKey } = await r.json()
      if (meta.files[f.key]) { meta.files[newKey] = meta.files[f.key]; delete meta.files[f.key] }
    } catch {}
  }
  meta.folders = meta.folders.map((f: string) => f === oldName ? safe : f)
  if (currentFolder === oldName) currentFolder = safe
  await saveMeta(); await loadFiles()
}

async function removeFolder(name: string) {
  if (!confirm(`Remove folder "${name}"? Files inside will be moved to root.`)) return
  for (const f of allFiles.filter((f: any) => f.key.startsWith(name + '/'))) {
    try {
      const r = await api('/memos/' + memoId + '/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ srcKey: f.key, dstFolder: '' }) })
      const { key: newKey } = await r.json()
      if (meta.files[f.key]) { meta.files[newKey] = meta.files[f.key]; delete meta.files[f.key] }
    } catch {}
  }
  meta.folders = meta.folders.filter((f: string) => f !== name)
  if (currentFolder === name) currentFolder = ''
  await saveMeta(); await loadFiles()
}

function openLightbox(key: string) {
  const previewable = allFiles.filter((f: any) => isPreviewable(f.key) && !f.key.startsWith('_'))
  lbFiles = previewable.length ? previewable : [{ key }]
  lbIdx = lbFiles.findIndex((f: any) => f.key === key); if (lbIdx === -1) lbIdx = 0
  showLightbox()
}

function showLightbox() {
  const f = lbFiles[lbIdx]; if (!f) return
  document.getElementById('lightbox')?.classList.remove('hidden'); document.body.style.overflow = 'hidden'
  const c = document.getElementById('lb-content')!; const prev = c.querySelector('video,audio') as HTMLMediaElement | null; if (prev) { prev.pause(); prev.src = '' }
  c.innerHTML = isVideo(f.key) ? `<video src="${fu(f.key)}" controls autoplay playsinline></video>` : isAudio(f.key) ? `<audio src="${fu(f.key)}" controls autoplay style="width:min(400px,80vw);outline:none"></audio>` : isPdf(f.key) ? `<iframe src="${fu(f.key)}"></iframe>` : `<img src="${fu(f.key)}" alt="${esc(basename(f.key))}">`
  const cap = document.getElementById('lb-caption'); if (cap) cap.textContent = basename(f.key)
  const ctr = document.getElementById('lb-counter'); if (ctr) ctr.textContent = lbFiles.length > 1 ? `${lbIdx + 1} / ${lbFiles.length}` : ''
  const multi = lbFiles.length > 1
  ;(document.getElementById('lb-prev') as HTMLElement | null)?.style && ((document.getElementById('lb-prev') as HTMLElement).style.display = multi ? '' : 'none')
  ;(document.getElementById('lb-next') as HTMLElement | null)?.style && ((document.getElementById('lb-next') as HTMLElement).style.display = multi ? '' : 'none')
}

function closeLightbox() {
  const c = document.getElementById('lb-content'); if (c) { const v = c.querySelector('video,audio') as HTMLMediaElement | null; if (v) { v.pause(); v.src = '' }; c.innerHTML = '' }
  document.getElementById('lightbox')?.classList.add('hidden'); document.body.style.overflow = ''
}

function lbNav(dir: number) { lbIdx = (lbIdx + dir + lbFiles.length) % lbFiles.length; showLightbox() }
function downloadFile(key: string) { const a = document.createElement('a'); a.href = fu(key); a.download = basename(key); a.click() }

function openFileInfo(key: string) {
  modalFile = key; const fm = meta.files[key] || {}
  ;(document.getElementById('modal-caption') as HTMLInputElement).value = fm.caption || ''
  ;(document.getElementById('modal-tags') as HTMLInputElement).value = (fm.tags || []).join(', ')
  document.getElementById('info-modal')?.classList.remove('hidden')
}
function closeModal() { document.getElementById('info-modal')?.classList.add('hidden'); modalFile = null }
async function saveFileInfo() {
  if (!modalFile) return
  meta.files[modalFile] = { caption: (document.getElementById('modal-caption') as HTMLInputElement).value.trim(), tags: (document.getElementById('modal-tags') as HTMLInputElement).value.split(',').map((t: string) => t.trim()).filter(Boolean) }
  await saveMeta(); closeModal(); renderFileList()
}

function exec(cmd: string) { noteEditor.focus(); document.execCommand(cmd, false, undefined) }
function insertPageBreak() { noteEditor.focus(); document.execCommand('insertHTML', false, '<hr><p><br></p>') }
function insertTask() { noteEditor.focus(); document.execCommand('insertHTML', false, '<input type="checkbox"> ') }
function clearNote() { if (!confirm('Clear the note?')) return; noteEditor.innerHTML = ''; const st = document.getElementById('note-status'); if (st) st.textContent = 'Cleared' }

function showBlockStyleMenu(e: Event) { showFloatMenu(e, [{ label: 'Heading', fn: `applyBlockStyle('h2')` }, { label: 'Subheading', fn: `applyBlockStyle('h3')` }, { label: 'Body', fn: `applyBlockStyle('p')` }]) }
function applyBlockStyle(tag: string) { noteEditor.focus(); document.execCommand('formatBlock', false, tag) }
function changeFontSize(delta: number) { noteEditor.focus(); const cur = parseInt(document.queryCommandValue('fontSize')) || 3; document.execCommand('fontSize', false, String(Math.max(1, Math.min(7, cur + delta)))) }
function applyTextColor(color: string) { noteEditor.focus(); if (_savedRange) { const sel = window.getSelection()!; sel.removeAllRanges(); sel.addRange(_savedRange) }; document.execCommand('foreColor', false, color); const cp = document.getElementById('color-preview'); if (cp) cp.style.color = color }
function showHighlightMenu(e: Event) { showFloatMenu(e, [{ label: '🟡 Yellow', fn: `applyHighlight('#fef08a')` }, { label: '🟢 Green', fn: `applyHighlight('#bbf7d0')` }, { label: '🩷 Pink', fn: `applyHighlight('#fecdd3')` }, { label: '🔵 Blue', fn: `applyHighlight('#bfdbfe')` }, '---', { label: '✕ Remove', fn: `applyHighlight('transparent')` }]) }
function applyHighlight(color: string) { noteEditor.focus(); if (!document.execCommand('hiliteColor', false, color)) document.execCommand('backColor', false, color) }
function setNoteImgSize(mode: string) { const img = (window as any)._noteImg as HTMLImageElement | null; if (!img) return; if (mode === 'small') { img.style.width = '200px'; img.style.maxWidth = '200px'; img.style.height = 'auto' } else if (mode === 'fit') { img.style.width = ''; img.style.maxWidth = '100%'; img.style.height = 'auto' } else { img.style.width = 'auto'; img.style.maxWidth = 'none'; img.style.height = 'auto' }; saveNote() }

async function saveNote() {
  noteEditor.querySelectorAll('input[type="checkbox"]').forEach((cb: Element) => { if ((cb as HTMLInputElement).checked) cb.setAttribute('checked', ''); else cb.removeAttribute('checked') })
  const html = noteEditor.innerHTML; const st = document.getElementById('note-status'); if (st) st.textContent = 'Saving…'
  try { await api('/memos/' + memoId + '/note', { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: html }); if (st) st.textContent = 'Saved ✓' }
  catch { if (st) st.textContent = 'Error' }
}

async function openShare() {
  shareOpen = true
  if (shareToken === null) {
    shareLoading = true
    try { const d = await (await api('/memos/' + memoId + '/share')).json(); shareToken = d.token } catch {}
    shareLoading = false
  }
}

async function generateShareLink() {
  shareLoading = true
  try { const d = await (await api('/memos/' + memoId + '/share', { method: 'POST' })).json(); shareToken = d.token } catch {}
  shareLoading = false
}

async function revokeShare() {
  if (!confirm('Revoke this share link? Anyone with the link will lose access.')) return
  try { await api('/memos/' + memoId + '/share', { method: 'DELETE' }); shareToken = null } catch {}
}

let shareCopied = $state(false)

function copyShareLink() {
  if (!shareToken) return
  const url = window.location.origin + '/share?token=' + shareToken
  navigator.clipboard.writeText(url)
  shareCopied = true
  setTimeout(() => { shareCopied = false }, 2000)
}

async function openCal() {
  if (!calDate) {
    const now = new Date()
    now.setHours(now.getHours() + 1, 0, 0, 0)
    calDate = now.toISOString().slice(0, 10)
    calTime = now.toTimeString().slice(0, 5)
  }
  calOpen = true
  try {
    const s = await (await api('/settings')).json() as Record<string, string>
    calCallId = s.gcal_call_id || ''
    calSmsId  = s.gcal_sms_id  || ''
  } catch {}
}

function addToGCal() {
  const title = (document.getElementById('title-input') as HTMLInputElement)?.value.trim() || 'Untitled'
  const div = document.createElement('div'); div.innerHTML = noteEditor?.innerHTML || ''
  const plain = (div.innerText || '').trim().replace(/\s+/g, ' ')
  const words = plain.split(' ')
  const desc = (words.length > 200 ? words.slice(0, 200).join(' ') + '…' : plain)

  const start = calDate.replace(/-/g, '') + 'T' + calTime.replace(':', '') + '00'
  const endDt = new Date(calDate + 'T' + calTime)
  endDt.setMinutes(endDt.getMinutes() + parseInt(calDur))
  const end = endDt.toISOString().slice(0, 10).replace(/-/g, '') + 'T' + endDt.toTimeString().slice(0, 5).replace(':', '') + '00'

  const params = new URLSearchParams({ action: 'TEMPLATE', text: title, details: desc, dates: start + '/' + end })
  const id = calCal === 'call' ? calCallId : calCal === 'sms' ? calSmsId : ''
  if (id) params.set('calid', id)
  const settingsPatch: Record<string,string> = {}
  if (calCal === 'call' && calCallId) settingsPatch.gcal_call_id = calCallId
  if (calCal === 'sms'  && calSmsId)  settingsPatch.gcal_sms_id  = calSmsId
  if (Object.keys(settingsPatch).length) api('/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settingsPatch) }).catch(() => {})

  window.open('https://calendar.google.com/calendar/render?' + params.toString(), '_blank')
  calOpen = false
}

async function copyLink() {
  const title = (document.getElementById('title-input') as HTMLInputElement).value.trim() || 'Untitled'
  await navigator.clipboard.writeText(title + '\n' + window.location.href)
  const btn = document.getElementById('copy-link-btn')!; const prev = btn.textContent!
  btn.textContent = '✓'; btn.style.opacity = '1'; setTimeout(() => { btn.textContent = prev; btn.style.opacity = '' }, 1500)
}

async function togglePin() { memo.pinned = memo.pinned ? 0 : 1; document.getElementById('pin-btn')?.classList.toggle('active', !!memo.pinned); await saveInfo() }
async function trashMemo() { if (!confirm('Move this memo to trash?')) return; try { await api('/memos/' + memoId, { method: 'DELETE' }); location.href = '/' } catch {} }
async function duplicateMemo() {
  const btn = document.getElementById('dup-btn') as HTMLButtonElement; btn.textContent = '…'; btn.disabled = true
  try { const r = await (await api('/memos/' + memoId + '/duplicate', { method: 'POST' })).json(); location.href = '/memo/?id=' + r.id }
  catch { btn.textContent = '⧉'; btn.disabled = false }
}

async function saveInfo() {
  const st = document.getElementById('info-status'); if (st) st.textContent = 'Saving…'
  try {
    const res = await api('/memos/' + memoId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      title: (document.getElementById('title-input') as HTMLInputElement).value.trim(),
      description: (document.getElementById('desc-input') as HTMLTextAreaElement).value.trim(),
      uid: (document.getElementById('uid-input') as HTMLInputElement).value.trim(),
      cover_file: (document.getElementById('cover-select') as HTMLSelectElement).value,
      tags: getTagsFromUI(), links: getLinksFromUI(), pinned: memo ? memo.pinned : 0,
      created_at: (document.getElementById('created-date-input') as HTMLInputElement)?.value || '',
    }) })
    if (!res.ok) { const err = await res.json().catch(() => ({})); console.error('saveInfo error', res.status, err); if (st) st.textContent = 'Error ' + res.status; return }
    if (memo) memo.uid = (document.getElementById('uid-input') as HTMLInputElement).value.trim()
    if (st) { st.textContent = 'Saved ✓'; setTimeout(() => { if (st) st.textContent = '' }, 2000) }
  } catch(e) { console.error('saveInfo failed:', e); if (st) st.textContent = 'Error' }
}

function renderTags(tags: string[]) {
  currentTags = [...tags]; const wrap = document.getElementById('tag-wrap')!
  wrap.querySelectorAll('.tag-chip').forEach(c => c.remove())
  currentTags.forEach(t => { const chip = document.createElement('span'); chip.className = 'tag-chip'; chip.innerHTML = `${esc(t)}<button onclick="removeTag('${esc(t)}')" title="Remove">×</button>`; wrap.insertBefore(chip, document.getElementById('tag-text-input')) })
}
function removeTag(t: string) { renderTags(currentTags.filter(x => x !== t)); saveInfo() }
function getTagsFromUI() { return [...currentTags] }

async function loadTagSuggestions() { try { allTagSuggestions = (await (await api('/tags')).json()).map((t: any) => t.tag) } catch {} }
function showTagSuggestions(val: string) {
  const drop = document.getElementById('tag-suggestions')!
  const matches = allTagSuggestions.filter(t => t.startsWith(val) && !currentTags.includes(t))
  if (!val || !matches.length) { drop.style.display = 'none'; return }
  drop.innerHTML = matches.slice(0, 6).map(t => `<div class="tag-sug-item" data-tag="${esc(t)}" onmousedown="selectTagSug('${esc(t)}')">${esc(t)}</div>`).join('')
  drop.style.display = ''
}
function selectTagSug(tag: string) {
  ;(document.getElementById('tag-text-input') as HTMLInputElement).value = ''
  document.getElementById('tag-suggestions')!.style.display = 'none'
  if (!currentTags.includes(tag)) { currentTags.push(tag); renderTags(currentTags); saveInfo() }
}

function renderLinks(links: Array<{label: string; url: string}>) {
  const list = document.getElementById('links-list')!; list.innerHTML = ''
  links.forEach((l, i) => {
    const row = document.createElement('div'); row.className = 'link-row'
    row.innerHTML = `<input type="text" placeholder="Label" value="${esc(l.label)}" data-idx="${i}" data-type="label"><input type="url" placeholder="URL" value="${esc(l.url)}" data-idx="${i}" data-type="url">${l.url ? `<a class="link-open-btn" href="${/^https?:\/\//i.test(l.url) ? esc(l.url) : 'https://' + esc(l.url)}" target="_blank" rel="noopener" title="Open link">↗</a>` : ''}<button onclick="removeLink(${i})">✕</button>`
    list.appendChild(row)
  })
}
function addLink() { renderLinks([...getLinksFromUI(), { label: '', url: '' }]) }
function removeLink(i: number) { const l = getLinksFromUI(); l.splice(i, 1); renderLinks(l) }
function getLinksFromUI() {
  return Array.from(document.querySelectorAll('.link-row')).map(row => ({
    label: (row.querySelector('[data-type="label"]') as HTMLInputElement | null)?.value || '',
    url: (row.querySelector('[data-type="url"]') as HTMLInputElement | null)?.value || '',
  })).filter(l => l.url)
}

async function saveMeta() { await api('/memos/' + memoId + '/meta', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) }) }

function printLabel() {
  const uid = (document.getElementById('uid-input') as HTMLInputElement).value.trim()
  const mid = document.getElementById('memo-id-badge')?.textContent || ''
  const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=10&data=' + encodeURIComponent(window.location.href)
  ;(document.getElementById('lbl-id') as HTMLElement).textContent = mid
  const lblUid = document.getElementById('lbl-uid') as HTMLElement; lblUid.textContent = uid; lblUid.style.display = uid ? '' : 'none'
  ;(document.getElementById('lbl-title') as HTMLElement).style.display = 'none'
  ;(document.getElementById('qr-img') as HTMLImageElement).src = qrUrl
  document.getElementById('label-modal')?.classList.remove('hidden')
}
function closeLabelModal() { document.getElementById('label-modal')?.classList.add('hidden') }
function printLabelModal() {
  const mid = document.getElementById('lbl-id')?.textContent || ''
  const uid = document.getElementById('lbl-uid')?.textContent || ''
  const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=' + encodeURIComponent(window.location.href)
  const w = window.open('', '_blank', 'width=380,height=500,menubar=no,toolbar=no,location=no,status=no')!
  w.document.write(`<!DOCTYPE html><html><head><title>Label</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Courier New',monospace;background:#f5f5f5;display:flex;align-items:flex-start;justify-content:center;padding:30px}.card{background:#fff;border-radius:16px;padding:24px 28px;text-align:center;box-shadow:0 2px 16px rgba(0,0,0,.12)}.card img{display:block;width:240px;height:240px;margin:0 auto 14px}.lbl-id{font-size:1.05rem;font-weight:bold;letter-spacing:.08em;color:#111}.lbl-uid{font-size:.88rem;color:#555;margin-top:5px;font-style:italic}.btn{margin-top:18px;padding:8px 24px;background:#1c1917;color:#fff;border:none;border-radius:8px;font-size:.9rem;cursor:pointer;font-family:inherit}@media print{.btn{display:none}body{background:#fff;padding:10px}.card{box-shadow:none;border-radius:0}}</style></head><body><div class="card"><img src="${qrUrl}" alt="QR code"><div class="lbl-id">${esc(mid)}</div>${uid ? `<div class="lbl-uid">${esc(uid)}</div>` : ''}<button class="btn" onclick="window.print()">🖨 Print</button></div></body></html>`)
  w.document.close()
}

async function loadSnippets() { try { snippets = await (await api('/memos/' + memoId + '/snippets')).json() } catch { snippets = [] }; renderSnippets() }
async function saveSnippets() { try { await api('/memos/' + memoId + '/snippets', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snippets) }) } catch {} }

function showClipPanel() {
  const panel = document.getElementById('clip-panel')!; panel.style.display = ''
  clipTitleInput.value = ''; clipPasteArea.innerHTML = ''; clipTitleInput.focus()
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}
function cancelClip() { document.getElementById('clip-panel')!.style.display = 'none' }
async function saveClip() {
  const title = clipTitleInput.value.trim() || 'Untitled clip'; const content = clipPasteArea.innerHTML
  if (!clipPasteArea.innerText.trim() && !clipPasteArea.querySelector('img')) { clipPasteArea.focus(); return }
  snippets.push({ id: crypto.randomUUID(), title, content, created_at: new Date().toISOString() })
  await saveSnippets(); renderSnippets(); cancelClip()
}

function renderSnippets() {
  const area = document.getElementById('snippets-area')!; const hdr = document.getElementById('snippets-hdr')!
  hdr.style.display = snippets.length ? '' : 'none'
  const cnt = document.getElementById('snippets-count'); if (cnt) cnt.textContent = `Clips (${snippets.length})`
  if (!snippets.length) { area.innerHTML = ''; return }
  area.innerHTML = snippets.map((s: any, i: number) => `<div class="snippet-card"><div class="snippet-hdr" onclick="toggleSnippet(${i})"><span class="snippet-icon">📋</span><span class="snippet-name" contenteditable="true" spellcheck="false" data-i="${i}" onclick="event.stopPropagation()" onblur="renameClip(this)">${esc(s.title)}</span><span class="snippet-ts">${new Date(s.created_at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span><button class="snippet-expand" onclick="openClipModal(${i},event)" title="Open in popup">⤢</button><button class="snippet-del" onclick="deleteSnippet(${i},event)" title="Delete clip">✕</button><span class="snippet-chev" id="chev-${i}">▸</span></div><div class="snippet-body" id="sb-${i}" style="display:none"><div class="snippet-content">${s.content}</div><div class="snippet-foot"><button onclick="copyClipText(${i})">Copy text</button></div></div></div>`).join('')
}

function toggleSnippet(i: number) { const body = document.getElementById('sb-' + i)!; const chev = document.getElementById('chev-' + i)!; const open = body.style.display !== 'none'; body.style.display = open ? 'none' : ''; chev.classList.toggle('open', !open) }
function openClipModal(i: number, e: Event) { e.stopPropagation(); const s = snippets[i]; ;(document.getElementById('clip-modal-title') as HTMLElement).textContent = s.title; ;(document.getElementById('clip-modal-body') as HTMLElement).innerHTML = s.content; document.getElementById('clip-modal')?.classList.remove('hidden'); document.body.style.overflow = 'hidden' }
function closeClipModal() { document.getElementById('clip-modal')?.classList.add('hidden'); document.body.style.overflow = '' }
async function deleteSnippet(i: number, e: Event) { e.stopPropagation(); if (!confirm('Delete this clip?')) return; snippets.splice(i, 1); await saveSnippets(); renderSnippets() }
async function renameClip(el: HTMLElement) { const i = parseInt(el.dataset.i!); const title = el.innerText.trim(); if (!title) { el.innerText = snippets[i].title; return }; if (title === snippets[i].title) return; snippets[i].title = title; await saveSnippets() }
async function copyClipText(i: number) { const s = snippets[i]; if (!s) return; const text = new DOMParser().parseFromString(s.content, 'text/html').body.innerText; try { await navigator.clipboard.writeText(text) } catch {} }

function htmlToMd(html: string): string {
  const div = document.createElement('div'); div.innerHTML = html
  function walk(node: Node): string {
    if (node.nodeType === 3) return node.textContent || ''
    if (node.nodeType !== 1) return ''
    const el = node as HTMLElement; const tag = el.tagName.toLowerCase()
    const inner = () => Array.from(el.childNodes).map(walk).join('')
    switch (tag) {
      case 'br': return '\n'
      case 'p': case 'div': { const c = inner(); return c ? c + '\n' : '' }
      case 'b': case 'strong': return `**${inner()}**`
      case 'i': case 'em': return `*${inner()}*`
      case 'u': return inner()
      case 's': case 'del': case 'strike': return `~~${inner()}~~`
      case 'h1': return `\n# ${inner()}\n`; case 'h2': return `\n## ${inner()}\n`; case 'h3': return `\n### ${inner()}\n`
      case 'ul': return Array.from(el.childNodes).filter(n => n.nodeType === 1 && (n as HTMLElement).tagName.toLowerCase() === 'li').map(li => `- ${Array.from(li.childNodes).map(walk).join('').trim()}`).join('\n') + '\n'
      case 'ol': return Array.from(el.childNodes).filter(n => n.nodeType === 1 && (n as HTMLElement).tagName.toLowerCase() === 'li').map((li, idx) => `${idx + 1}. ${Array.from(li.childNodes).map(walk).join('').trim()}`).join('\n') + '\n'
      case 'li': return inner()
      case 'a': return `[${inner()}](${(el as HTMLAnchorElement).href || ''})`
      case 'img': { const src = (el as HTMLImageElement).src; return src && !src.startsWith('data:') ? `![](${src})\n` : '' }
      default: return inner()
    }
  }
  return walk(div).replace(/\n{3,}/g, '\n\n').trim()
}

function buildExportHtml(): string {
  noteEditor.querySelectorAll('input[type="checkbox"]').forEach((cb: Element) => { if ((cb as HTMLInputElement).checked) cb.setAttribute('checked', ''); else cb.removeAttribute('checked') })
  const title = (document.getElementById('title-input') as HTMLInputElement).value.trim() || 'Untitled'
  const desc = (document.getElementById('desc-input') as HTMLTextAreaElement).value.trim()
  const noteHtml = noteEditor.innerHTML.trim(); const tags = currentTags
  const uid = memo?.uid || ''; const links = safeJson(memo?.links, [])
  const created = memo ? new Date(memo.created_at).toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' }) : ''
  const mId = memo?.memo_id || ''; const exportedAt = new Date().toLocaleString(undefined, { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
  const clipsSection = snippets.length ? `<section class="clips-section"><div class="section-hdr"><h2 class="section-label">Clips (${snippets.length})</h2><button class="expand-all-btn" onclick="var open=this.textContent.trim()==='Expand all';document.querySelectorAll('.clip-card').forEach(function(d){d.open=open});this.textContent=open?'Collapse all':'Expand all'">Expand all</button></div><nav class="clips-toc">${snippets.map((s: any, i: number) => `<a href="#clip-${i}">${esc(s.title)}</a>`).join('')}</nav>${snippets.map((s: any, i: number) => `<details id="clip-${i}" class="clip-card"><summary class="clip-summary"><span class="clip-title">${esc(s.title)}</span><span class="clip-ts">${new Date(s.created_at).toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span></summary><div class="clip-body">${s.content}</div></details>`).join('')}</section>` : ''
  const linksSection = (links as any[]).length ? `<section class="links-section"><h2 class="section-label">Links</h2>${(links as any[]).map((l: any) => `<a class="link-item" href="${esc(l.url)}" target="_blank">${esc(l.label || l.url)}</a>`).join('')}</section>` : ''
  const visibleFiles = allFiles.filter((f: any) => !f.key.startsWith('_'))
  const filesSection = visibleFiles.length ? `<section class="files-section"><h2 class="section-label">Files (${visibleFiles.length})</h2><div class="file-list">${visibleFiles.map((f: any) => { const fm = meta.files[f.key] || {}; const folder = f.key.includes('/') ? f.key.split('/').slice(0,-1).join('/') : ''; return `<div class="file-row"><div class="file-name">${esc(basename(f.key))}</div><div class="file-meta-row">${folder ? `<span class="file-folder">${esc(folder)}</span>` : ''}<span>${fmtSize(f.size)}</span><span>${fmtDate(f.uploaded)}</span>${fm.caption ? `<span class="file-caption">${esc(fm.caption)}</span>` : ''}</div></div>` }).join('')}</div></section>` : ''
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(title)}</title><style>*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f4;color:#1c1917;min-height:100vh;padding:40px 24px 80px}.page{max-width:1000px;margin:0 auto}.memo-header{background:#fff;border-radius:14px;padding:32px 36px 28px;box-shadow:0 1px 4px rgba(0,0,0,.08);margin-bottom:20px}.memo-title{font-size:2rem;font-weight:700;line-height:1.2;margin-bottom:10px}.memo-desc{font-size:1rem;color:#57534e;margin-bottom:16px;line-height:1.5}.memo-meta{display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-size:.82rem;color:#78716c}.tags{display:flex;flex-wrap:wrap;gap:6px}.tag{background:#ede9fe;color:#6366f1;padding:2px 10px;border-radius:12px;font-size:.78rem;font-weight:500}.memo-id{font-family:monospace;font-size:.75rem;color:#a8a29e}.card{background:#fff;border-radius:14px;padding:28px 36px;box-shadow:0 1px 4px rgba(0,0,0,.08);margin-bottom:20px}.section-label{font-size:.7rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#78716c;margin-bottom:18px}.note-content{font-size:.95rem;line-height:1.75;overflow-x:auto}.note-content h2{font-size:1.35rem;font-weight:700;margin:16px 0 6px}.note-content h3{font-size:1.05rem;font-weight:600;margin:12px 0 4px}.note-content ul,.note-content ol{padding-left:22px;margin:6px 0}.note-content hr{border:none;border-top:2px dashed #d4d4d4;margin:18px 0}.note-content input[type="checkbox"]{width:14px;height:14px;margin-right:4px;vertical-align:middle;accent-color:#6366f1}.section-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}.section-hdr .section-label{margin-bottom:0}.expand-all-btn{background:none;border:1px solid #e7e5e4;border-radius:6px;padding:4px 12px;font-size:.75rem;color:#78716c;cursor:pointer;font-family:inherit}.expand-all-btn:hover{border-color:#6366f1;color:#6366f1}.clips-toc{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px}.clips-toc a{color:#6366f1;font-size:.82rem;text-decoration:none;background:#ede9fe;padding:3px 10px;border-radius:10px}.clip-card{border:1px solid #e7e5e4;border-radius:10px;overflow:hidden;margin-bottom:14px}.clip-summary{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#fafaf9;cursor:pointer;list-style:none;gap:12px}.clip-summary::-webkit-details-marker{display:none}.clip-title{font-weight:600;font-size:.9rem}.clip-ts{font-size:.72rem;color:#78716c;flex-shrink:0}.clip-body{padding:16px;font-size:.88rem;line-height:1.7;overflow-x:auto;border-top:1px solid #e7e5e4}.file-list{display:flex;flex-direction:column}.file-row{padding:10px 0;border-bottom:1px solid #f0eeec}.file-row:last-child{border-bottom:none}.file-name{font-size:.88rem;font-weight:500;color:#1c1917;margin-bottom:3px}.file-meta-row{display:flex;flex-wrap:wrap;gap:8px;font-size:.75rem;color:#78716c}.file-folder{color:#a8a29e;font-style:italic}.file-caption{color:#57534e;font-style:italic}.link-item{display:block;color:#6366f1;font-size:.9rem;margin-bottom:8px;word-break:break-all}.export-footer{text-align:center;font-size:.75rem;color:#a8a29e;margin-top:32px;line-height:2}.export-source-link{color:#a8a29e;text-decoration:none;border-bottom:1px dotted #a8a29e}.export-source-link:hover{color:#6366f1;border-color:#6366f1}@media print{body{background:#fff;padding:0}.card,.memo-header{box-shadow:none;border:1px solid #e7e5e4}.note-content hr{page-break-after:always;border:none;height:0;margin:0}}</style></head><body><div class="page"><div class="memo-header"><div class="memo-title">${esc(title)}</div>${desc ? `<div class="memo-desc">${esc(desc)}</div>` : ''}<div class="memo-meta">${created ? `<span>📅 ${esc(created)}</span>` : ''}${uid ? `<span>🏷 ${esc(uid)}</span>` : ''}${tags.length ? `<span class="tags">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</span>` : ''}${mId ? `<span class="memo-id">${esc(mId)}</span>` : ''}</div></div>${noteHtml ? `<div class="card"><div class="section-label">Notes</div><div class="note-content">${noteHtml}</div></div>` : ''}${linksSection ? `<div class="card">${linksSection}</div>` : ''}${clipsSection ? `<div class="card">${clipsSection}</div>` : ''}${filesSection ? `<div class="card">${filesSection}</div>` : ''}<div class="export-footer">Exported from Memo · ${esc(exportedAt)}${mId ? ' · ' + esc(mId) : ''}<br><a class="export-source-link" href="${esc(window.location.href)}" target="_blank">View live memo ↗</a></div></div></body></html>`
}

function exportNote() {
  const html = buildExportHtml()
  const title = (document.getElementById('title-input') as HTMLInputElement).value.trim() || 'Untitled'
  const mId = memo?.memo_id || ''
  const slug = title.slice(0, 50).replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').toLowerCase()
  const blob = new Blob([html], { type: 'text/html' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (mId ? mId + '-' : '') + slug + '.html'; a.click(); URL.revokeObjectURL(a.href)
}

let emailSending = $state(false)
let emailStatus = $state('')

async function emailNote() {
  if (emailSending) return
  emailSending = true; emailStatus = 'Sending…'
  try {
    const r = await api('/memos/' + memoId + '/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        exportHtml: buildExportHtml(),
        noteHtml: noteEditor?.innerHTML.trim() || '',
        memoUrl: window.location.href,
      })
    })
    if (r.ok) { emailStatus = '✓ Sent!' } else { const e = await r.json().catch(() => ({})) as any; console.error('email failed:', e); emailStatus = '✗ ' + (e?.error || r.status) }
  } catch (e) { console.error('email error:', e); emailStatus = '✗ Failed' }
  emailSending = false
  setTimeout(() => { emailStatus = '' }, 3000)
}

async function exportClips() {
  if (!snippets.length) return
  const btn = document.getElementById('export-clips-btn') as HTMLButtonElement; btn.textContent = '…'; btn.disabled = true
  try {
    if (!(window as any).JSZip) { await new Promise<void>((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'; s.onload = () => res(); s.onerror = rej; document.head.appendChild(s) }) }
    const zip = new (window as any).JSZip(); const used: Record<string, number> = {}
    snippets.forEach((s: any) => { const base = (s.title.replace(/[^a-z0-9\s]/gi, '').trim().replace(/\s+/g, '-').toLowerCase() || 'clip').slice(0, 60); used[base] = (used[base] || 0) + 1; const fn = used[base] > 1 ? `${base}-${used[base]}.md` : `${base}.md`; const date = new Date(s.created_at).toLocaleDateString(undefined, {year:'numeric',month:'short',day:'numeric'}); zip.file(fn, `# ${s.title}\n\n*${date}*\n\n${htmlToMd(s.content)}\n`) })
    const blob = await zip.generateAsync({ type: 'blob' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `clips-${memo?.memo_id || memoId}-${new Date().toISOString().slice(0, 10)}.zip`; a.click(); URL.revokeObjectURL(a.href)
  } catch(e) { console.error('exportClips:', e) }
  btn.textContent = '⬇ Export .md'; btn.disabled = false
}

function gsSetIdx(i: number) {
  const items = document.querySelectorAll('#gsearch-drop .gsr-item')
  _gs_idx = Math.max(-1, Math.min(i, items.length - 1))
  items.forEach((el, j) => el.classList.toggle('hi', j === _gs_idx))
  if (_gs_idx >= 0) items[_gs_idx].scrollIntoView({ block: 'nearest' })
}
function gsGo(id: string) { window.location.href = '/memo/?id=' + encodeURIComponent(id) }
async function doGSearch(q: string) {
  const gsDrop = document.getElementById('gsearch-drop')!
  try { _gs_results = await (await api('/search?q=' + encodeURIComponent(q))).json() } catch { _gs_results = [] }
  _gs_idx = -1
  gsDrop.innerHTML = _gs_results.length ? _gs_results.slice(0, 8).map((r: any) => `<div class="gsr-item" data-id="${encodeURIComponent(r.id)}"><div class="gsr-title">${esc(r.title || 'Untitled')}</div><div class="gsr-meta">${esc(r.memo_id)}${r.uid ? ' · ' + esc(r.uid) : ''}</div>${r.description ? `<div class="gsr-desc">${esc(r.description)}</div>` : ''}</div>`).join('') : '<div class="gsr-item" style="color:var(--muted);cursor:default">No results</div>'
  gsDrop.classList.add('open')
}

function positionHover(e: MouseEvent) {
  const hb = document.getElementById('hover-preview')!; const w = 260, h = 260, pad = 16
  let left = e.clientX + pad, top = e.clientY - h / 2
  if (left + w > window.innerWidth) left = e.clientX - w - pad
  hb.style.left = left + 'px'; hb.style.top = Math.max(pad, Math.min(top, window.innerHeight - h - pad)) + 'px'
}

function onKeyDown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement).tagName
  const inEditable = ['INPUT','TEXTAREA','SELECT'].includes(tag) || (e.target as HTMLElement).isContentEditable
  const lbOpen = !document.getElementById('lightbox')?.classList.contains('hidden')
  if (e.key === 'Escape') {
    if (lbOpen) { closeLightbox(); return }
    if (!document.getElementById('info-modal')?.classList.contains('hidden')) { closeModal(); return }
    if (!document.getElementById('trash-modal')?.classList.contains('hidden')) { closeTrashModal(); return }
  }
  if (lbOpen) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); lbNav(-1) }
    if (e.key === 'ArrowRight') { e.preventDefault(); lbNav(1) }
  }
  if (inEditable && (e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault(); saveNote()
  }
}

onMount(() => {
  memoId = new URLSearchParams(location.search).get('id') || ''
  viewMode = localStorage.getItem('memo_view') || 'list'

  Object.assign(window, {
    setFolder, showFolderMenu, toggleSelect, openLightbox, downloadFile,
    showMoveMenu, openFileInfo, trashFile, showFileMenu,
    restoreFile, permDelete,
    toggleSnippet, openClipModal, deleteSnippet, renameClip, copyClipText,
    removeTag, selectTagSug, removeLink,
    moveFile, bulkMoveTo, applyBlockStyle, applyHighlight,
    renameFolder, removeFolder, setNoteImgSize, openFolderPicker,
  })

  document.addEventListener('keydown', onKeyDown)

  const dropZone = document.getElementById('drop-zone')!
  dropZone.addEventListener('click', () => { if (!_pickerActive) openFilePicker() })
  dropZone.addEventListener('dragover', (e: DragEvent) => { e.preventDefault(); dropZone.classList.add('drag-over') })
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'))
  dropZone.addEventListener('drop', async (e: DragEvent) => { e.preventDefault(); dropZone.classList.remove('drag-over'); await uploadFiles(Array.from(e.dataTransfer!.files) as File[]) })

  document.addEventListener('click', (e: MouseEvent) => { const m = document.getElementById('float-menu'); if (m) m.style.display = 'none'; if (shareOpen && !(e.target as HTMLElement).closest('.share-popup') && !(e.target as HTMLElement).closest('[title="Share"]')) shareOpen = false })

  const gsInput = document.getElementById('gsearch') as HTMLInputElement
  const gsDrop = document.getElementById('gsearch-drop')!
  gsInput.addEventListener('input', () => { clearTimeout(_gs_timer!); const q = gsInput.value.trim(); if (!q) { gsDrop.classList.remove('open'); _gs_idx = -1; return }; _gs_timer = setTimeout(() => doGSearch(q), 300) })
  gsInput.addEventListener('keydown', e => {
    if (!gsDrop.classList.contains('open')) return
    if (e.key === 'ArrowDown') { e.preventDefault(); gsSetIdx(_gs_idx + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); gsSetIdx(_gs_idx - 1) }
    else if (e.key === 'Enter' && _gs_idx >= 0) { e.preventDefault(); const items = gsDrop.querySelectorAll('[data-id]'); const el = items[_gs_idx] as HTMLElement | undefined; if (el) gsGo(decodeURIComponent(el.dataset.id!)) }
    else if (e.key === 'Escape') { gsDrop.classList.remove('open'); gsInput.blur() }
  })
  gsDrop.addEventListener('click', e => { const item = (e.target as HTMLElement).closest('[data-id]') as HTMLElement | null; if (item) gsGo(decodeURIComponent(item.dataset.id!)) })
  document.addEventListener('click', e => { if (!(e.target as HTMLElement).closest('.gsearch-wrap')) { gsDrop.classList.remove('open'); _gs_idx = -1 } })

  noteEditor.addEventListener('input', () => { const st = document.getElementById('note-status'); if (st) st.textContent = 'Unsaved…'; clearTimeout(_noteTimer!); _noteTimer = setTimeout(saveNote, 2000) })
  noteEditor.addEventListener('blur', () => { clearTimeout(_noteTimer!); saveNote() })
  noteEditor.addEventListener('paste', (e: ClipboardEvent) => {
    const imgItem = Array.from(e.clipboardData!.items).find(i => i.type.startsWith('image/')); if (!imgItem) return
    e.preventDefault(); const file = imgItem.getAsFile()!; const reader = new FileReader()
    reader.onload = (ev: ProgressEvent<FileReader>) => { document.execCommand('insertHTML', false, `<img src="${ev.target!.result}" data-paste-img="1" style="max-width:100%;height:auto">`); saveNote() }
    reader.readAsDataURL(file)
  })
  clipPasteArea.addEventListener('paste', (e: ClipboardEvent) => {
    const imgItem = Array.from(e.clipboardData!.items).find(i => i.type.startsWith('image/')); if (!imgItem) return
    e.preventDefault(); const file = imgItem.getAsFile()!; const reader = new FileReader()
    reader.onload = (ev: ProgressEvent<FileReader>) => { document.execCommand('insertHTML', false, `<img src="${ev.target!.result}" style="max-width:100%;height:auto">`) }
    reader.readAsDataURL(file)
  })
  noteEditor.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.tagName === 'IMG' && (target as HTMLImageElement).dataset.pasteImg) {
      e.stopPropagation(); (window as any)._noteImg = target
      showFloatMenuAt(target.getBoundingClientRect(), [{ label: 'Small  (200 px)', fn: `setNoteImgSize('small')` }, { label: 'Best fit  (100%)', fn: `setNoteImgSize('fit')` }, { label: 'Original size', fn: `setNoteImgSize('original')` }])
    }
  })

  const colorInput = document.getElementById('text-color-input') as HTMLInputElement
  colorInput.addEventListener('mousedown', () => { const sel = window.getSelection(); if (sel?.rangeCount) _savedRange = sel.getRangeAt(0).cloneRange() })
  colorInput.addEventListener('input', e => applyTextColor((e.target as HTMLInputElement).value))

  document.addEventListener('keydown', e => { if (document.activeElement !== noteEditor) return; if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); changeFontSize(1) }; if ((e.metaKey || e.ctrlKey) && e.key === '-') { e.preventDefault(); changeFontSize(-1) } })

  const lb = document.getElementById('lightbox')!
  lb.addEventListener('click', e => { if (e.target === lb) closeLightbox() })
  document.addEventListener('keydown', e => { if (lb.classList.contains('hidden')) return; if (e.key === 'Escape') closeLightbox(); if (e.key === 'ArrowLeft') lbNav(-1); if (e.key === 'ArrowRight') lbNav(1) })

  const clipModal = document.getElementById('clip-modal')!
  clipModal.addEventListener('click', e => { if (e.target === clipModal) closeClipModal() })
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !clipModal.classList.contains('hidden')) closeClipModal() })

  const hoverBox = document.getElementById('hover-preview')!; const hoverImg = hoverBox.querySelector('img') as HTMLImageElement
  document.addEventListener('mouseover', (e: MouseEvent) => { const t = e.target as HTMLElement; if (t.dataset?.preview && (t as HTMLImageElement).src) { hoverImg.src = (t as HTMLImageElement).src; hoverBox.style.display = 'block'; positionHover(e) } })
  document.addEventListener('mouseout', (e: MouseEvent) => { const t = e.target as HTMLElement; if (t.dataset?.preview) { hoverBox.style.display = 'none'; hoverImg.src = '' } })
  document.addEventListener('mousemove', (e: MouseEvent) => { if (hoverBox.style.display !== 'none') positionHover(e) })

  document.getElementById('title-input')?.addEventListener('change', saveInfo)
  document.getElementById('desc-input')?.addEventListener('change', saveInfo)
  document.getElementById('uid-input')?.addEventListener('change', saveInfo)

  document.getElementById('links-list')?.addEventListener('input', (e: Event) => {
    const target = e.target as HTMLInputElement
    if (target.dataset.type === 'url') {
      const row = target.closest('.link-row')!; let btn = row.querySelector('.link-open-btn') as HTMLAnchorElement | null
      const url = target.value.trim()
      if (url && !btn) { btn = document.createElement('a') as HTMLAnchorElement; btn.className = 'link-open-btn'; btn.target = '_blank'; btn.rel = 'noopener'; btn.title = 'Open link'; btn.textContent = '↗'; target.insertAdjacentElement('afterend', btn) }
      if (btn) { btn.href = /^https?:\/\//i.test(url) ? url : 'https://' + url; btn.style.display = url ? '' : 'none' }
    }
    const st = document.getElementById('info-status'); if (st) st.textContent = 'Unsaved…'
    clearTimeout(_infoTimer!); _infoTimer = setTimeout(saveInfo, 2000)
  })

  const tagInput = document.getElementById('tag-text-input') as HTMLInputElement
  const tagDrop = document.getElementById('tag-suggestions')!
  tagInput.addEventListener('input', e => showTagSuggestions((e.target as HTMLInputElement).value.trim().toLowerCase()))
  tagInput.addEventListener('blur', () => setTimeout(() => { tagDrop.style.display = 'none' }, 150))
  tagInput.addEventListener('keydown', e => {
    if (e.key === 'Tab') { const first = tagDrop.querySelector('.tag-sug-item') as HTMLElement | null; if (tagDrop.style.display !== 'none' && first) { e.preventDefault(); selectTagSug(first.dataset.tag!); return } }
    if (e.key === 'Escape') { tagDrop.style.display = 'none'; return }
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); const val = tagInput.value.trim().replace(/,$/, '').toLowerCase(); tagDrop.style.display = 'none'; if (val && !currentTags.includes(val)) { currentTags.push(val); renderTags(currentTags); saveInfo() }; tagInput.value = '' }
  })

  init()
})

onDestroy(() => {
  document.removeEventListener('keydown', onKeyDown)
})
</script>

<div class="page-header">
  <a href="/" class="back-link">← Back</a>
  <span id="memo-id-badge" class="memo-id-badge">…</span>
  <div class="header-spacer"></div>
  <button class="btn-icon" id="pin-btn" data-tip="Pin" onclick={togglePin}>📌</button>
  <button class="btn-icon" id="dup-btn" data-tip="Duplicate" onclick={duplicateMemo}>⧉</button>
  <button class="btn-icon" id="copy-link-btn" data-tip="Copy link" onclick={copyLink}>🔗</button>
  <button class="btn-icon" data-tip="Export note" onclick={exportNote}>↓</button>
  <button class="btn-icon email-btn" data-tip={emailStatus || 'Email note to myself'} onclick={emailNote} disabled={emailSending} style={emailStatus.startsWith('✓') ? 'opacity:1;color:var(--success)' : emailStatus.startsWith('✗') ? 'opacity:1;color:var(--danger)' : ''}>✉</button>
  <button class="btn-icon" data-tip="Print label" onclick={printLabel}>🏷</button>
  <button class="btn-icon" data-tip="Move to trash" onclick={trashMemo}>🗑</button>
  <div style="position:relative">
    <button class="btn-icon" data-tip="Add to Google Calendar" onclick={openCal}>📅</button>
    {#if calOpen}
    <div class="share-popup" style="width:300px" onclick={(e) => e.stopPropagation()}>
      <button class="share-popup-close" onclick={() => calOpen = false}>✕</button>
      <div class="share-popup-title">Add to Google Calendar</div>
      <div class="cal-row"><label class="cal-label">Date</label><input type="date" class="cal-input" bind:value={calDate}></div>
      <div class="cal-row"><label class="cal-label">Time</label><input type="time" class="cal-input" bind:value={calTime}></div>
      <div class="cal-row"><label class="cal-label">Duration</label>
        <select class="cal-input" bind:value={calDur}>
          <option value="15">15 min</option>
          <option value="30">30 min</option>
          <option value="60">1 hour</option>
          <option value="120">2 hours</option>
        </select>
      </div>
      <div class="cal-row"><label class="cal-label">Calendar</label>
        <select class="cal-input" bind:value={calCal}>
          <option value="default">Default</option>
          <option value="call">Call</option>
          <option value="sms">SMS</option>
        </select>
      </div>
      {#if calCal === 'call' || calCal === 'sms'}
      <div class="cal-row" style="align-items:flex-start;flex-direction:column;gap:4px">
        <label class="cal-label" style="width:auto">{calCal === 'call' ? 'Call' : 'SMS'} calendar ID</label>
        <input type="text" class="cal-input" style="width:100%" placeholder="abc@group.calendar.google.com"
          value={calCal === 'call' ? calCallId : calSmsId}
          oninput={(e) => calCal === 'call' ? (calCallId = e.currentTarget.value) : (calSmsId = e.currentTarget.value)}>
        <div class="share-popup-info" style="margin:0">Google Calendar → Settings → [calendar name] → Calendar ID</div>
      </div>
      {/if}
      <button class="share-popup-btn" style="width:100%;margin-top:10px" onclick={addToGCal}>Open Google Calendar ↗</button>
    </div>
    {/if}
  </div>
  <div style="position:relative">
    <button class="header-btn" onclick={openShare} title="Share">↗ Share</button>
    {#if shareOpen}
    <div class="share-popup" onclick={(e) => e.stopPropagation()}>
      <button class="share-popup-close" onclick={() => shareOpen = false}>✕</button>
      <div class="share-popup-title">Share memo</div>
      {#if shareLoading}
        <div class="share-popup-info">Loading…</div>
      {:else if shareToken}
        <div class="share-popup-info">Anyone with this link can view (read-only)</div>
        <input class="share-popup-url" readonly value={window.location.origin + '/share?token=' + shareToken}>
        <div class="share-popup-actions">
          <button class="share-popup-btn" class:copied={shareCopied} onclick={copyShareLink}>{shareCopied ? '✓ Copied!' : 'Copy link'}</button>
          <button class="share-popup-btn danger" onclick={revokeShare}>Revoke</button>
        </div>
      {:else}
        <div class="share-popup-info">Generate a read-only link to share this memo</div>
        <button class="share-popup-btn" onclick={generateShareLink}>Generate link</button>
      {/if}
    </div>
    {/if}
  </div>
  <button id="signout-btn" onclick={logout}>Sign out</button>
</div>

<div class="gsearch-wrap">
  <input type="search" id="gsearch" placeholder="Search all memos…" autocomplete="off" spellcheck="false">
  <div class="gsearch-drop" id="gsearch-drop"></div>
</div>

<div class="title-section">
  <input type="text" id="title-input" placeholder="Untitled memo" autocomplete="off">
  <textarea id="desc-input" placeholder="Add a description…" rows="1" oninput={(e) => autoGrow(e.currentTarget as HTMLTextAreaElement)}></textarea>
</div>

<div class="quick-meta">
  <div class="qm-uid">
    <span class="qm-label">UID</span>
    <input type="text" id="uid-input" placeholder="e.g. STOR-001">
  </div>
  <div class="qm-sep"></div>
  <div class="qm-tags">
    <span class="qm-label">Tags</span>
    <div class="tag-input-wrap" id="tag-wrap" onclick={() => (document.getElementById('tag-text-input') as HTMLInputElement)?.focus()}>
      <input type="text" id="tag-text-input" placeholder="Add tag, press Enter…" autocomplete="off">
    </div>
    <div id="tag-suggestions" style="display:none"></div>
  </div>
</div>

<details class="section" open>
  <summary>Notes <span class="s-right" id="note-hint"></span></summary>
  <div class="section-body">
    <div class="editor-toolbar">
      <button onclick={showBlockStyleMenu} title="Text style">Aa ▾</button>
      <div class="tb-sep"></div>
      <button onclick={() => exec('bold')} title="Bold (⌘B)"><b>B</b></button>
      <button onclick={() => exec('italic')} title="Italic (⌘I)"><i>I</i></button>
      <button onclick={() => exec('underline')} title="Underline (⌘U)"><u>U</u></button>
      <button onclick={() => exec('strikeThrough')} title="Strikethrough"><s>S</s></button>
      <div class="tb-sep"></div>
      <button onclick={() => changeFontSize(1)} title="Larger (⌘=)">A+</button>
      <button onclick={() => changeFontSize(-1)} title="Smaller (⌘−)">A−</button>
      <div class="tb-sep"></div>
      <div class="tb-color-wrap" title="Text color">
        <div class="tb-color-preview" id="color-preview">A</div>
        <input type="color" id="text-color-input" value="#1c1917">
      </div>
      <button onclick={showHighlightMenu} title="Highlight">H▾</button>
      <div class="tb-sep"></div>
      <button onclick={() => exec('insertUnorderedList')}>• List</button>
      <button onclick={() => exec('insertOrderedList')}>1. List</button>
      <div class="tb-sep"></div>
      <button onclick={insertPageBreak} title="Insert page break">— Break</button>
      <button onclick={() => exec('indent')} title="Indent">⇥</button>
      <button onclick={() => exec('outdent')} title="Outdent">⇤</button>
      <button onclick={insertTask} title="Insert checkbox task">☐ Task</button>
      <div class="tb-sep"></div>
      <button onclick={clearNote}>Clear</button>
      <div class="tb-sep"></div>
      <button onclick={showClipPanel} title="Capture a clip">📋 Clip</button>
    </div>
    <div id="note-editor" contenteditable="true" spellcheck="true" bind:this={noteEditor}></div>
    <div class="note-footer">
      <span id="note-status">No note yet</span>
      <button id="save-note-btn" onclick={saveNote}>Save note</button>
    </div>

    <div class="clip-panel" id="clip-panel" style="display:none">
      <div class="clip-panel-head">📋 New clip — paste content, give it a title, then save</div>
      <input type="text" id="clip-title-input" placeholder="Title for this clip…" maxlength="120" bind:this={clipTitleInput}>
      <div id="clip-paste-area" contenteditable="true" spellcheck="false" bind:this={clipPasteArea}></div>
      <div class="clip-foot">
        <button class="clip-cancel" onclick={cancelClip}>Cancel</button>
        <button class="clip-save" onclick={saveClip}>Save clip</button>
      </div>
    </div>

    <div class="snippets-hdr" id="snippets-hdr" style="display:none">
      <span class="snippets-hdr-label" id="snippets-count"></span>
      <button id="export-clips-btn" onclick={exportClips}>⬇ Export .md</button>
    </div>
    <div class="snippets-area" id="snippets-area"></div>
  </div>
</details>

<details class="section">
  <summary>Memo Info</summary>
  <div class="section-body">
    <div class="field-group">
      <label class="field-label">Created</label>
      <input type="date" id="created-date-input" class="field-input" style="width:auto">
    </div>
    <div class="field-group">
      <label class="field-label">Cover Image</label>
      <select id="cover-select" class="field-input"><option value="">— None —</option></select>
    </div>
    <div class="field-group">
      <label class="field-label">Links</label>
      <div class="links-list" id="links-list"></div>
      <button id="add-link-btn" onclick={addLink}>+ Add link</button>
    </div>
    <div class="note-footer" style="margin-top:14px">
      <span id="info-status" style="font-size:.78rem;color:var(--muted)"></span>
      <button id="save-info-btn" onclick={saveInfo}>Save</button>
    </div>
  </div>
</details>

<div class="file-browser">
  <div class="drop-zone" id="drop-zone">
    <div class="drop-zone-icon">↑</div>
    <div class="drop-zone-text" id="drop-zone-text">Drop files here · or <b>click to browse</b> · or <b onclick={(e) => { e.stopPropagation(); openFolderPicker() }} style="cursor:pointer">upload folder</b></div>
    {#if uploadVisible}
    <div id="upload-progress">
      <div id="upload-bar-row">
        <div id="upload-bar"><div id="upload-bar-fill" style="width:{uploadPercent}%"></div></div>
        <button id="upload-cancel" onclick={(e) => { e.stopPropagation(); cancelUpload() }} title="Cancel">✕</button>
      </div>
      <div id="upload-bar-text">{uploadLabel}</div>
    </div>
    {/if}
  </div>

  <div class="fb-toolbar">
    <div class="fb-left">
      <span class="fb-label">Files</span>
      <span class="fb-size" id="fb-size"></span>
      <button class="view-btn active" id="view-list-btn" onclick={() => setView('list')} title="List view">☰</button>
      <button class="view-btn" id="view-grid-btn" onclick={() => setView('grid')} title="Grid view">⊞</button>
      <select id="sort-select" onchange={renderFileList}>
        <option value="name">Name</option>
        <option value="type">Type</option>
        <option value="date">Date</option>
        <option value="size">Size</option>
      </select>
      <button class="sort-dir-btn" id="sort-dir-btn" onclick={toggleSortDir}>▲</button>
    </div>
    <div class="fb-right">
      <button class="fb-btn fb-btn-primary" onclick={openFilePicker}>Upload</button>
      <button class="fb-btn" onclick={addFolder}>New folder</button>
      <button class="fb-btn fb-btn-danger" id="trash-btn" onclick={openTrashModal}>Trash (<span id="trash-count-btn">0</span>)</button>
      <button class="fb-btn" onclick={loadFiles}>Refresh</button>
      <button class="fb-btn fb-btn-danger" onclick={clearAll}>Clear all</button>
    </div>
  </div>

  <div class="breadcrumb" id="breadcrumb" style="display:none">
    <button class="bc-back" onclick={() => setFolder('')}>← Back</button>
    <span class="bc-sep">›</span>
    <span class="bc-current" id="bc-folder-name"></span>
  </div>

  <div class="select-bar">
    <button class="sel-btn" onclick={selectAll}>Select all</button>
    <button class="sel-btn" onclick={deselectAll}>Deselect all</button>
    <span id="sel-count"></span>
  </div>

  <div id="file-list"></div>
  <div class="file-list-empty" id="file-list-empty" style="display:none">No files here yet.</div>

  <div class="gallery-section" id="gallery-section" style="display:none">
    <div class="gallery-header" id="gallery-header">Images</div>
    <div class="image-gallery" id="image-gallery"></div>
  </div>
</div>

<div class="bulk-bar" id="bulk-bar">
  <span class="bulk-count" id="bulk-count">0 selected</span>
  <span class="bulk-sep">|</span>
  <button class="bulk-action" onclick={bulkTag}>Tag</button>
  <span class="bulk-sep">|</span>
  <button class="bulk-action" onclick={showBulkMoveMenu}>Move</button>
  <span class="bulk-sep">|</span>
  <button class="bulk-action bulk-del" onclick={bulkTrash}>Delete</button>
  <span class="bulk-sep">|</span>
  <button class="bulk-action" onclick={bulkDownload}>↓ Download</button>
  <button class="bulk-cancel bulk-action" onclick={deselectAll}>Cancel</button>
</div>

<!-- Trash modal -->
<div class="modal-overlay hidden" id="trash-modal">
  <div class="modal-box" style="max-width:540px">
    <div class="modal-hdr">
      <div><h3>Trash</h3><div class="modal-sub" id="trash-modal-sub"></div></div>
      <button class="modal-close" onclick={closeTrashModal}>✕</button>
    </div>
    <div class="modal-scroll" id="trash-modal-list"></div>
    <div class="modal-ftr">
      <div class="modal-ftr-left">
        <button class="btn-danger-sm" onclick={emptyTrash}>Empty trash</button>
        <button class="btn-cancel" onclick={restoreAll}>Restore all</button>
      </div>
      <button class="btn-cancel" onclick={closeTrashModal}>Close</button>
    </div>
  </div>
</div>

<!-- Label modal -->
<div class="modal-overlay hidden" id="label-modal">
  <div class="modal-box" style="max-width:320px;text-align:center">
    <div class="modal-hdr" style="justify-content:flex-end"><button class="modal-close" onclick={closeLabelModal}>✕</button></div>
    <img id="qr-img" style="display:block;margin:0 auto 4px;width:200px;height:200px" alt="QR code">
    <div id="lbl-id" style="font-family:'DM Mono',monospace;font-size:1rem;font-weight:700;letter-spacing:.08em;margin-top:6px"></div>
    <div id="lbl-uid" style="font-size:.9rem;color:var(--muted);margin-top:4px;font-family:'DM Mono',monospace"></div>
    <div id="lbl-title" style="font-size:.82rem;color:var(--muted);margin-top:6px;word-break:break-word"></div>
    <div class="modal-ftr" style="justify-content:center;margin-top:20px;gap:10px">
      <button class="btn-cancel" onclick={closeLabelModal}>Close</button>
      <button class="btn-save" onclick={printLabelModal}>🖨 Print</button>
    </div>
  </div>
</div>

<!-- File info modal -->
<div class="modal-overlay hidden" id="info-modal">
  <div class="modal-box file-info-modal" style="max-width:380px">
    <div class="modal-hdr"><h3>File Info</h3><button class="modal-close" onclick={closeModal}>✕</button></div>
    <label>Caption</label>
    <input type="text" id="modal-caption" placeholder="Describe this file…">
    <label>Tags (comma separated)</label>
    <input type="text" id="modal-tags" placeholder="tag1, tag2">
    <div class="modal-ftr" style="justify-content:flex-end">
      <button class="btn-cancel" onclick={closeModal}>Cancel</button>
      <button class="btn-save" onclick={saveFileInfo}>Save</button>
    </div>
  </div>
</div>

<!-- Clip modal -->
<div id="clip-modal" class="hidden">
  <div id="clip-modal-box">
    <div id="clip-modal-hdr">
      <span id="clip-modal-title"></span>
      <button id="clip-modal-close" onclick={closeClipModal}>✕</button>
    </div>
    <div id="clip-modal-body"></div>
  </div>
</div>

<!-- Lightbox -->
<div id="lightbox" class="hidden">
  <button id="lb-close" onclick={closeLightbox}>✕</button>
  <button id="lb-prev" onclick={() => lbNav(-1)}>‹</button>
  <div id="lb-content"></div>
  <button id="lb-next" onclick={() => lbNav(1)}>›</button>
  <div id="lb-caption"></div>
  <div id="lb-counter"></div>
</div>

<!-- Hover preview -->
<div id="hover-preview"><img src="" alt=""></div>

<!-- Float menu -->
<div class="float-menu" id="float-menu"></div>

<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --danger-light:#fef2f2;--danger-border:#fecaca;
  --success:#22c55e;--radius:10px;--shadow:0 1px 3px rgba(0,0,0,.08);
}
.page-header{background:var(--surface);border-bottom:1px solid var(--border);padding:0 20px;height:52px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:100}
.back-link{color:var(--muted);text-decoration:none;font-size:.85rem;padding:4px 8px;border-radius:6px;flex-shrink:0}
.back-link:hover{background:var(--bg);color:var(--text)}
.memo-id-badge{font-family:'DM Mono',monospace;font-size:.75rem;color:var(--accent);font-weight:500;background:#ede9fe;padding:3px 10px;border-radius:20px;flex-shrink:0;white-space:nowrap}
.header-spacer{flex:1}
.gsearch-wrap{background:var(--surface);border-bottom:1px solid var(--border);padding:8px 16px;position:sticky;top:52px;z-index:99}
#gsearch{width:100%;padding:7px 14px;border:1px solid var(--border);border-radius:8px;font-size:.9rem;font-family:inherit;background:var(--bg);color:var(--text);outline:none}
#gsearch:focus{border-color:var(--accent)}
.gsearch-drop{position:absolute;left:16px;right:16px;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:200;max-height:340px;overflow-y:auto}
.btn-icon{background:none;border:none;cursor:pointer;padding:5px 7px;border-radius:7px;font-size:.95rem;opacity:.45;line-height:1;transition:opacity .1s;flex-shrink:0;position:relative}
.email-btn{font-size:1.25rem;font-weight:700;padding:5px 9px;opacity:.6}
.btn-icon:hover{opacity:1;background:var(--bg)}
.btn-icon[data-tip]::after{content:attr(data-tip);position:absolute;top:calc(100% + 6px);left:50%;transform:translateX(-50%);background:#1c1917;color:#fff;font-size:.7rem;font-family:'DM Sans',sans-serif;white-space:nowrap;padding:3px 8px;border-radius:5px;pointer-events:none;opacity:0;transition:opacity .15s;z-index:500}
.btn-icon[data-tip]:hover::after{opacity:1}
#signout-btn{background:none;border:1px solid var(--border);border-radius:7px;padding:5px 10px;font-size:.78rem;cursor:pointer;color:var(--muted);font-family:inherit;flex-shrink:0}
#signout-btn:hover{border-color:var(--text);color:var(--text)}
.header-btn{background:none;border:1px solid var(--border);border-radius:7px;padding:5px 10px;font-size:.78rem;cursor:pointer;color:var(--muted);font-family:inherit;flex-shrink:0}
.header-btn:hover{border-color:var(--accent);color:var(--accent)}
.share-popup{position:absolute;top:calc(100% + 6px);right:0;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;width:300px;box-shadow:0 8px 24px rgba(0,0,0,.14);z-index:600}
.share-popup-close{position:absolute;top:10px;right:10px;background:none;border:none;cursor:pointer;color:var(--muted);font-size:.85rem;padding:2px 6px;border-radius:4px}
.share-popup-close:hover{color:var(--text)}
.share-popup-title{font-size:.9rem;font-weight:600;margin-bottom:8px}
.share-popup-info{font-size:.8rem;color:var(--muted);margin-bottom:10px}
.share-popup-url{width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:.72rem;font-family:'DM Mono',monospace;color:var(--text);background:var(--bg);margin-bottom:8px;box-sizing:border-box}
.share-popup-actions{display:flex;gap:6px}
.share-popup-btn{padding:6px 14px;border-radius:7px;border:1px solid var(--border);background:transparent;font-size:.82rem;font-family:inherit;cursor:pointer;color:var(--text)}
.share-popup-btn:hover{border-color:var(--accent);color:var(--accent)}
.share-popup-btn.copied{border-color:var(--success);color:var(--success);pointer-events:none}
.share-popup-btn.danger{color:var(--danger);border-color:var(--danger-border)}
.share-popup-btn.danger:hover{background:var(--danger-light)}
.title-section{background:var(--surface);border-bottom:1px solid var(--border);padding:16px 20px 14px}
#title-input{width:100%;border:none;outline:none;font-size:1.5rem;font-weight:600;font-family:inherit;color:var(--text);background:transparent;margin-bottom:6px;display:block}
#title-input::placeholder{color:#d4d4d4;font-weight:400}
#desc-input{width:100%;border:none;outline:none;font-size:.9rem;font-family:inherit;color:var(--muted);background:transparent;resize:none;min-height:20px;line-height:1.5;display:block;overflow:hidden}
#desc-input::placeholder{color:#d4d4d4}
.quick-meta{background:var(--surface);border-top:1px solid var(--border);padding:10px 20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.qm-uid{display:flex;align-items:center;gap:8px;flex-shrink:0}
.qm-label{font-size:.72rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);white-space:nowrap}
.qm-uid input{border:1px solid var(--border);border-radius:7px;padding:5px 10px;font-size:.85rem;font-family:inherit;width:150px;color:var(--text);background:transparent}
.qm-uid input:focus{outline:none;border-color:var(--accent)}
.qm-sep{width:1px;height:20px;background:var(--border);flex-shrink:0}
.qm-tags{display:flex;align-items:center;gap:8px;flex:1;min-width:180px;position:relative}
.qm-tags .tag-input-wrap{flex:1;padding:4px 8px;min-height:32px}
#tag-suggestions{position:absolute;top:100%;left:0;min-width:160px;background:var(--surface);border:1px solid var(--border);border-radius:8px;box-shadow:var(--shadow);z-index:200;overflow:hidden;margin-top:2px}
.section{background:var(--surface);border-top:1px solid var(--border)}
.section summary{padding:14px 20px;cursor:pointer;font-size:.85rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--text);display:flex;align-items:center;justify-content:space-between;list-style:none;user-select:none}
.section summary::-webkit-details-marker{display:none}
.section summary:hover{color:var(--accent)}
.section summary .s-right{font-size:.75rem;color:var(--muted);font-weight:400;text-transform:none;letter-spacing:0}
.section-body{padding:0 20px 20px}
.editor-toolbar{display:flex;gap:3px;flex-wrap:wrap;align-items:center;position:sticky;top:104px;z-index:10;background:var(--surface);padding:6px 0 8px;margin:0 -20px 10px;padding-left:20px;padding-right:20px;border-bottom:1px solid var(--border)}
.editor-toolbar button{padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:.82rem;cursor:pointer;background:transparent;font-family:inherit;color:var(--text);line-height:1.3}
.editor-toolbar button:hover{border-color:var(--accent);color:var(--accent)}
.tb-sep{width:1px;height:18px;background:var(--border);margin:0 3px;flex-shrink:0}
.tb-color-wrap{position:relative;display:inline-flex;cursor:pointer}
.tb-color-wrap input[type=color]{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;border:none;padding:0}
.tb-color-preview{padding:3px 7px;border:1px solid var(--border);border-radius:6px;font-size:.85rem;font-weight:700;pointer-events:none;line-height:1.5}
#note-editor{min-height:140px;border:1px solid var(--border);border-radius:8px;padding:12px;font-size:.9rem;line-height:1.6;outline:none;background:var(--surface);color:var(--text)}
#note-editor:focus{border-color:var(--accent)}
.note-footer{display:flex;align-items:center;justify-content:space-between;margin-top:10px}
#note-status{font-size:.78rem;color:var(--muted)}
#save-note-btn{padding:7px 16px;background:var(--accent);color:#fff;border:none;border-radius:7px;font-size:.85rem;cursor:pointer;font-family:inherit;font-weight:500}
.clip-panel{margin-top:14px;border:1.5px solid var(--accent);border-radius:10px;overflow:hidden}
.clip-panel-head{padding:8px 14px;font-size:.78rem;font-weight:600;color:var(--accent);background:#ede9fe;letter-spacing:.04em}
#clip-title-input{width:100%;border:none;border-bottom:1px solid var(--border);padding:10px 14px;font-size:.9rem;font-family:inherit;background:var(--surface);outline:none;color:var(--text)}
#clip-title-input::placeholder{color:var(--muted)}
#clip-paste-area{min-height:100px;max-height:260px;overflow-y:auto;padding:12px 14px;font-size:.85rem;line-height:1.6;outline:none;background:var(--surface);color:var(--text)}
#clip-paste-area:empty::before{content:'Paste your content here…';color:var(--muted);pointer-events:none}
.clip-foot{display:flex;justify-content:flex-end;gap:8px;padding:8px 14px;border-top:1px solid var(--border);background:var(--surface)}
.clip-foot button{padding:6px 14px;border-radius:7px;font-size:.85rem;cursor:pointer;font-family:inherit;border:1px solid var(--border)}
.clip-foot .clip-save{background:var(--accent);color:#fff;border-color:var(--accent);font-weight:500}
.clip-foot .clip-cancel{background:transparent;color:var(--muted)}
.snippets-area{margin-top:16px;display:flex;flex-direction:column;gap:8px}
#clip-modal{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2000;display:flex;align-items:center;justify-content:center}
#clip-modal.hidden{display:none}
#clip-modal-box{background:var(--surface);border-radius:14px;width:min(1000px,92vw);max-height:88vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.25)}
#clip-modal-hdr{display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid var(--border);flex-shrink:0}
#clip-modal-title{font-weight:600;font-size:1rem;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#clip-modal-close{background:none;border:none;font-size:1.4rem;cursor:pointer;color:var(--muted);padding:2px 6px;border-radius:6px;line-height:1}
#clip-modal-close:hover{background:var(--bg);color:var(--text)}
#clip-modal-body{padding:20px;overflow-y:auto;font-size:.92rem;line-height:1.75;word-break:break-word;flex:1}
.snippets-hdr{display:flex;align-items:center;justify-content:space-between;margin-top:16px;margin-bottom:4px}
.snippets-hdr-label{font-size:.75rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
#export-clips-btn{padding:4px 10px;border:1px solid var(--border);border-radius:6px;font-size:.75rem;cursor:pointer;background:transparent;font-family:inherit;color:var(--muted)}
#export-clips-btn:hover{border-color:var(--accent);color:var(--accent)}
.field-group{margin-bottom:14px}
.field-label{font-size:.72rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:5px;display:block}
.field-input{width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:.88rem;font-family:inherit;color:var(--text)}
.field-input:focus{outline:none;border-color:var(--accent)}
.tag-input-wrap{display:flex;flex-wrap:wrap;gap:6px;border:1px solid var(--border);border-radius:8px;padding:6px 10px;cursor:text;min-height:38px;align-items:center}
.tag-input-wrap:focus-within{border-color:var(--accent)}
#tag-text-input{border:none;outline:none;font-size:.85rem;font-family:inherit;min-width:80px;flex:1}
.links-list{display:flex;flex-direction:column;gap:8px;margin-bottom:8px}
#add-link-btn{padding:6px 12px;border:1px dashed var(--border);border-radius:7px;font-size:.82rem;cursor:pointer;background:transparent;color:var(--muted);font-family:inherit}
#add-link-btn:hover{border-color:var(--accent);color:var(--accent)}
#save-info-btn{padding:8px 20px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:.9rem;cursor:pointer;font-family:inherit;font-weight:500}
#cover-select{width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:.85rem;font-family:inherit}
.file-browser{background:var(--surface);margin-top:8px}
.drop-zone{border:2px dashed var(--border);border-radius:var(--radius);padding:14px;text-align:center;cursor:pointer;transition:all .15s;background:var(--bg);margin:12px 20px}
.drop-zone:hover{border-color:var(--accent);background:#f5f3ff}
.drop-zone-icon{font-size:1.1rem;opacity:.4;margin-bottom:2px}
.drop-zone-text{font-size:.82rem;color:var(--muted)}
.drop-zone-text b{color:var(--accent);font-weight:500}
#upload-progress{margin:8px 0 0}
#upload-bar-row{display:flex;align-items:center;gap:6px}
#upload-bar{flex:1;height:4px;background:#e2e8f0;border-radius:2px;overflow:hidden}
#upload-bar-fill{height:100%;background:var(--accent);width:0%;transition:width .1s}
#upload-cancel{background:none;border:none;cursor:pointer;color:var(--muted);font-size:.7rem;padding:0 2px;line-height:1;flex-shrink:0}
#upload-cancel:hover{color:var(--danger)}
#upload-bar-text{font-size:.72rem;color:var(--muted);margin-top:3px}
.fb-toolbar{border-bottom:1px solid var(--border);padding:10px 20px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.fb-left{display:flex;align-items:center;gap:6px;flex:1;min-width:0}
.fb-label{font-size:.9rem;font-weight:600;white-space:nowrap}
.fb-size{font-size:.78rem;color:var(--muted);white-space:nowrap}
.view-btn{padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:transparent;cursor:pointer;font-size:.9rem;line-height:1;color:var(--muted)}
.view-btn.active{background:#1c1917;border-color:#1c1917;color:#fff}
.view-btn:hover:not(.active){border-color:var(--accent);color:var(--accent)}
#sort-select{padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:.8rem;font-family:inherit;background:var(--surface);color:var(--text)}
.sort-dir-btn{padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:transparent;cursor:pointer;font-size:.85rem;color:var(--muted)}
.sort-dir-btn:hover{border-color:var(--accent);color:var(--accent)}
.fb-right{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.fb-btn{padding:6px 14px;border-radius:8px;border:1px solid var(--border);background:transparent;font-size:.83rem;font-family:inherit;cursor:pointer;color:var(--text);white-space:nowrap;font-weight:500}
.fb-btn:hover{border-color:var(--accent);color:var(--accent)}
.fb-btn-primary{background:#1c1917;border-color:#1c1917;color:#fff}
.fb-btn-primary:hover{background:#292524;border-color:#292524;color:#fff}
.fb-btn-danger{background:var(--danger-light);border-color:var(--danger-border);color:var(--danger)}
.fb-btn-danger:hover{background:#fee2e2;border-color:var(--danger)}
.breadcrumb{padding:9px 20px;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--border);font-size:.85rem;background:var(--surface)}
.bc-back{background:none;border:none;cursor:pointer;color:var(--accent);font-size:.85rem;font-family:inherit;padding:0;text-decoration:none}
.bc-back:hover{text-decoration:underline}
.bc-sep{color:var(--muted);opacity:.5}
.bc-current{font-weight:600;color:var(--text)}
.select-bar{padding:8px 20px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border);background:var(--surface)}
.sel-btn{padding:4px 10px;border:1px solid var(--border);border-radius:6px;font-size:.78rem;cursor:pointer;background:transparent;font-family:inherit;color:var(--muted)}
.sel-btn:hover{border-color:var(--accent);color:var(--accent)}
#sel-count{font-size:.78rem;color:var(--accent);font-weight:500}
#file-list{background:var(--surface)}
.file-list-empty{padding:28px;text-align:center;color:var(--muted);font-size:.85rem}
.gallery-section{padding:12px 20px 16px;background:var(--surface);border-top:1px solid var(--border)}
.gallery-header{font-size:.72rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
.image-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px}
.bulk-bar{position:fixed;bottom:0;left:0;right:0;background:#1c1917;color:#fff;padding:0 20px;height:52px;display:flex;align-items:center;z-index:500;transform:translateY(100%);transition:transform .2s ease;box-shadow:0 -2px 12px rgba(0,0,0,.25)}
.bulk-count{font-size:.88rem;font-weight:600;padding-right:16px;border-right:1px solid rgba(255,255,255,.2);margin-right:14px;white-space:nowrap}
.bulk-sep{color:rgba(255,255,255,.25);margin:0 10px}
.bulk-action{background:none;border:none;color:#fff;cursor:pointer;font-size:.88rem;font-family:inherit;padding:4px 0;opacity:.8}
.bulk-action:hover{opacity:1}
.bulk-del{color:#fca5a5}
.bulk-cancel{margin-left:auto;opacity:.5;font-size:.82rem}
.bulk-cancel:hover{opacity:1}
.float-menu{display:none;position:fixed;z-index:700;background:#fff;border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.14);min-width:150px;overflow:hidden}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1500;display:flex;align-items:center;justify-content:center;padding:20px}
.modal-overlay.hidden{display:none}
.modal-box{background:#fff;border-radius:14px;padding:24px;width:100%;max-height:90vh;display:flex;flex-direction:column}
.modal-hdr{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:4px;flex-shrink:0}
.modal-hdr h3{font-size:1rem;font-weight:600}
.modal-hdr .modal-sub{font-size:.8rem;color:var(--muted);margin-top:2px}
.modal-close{background:none;border:none;cursor:pointer;font-size:1.1rem;color:var(--muted);padding:2px 6px;border-radius:6px;line-height:1}
.modal-close:hover{color:var(--text)}
.modal-scroll{overflow-y:auto;flex:1;margin:12px -24px 0;padding:0 24px}
.modal-ftr{display:flex;align-items:center;margin-top:16px;flex-shrink:0;gap:8px}
.modal-ftr-left{display:flex;gap:8px;flex:1}
.btn-cancel{padding:7px 16px;border:1px solid var(--border);border-radius:8px;background:transparent;color:var(--muted);font-family:inherit;font-size:.85rem;cursor:pointer;font-weight:500}
.btn-cancel:hover{border-color:var(--text);color:var(--text)}
.btn-save{padding:7px 16px;border-radius:8px;background:var(--accent);color:#fff;border:none;font-family:inherit;font-size:.85rem;cursor:pointer;font-weight:500}
.btn-save:hover{background:var(--accent-hover)}
.btn-danger-sm{padding:7px 14px;border-radius:8px;background:var(--danger-light);color:var(--danger);border:1px solid var(--danger-border);font-family:inherit;font-size:.85rem;cursor:pointer;font-weight:500}
.btn-danger-sm:hover{background:#fee2e2}
.file-info-modal label{font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);display:block;margin-bottom:4px;margin-top:14px}
.file-info-modal input{width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:7px;font-size:.9rem;font-family:inherit}
.file-info-modal input:focus{outline:none;border-color:var(--accent)}
#lightbox{position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:2500;display:flex;align-items:center;justify-content:center}
#lightbox.hidden{display:none}
#lb-close{position:absolute;top:16px;right:20px;background:none;border:none;color:#fff;font-size:1.6rem;cursor:pointer;opacity:.7;z-index:10}
#lb-close:hover{opacity:1}
#lb-prev,#lb-next{position:absolute;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.12);border:none;color:#fff;font-size:2rem;cursor:pointer;padding:12px 16px;border-radius:8px;z-index:10;line-height:1}
#lb-prev{left:16px}#lb-next{right:16px}
#lb-prev:hover,#lb-next:hover{background:rgba(255,255,255,.22)}
#lb-caption{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,.75);font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:80vw}
#lb-counter{position:absolute;top:16px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,.55);font-size:.78rem}
#hover-preview{position:fixed;z-index:900;background:#fff;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.22);overflow:hidden;pointer-events:none;display:none;width:260px;height:260px}
#hover-preview img{width:100%;height:100%;object-fit:contain;display:block}
@media (max-width: 640px) {
  .page-header{padding:0 12px;gap:6px}
  .memo-id-badge{display:none}
  #signout-btn{font-size:.75rem;padding:4px 8px}
  .gsearch-wrap{padding:6px 12px}
  .title-section{padding:12px 16px 10px}
  #title-input{font-size:1.25rem}
  .quick-meta{flex-direction:column;align-items:stretch;gap:8px;padding:10px 16px}
  .qm-sep{display:none}
  .qm-uid input{width:100%}
  .qm-tags{min-width:0}
  .section summary{padding:12px 16px}
  .section-body{padding:0 16px 16px}
  .editor-toolbar{gap:3px}
  .drop-zone{margin:10px 14px}
  .fb-toolbar{padding:8px 14px;gap:6px}
  .bulk-bar{height:auto;padding:10px 16px;flex-wrap:wrap;gap:8px}
  .modal-box{width:calc(100vw - 32px)!important;max-width:none!important}
}
.cal-row{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.cal-label{font-size:.78rem;color:var(--muted);width:68px;flex-shrink:0}
.cal-input{flex:1;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:.82rem;font-family:inherit;color:var(--text);background:var(--bg);outline:none}
.cal-input:focus{border-color:var(--accent)}
</style>
