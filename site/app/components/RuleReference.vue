<script setup lang="ts">
import rules from '../../public/rules.json'

type Example = { code: string, description: string, valid: boolean }
type Rule = {
  id: string
  name: string
  description: string
  explanation: string
  group: string
  group_name: string
  severity: string
  auto_fix: boolean
  enabled_by_default: boolean
  config_key: string
  config_example: string
  deprecated_by: string | null
  previous_ids: string[]
  examples: Example[]
}
type Finding = { rule_id: string, message: string, line: number, column: number, severity: string }
type Result = { code: string, fixes: number, issues: Finding[] }

const allRules = rules as Rule[]
const route = useRoute()
const router = useRouter()
const config = useRuntimeConfig()
const query = ref('')
const group = ref('all')
const selectedId = ref(String(route.query.rule || 'C150').toUpperCase())
const selected = computed(() => allRules.find(rule => rule.id === selectedId.value) || allRules[0]!)
const code = ref('')
const procedure = ref('prolog')
const busy = ref(false)
const error = ref('')
const result = ref<Result | null>(null)
const groups = [...new Set(allRules.map(rule => rule.group))]
const filtered = computed(() => allRules.filter((rule) => {
  if (group.value !== 'all' && rule.group !== group.value) return false
  const text = `${rule.id} ${rule.name} ${rule.description} ${rule.explanation}`.toLowerCase()
  return text.includes(query.value.toLowerCase().trim())
}))

let worker: Worker | undefined
let requestId = 0

function chooseExample(example?: Example) {
  code.value = example?.code || 'nValue=1;'
  result.value = null
  error.value = ''
}

function selectRule(rule: Rule) {
  selectedId.value = rule.id
  chooseExample(rule.examples.find(example => !example.valid) || rule.examples[0])
  void router.replace({ query: { ...route.query, rule: rule.id } })
}

watch(selected, rule => chooseExample(rule.examples.find(example => !example.valid) || rule.examples[0]), { immediate: true })
watch(() => route.query.rule, (id) => {
  if (typeof id === 'string' && allRules.some(rule => rule.id === id.toUpperCase())) {
    selectedId.value = id.toUpperCase()
  }
})

function run(fix = false) {
  if (busy.value || !import.meta.client) return
  busy.value = true
  error.value = ''
  result.value = null
  worker ||= new Worker(`${config.app.baseURL}linti-worker.js`)
  const id = ++requestId
  worker.onmessage = ({ data }: MessageEvent<{ id: number, result?: Result, error?: string }>) => {
    if (data.id !== id) return
    busy.value = false
    if (data.error) {
      error.value = data.error
    } else if (data.result) {
      result.value = data.result
      if (fix) code.value = data.result.code
    }
  }
  worker.onerror = (event) => {
    busy.value = false
    error.value = event.message || 'The browser could not load Pyodide.'
  }
  worker.postMessage({ id, code: code.value, procedure: procedure.value, ruleId: selected.value.id, fix })
}

onBeforeUnmount(() => worker?.terminate())
</script>

<template>
  <div class="reference">
    <div class="reference-sidebar">
      <label class="field-label" for="rule-search">Find a rule</label>
      <input id="rule-search" v-model="query" class="field" type="search" placeholder="ID, name, description…">
      <label class="field-label" for="rule-group">Category</label>
      <select id="rule-group" v-model="group" class="field">
        <option value="all">All categories</option>
        <option v-for="letter in groups" :key="letter" :value="letter">
          {{ letter }} · {{ allRules.find(rule => rule.group === letter)?.group_name }}
        </option>
      </select>
      <p class="rule-count">{{ filtered.length }} of {{ allRules.length }} rules</p>
      <div class="rule-list" role="list" aria-label="LinTi rules">
        <button
          v-for="rule in filtered"
          :key="rule.id"
          class="rule-choice"
          :class="{ active: selected.id === rule.id }"
          :aria-current="selected.id === rule.id ? 'true' : undefined"
          @click="selectRule(rule)"
        >
          <span class="rule-choice-title"><code>{{ rule.id }}</code> {{ rule.name }}</span>
          <span class="rule-choice-description">{{ rule.description }}</span>
        </button>
        <p v-if="!filtered.length" class="empty">No matching rules.</p>
      </div>
    </div>

    <section v-if="selected" class="rule-detail" :aria-label="`${selected.id}: ${selected.name}`">
      <div class="rule-header">
        <span class="rule-code">{{ selected.id }}</span>
        <span class="badge">{{ selected.group_name }}</span>
        <span class="badge">{{ selected.severity }}</span>
        <span v-if="selected.auto_fix" class="badge">Auto-fix</span>
      </div>
      <h2>{{ selected.name }}</h2>
      <p class="lede">{{ selected.description }}</p>
      <p v-if="selected.deprecated_by" class="notice">Deprecated; use {{ selected.deprecated_by }} instead.</p>
      <p v-if="!selected.enabled_by_default" class="notice">This rule is disabled by default; the playground selects it explicitly.</p>
      <p v-if="selected.previous_ids.length" class="muted">Previous ID: {{ selected.previous_ids.join(', ') }}</p>
      <div v-if="selected.explanation" class="explanation">{{ selected.explanation }}</div>

      <div class="playground">
        <h3>Try {{ selected.id }}</h3>
        <p>Edit an example and run the real Python rule in your browser. The first run loads Pyodide; subsequent runs reuse it.</p>
        <div v-if="selected.examples.length" class="example-actions">
          <button v-for="(example, index) in selected.examples" :key="index" class="example-button" @click="chooseExample(example)">
            {{ example.description || (example.valid ? 'Valid example' : 'Invalid example') }}
          </button>
        </div>
        <label class="field-label" for="procedure">TI procedure</label>
        <select id="procedure" v-model="procedure" class="field procedure-field">
          <option value="prolog">Prolog</option>
          <option value="metadata">Metadata</option>
          <option value="data">Data</option>
          <option value="epilog">Epilog</option>
        </select>
        <label class="field-label" for="ti-code">TI code</label>
        <textarea id="ti-code" v-model="code" class="code-editor" spellcheck="false" rows="10" aria-label="TI code" />
        <div class="run-actions">
          <button class="run-button" :disabled="busy" @click="run()">{{ busy ? 'Loading LinTi / checking…' : `Run ${selected.id}` }}</button>
          <button v-if="selected.auto_fix" class="fix-button" :disabled="busy" @click="run(true)">Apply auto-fix</button>
        </div>
        <p v-if="error" role="alert" class="error">{{ error }}</p>
        <div v-if="result" class="findings" aria-live="polite">
          <p v-if="result.fixes" class="success">Applied {{ result.fixes }} fix{{ result.fixes === 1 ? '' : 'es' }}.</p>
          <p v-if="!result.issues.length" class="success">No findings for {{ selected.id }}.</p>
          <ul v-else>
            <li v-for="(issue, index) in result.issues" :key="index">
              <code>{{ issue.rule_id }}</code> · {{ issue.severity }} · {{ issue.line }}:{{ issue.column }} — {{ issue.message }}
            </li>
          </ul>
        </div>
      </div>

      <div v-if="selected.config_example" class="configuration">
        <h3>Configuration</h3>
        <pre><code>{{ selected.config_example }}</code></pre>
      </div>
    </section>
  </div>
