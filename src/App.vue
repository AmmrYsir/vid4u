<script setup lang="ts">
import { computed, ref } from 'vue'

const url = ref('')
const error = ref('')
const submitted = ref(false)
const copied = ref(false)
const format = ref('MP4 · 1080p')

const source = computed(() => {
  const value = url.value.toLowerCase()
  if (value.includes('youtube') || value.includes('youtu.be')) return 'YouTube'
  if (value.includes('instagram')) return 'Instagram'
  if (value.includes('facebook') || value.includes('fb.watch')) return 'Facebook'
  if (value.includes('tiktok')) return 'TikTok'
  if (value.includes('x.com') || value.includes('twitter')) return 'X'
  return 'Video link'
})

async function pasteLink() {
  try {
    url.value = await navigator.clipboard.readText()
    error.value = ''
    submitted.value = false
    copied.value = true
    window.setTimeout(() => (copied.value = false), 1600)
  } catch {
    error.value = 'Clipboard access is unavailable. Paste your link into the field.'
  }
}

function prepareLink() {
  error.value = ''
  try {
    const parsed = new URL(url.value.trim())
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid protocol')
    url.value = parsed.href
    submitted.value = true
  } catch {
    submitted.value = false
    error.value = 'Enter a valid video URL to continue.'
  }
}

function reset() {
  url.value = ''
  submitted.value = false
  error.value = ''
}
</script>

