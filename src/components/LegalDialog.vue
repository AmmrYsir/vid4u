<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (event: 'close'): void }>()

const dialog = ref<HTMLDialogElement | null>(null)

function syncOpen(open: boolean): void {
  const element = dialog.value
  if (!element) return
  if (open && !element.open) element.showModal()
  if (!open && element.open) element.close()
}

watch(() => props.open, syncOpen)
onMounted(() => syncOpen(props.open))

function close(): void {
  dialog.value?.close()
}

function onBackdrop(event: MouseEvent): void {
  if (event.target === dialog.value) close()
}
</script>

<template>
  <dialog ref="dialog" class="legal-dialog" @close="emit('close')" @click="onBackdrop">
    <div class="legal-card">
      <div class="legal-head">
        <div>
          <span class="section-kicker">THE FINE PRINT, SIMPLIFIED</span>
          <h2>Privacy &amp; fair use</h2>
        </div>
        <button class="legal-close" type="button" aria-label="Close" @click="close">×</button>
      </div>

      <div class="legal-body">
        <section>
          <h3>What happens to your link</h3>
          <p>
            Your link is sent to the vid4u server only to prepare the download you asked for.
            We do not require an account, keep a download history, or sell personal data.
            Temporary files are deleted automatically when the download expires.
          </p>
        </section>
        <section>
          <h3>Use it fairly</h3>
          <p>
            Only download videos you own or have permission to save. Respect copyright and the
            terms of the platform you are using. vid4u is not affiliated with Meta, YouTube,
            TikTok, X or any other platform.
          </p>
        </section>
        <section>
          <h3>Public videos only</h3>
          <p>
            Private, members-only and login-protected videos are not supported. Instagram and
            some Facebook or YouTube videos may require a logged-in session; these links return
            a clear error instead of a download.
          </p>
        </section>
        <section>
          <h3>Rate limits</h3>
          <p>
            Requests are rate-limited and downloads are capped by length and file size to keep
            the service available for everyone. Very long videos and live streams are rejected.
          </p>
        </section>
        <p class="legal-footnote">
          By using vid4u you agree to use it only for content you have the right to download.
        </p>
      </div>
    </div>
  </dialog>
</template>
