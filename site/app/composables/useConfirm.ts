type ConfirmRequest = { message: string, confirmLabel: string, danger: boolean, resolve: (ok: boolean) => void }

// Client-only: requests are created from clicks, route changes and storage events.
const pending = shallowRef<ConfirmRequest | null>(null)

/** One styled confirmation dialog for all tool pages, instead of window.confirm(). */
export function useConfirm() {
  function ask(message: string, confirmLabel = 'Replace', danger = false): Promise<boolean> {
    pending.value?.resolve(false)
    return new Promise(resolve => (pending.value = { message, confirmLabel, danger, resolve }))
  }

  function answer(ok: boolean) {
    const request = pending.value
    pending.value = null
    request?.resolve(ok)
  }

  return { pending, ask, answer }
}
