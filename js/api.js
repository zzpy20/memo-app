// Shared API client and utilities — loaded before each page's own script.
// Uses var for token so page scripts can mutate it across script boundaries.

var token = localStorage.getItem('memo_token') || '';
const WORKER = 'https://memo-worker.ausz.workers.dev';

function api(path, opts = {}) {
  const sep = path.includes('?') ? '&' : '?';
  return fetch(WORKER + path + sep + 't=' + encodeURIComponent(token), opts).then(r => {
    if (r.status === 401) { logout(); throw new Error('unauthorized'); }
    return r;
  });
}

function logout() {
  localStorage.removeItem('memo_token');
  token = '';
  document.getElementById('auth-overlay').classList.remove('hidden');
}

function safeJson(s, fallback) {
  try { return typeof s === 'string' ? JSON.parse(s) : (s || fallback); } catch { return fallback; }
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
