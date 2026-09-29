type WorkerReply<Result> = { id: number, status?: 'running', result?: Result, error?: string }

// Downloading Pyodide can take a while; a lint run should not.
const LOAD_TIMEOUT_MS = 120_000
const RUN_TIMEOUT_MS = 15_000

/** One in-flight request and at most one queued replacement, shared by both demos. */
export function useLintiWorker<Result>() {
  const baseURL = useRuntimeConfig().app.baseURL
  const busy = ref(false)
  const ready = ref(false)
  const error = ref('')
  let worker: Worker | undefined
  type Callback = { onResult: (result: Result) => void, onError?: (message: string) => void }
  let active: Callback & { id: number } | undefined
  let queued: Callback & { payload: Record<string, unknown> } | undefined
  let nextId = 0
  let watchdog: ReturnType<typeof setTimeout> | undefined

  function stop() {
    clearTimeout(watchdog)
    worker?.terminate()
    worker = undefined
    active = undefined
    queued = undefined
    busy.value = false
    ready.value = false
  }

  function arm(ms: number) {
    clearTimeout(watchdog)
    watchdog = setTimeout(() => {
      const next = queued
      const onError = active?.onError
      stop()
      error.value = ms === LOAD_TIMEOUT_MS
        ? 'LinTi could not finish loading. Please try again.'
        : `LinTi did not finish within ${RUN_TIMEOUT_MS / 1000} s and was stopped.`
      onError?.(error.value)
      if (next) dispatch(next.payload, next.onResult, next.onError)
    }, ms)
  }

  function dispatch(payload: Record<string, unknown>, onResult: (result: Result) => void, onError?: (message: string) => void) {
    const id = ++nextId
    active = { id, onResult, onError }
    busy.value = true
    error.value = ''
    if (!worker) {
      worker = new Worker(`${baseURL}linti-worker.js`)
      worker.onmessage = ({ data }: MessageEvent<WorkerReply<Result>>) => {
        if (!active || data.id !== active.id) return
        if (data.status === 'running') {
          ready.value = true
          arm(RUN_TIMEOUT_MS)
          return
        }
        clearTimeout(watchdog)
        const callback = active.onResult
        const fail = active.onError
        active = undefined
        const next = queued
        queued = undefined
        if (data.error) {
          error.value = data.error
          fail?.(data.error)
        }
        else if (data.result && !next) callback(data.result)
        if (next) dispatch(next.payload, next.onResult, next.onError)
        else busy.value = false
      }
      worker.onerror = (event) => {
        const onError = active?.onError
        stop()
        error.value = event.message || 'The browser could not load Pyodide.'
        onError?.(error.value)
      }
    }
    arm(ready.value ? RUN_TIMEOUT_MS : LOAD_TIMEOUT_MS)
    worker.postMessage({ ...payload, id })
  }

  function run(payload: Record<string, unknown>, onResult: (result: Result) => void, onError?: (message: string) => void) {
    error.value = ''
    if (active) {
      queued = { payload, onResult, onError }
      return
    }
    dispatch(payload, onResult, onError)
  }

  /** Ignore the current result after input changes, without re-downloading Pyodide. */
  function invalidate() {
    if (active) active.onResult = () => {}
    queued = undefined
  }

  onBeforeUnmount(stop)
  return { busy, ready, error, run, invalidate }
}