<template>
  <div class="page-shell">
    <header class="topbar">
      <a class="brand" href="#top" aria-label="vid4u home">
        <span class="brand-mark"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 4.8c0-.77.84-1.25 1.5-.86l11.2 6.55a1.75 1.75 0 0 1 0 3.02L7.5 20.06A1 1 0 0 1 6 19.2V4.8Z" fill="currentColor"/></svg></span>
        <span>vid<span>4</span>u</span>
      </a>
      <nav class="nav-links" aria-label="Main navigation">
        <a href="#how-it-works">How it works</a>
        <a href="#supported">Supported sites</a>
      </nav>
      <a class="nav-cta" href="#downloader">Get started <span aria-hidden="true">↗</span></a>
    </header>

    <main id="top">
      <section class="hero" id="downloader">
        <div class="hero-copy">
          <div class="eyebrow"><span class="eyebrow-dot"></span> YOUR FAVORITES, OFFLINE</div>
          <h1>Save the videos<br />you <span>love.</span></h1>
          <p class="hero-lede">One little link is all it takes. Keep your favorite moments close, wherever you go.</p>
          <div class="trust-line"><span class="sparkle">✳</span> Free to use <i></i> No sign-up <i></i> Just paste &amp; go</div>
        </div>

        <div class="download-card">
          <div class="card-topline">
            <div class="card-heading"><span class="link-icon"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9.5 14.5 14.5 9.5M7.2 16.8l-1 1a4 4 0 0 1-5.65-5.65l4.24-4.24a4 4 0 0 1 5.66 0m6.35-.7 1-1a4 4 0 0 1 5.65 5.65l-4.24 4.24a4 4 0 0 1-5.66 0" transform="translate(1 0)" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></span><div><strong>Drop your link here</strong><small>We’ll take it from there</small></div></div>
            <span class="secure-badge"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 7V5a4 4 0 1 1 8 0v2m-8 0H3v7h10V7H4Z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg> PRIVATE</span>
          </div>
          <form class="url-form" @submit.prevent="prepareLink">
            <div class="input-wrap" :class="{ 'has-error': error }">
              <svg class="input-link" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9.5 14.5 14.5 9.5M7.2 16.8l-1 1a4 4 0 0 1-5.65-5.65l4.24-4.24a4 4 0 0 1 5.66 0m6.35-.7 1-1a4 4 0 0 1 5.65 5.65l-4.24 4.24a4 4 0 0 1-5.66 0" transform="translate(1 0)" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
              <input v-model="url" aria-label="Video URL" placeholder="Paste a video link to get started..." @input="submitted = false; error = ''" />
              <button v-if="url" class="clear-button" type="button" aria-label="Clear URL" @click="reset">×</button>
              <button v-else class="paste-button" type="button" @click="pasteLink"><svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M6 4.5H4.5v10h9v-10H12M6.5 3h5v3h-5V3Zm2.5 6v4m-2-2 2 2 2-2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>{{ copied ? 'Pasted' : 'Paste' }}</button>
            </div>
            <p v-if="error" class="form-error" role="alert">{{ error }}</p>
            <button class="download-button" type="submit"><span>Find my video</span><span class="button-arrow" aria-hidden="true">→</span></button>
          </form>

          <div v-if="submitted" class="result-panel" aria-live="polite">
            <div class="result-thumb"><span class="thumb-play">▶</span><span class="thumb-time">00:24</span></div>
            <div class="result-meta"><div class="detected"><span class="status-dot"></span>{{ source }} link ready</div><strong>Your video is ready to save</strong><span class="result-url">{{ url }}</span></div>
            <label class="format-select"><span class="sr-only">Video format</span><select v-model="format"><option>MP4 · 1080p</option><option>MP4 · 720p</option><option>MP4 · 480p</option><option>MP3 · Audio</option></select><span class="select-chevron">⌄</span></label>
          </div>
          <div class="platform-row"><span>Works with your favorites</span><div class="platforms"><span class="platform yt"><b>▶</b> YouTube</span><span class="platform ig"><b>◎</b> Instagram</span><span class="platform fb"><b>f</b> Facebook</span><span class="platform tt"><b>♪</b> TikTok</span><span class="platform more">+ more</span></div></div>
        </div>

        <div class="hero-footnote"><span class="footnote-check">✓</span> Your links are processed securely and never stored.</div>
        <div class="orb orb-one"></div><div class="orb orb-two"></div>
      </section>

      <section class="steps-section" id="how-it-works">
        <div class="section-intro"><span class="section-kicker">A LITTLE BIT OF MAGIC</span><h2>From scroll to saved<br />in <span>three easy steps.</span></h2><p>No confusing menus. No hoops to jump through.<br />Just the good stuff, made simple.</p></div>
        <div class="steps-grid">
          <article class="step-card"><div class="step-number">01 <span>·</span></div><div class="step-icon icon-link"><svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="m20 28 8-8m-12 12-2 2a7 7 0 0 1-10-10l8-8a7 7 0 0 1 10 0m10 2 2-2a7 7 0 0 1 10 10l-8 8a7 7 0 0 1-10 0" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></div><h3>Copy the link</h3><p>Find a video you love and copy its link from your favorite app.</p></article>
          <article class="step-card"><div class="step-number">02 <span>·</span></div><div class="step-icon icon-spark"><svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M24 5v38M5 24h38M10.6 10.6l26.8 26.8m0-26.8L10.6 37.4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle cx="24" cy="24" r="8" fill="currentColor"/></svg></div><h3>Drop it in</h3><p>Paste it above and we’ll get everything ready for you.</p></article>
          <article class="step-card"><div class="step-number">03 <span>·</span></div><div class="step-icon icon-save"><svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M24 7v23m0 0 9-9m-9 9-9-9M8 33v8h32v-8" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div><h3>Keep it forever</h3><p>Pick the quality you want and save it for offline moments.</p></article>
        </div>
      </section>

      <section class="supported-section" id="supported"><div class="supported-icon">✳</div><div><span class="section-kicker">ALL YOUR PLACES, ONE SPOT</span><h2>Your feed is <span>full of good stuff.</span></h2><p>From quick clips to the videos you want to watch again, vid4u makes saving simple.</p></div><a href="#downloader">Try it now <span>→</span></a></section>
    </main>

    <footer class="footer"><a class="brand footer-brand" href="#top"><span class="brand-mark"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 4.8c0-.77.84-1.25 1.5-.86l11.2 6.55a1.75 1.75 0 0 1 0 3.02L7.5 20.06A1 1 0 0 1 6 19.2V4.8Z" fill="currentColor"/></svg></span><span>vid<span>4</span>u</span></a><p>Made for the videos worth keeping. <span>© 2025 vid4u</span></p><div class="footer-links"><a href="#how-it-works">How it works</a><a href="#supported">Supported sites</a><a href="#top">Privacy</a></div></footer>
  </div>
</template>
