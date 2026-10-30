export type SavedConfig = {
  id: string
  name: string
  yaml: string
  createdAt: string
  updatedAt: string
}

export type ConfigDraft = { yaml: string, baseId: string | null, name: string }
export type ConfigLibrary = { version: 1, profiles: SavedConfig[], draft: ConfigDraft }
export type SharedConfig = { name: string, yaml: string }

export const LIBRARY_KEY = 'linti:config-library:v1'
export const LEGACY_KEY = 'linti:config'
export const MAX_SHARE_LENGTH = 8000

export function emptyLibrary(defaultYaml: string): ConfigLibrary {
  return { version: 1, profiles: [], draft: { yaml: defaultYaml, baseId: null, name: '' } }
}

export function migrateLegacy(yaml: string, id: string, now: string): ConfigLibrary {
  const name = 'My linti.yaml'
  return {
    version: 1,
    profiles: [{ id, name, yaml, createdAt: now, updatedAt: now }],
    draft: { baseId: id, yaml, name },
  }
}

export function parseLibrary(raw: string | null): ConfigLibrary | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1
      || !('profiles' in value) || !Array.isArray(value.profiles)
      || !('draft' in value) || !value.draft || typeof value.draft !== 'object') return null
    const draft = value.draft as Record<string, unknown>
    const profiles = value.profiles as unknown[]
    if (typeof draft.yaml !== 'string' || typeof draft.name !== 'string'
      || !(draft.baseId === null || typeof draft.baseId === 'string')
      || profiles.some(profile => !profile || typeof profile !== 'object'
        || !['id', 'name', 'yaml', 'createdAt', 'updatedAt'].every(key => typeof (profile as Record<string, unknown>)[key] === 'string'))) return null
    return value as ConfigLibrary
  } catch {
    return null
  }
}

export function saveProfile(library: ConfigLibrary, name: string, id: string, now: string, asNew = false): ConfigLibrary {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Give this configuration a name.')
  const existing = asNew ? null : library.profiles.find(profile => profile.id === library.draft.baseId) ?? null
  if (library.profiles.some(profile => profile.name.toLowerCase() === trimmed.toLowerCase() && profile.id !== existing?.id)) {
    throw new Error('A configuration with this name already exists.')
  }
  const profile: SavedConfig = existing
    ? { ...existing, name: trimmed, yaml: library.draft.yaml, updatedAt: now }
    : { id, name: trimmed, yaml: library.draft.yaml, createdAt: now, updatedAt: now }
  return {
    version: 1,
    profiles: existing
      ? library.profiles.map(item => item.id === existing.id ? profile : item)
      : [...library.profiles, profile],
    draft: { yaml: profile.yaml, baseId: profile.id, name: profile.name },
  }
}

export function removeProfile(library: ConfigLibrary, id: string, defaultYaml: string): ConfigLibrary {
  return {
    version: 1,
    profiles: library.profiles.filter(profile => profile.id !== id),
    draft: library.draft.baseId === id ? emptyLibrary(defaultYaml).draft : library.draft,
  }
}

function sameProfile(a: SavedConfig, b: SavedConfig): boolean {
  return a.name === b.name && a.yaml === b.yaml
}

/**
 * Three-way merge of this tab's library into what another tab stored meanwhile.
 * `base` is the stored profile list this tab last read or wrote. Changes made
 * here are replayed onto `stored`, so profiles another tab added, edited or
 * deleted survive. When both tabs changed the same profile, the stored version
 * stays and this tab's version is kept as a renamed copy.
 */
export function mergeLibrary(base: SavedConfig[], local: ConfigLibrary, stored: ConfigLibrary, newId: () => string): ConfigLibrary {
  const baseById = new Map(base.map(profile => [profile.id, profile]))
  const localIds = new Set(local.profiles.map(profile => profile.id))
  let profiles = stored.profiles.filter((theirs) => {
    const old = baseById.get(theirs.id)
    // Deleted here, and untouched elsewhere since this tab last synced.
    return localIds.has(theirs.id) || !old || !sameProfile(old, theirs)
  })
  const added = new Set<string>()
  let draft = local.draft
  for (const mine of local.profiles) {
    const old = baseById.get(mine.id)
    if (old && sameProfile(old, mine)) continue
    const theirs = profiles.find(profile => profile.id === mine.id)
    if (!theirs) {
      // New here, or edited here while another tab deleted it: keep the edit.
      profiles = [...profiles, mine]
      added.add(mine.id)
    } else if (!old || sameProfile(old, theirs)) {
      profiles = profiles.map(profile => profile.id === mine.id ? mine : profile)
    } else if (!sameProfile(theirs, mine)) {
      const copy = { ...mine, id: newId(), name: `${mine.name} (this tab)` }
      profiles = [...profiles, copy]
      added.add(copy.id)
      if (draft.baseId === mine.id) draft = { ...draft, baseId: copy.id, name: copy.name }
    }
  }
  // Two tabs can create the same name independently; rename this tab's one.
  const names = new Set(profiles.filter(profile => !added.has(profile.id)).map(profile => profile.name.toLowerCase()))
  profiles = profiles.map((profile) => {
    if (!added.has(profile.id)) return profile
    let name = profile.name
    let suffix = 2
    while (names.has(name.toLowerCase())) name = `${profile.name} (${suffix++})`
    names.add(name.toLowerCase())
    if (name === profile.name) return profile
    if (draft.baseId === profile.id) draft = { ...draft, name }
    return { ...profile, name }
  })
  return { version: 1, profiles, draft }
}

function encode(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decode(value: string): string | null {
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0)))
  } catch {
    return null
  }
}

/** A fragment carries one profile, never the local library. Old YAML-only links still work. */
export function encodeSharedConfig(config: SharedConfig): string {
  return `v1.${encode(JSON.stringify(config))}`
}

export function decodeSharedConfig(hash: string): SharedConfig | null {
  const match = /^#config=([\w.-]+)$/.exec(hash)
  if (!match || match[1]!.length > MAX_SHARE_LENGTH) return null
  const payload = match[1]!
  const decoded = decode(payload.startsWith('v1.') ? payload.slice(3) : payload)
  if (decoded === null) return null
  if (!payload.startsWith('v1.')) return { name: 'Shared configuration', yaml: decoded }
  try {
    const value: unknown = JSON.parse(decoded)
    if (!value || typeof value !== 'object' || !('name' in value) || !('yaml' in value)
      || typeof value.name !== 'string' || typeof value.yaml !== 'string') return null
    return { name: value.name, yaml: value.yaml }
  } catch {
    return null
  }
}
