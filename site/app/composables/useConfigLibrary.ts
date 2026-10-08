import { decodeSharedConfig, emptyLibrary, encodeSharedConfig, LEGACY_KEY, LIBRARY_KEY, MAX_SHARE_LENGTH, migrateLegacy, parseLibrary, removeProfile, saveProfile } from '../utils/configLibrary'
import type { ConfigLibrary, SavedConfig } from '../utils/configLibrary'
import { presets, presetText } from '../utils/lintiConfig'

const defaultYaml = presetText(presets[0]!)

export function shareLink(name: string, yaml: string): string | null {
  const payload = encodeSharedConfig({ name, yaml })
  if (payload.length > MAX_SHARE_LENGTH) return null
  const { baseURL } = useRuntimeConfig().app
  return `${location.origin}${baseURL}config#config=${payload}`
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
    // Nuxt may have consumed location.hash for anchor handling already.
    if (route.hash.startsWith('#config=')) {
      const shared = decodeSharedConfig(route.hash)
      void router.replace({ query: route.query, hash: '' })
      if (shared) library.value.draft = { yaml: shared.yaml, baseId: null, name: shared.name }
    }
  })

  watch(library, (value) => {
    if (!loaded.value) return
    try {
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(value))
      storageError.value = false
    } catch {
      storageError.value = true
    }
  }, { deep: true })

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
