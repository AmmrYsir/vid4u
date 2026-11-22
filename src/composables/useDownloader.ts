import { computed, onUnmounted, ref, watch } from 'vue'
import {
  ApiError,
  cancelJob,
  createJob,
  getJob,
  isAbortError,
  resolveVideo,
} from '../lib/api'
import type { Job, Preset, UiError, VideoInfo } from '../types/api'

export type Phase =
  | 'idle'
  | 'resolving'
  | 'resolved'
  | 'starting'
  | 'processing'
  | 'ready'
  | 'error'
  | 'canceled'

function toUiError(error: unknown): UiError {
  if (error instanceof ApiError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.hint ? { hint: error.hint } : {}),
    }
  }
  return {
    code: 'unexpected',
    message: 'Something went wrong.',
    hint: 'Please try again in a moment.',
  }
}

export function useDownloader() {
  const url = ref('')
  const phase = ref<Phase>('idle')
  const video = ref<VideoInfo | null>(null)
  const presets = ref<Preset[]>([])
  const selectedPreset = ref('')
  const token = ref('')
  const job = ref<Job | null>(null)
  const error = ref<UiError | null>(null)
  const copied = ref(false)
  const resolvedInput = ref('')

  let resolveController: AbortController | null = null
  let pollController: AbortController | null = null
  let pollTimer: number | undefined
  let pollFailures = 0
  let clipboardTimer: number | undefined
  let actionId = 0

  const isBusy = computed(
    () =>
      phase.value === 'resolving' ||
      phase.value === 'starting' ||
      phase.value === 'processing',
  )
  const isReady = computed(() => phase.value === 'ready' && Boolean(job.value?.fileUrl))
  const progress = computed(() => job.value?.progress ?? 0)

  function stopPolling(): void {
    if (pollTimer !== undefined) {
      window.clearTimeout(pollTimer)
      pollTimer = undefined
    }
    pollController?.abort()
    pollController = null
  }

  function discardActiveJob(): void {
    const id = job.value?.id
    if (!id) return
    if (
      phase.value === 'starting' ||
      phase.value === 'processing' ||
      phase.value === 'ready' ||
      phase.value === 'error'
    ) {
      void cancelJob(id).catch(() => {
        // The job may already be finished or expired.
      })
    }
  }

  function abortResolve(): void {
    resolveController?.abort()
    resolveController = null
  }

  async function resolve(): Promise<void> {
    if (isBusy.value) return

    const value = url.value.trim()
    if (!value) {
      error.value = { code: 'invalid_url', message: 'Paste a video link first.' }
      phase.value = 'error'
      return
    }

    let parsed: URL
    try {
      parsed = new URL(value)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Invalid protocol')
      }
    } catch {
      error.value = {
        code: 'invalid_url',
        message: 'That does not look like a video link.',
        hint: 'Paste the full link, starting with https://.',
      }
      phase.value = 'error'
      video.value = null
      return
    }

    stopPolling()
    abortResolve()
    discardActiveJob()
    actionId += 1
    const controller = new AbortController()
    resolveController = controller

    error.value = null
    job.value = null
    video.value = null
    presets.value = []
    selectedPreset.value = ''
    token.value = ''
    phase.value = 'resolving'

    try {
      const result = await resolveVideo(parsed.href, controller.signal)
      if (controller.signal.aborted) return

      video.value = result.video
      presets.value = result.presets
      token.value = result.token
      selectedPreset.value = result.presets[0]?.id ?? ''
      resolvedInput.value = value
      phase.value = 'resolved'
    } catch (caught) {
      if (isAbortError(caught) || controller.signal.aborted) return
      error.value = toUiError(caught)
      phase.value = 'error'
    } finally {
      if (resolveController === controller) resolveController = null
    }
  }

  function startPolling(id: string): void {
    stopPolling()
    pollFailures = 0

    const tick = async (): Promise<void> => {
      if (phase.value !== 'processing') return

      const controller = new AbortController()
      pollController = controller

      try {
        const next = await getJob(id, controller.signal)
        if (phase.value !== 'processing' || controller.signal.aborted) return

        pollFailures = 0
        job.value = next

        if (next.status === 'ready') {
          phase.value = 'ready'
          stopPolling()
          return
        }
        if (next.status === 'error') {
          error.value = next.error
            ? {
                code: next.error.code,
                message: next.error.message,
                ...(next.error.hint ? { hint: next.error.hint } : {}),
              }
            : { code: 'extractor_failed', message: 'The download failed.' }
          phase.value = 'error'
          stopPolling()
          return
        }
        if (next.status === 'canceled') {
          phase.value = 'canceled'
          stopPolling()
          return
        }

        pollTimer = window.setTimeout(() => void tick(), 1000)
      } catch (caught) {
        if (isAbortError(caught)) return
        pollFailures += 1
        if (pollFailures >= 3) {
          error.value = toUiError(caught)
          phase.value = 'error'
          stopPolling()
          return
        }
        pollTimer = window.setTimeout(() => void tick(), 1200)
      }
    }

    pollTimer = window.setTimeout(() => void tick(), 400)
  }

  async function startDownload(): Promise<void> {
    if (isBusy.value || !token.value || !selectedPreset.value) return

    const action = ++actionId
    error.value = null
    job.value = null
    phase.value = 'starting'

    try {
      const created = await createJob(token.value, selectedPreset.value)
      if (action !== actionId) {
        // The user canceled or changed links while the job was being created.
        void cancelJob(created.id).catch(() => {})
        return
      }
      job.value = created

      if (created.status === 'ready') {
        phase.value = 'ready'
        return
      }
      if (created.status === 'error') {
        error.value = created.error
          ? {
              code: created.error.code,
              message: created.error.message,
              ...(created.error.hint ? { hint: created.error.hint } : {}),
            }
          : { code: 'extractor_failed', message: 'The download failed.' }
        phase.value = 'error'
        return
      }

      phase.value = 'processing'
      startPolling(created.id)
    } catch (caught) {
      if (action !== actionId) return
      error.value = toUiError(caught)
      phase.value = 'error'
    }
  }

  async function cancel(): Promise<void> {
    actionId += 1
    const id = job.value?.id
    stopPolling()

    if (id) {
      try {
        await cancelJob(id)
      } catch {
        // The job may already have expired; the UI should still reset.
      }
    }

    if (job.value) {
      job.value = {
        ...job.value,
        status: 'canceled',
        stage: 'Canceled',
        progress: 0,
        fileUrl: undefined,
      }
    }
    error.value = null
    phase.value = 'canceled'
  }

  function retry(): void {
    if (error.value?.code === 'invalid_token') {
      void resolve()
      return
    }
    if (video.value && token.value) {
      void startDownload()
      return
    }
    void resolve()
  }

  async function pasteLink(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        error.value = {
          code: 'clipboard_empty',
          message: 'Your clipboard is empty.',
          hint: 'Copy a video link first.',
        }
        return
      }
      url.value = text.trim()
      error.value = null
      if (phase.value === 'error') phase.value = 'idle'
      copied.value = true
      window.clearTimeout(clipboardTimer)
      clipboardTimer = window.setTimeout(() => {
        copied.value = false
      }, 1600)
    } catch {
      error.value = {
        code: 'clipboard',
        message: 'Clipboard access is unavailable.',
        hint: 'Paste the link into the field instead.',
      }
    }
  }

  function reset(): void {
    actionId += 1
    abortResolve()
    stopPolling()
    discardActiveJob()
    url.value = ''
    phase.value = 'idle'
    video.value = null
    presets.value = []
    selectedPreset.value = ''
    token.value = ''
    job.value = null
    error.value = null
    copied.value = false
    resolvedInput.value = ''
  }

  // Editing the link after a result should not leave an old video armed for
  // download under a different URL.
  watch(url, (value) => {
    if (!video.value || value.trim() === resolvedInput.value) return
    actionId += 1
    abortResolve()
    stopPolling()
    discardActiveJob()
    video.value = null
    presets.value = []
    selectedPreset.value = ''
    token.value = ''
    job.value = null
    error.value = null
    phase.value = 'idle'
    resolvedInput.value = ''
  })

  onUnmounted(() => {
    abortResolve()
    stopPolling()
    window.clearTimeout(clipboardTimer)
  })

  return {
    url,
    phase,
    video,
    presets,
    selectedPreset,
    token,
    job,
    error,
    copied,
    isBusy,
    isReady,
    progress,
    resolve,
    startDownload,
    cancel,
    retry,
    pasteLink,
    reset,
  }
}
