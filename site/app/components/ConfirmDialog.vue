<script setup lang="ts">
const { pending, answer } = useConfirm()
const dialog = ref<HTMLDialogElement | null>(null)

function sync() {
  if (!dialog.value) return
  if (pending.value && !dialog.value.open) dialog.value.showModal()
  else if (!pending.value && dialog.value.open) dialog.value.close()
}

watch(pending, sync, { flush: 'post' })
onMounted(sync)
</script>

<template>
  <dialog ref="dialog" class="confirm-dialog" aria-labelledby="confirm-message" @cancel.prevent="answer(false)">
    <p id="confirm-message">{{ pending?.message }}</p>
    <div class="confirm-actions">
      <UButton color="neutral" variant="ghost" @click="answer(false)">Cancel</UButton>
      <UButton :color="pending?.danger ? 'error' : 'primary'" @click="answer(true)">{{ pending?.confirmLabel }}</UButton>
    </div>
  </dialog>
</template>

<style scoped>
.confirm-dialog { width: min(28rem, calc(100vw - 2rem)); max-width: none; padding: 1.2rem; border: 1px solid var(--ui-border); border-radius: .6rem; color: var(--ui-text); background: var(--ui-bg); box-shadow: 0 1rem 3rem rgb(0 0 0 / 20%); }
.confirm-dialog::backdrop { background: rgb(0 0 0 / 45%); }
.confirm-dialog p { margin: 0 0 1rem; line-height: 1.5; }
.confirm-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .5rem; }
</style>
