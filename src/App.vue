<script setup lang="ts">
import { ref } from 'vue'
import DownloadCard from './components/DownloadCard.vue'
import LegalDialog from './components/LegalDialog.vue'

const legalOpen = ref(false)
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

        <DownloadCard />

        <div class="hero-footnote"><span class="footnote-check">✓</span> Your link is used only to prepare this download and is deleted shortly after.</div>
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

      <section class="supported-section" id="supported"><div class="supported-icon">✳</div><div><span class="section-kicker">ALL YOUR PLACES, ONE SPOT</span><h2>Your feed is <span>full of good stuff.</span></h2><p>From quick clips to the videos you want to watch again, vid4u makes saving public videos simple.</p></div><a href="#downloader">Try it now <span>→</span></a></section>
    </main>

    <footer class="footer">
      <a class="brand footer-brand" href="#top"><span class="brand-mark"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 4.8c0-.77.84-1.25 1.5-.86l11.2 6.55a1.75 1.75 0 0 1 0 3.02L7.5 20.06A1 1 0 0 1 6 19.2V4.8Z" fill="currentColor"/></svg></span><span>vid<span>4</span>u</span></a>
      <p>Made for the videos worth keeping. <span>© 2026 vid4u</span></p>
      <div class="footer-links">
        <a href="#how-it-works">How it works</a>
        <a href="#supported">Supported sites</a>
        <button class="link-button" type="button" @click="legalOpen = true">Privacy &amp; terms</button>
      </div>
    </footer>

    <LegalDialog :open="legalOpen" @close="legalOpen = false" />
  </div>
</template>
