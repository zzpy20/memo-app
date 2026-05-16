<script lang="ts">
  import '../app.css'
  import { onMount } from 'svelte'
  import { tokenStore, WORKER } from '$lib/api'

  let { children } = $props()
  let authed = $state(false)
  let authInput = $state('')
  let authError = $state('')
  let darkMode = $state(false)

  onMount(async () => {
    darkMode = localStorage.getItem('dark') === '1'
    if (darkMode) document.body.classList.add('dark')

    if (window.location.pathname.startsWith('/share')) { authed = true; return }

    const t = $tokenStore
    if (t) {
      const r = await fetch(`${WORKER}?check=1&t=${encodeURIComponent(t)}`).catch(() => null)
      if (r?.ok) { authed = true; return }
    }
  })

  $effect(() => {
    if ($tokenStore === '') authed = false
  })

  function toggleDark() {
    darkMode = !darkMode
    document.body.classList.toggle('dark', darkMode)
    localStorage.setItem('dark', darkMode ? '1' : '0')
  }

  async function doAuth() {
    authError = ''
    try {
      const r = await fetch(`${WORKER}?check=1&t=${encodeURIComponent(authInput)}`)
      if (r.ok) {
        tokenStore.set(authInput)
        authed = true
      } else {
        authError = 'Wrong passphrase.'
      }
    } catch {
      authError = 'Connection error.'
    }
  }
</script>

{#if !authed}
<div id="auth-overlay">
  <div class="auth-box">
    <h1>Memo</h1>
    <p>Enter your passphrase to continue</p>
    <input
      type="password"
      placeholder="Passphrase"
      autocomplete="current-password"
      bind:value={authInput}
      onkeydown={(e) => e.key === 'Enter' && doAuth()}
    >
    <button onclick={doAuth}>Unlock</button>
    <div class="auth-error">{authError}</div>
  </div>
</div>
{:else}
{@render children()}
{/if}
<button class="dark-btn" onclick={toggleDark} title={darkMode ? 'Light mode' : 'Dark mode'}>{darkMode ? '☀' : '🌙'}</button>

<style>
  #auth-overlay{position:fixed;inset:0;background:#1c1917;display:flex;align-items:center;justify-content:center;z-index:1000}
  .auth-box{background:#fff;border-radius:16px;padding:40px;width:360px;text-align:center}
  .auth-box h1{font-size:1.5rem;font-weight:600;margin-bottom:8px}
  .auth-box p{color:var(--muted);font-size:.9rem;margin-bottom:24px}
  .auth-box input{width:100%;padding:10px 14px;border:1px solid var(--border);border-radius:8px;font-size:1rem;font-family:inherit;margin-bottom:12px}
  .auth-box button{width:100%;padding:10px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:1rem;font-family:inherit;cursor:pointer;font-weight:500}
  .auth-box button:hover{background:var(--accent-hover)}
  .auth-error{color:var(--danger);font-size:.85rem;margin-top:8px;min-height:20px}
  @media (max-width:640px){
    .auth-box{width:calc(100vw - 48px);padding:32px 24px}
  }
  .dark-btn{position:fixed;bottom:16px;right:16px;background:var(--surface);border:1px solid var(--border);border-radius:50%;width:36px;height:36px;cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,.15)}
  .dark-btn:hover{border-color:var(--accent)}
</style>
