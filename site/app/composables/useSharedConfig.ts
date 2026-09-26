/**
 * The visitor's linti.yaml, shared by the configurator, the playground and the
 * rule reference. It lives in this browser only (localStorage) and can travel
 * in a `#config=` link; it is never sent to a server.
 */
const STORAGE_KEY = 'linti:config'

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStored(text: string) {
  try {
    if (text.trim()) localStorage.setItem(STORAGE_KEY, text)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage blocked (private mode, disabled site data): keep it in memory only.
  }
}

export function shareLink(text: string, page = 'config'): string {
  const { baseURL } = useRuntimeConfig().app
  return `${location.origin}${baseURL}${page}#config=${encodeShare(text)}`
}

/**
 * `text` starts empty on the server and during hydration; the stored config
 * (or a share link's) is applied on mount, so prerendered HTML and the first
 * client render agree. Components that read it in their own `onMounted` see
 * the loaded value, because this hook is registered first.
 */
export function useSharedConfig() {
  const text = useState('linti-config', () => '')
  const loaded = useState('linti-config-loaded', () => false)
  /** Whether the value came from storage or a link rather than being empty. */
  const restored = ref(false)
  // Read through the router: the page may drop `location.hash` before mount
  // (anchor scrolling), while the route keeps it.
  const route = useRoute()
  const router = useRouter()

  onMounted(() => {
    if (!loaded.value) {
      text.value = readStored() ?? ''
      loaded.value = true
    }
    const match = /^#config=([\w-]+)$/.exec(route.hash)
    const shared = match ? decodeShare(match[1]!) : null
    if (match) void router.replace({ query: route.query, hash: '' })
    if (shared !== null) text.value = shared
    restored.value = !!text.value.trim()
  })
  watch(text, value => writeStored(value))

  return { text, restored }
}
