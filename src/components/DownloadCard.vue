<script setup lang="ts">
import { computed } from 'vue'
import { useDownloader } from '../composables/useDownloader'
import ResultPanel from './ResultPanel.vue'

const {
  url,
  phase,
  video,
  presets,
  selectedPreset,
  job,
  error,
  copied,
  isBusy,
  resolve,
  startDownload,
  cancel,
  retry,
  pasteLink,
  reset,
} = useDownloader()

const showFormError = computed(() => Boolean(error.value) && !video.value)
const buttonLabel = computed(() => {
  if (phase.value === 'resolving') return 'Finding video…'
  if (phase.value === 'starting') return 'Starting…'
  if (phase.value === 'processing') return 'Preparing…'
  return 'Find my video'
})

function onInput(): void {
  if (!video.value && error.value) error.value = null
}

function updatePreset(value: string): void {
  selectedPreset.value = value
}
</script>

<template>
  <div class="download-card">
    <div class="card-topline">
      <div class="card-heading">
        <span class="link-icon">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M9.5 14.5 14.5 9.5M7.2 16.8l-1 1a4 4 0 0 1-5.65-5.65l4.24-4.24a4 4 0 0 1 5.66 0m6.35-.7 1-1a4 4 0 0 1 5.65 5.65l-4.24 4.24a4 4 0 0 1-5.66 0"
              transform="translate(1 0)"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
            />
          </svg>
        </span>
        <div>
          <strong>Drop your link here</strong>
          <small>We’ll take it from there</small>
        </div>
      </div>
      <span class="secure-badge">
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M4 7V5a4 4 0 1 1 8 0v2m-8 0H3v7h10V7H4Z"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        NO ACCOUNT
      </span>
    </div>

    <form class="url-form" :aria-busy="isBusy" @submit.prevent="resolve">
      <div class="input-wrap" :class="{ 'has-error': showFormError }">
        <svg class="input-link" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M9.5 14.5 14.5 9.5M7.2 16.8l-1 1a4 4 0 0 1-5.65-5.65l4.24-4.24a4 4 0 0 1 5.66 0m6.35-.7 1-1a4 4 0 0 1 5.65 5.65l-4.24 4.24a4 4 0 0 1-5.66 0"
            transform="translate(1 0)"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
          />
        </svg>
        <input
          v-model="url"
          aria-label="Video URL"
          placeholder="Paste a video link to get started..."
          :disabled="isBusy"
          @input="onInput"
        />
        <button
          v-if="url && !isBusy"
          class="clear-button"
          type="button"
          aria-label="Clear URL"
          @click="reset"
        >
          ×
        </button>
        <button v-else-if="!url" class="paste-button" type="button" @click="pasteLink">
          <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path
              d="M6 4.5H4.5v10h9v-10H12M6.5 3h5v3h-5V3Zm2.5 6v4m-2-2 2 2 2-2"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          {{ copied ? 'Pasted' : 'Paste' }}
        </button>
      </div>
      <button class="download-button" type="submit" :disabled="isBusy || !url.trim()">
        <span class="button-label">
          <span v-if="isBusy" class="spinner" aria-hidden="true"></span>
          <span>{{ buttonLabel }}</span>
        </span>
        <span class="button-arrow" aria-hidden="true">→</span>
      </button>
    </form>

    <p v-if="showFormError" class="form-error" role="alert">
      {{ error?.message }}
      <span v-if="error?.hint" class="form-error-hint">{{ error.hint }}</span>
    </p>

    <ResultPanel
      v-if="video"
      :video="video"
      :presets="presets"
      :selected-preset="selectedPreset"
      :phase="phase"
      :job="job"
      :error="error"
      @update:selected-preset="updatePreset"
      @download="startDownload"
      @cancel="cancel"
      @retry="retry"
    />

    <div class="platform-row">
      <span>Works with your favorites</span>
      <div class="platforms">
        <span class="platform yt"><b>▶</b> YouTube</span>
        <span class="platform ig"><b>◎</b> Instagram</span>
        <span class="platform fb"><b>f</b> Facebook</span>
        <span class="platform tt"><b>♪</b> TikTok</span>
        <span class="platform more">+ more</span>
      </div>
    </div>
    <p class="platform-note">
      Public videos only. Links are checked before anything is downloaded.
    </p>
  </div>
</template>
