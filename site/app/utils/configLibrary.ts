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
