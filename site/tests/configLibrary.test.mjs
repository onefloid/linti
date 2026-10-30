import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeSharedConfig, emptyLibrary, encodeSharedConfig, mergeLibrary, migrateLegacy, parseLibrary, removeProfile, saveProfile } from '../app/utils/configLibrary.ts'

test('migrates the previous browser YAML without losing its content', () => {
  const yaml = 'rules:\n  keyword_casing:\n    enabled: false\n'
  const migrated = migrateLegacy(yaml, 'old-id', '2026-09-27T00:00:00Z')
  assert.equal(migrated.profiles[0].yaml, yaml)
  assert.equal(migrated.draft.baseId, 'old-id')
  assert.deepEqual(parseLibrary(JSON.stringify(migrated)), migrated)
  assert.equal(parseLibrary(JSON.stringify(emptyLibrary('')))?.profiles.length, 0)
})

test('rejects corrupt storage without discarding a valid library', () => {
  assert.equal(parseLibrary('{'), null)
  assert.equal(parseLibrary('{"version":2,"profiles":[],"draft":{}}'), null)
  assert.equal(parseLibrary('{"version":1,"profiles":[{}],"draft":{"yaml":"","name":"","baseId":null}}'), null)
})

test('keeps multiple profiles independent and resets only a deleted active profile', () => {
  const firstDraft = emptyLibrary('defaults')
  firstDraft.draft = { yaml: 'rules:\n  keyword_casing: {}', name: 'CI', baseId: null }
  const first = saveProfile(firstDraft, 'CI', 'id-1', '2026-09-27')
  const secondDraft = { ...first, draft: { yaml: 'rules:\n  indentation: {}', name: 'Dev', baseId: null } }
  const second = saveProfile(secondDraft, 'Dev', 'id-2', '2026-09-28')
  assert.deepEqual(second.profiles.map(profile => profile.name), ['CI', 'Dev'])
  assert.equal(second.profiles[0].yaml, 'rules:\n  keyword_casing: {}')
  assert.equal(second.draft.baseId, 'id-2')
  assert.throws(() => saveProfile(second, 'CI', 'id-3', '2026-09-29', true), /already exists/)
  const deleted = removeProfile(second, 'id-2', 'defaults')
  assert.deepEqual(deleted.profiles.map(profile => profile.name), ['CI'])
  assert.equal(deleted.draft.yaml, 'defaults')
  assert.equal(deleted.draft.baseId, null)
})

test('a named empty draft saves once and subsequent saves update the same profile', () => {
  const library = emptyLibrary('recommended preset')
  library.draft = { yaml: '', name: 'Fresh', baseId: null }
  const created = saveProfile(library, library.draft.name, 'fresh-id', '2026-09-29')
  assert.equal(created.profiles[0].yaml, '')
  assert.equal(created.draft.baseId, 'fresh-id')

  created.draft.yaml = 'rules:\n  indentation:\n    size: 2\n'
  const updated = saveProfile(created, created.draft.name, 'unused-id', '2026-09-30')
  assert.equal(updated.profiles.length, 1)
  assert.equal(updated.profiles[0].id, 'fresh-id')
  assert.equal(updated.profiles[0].yaml, created.draft.yaml)
})

test('new and previous share links preserve Unicode YAML and a profile name', () => {
  const yaml = '# Grüße 🌍\nrules:\n  keyword_casing:\n    enabled: false\n'
  const shared = { name: 'Meine Regeln', yaml }
  assert.deepEqual(decodeSharedConfig(`#config=${encodeSharedConfig(shared)}`), shared)
  const legacy = Buffer.from(yaml).toString('base64url')
  assert.deepEqual(decodeSharedConfig(`#config=${legacy}`), { name: 'Shared configuration', yaml })
  assert.equal(decodeSharedConfig('#config=v1.not-json'), null)
  assert.equal(decodeSharedConfig(`#config=${'a'.repeat(8001)}`), null)
})

const profile = (id, name, yaml = `# ${name}\n`) => ({ id, name, yaml, createdAt: '2026-10-01', updatedAt: '2026-10-01' })
const library = (profiles, draft = { yaml: '', baseId: null, name: '' }) => ({ version: 1, profiles, draft })
const ids = () => { let next = 0; return () => `new-${++next}` }

test('a stale tab keeps profiles another tab saved meanwhile', () => {
  const alpha = profile('a', 'Alpha')
  // Tab B loaded [Alpha], tab A then stored Beta; B only changed its draft.
  const stored = library([alpha, profile('b', 'Beta')])
  const local = library([alpha], { yaml: '# F110 variant\n', baseId: null, name: 'F110 variant' })
  const merged = mergeLibrary([alpha], local, stored, ids())
  assert.deepEqual(merged.profiles.map(item => item.name), ['Alpha', 'Beta'])
  assert.deepEqual(merged.draft, local.draft)
})

test('local edits, additions and deletions replay onto the stored library', () => {
  const base = [profile('a', 'Alpha'), profile('b', 'Beta'), profile('c', 'Gamma')]
  const stored = library([...base, profile('d', 'Delta')])
  const local = library([{ ...base[0], yaml: '# edited\n' }, base[2], profile('e', 'Epsilon')])
  const merged = mergeLibrary(base, local, stored, ids())
  assert.deepEqual(merged.profiles.map(item => item.id), ['a', 'c', 'd', 'e'])
  assert.equal(merged.profiles[0].yaml, '# edited\n')
})

test('concurrent edits and deletions never lose either version', () => {
  const base = [profile('a', 'Alpha'), profile('b', 'Beta')]
  // Elsewhere: Alpha edited, Beta deleted. Here: Alpha edited differently, Beta edited.
  const stored = library([{ ...base[0], yaml: '# theirs\n' }])
  const local = library([{ ...base[0], yaml: '# mine\n' }, { ...base[1], yaml: '# kept\n' }], { yaml: '# mine\n', baseId: 'a', name: 'Alpha' })
  const merged = mergeLibrary(base, local, stored, ids())
  assert.deepEqual(merged.profiles.map(item => [item.name, item.yaml]), [
    ['Alpha', '# theirs\n'],
    ['Alpha (this tab)', '# mine\n'],
    ['Beta', '# kept\n'],
  ])
  assert.deepEqual(merged.draft, { yaml: '# mine\n', baseId: 'new-1', name: 'Alpha (this tab)' })
})

test('a deletion elsewhere wins over an untouched local copy, and duplicate names are renamed', () => {
  const base = [profile('a', 'Alpha')]
  const stored = library([profile('x', 'Beta')])
  const local = library([base[0], profile('y', 'beta')], { yaml: '# beta\n', baseId: 'y', name: 'beta' })
  const merged = mergeLibrary(base, local, stored, ids())
  assert.deepEqual(merged.profiles.map(item => item.name), ['Beta', 'beta (2)'])
  assert.equal(merged.draft.name, 'beta (2)')
})
