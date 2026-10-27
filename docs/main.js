// Turno landing: download by OS, the output index, the account-pool toggle, tonight's countdown, motion.
(() => {
  const REPO = 'eurafaeldecarvalho/turno'

  // download: pick the latest release asset for this system; every link falls back to the releases page
  const ua = navigator.userAgent
  const os = /Windows/i.test(ua) ? 'windows' : /Mac OS X|Macintosh/i.test(ua) ? 'mac' : /Linux|X11/i.test(ua) && !/Android/i.test(ua) ? 'linux' : 'other'
  const links = document.querySelectorAll('[data-download]')
  const note = document.querySelector('[data-cta-note]')
  const label = (text) => links.forEach((a) => { if (a.classList.contains('button')) a.textContent = text })
  if (os === 'mac') {
    label('macOS: build from source')
    if (note) note.textContent = 'macOS is not packaged yet: the releases page has the source.'
  } else if (os === 'windows' || os === 'linux') {
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((rel) => {
        const want = os === 'windows' ? /Setup-.*\.exe$/ : /\.AppImage$/
        const asset = (rel.assets || []).find((x) => want.test(x.name))
        if (!asset) return
        links.forEach((a) => { a.href = asset.browser_download_url })
        label(`Download for ${os === 'windows' ? 'Windows' : 'Linux'}`)
        if (note) note.textContent = `${asset.name} · ${rel.tag_name}. Other formats are on the releases page.`
      })
      .catch(() => {})
  }

  // output index: one sheet at a time, crossfaded
  const tabs = [...document.querySelectorAll('.index-list [role="tab"]')]
  const show = (tab) => {
    tabs.forEach((t) => {
      const on = t === tab
      t.setAttribute('aria-selected', String(on))
      t.tabIndex = on ? 0 : -1
      const panel = document.getElementById(t.getAttribute('aria-controls'))
      if (on) { panel.hidden = false; requestAnimationFrame(() => panel.classList.add('is-on')) }
      else { panel.classList.remove('is-on'); panel.hidden = true }
    })
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => show(t))
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
      if (!d) return
      e.preventDefault()
      const next = tabs[(i + d + tabs.length) % tabs.length]
      show(next); next.focus()
    })
  })
  tabs.forEach((t, i) => { t.tabIndex = i === 0 ? 0 : -1 })

  // the account-pool toggle: with it the run continues, without it the run waits for the reset
  const pool = document.querySelector('[data-pool]')
  const on = document.querySelector('[data-slip-on]')
  const off = document.querySelector('[data-slip-off]')
  pool?.addEventListener('click', () => {
    const now = pool.getAttribute('aria-pressed') !== 'true'
    pool.setAttribute('aria-pressed', String(now))
    on.hidden = !now; off.hidden = now
  })

  // tonight, in the visitor's own time: the date on the slip and the time to the next 02:00
  const next = new Date(); next.setHours(2, 0, 0, 0)
  if (next <= new Date()) next.setDate(next.getDate() + 1)
  const dateEl = document.querySelector('[data-slip-date]')
  if (dateEl) dateEl.textContent = 'Night shift · ' + next.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const cd = document.querySelector('[data-countdown]')
  const tick = () => {
    const ms = next - new Date()
    const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4)
    if (cd) cd.textContent = `Your next 02:00 starts in ${h} h ${String(m).padStart(2, '0') /* taste-skill-ignore: a clock */} min, your time.`
  }
  tick(); setInterval(tick, 30000)

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches

  // the hero demo: pausable, and still under reduced motion
  const video = document.querySelector('[data-video]')
  const vbtn = document.querySelector('[data-video-toggle]')
  const setPlaying = (play) => { if (!video) return; play ? video.play().catch(() => {}) : video.pause(); if (vbtn) vbtn.textContent = play ? 'Pause demo' : 'Play demo' }
  if (reduce) setPlaying(false)
  vbtn?.addEventListener('click', () => setPlaying(video.paused))

  // signature move: the close-up slowly crossfades between three screens of the app
  const stack = document.querySelector('[data-crossfade]')
  if (stack && !reduce) {
    const imgs = [...stack.querySelectorAll('img')]
    let i = 0
    setInterval(() => {
      if (document.hidden) return
      imgs[i].classList.remove('is-on'); i = (i + 1) % imgs.length; imgs[i].classList.add('is-on')
    }, 5600)
  }

  // entrances: heading, then text, then picture, once per section
  if (!reduce && 'IntersectionObserver' in window) {
    const groups = document.querySelectorAll('.showcase, .shift, .board, .questions, .foot-top')
    groups.forEach((g) => {
      const parts = g.querySelectorAll('.head, p, .index-list button, .stage, .slip, .tile, .toggle, .card, .foot-invite, .button, .foot-links li')
      parts.forEach((p, k) => { p.classList.add('reveal'); p.style.transitionDelay = `${Math.min(k, 8) * 70}ms` })
    })
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return
      e.target.querySelectorAll('.reveal').forEach((p) => p.classList.add('is-in'))
      io.unobserve(e.target)
    }), { threshold: 0.12 })
    groups.forEach((g) => io.observe(g))
  }
})()