</template>

<style scoped>
.reference { display: grid; grid-template-columns: minmax(14rem, 19rem) minmax(0, 1fr); gap: 2rem; margin-top: 2rem; align-items: start; }
.reference-sidebar { position: sticky; top: 1.5rem; max-height: calc(100vh - 3rem); display: flex; flex-direction: column; min-width: 0; }
.field-label { display: block; margin: .7rem 0 .35rem; font-size: .85rem; font-weight: 650; }
.field { width: 100%; border: 1px solid var(--ui-border); border-radius: .45rem; padding: .55rem .7rem; color: var(--ui-text); background: var(--ui-bg); }
.rule-count, .muted { color: var(--ui-text-muted); font-size: .85rem; }
.rule-list { overflow-y: auto; border: 1px solid var(--ui-border); border-radius: .5rem; }
.rule-choice { display: block; width: 100%; padding: .7rem .8rem; text-align: left; border-bottom: 1px solid var(--ui-border); }
.rule-choice:hover, .rule-choice.active { background: var(--ui-bg-elevated); }
.rule-choice.active { box-shadow: inset 3px 0 var(--ui-primary); }
.rule-choice-title { display: block; font-size: .9rem; font-weight: 650; }
.rule-choice-description { display: -webkit-box; overflow: hidden; -webkit-line-clamp: 2; -webkit-box-orient: vertical; margin-top: .15rem; color: var(--ui-text-muted); font-size: .8rem; line-height: 1.35; }
.rule-detail { min-width: 0; }
.rule-header, .example-actions, .run-actions { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; }
.rule-code { font-size: 1.15rem; font-weight: 750; color: var(--ui-primary); }
.badge { border: 1px solid var(--ui-border); border-radius: 1rem; padding: .15rem .55rem; font-size: .75rem; }
.rule-detail h2 { margin: .8rem 0 .5rem; font-size: 1.8rem; font-weight: 720; }
.lede { font-size: 1.07rem; }
.explanation { margin: 1.4rem 0; white-space: pre-wrap; line-height: 1.65; }
.notice { padding: .7rem; border-left: 3px solid var(--ui-warning); background: var(--ui-bg-elevated); }
.playground { padding: 1.2rem; border: 1px solid var(--ui-border); border-radius: .65rem; background: var(--ui-bg-elevated); }
.playground h3, .configuration h3 { font-size: 1.2rem; font-weight: 700; margin-bottom: .3rem; }
.playground p { font-size: .9rem; }
.example-actions { margin: 1rem 0; }
.example-button, .fix-button { padding: .4rem .65rem; border: 1px solid var(--ui-border); border-radius: .4rem; font-size: .82rem; }
.example-button:hover, .fix-button:hover { border-color: var(--ui-primary); }
.procedure-field { max-width: 11rem; }
.code-editor { width: 100%; resize: vertical; padding: .8rem; border-radius: .45rem; border: 1px solid var(--ui-border); background: var(--ui-bg); color: var(--ui-text); font: .85rem/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; tab-size: 4; }
.run-actions { margin-top: .8rem; }
.run-button { padding: .48rem .9rem; border-radius: .4rem; background: var(--ui-primary); color: white; font-weight: 650; }
.run-button:disabled, .fix-button:disabled { opacity: .6; cursor: wait; }
.error { color: var(--ui-error); overflow-wrap: anywhere; }
.success { color: var(--ui-success); }
.findings { margin-top: 1rem; }
.findings li { margin: .35rem 0; }
.configuration { margin-top: 1.8rem; }
.configuration pre { padding: 1rem; overflow-x: auto; border-radius: .5rem; background: var(--ui-bg-elevated); }
.empty { padding: .8rem; }
@media (max-width: 760px) { .reference { grid-template-columns: 1fr; gap: 1.5rem; } .reference-sidebar { position: static; max-height: none; } .rule-list { max-height: 15rem; } }
</style>
