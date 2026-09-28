import assert from 'node:assert/strict'
import test from 'node:test'
import { Module } from 'node:module'
import { build } from 'esbuild'

// Bundle the same TS utility, JSON schema and YAML parser that Nuxt loads.
const bundle = await build({
  entryPoints: [new URL('../app/utils/lintiConfig.ts', import.meta.url).pathname],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  write: false,
})
const module = new Module('lintiConfig.cjs')
module._compile(bundle.outputFiles[0].text, 'lintiConfig.cjs')
const { effectiveValue, isChanged, parseConfig, ruleCards, topLevelFields, validateConfig } = module.exports

test('coerced values render like Core values and are not flagged as invalid', () => {
  const enabled = ruleCards.find(card => card.configKey === 'keyword_casing').fields.find(field => field.key === 'enabled')
  const depth = topLevelFields.find(field => field.key === 'max_nesting_depth')
  const data = parseConfig('rules:\n  keyword_casing:\n    enabled: "false"\nmax_nesting_depth: "2"\n').data
  assert.equal(effectiveValue(data, enabled), false)
  assert.equal(effectiveValue(data, depth), 2)
  assert.ok(!validateConfig(data).some(issue => issue.level === 'error'))
  assert.equal(isChanged(data, depth), 2 !== depth.default)
})

test('local feedback still catches invalid forms before authoritative Core save', () => {
  const data = parseConfig('rules:\n  keyword_casing:\n    enabled: maybe\n').data
  assert.ok(validateConfig(data).some(issue => issue.path.join('.') === 'rules.keyword_casing.enabled' && issue.level === 'error'))
})
