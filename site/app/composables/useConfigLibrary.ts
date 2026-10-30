import type { Ref } from 'vue'
import type { Router } from 'vue-router'
import { decodeSharedConfig, emptyLibrary, encodeSharedConfig, LEGACY_KEY, LIBRARY_KEY, MAX_SHARE_LENGTH, mergeLibrary, migrateLegacy, parseLibrary, removeProfile, saveProfile } from '../utils/configLibrary'
import type { ConfigLibrary, SavedConfig } from '../utils/configLibrary'
import { presets, presetText } from '../utils/lintiConfig'

const defaultYaml = presetText(presets[0]!)

export function shareLink(name: string, yaml: string): string | null {
  const payload = encodeSharedConfig({ name, yaml })
  if (payload.length > MAX_SHARE_LENGTH) return null
  const { baseURL } = useRuntimeConfig().app
  return `${location.origin}${baseURL}config#config=${payload}`
}

function hasUnsavedDraft(library: ConfigLibrary): boolean {
  const { draft } = library
  const base = library.profiles.find(profile => profile.id === draft.baseId)
  if (base) return base.yaml !== draft.yaml
  return Boolean(draft.name) || (draft.yaml !== defaultYaml && Boolean(draft.yaml.trim()))
}

let sync: { importHash: (hash: string) => void } | null = null

/**
 * Loads the library once per page load and keeps it in step with localStorage
 * and with other tabs. Every write is merged into what is stored at that
 * moment, so a tab holding an older copy cannot drop profiles saved elsewhere.
 */
function startSync(library: Ref<ConfigLibrary>, loaded: Ref<boolean>, storageError: Ref<boolean>, router: Router) {
  if (!loaded.value) {
    try {
      const stored = localStorage.getItem(LIBRARY_KEY)
      const parsed = parseLibrary(stored)
      if (parsed) library.value = parsed
      else {
        const legacy = localStorage.getItem(LEGACY_KEY)
        if (legacy?.trim()) {
          library.value = migrateLegacy(legacy, crypto.randomUUID(), new Date().toISOString())
          localStorage.setItem(LIBRARY_KEY, JSON.stringify(library.value))
          localStorage.removeItem(LEGACY_KEY)
        } else if (stored) storageError.value = true
      }
    } catch {
      storageError.value = true
    }
    loaded.value = true
  }
  const clone = (value: ConfigLibrary) => JSON.parse(JSON.stringify(value)) as ConfigLibrary
  // The profiles as last read from or written to storage, the merge base.
  let synced = clone(library.value).profiles
  // The serialized state that needs no write.
  let written = JSON.stringify(library.value)

  function persist(value: ConfigLibrary) {
    const text = JSON.stringify(value)
    if (text === written) return
    try {
      const stored = parseLibrary(localStorage.getItem(LIBRARY_KEY))
      const next = stored ? mergeLibrary(synced, value, stored, () => crypto.randomUUID()) : value
      const output = JSON.stringify(next)
      localStorage.setItem(LIBRARY_KEY, output)
      synced = clone(next).profiles
      written = output
      if (output !== text) library.value = clone(next)
      storageError.value = false
    } catch {
      storageError.value = true
    }
  }

  function adopt(raw: string | null) {
    const stored = parseLibrary(raw)
    if (!stored) return
    const next = mergeLibrary(synced, library.value, stored, () => crypto.randomUUID())
    synced = clone(stored).profiles
    // Unchanged profiles need no write back; the draft stays local to this tab.
    if (JSON.stringify(next.profiles) === JSON.stringify(stored.profiles)) written = JSON.stringify(next)
    library.value = next
  }

  // Mounting and the route watcher can both see one link; ask only once.
  let handledHash = ''
  function importHash(hash: string) {
    if (!hash.startsWith('#config=')) {
      handledHash = ''
      return
    }
    if (hash === handledHash) return
    handledHash = hash
    const shared = decodeSharedConfig(hash)
    const route = router.currentRoute.value
    void router.replace({ path: route.path, query: route.query, hash: '' })
    if (!shared) return
    if (hasUnsavedDraft(library.value) && library.value.draft.yaml !== shared.yaml
      && !confirm(`Replace the current unsaved configuration with the shared "${shared.name}"?`)) return
    library.value.draft = { yaml: shared.yaml, baseId: null, name: shared.name }
  }

  effectScope(true).run(() => {
    watch(library, persist, { deep: true })
    // Pasting a share link into an open page only changes the fragment, which
    // the router picks up from popstate without remounting anything.
    watch(() => router.currentRoute.value.hash, importHash)
  })
  window.addEventListener('storage', (event) => {
    if (event.key === LIBRARY_KEY && event.storageArea === localStorage) adopt(event.newValue)
  })
  return { importHash }
}

/** Browser-only profile library, shared across all three interactive pages. */
export function useConfigLibrary() {
  const library = useState<ConfigLibrary>('linti-config-library', () => emptyLibrary(defaultYaml))
  const loaded = useState('linti-config-library-loaded', () => false)
  const storageError = useState('linti-config-library-storage-error', () => false)
  const route = useRoute()
  const router = useRouter()

  const activeProfile = computed(() => library.value.profiles.find(profile => profile.id === library.value.draft.baseId) ?? null)
  const yaml = computed({
    get: () => library.value.draft.yaml,
    set: (value: string) => { library.value.draft.yaml = value },
  })
  const isDefault = computed(() => !activeProfile.value && !library.value.draft.name && (yaml.value === defaultYaml || !yaml.value.trim()))
  const dirty = computed(() => activeProfile.value ? activeProfile.value.yaml !== yaml.value : !isDefault.value)
  const label = computed(() => activeProfile.value?.name ?? (isDefault.value ? 'LinTi defaults' : library.value.draft.name || 'Local draft'))
  const status = computed(() => isDefault.value ? 'defaults' : dirty.value ? 'draft' : 'saved')

  onMounted(() => {
    sync ??= startSync(library, loaded, storageError, router)
    // Nuxt may have consumed location.hash for anchor handling already.
    sync.importHash(route.hash)
  })

  function selectProfile(id: string) {
    const profile = library.value.profiles.find(item => item.id === id)
    if (profile) library.value.draft = { yaml: profile.yaml, baseId: id, name: profile.name }
  }

  function selectDefaults() {
    library.value.draft = { yaml: defaultYaml, baseId: null, name: '' }
  }

  function startDraft(name = '', source = yaml.value) {
    library.value.draft = { yaml: source, baseId: null, name }
  }

  function save(name: string, asNew = false): SavedConfig {
    library.value = saveProfile(library.value, name, crypto.randomUUID(), new Date().toISOString(), asNew)
    return activeProfile.value!
  }

  function deleteProfile(id: string) {
    library.value = removeProfile(library.value, id, defaultYaml)
  }

  function importLibrary(raw: string): boolean {
    const imported = parseLibrary(raw)
    if (!imported) return false
    // Imported IDs must not collide with existing profiles.
    const names = new Set(library.value.profiles.map(profile => profile.name.toLowerCase()))
    for (const profile of imported.profiles) {
      let name = profile.name
      let suffix = 2
      while (names.has(name.toLowerCase())) name = `${profile.name} (${suffix++})`
      names.add(name.toLowerCase())
      library.value.profiles.push({ ...profile, id: crypto.randomUUID(), name })
    }
    return true
  }

  return { library, yaml, loaded, storageError, activeProfile, dirty, label, status, selectProfile, selectDefaults, startDraft, save, deleteProfile, importLibrary }
}
