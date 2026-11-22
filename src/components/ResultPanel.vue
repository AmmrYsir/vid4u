<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Phase } from '../composables/useDownloader'
import { formatBytes, formatDuration, minutesUntil } from '../lib/platforms'
import type { Job, Preset, UiError, VideoInfo } from '../types/api'

const props = defineProps<{
  video: VideoInfo
  presets: Preset[]
  selectedPreset: string
  phase: Phase
  job: Job | null
  error: UiError | null
}>()

const emit = defineEmits<{
  (event: 'update:selectedPreset', value: string): void
  (event: 'download'): void
  (event: 'cancel'): void
  (event: 'retry'): void
}>()

const thumbFailed = ref(false)
watch(
  () => props.video.thumbnail,
  () => {
    thumbFailed.value = false
  },
)

const videoPresets = computed(() => props.presets.filter((preset) => preset.kind === 'video'))
const audioPresets = computed(() => props.presets.filter((preset) => preset.kind === 'audio'))
const busy = computed(() => props.phase === 'starting' || props.phase === 'processing')
const ready = computed(() => props.phase === 'ready' && Boolean(props.job?.fileUrl))
const canceled = computed(() => props.phase === 'canceled')
const progressValue = computed(() => Math.max(0, Math.min(100, props.job?.progress ?? 0)))

const statusText = computed(() => {
  if (ready.value) return 'Download ready'
  if (busy.value) return 'Preparing download'
  if (props.phase === 'canceled') return 'Canceled'
  if (props.phase === 'error') return 'Needs attention'
  return 'Link ready'
})

const summary = computed(() => {
  const parts: string[] = []
  if (props.video.uploader) parts.push(props.video.uploader)
  const duration = formatDuration(props.video.duration)
  if (duration) parts.push(duration)
  return parts.join(' · ')
})

function onSelect(event: Event): void {
  emit('update:selectedPreset', (event.target as HTMLSelectElement).value)
}
</script>

<template>
  <div
    class="result-panel"
    :class="{
      'is-busy': busy,
      'is-ready': ready,
      'is-error': phase === 'error' || canceled,
    }"
    :aria-busy="busy"
  >
    <div class="result-thumb" :class="{ 'has-image': video.thumbnail && !thumbFailed }">
      <img
        v-if="video.thumbnail && !thumbFailed"
        :src="video.thumbnail"
        alt=""
        referrerpolicy="no-referrer"
        @error="thumbFailed = true"
      />
      <template v-else>
        <span class="thumb-play">▶</span>
      </template>
      <span v-if="video.duration" class="thumb-time">{{ formatDuration(video.duration) }}</span>
    </div>

    <div class="result-meta">
      <div class="detected" aria-live="polite">
        <span
          class="status-dot"
          :class="{ 'is-error': phase === 'error', 'is-ready': ready }"
        ></span>
        {{ video.platformLabel }} · {{ statusText }}
      </div>
      <strong class="result-title" :title="video.title">{{ video.title }}</strong>
      <span class="result-url">{{ summary || video.webpageUrl }}</span>
    </div>

    <div class="result-actions">
      <label v-if="presets.length" class="format-select">
        <span class="sr-only">Video format</span>
        <select
          :value="selectedPreset"
          :disabled="busy || ready"
          @change="onSelect"
        >
          <optgroup v-if="videoPresets.length" label="Video">
            <option v-for="preset in videoPresets" :key="preset.id" :value="preset.id">
              {{ preset.label }}
            </option>
          </optgroup>
          <optgroup v-if="audioPresets.length" label="Audio">
            <option v-for="preset in audioPresets" :key="preset.id" :value="preset.id">
              {{ preset.label }}
            </option>
          </optgroup>
        </select>
        <span class="select-chevron">⌄</span>
      </label>

      <a
        v-if="ready && job?.fileUrl"
        class="save-button"
        :href="job.fileUrl"
        download
      >
        Save video
      </a>
      <button
        v-else-if="!busy && !canceled && phase !== 'error'"
        class="save-button"
        type="button"
        :disabled="!selectedPreset"
        @click="emit('download')"
      >
        Save video
      </button>
      <button v-if="busy" class="cancel-button" type="button" @click="emit('cancel')">
        Cancel
      </button>
    </div>

    <div v-if="busy" class="result-detail">
      <div
        class="progress-track"
        role="progressbar"
        aria-label="Download progress"
        :aria-valuenow="progressValue"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <span class="progress-bar" :style="{ width: `${Math.max(progressValue, 4)}%` }"></span>
      </div>
      <div class="progress-meta">
        <span>{{ job?.stage ?? 'Starting download…' }}</span>
        <span>{{ progressValue }}%</span>
      </div>
    </div>

    <div v-else-if="phase === 'error'" class="result-detail result-error">
      <strong>{{ error?.message ?? 'The download failed.' }}</strong>
      <p v-if="error?.hint">{{ error.hint }}</p>
      <button class="retry-button" type="button" @click="emit('retry')">Try again</button>
    </div>

    <div v-else-if="canceled" class="result-detail result-error">
      <strong>Download canceled.</strong>
      <p>Nothing was saved. You can try again with the same link.</p>
      <button class="retry-button" type="button" @click="emit('retry')">Try again</button>
    </div>

    <div v-else-if="ready" class="result-detail result-ready">
      <span class="ready-filename">
        {{ job?.filename }}<template v-if="job?.sizeBytes"> · {{ formatBytes(job.sizeBytes) }}</template>
      </span>
      <span class="ready-expiry">Link expires in {{ minutesUntil(job?.expiresAt) }} min</span>
    </div>
  </div>
</template>
