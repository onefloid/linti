<script setup lang="ts">
import rules from '../data/rules.json'

type Example = {
  code: string
  description: string
  valid: boolean
  procedure: string
  config: string
  parameters: string[]
  variables: string[]
  datasource_type: string | null
  datasource_query: string | null
}
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
  default_config: string
  deprecated_by: string | null
  previous_ids: string[]
  examples: Example[]
}
type Finding = { rule_id: string, message: string, line: number, column: number, severity: 'error' | 'warning', fixable: boolean }
type Result = { code: string, fixes: number, warnings: string[], issues: Finding[] }
type WorkerReply = { id: number, status?: 'running', result?: Result, error?: string }

// Upper bound for one lint run once Pyodide is loaded. Loading itself is not
// timed: a first visit on a slow connection may legitimately take longer.
const RUN_TIMEOUT_MS = 15_000
const DEFAULT_RULE = 'C150'

const allRules = rules as Rule[]
// The visitor's own linti.yaml from the configurator, if they saved one.
const { text: savedConfig } = useSharedConfig()
const route = useRoute()
const router = useRouter()
const config = useRuntimeConfig()
const query = ref('')
const groups = [...new Set(allRules.map(rule => rule.group))]
const group = ref('all')
const groupItems = [
  { label: 'All categories', value: 'all' },
  ...groups.map(letter => ({ label: `${letter} · ${allRules.find(rule => rule.group === letter)?.group_name}`, value: letter })),
]
const procedureItems = [
  { label: 'Prolog', value: 'prolog' },
  { label: 'Metadata', value: 'metadata' },
  { label: 'Data', value: 'data' },
  { label: 'Epilog', value: 'epilog' },
]
// 16px text on phones keeps iOS Safari from zooming in when a field gets focus.
const fieldUi = { base: 'text-base sm:text-sm' }
// Starts at the default on both server and client; the ?rule= deep link is
// applied in onMounted so the prerendered HTML and hydration agree.
const selectedId = ref(DEFAULT_RULE)
const selected = computed(() => allRules.find(rule => rule.id === selectedId.value) || allRules[0]!)
const code = ref('')
const codeEditor = ref<HTMLTextAreaElement | null>(null)
const procedure = ref('prolog')
type ConfigMode = 'defaults' | 'example' | 'saved' | 'custom'
const configMode = ref<ConfigMode>('defaults')
const exampleConfig = ref('')
const customConfig = ref('')
const hasCustomDraft = ref(false)
const lintiYaml = computed(() => {
  if (configMode.value === 'example') return exampleConfig.value
  if (configMode.value === 'saved') return savedConfig.value
  if (configMode.value === 'custom') return customConfig.value
  return ''
})
function selectConfig(mode: ConfigMode) {
  if (mode === 'custom' && !hasCustomDraft.value) {
    customConfig.value = ''
    hasCustomDraft.value = true
  }
  configMode.value = mode
}
function editConfig(event: Event) {
  customConfig.value = (event.target as HTMLTextAreaElement).value
  hasCustomDraft.value = true
  configMode.value = 'custom'
}
const parameters = ref('')
const variables = ref('')
const datasourceType = ref('')
const datasourceQuery = ref('')
type RuleDraft = {
  ruleId: string
  code: string
  procedure: string
  parameters: string
  variables: string
  datasourceType: string
  datasourceQuery: string
  configMode: ConfigMode
  customConfig: string
  hasCustomDraft: boolean
  exampleConfig: string
}
const draft = useState<RuleDraft | null>('linti-rule-reference-draft', () => null)
const splitNames = (text: string) => text.split(/[\s,]+/).filter(Boolean)
// Only the context an example actually uses is shown; the rest can be added.
type ContextField = 'parameters' | 'variables' | 'datasource'
const contextLabels: Record<ContextField, string> = {
  parameters: 'Parameters',
  variables: 'Variables',
  datasource: 'Data source',
}
const shownContext = ref<ContextField[]>([])
const hiddenContext = computed(() => (Object.keys(contextLabels) as ContextField[]).filter(field => !shownContext.value.includes(field)))
function addContext(field: ContextField) {
  shownContext.value = [...shownContext.value, field]
}
function removeContext(field: ContextField) {
  shownContext.value = shownContext.value.filter(item => item !== field)
  if (field === 'parameters') parameters.value = ''
  if (field === 'variables') variables.value = ''
  if (field === 'datasource') datasourceType.value = datasourceQuery.value = ''
}
const busy = ref(false)
const error = ref('')
const result = ref<Result | null>(null)
const errorCount = computed(() => result.value?.issues.filter(issue => issue.severity === 'error').length ?? 0)
const warningCount = computed(() => (result.value?.issues.length ?? 0) - errorCount.value)
const fixableCount = computed(() => result.value?.issues.filter(issue => issue.fixable).length ?? 0)
const filtered = computed(() => allRules.filter((rule) => {
  if (group.value !== 'all' && rule.group !== group.value) return false
  const text = `${rule.id} ${rule.name} ${rule.description} ${rule.explanation}`.toLowerCase()
  return text.includes(query.value.toLowerCase().trim())
}))

let worker: Worker | undefined
let requestId = 0
// The request whose reply the UI is waiting for. Replies for any other id are
// stale (the user moved on) and are dropped.
let pending: { id: number, fix: boolean } | undefined
let watchdog: ReturnType<typeof setTimeout> | undefined

function finish() {
  pending = undefined
  busy.value = false
}

function chooseExample(example?: Example) {
  code.value = example?.code || 'nValue=1;'
  procedure.value = example?.procedure || 'prolog'
  exampleConfig.value = example?.config || ''
  if (configMode.value === 'defaults' || configMode.value === 'example') {
    configMode.value = exampleConfig.value ? 'example' : 'defaults'
  }
  parameters.value = example?.parameters.join(', ') || ''
  variables.value = example?.variables.join(', ') || ''
  datasourceType.value = example?.datasource_type || ''
  datasourceQuery.value = example?.datasource_query || ''
  shownContext.value = (Object.keys(contextLabels) as ContextField[]).filter(field => ({
    parameters: parameters.value,
    variables: variables.value,
    datasource: datasourceType.value || datasourceQuery.value,
  })[field])
  result.value = null
  error.value = ''
}

function selectRule(rule: Rule) {
  selectedId.value = rule.id
  void router.replace({ query: { ...route.query, rule: rule.id } })
}

watch(selected, rule => chooseExample(rule.examples.find(example => !example.valid) || rule.examples[0]), { immediate: true })
// The page is prerendered without a query string, so URL state is applied only
// after hydration to keep the server and client markup identical.
function applyQuery() {
  const letter = String(route.query.group || '').toUpperCase()
  if (groups.includes(letter)) {
    group.value = letter
    if (selected.value.group !== letter) selectedId.value = allRules.find(rule => rule.group === letter)!.id
  }
  const id = String(route.query.rule || '').toUpperCase()
  if (allRules.some(rule => rule.id === id)) selectedId.value = id
  if (route.query.config === 'saved' && savedConfig.value.trim()) configMode.value = 'saved'
}

onMounted(async () => {
  applyQuery()
  await nextTick()
  const previous = draft.value
  if (!previous || previous.ruleId !== selectedId.value) return
  code.value = previous.code
  procedure.value = previous.procedure
  parameters.value = previous.parameters
  variables.value = previous.variables
  datasourceType.value = previous.datasourceType
  datasourceQuery.value = previous.datasourceQuery
  exampleConfig.value = previous.exampleConfig
  customConfig.value = previous.customConfig
  hasCustomDraft.value = previous.hasCustomDraft
  if (route.query.config !== 'saved') configMode.value = previous.configMode === 'saved' && !savedConfig.value.trim() ? 'defaults' : previous.configMode
  shownContext.value = (Object.keys(contextLabels) as ContextField[]).filter(field => ({
    parameters: parameters.value,
    variables: variables.value,
    datasource: datasourceType.value || datasourceQuery.value,
  })[field])
})
watch(() => [route.query.rule, route.query.group], applyQuery)

// Any change to what would be linted abandons the in-flight request, so its
// result can neither be shown for the wrong rule nor overwrite edited code.
watch([code, procedure, selectedId, lintiYaml, parameters, variables, datasourceType, datasourceQuery], () => {
  if (pending) finish()
})

function resetWorker() {
  clearTimeout(watchdog)
  worker?.terminate()
  worker = undefined
}

function onReply({ data }: MessageEvent<WorkerReply>) {
  if (data.status === 'running') {
    // Guards the worker, not a particular request: a hung run blocks every
    // request queued behind it, stale or not.
    clearTimeout(watchdog)
    watchdog = setTimeout(() => {
      resetWorker()
      if (pending) {
        finish()
        error.value = `LinTi did not finish within ${RUN_TIMEOUT_MS / 1000} s and was stopped.`
      }
    }, RUN_TIMEOUT_MS)
    return
  }
  clearTimeout(watchdog)
  if (data.id !== pending?.id) return
  const { fix } = pending
  finish()
  if (data.error) {
    error.value = data.error
  } else if (data.result) {
    result.value = data.result
    if (fix) code.value = data.result.code
  }
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(`${config.app.baseURL}linti-worker.js`)
    worker.onmessage = onReply
    worker.onerror = (event) => {
      // The worker script itself failed; start from scratch on the next run.
      resetWorker()
      finish()
      error.value = event.message || 'The browser could not load Pyodide.'
    }
  }
  return worker
}

function run(fix = false) {
  if (busy.value || !import.meta.client) return
  busy.value = true
  error.value = ''
  result.value = null
  pending = { id: ++requestId, fix }
  const context = {
    config: lintiYaml.value,
    parameters: splitNames(parameters.value),
    variables: splitNames(variables.value),
    datasource_type: datasourceType.value.trim(),
    datasource_query: datasourceQuery.value.trim(),
  }
  getWorker().postMessage({ id: pending.id, code: code.value, procedure: procedure.value, ruleId: selected.value.id, fix, context })
}

function jumpTo(issue: Finding) {
  const editor = codeEditor.value
  if (!editor) return
  const lines = code.value.split('\n')
  const line = Math.min(Math.max(issue.line, 1), lines.length)
  const offset = lines.slice(0, line - 1).reduce((total, text) => total + text.length + 1, 0)
  const position = offset + Math.min(Math.max(issue.column - 1, 0), lines[line - 1]!.length)
  editor.focus()
  editor.setSelectionRange(position, position)
  const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight)
  if (Number.isFinite(lineHeight)) editor.scrollTop = Math.max(0, (line - 2) * lineHeight)
}

onBeforeUnmount(() => {
  draft.value = {
    ruleId: selectedId.value,
    code: code.value,
    procedure: procedure.value,
    parameters: parameters.value,
    variables: variables.value,
    datasourceType: datasourceType.value,
    datasourceQuery: datasourceQuery.value,
    configMode: configMode.value,
    customConfig: customConfig.value,
    hasCustomDraft: hasCustomDraft.value,
    exampleConfig: exampleConfig.value,
  }
  resetWorker()
})
</script>

<template>
  <div class="reference">
    <div class="reference-sidebar">
      <label class="field-label" for="rule-search">Find a rule</label>
      <UInput id="rule-search" v-model="query" type="search" icon="i-lucide-search" size="lg" placeholder="ID, name, description…" class="w-full" :ui="fieldUi" />
      <label class="field-label" for="rule-group">Category</label>
      <USelect id="rule-group" v-model="group" :items="groupItems" icon="i-lucide-list-filter" size="lg" class="w-full" :ui="fieldUi" />
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
          <UButton
            v-for="(example, index) in selected.examples"
            :key="index"
            :icon="example.valid ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
            color="neutral"
            variant="outline"
            size="sm"
            class="example-button"
            @click="chooseExample(example)"
          >
            {{ example.description || (example.valid ? 'Valid example' : 'Invalid example') }}
          </UButton>
        </div>
        <label class="field-label" for="procedure">TI procedure</label>
        <USelect id="procedure" v-model="procedure" :items="procedureItems" size="lg" class="w-44 max-w-full" :ui="fieldUi" />
        <label class="field-label" for="ti-code">TI code</label>
        <textarea id="ti-code" ref="codeEditor" v-model="code" class="code-editor" spellcheck="false" rows="10" aria-label="TI code" />
        <section class="run-config" aria-label="Configuration for this run">
          <h4>Configuration for this run</h4>
          <div class="config-choices">
            <button type="button" :class="{ active: configMode === 'defaults' }" :aria-pressed="configMode === 'defaults'" @click="selectConfig('defaults')">LinTi defaults</button>
            <button v-if="exampleConfig.trim()" type="button" :class="{ active: configMode === 'example' }" :aria-pressed="configMode === 'example'" @click="selectConfig('example')">Example settings</button>
            <button v-if="savedConfig.trim()" type="button" :class="{ active: configMode === 'saved' }" :aria-pressed="configMode === 'saved'" @click="selectConfig('saved')">My linti.yaml</button>
            <button type="button" :class="{ active: configMode === 'custom' }" :aria-pressed="configMode === 'custom'" @click="selectConfig('custom')">Custom YAML</button>
          </div>
          <p v-if="configMode === 'defaults'" class="muted">No linti.yaml is passed to LinTi. This rule is selected for the example.</p>
          <p v-else-if="configMode === 'example'" class="muted">This example needs these settings to demonstrate the rule.</p>
          <p v-else-if="configMode === 'saved'" class="muted">Using the linti.yaml saved in your browser by the configurator. Editing below creates a separate draft.</p>
          <p v-else class="muted">Paste or edit YAML for this example. An empty field uses LinTi defaults; your saved linti.yaml is unchanged.</p>
          <details v-if="configMode === 'defaults' && selected.default_config" class="default-values">
            <summary>View this rule's default values</summary>
            <pre><code>{{ selected.default_config }}</code></pre>
          </details>
          <template v-if="configMode !== 'defaults'">
            <label class="field-label" for="run-config-yaml">linti.yaml used for this run</label>
            <textarea
              id="run-config-yaml"
              :value="lintiYaml"
              class="code-editor"
              spellcheck="false"
              wrap="off"
              placeholder="Paste your linti.yaml here…"
              :rows="Math.max(4, lintiYaml.split('\n').length)"
              @input="editConfig"
            />
          </template>
          <UButton :to="{ path: '/config', query: { from: 'rules', rule: selected.id } }" icon="i-lucide-sliders-horizontal" color="neutral" variant="link" size="sm">
            {{ savedConfig.trim() ? 'Edit my linti.yaml' : 'Build a linti.yaml' }}
          </UButton>
        </section>
        <div v-if="shownContext.length" class="context">
          <p class="context-title">Runs with</p>
          <div v-for="field in shownContext" :key="field" class="context-field">
            <div class="context-label">
              <label class="field-label" :for="`context-${field}`">{{ contextLabels[field] }}</label>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-x"
                :aria-label="`Remove ${contextLabels[field]}`"
                @click="removeContext(field)"
              />
            </div>
            <UInput v-if="field === 'parameters'" id="context-parameters" v-model="parameters" placeholder="pYear, pVersion" class="w-full" :ui="fieldUi" />
            <UInput v-else-if="field === 'variables'" id="context-variables" v-model="variables" placeholder="vRegion, vAmount" class="w-full" :ui="fieldUi" />
            <div v-else class="datasource-fields">
              <UInput id="context-datasource" v-model="datasourceType" placeholder="ODBC" aria-label="Data source type" :ui="fieldUi" />
              <UInput v-model="datasourceQuery" placeholder="SELECT … FROM …" aria-label="Data source query" class="w-full" :ui="fieldUi" />
            </div>
          </div>
        </div>
        <div v-if="hiddenContext.length" class="context-add">
          <span class="muted">Add:</span>
          <UButton
            v-for="field in hiddenContext"
            :key="field"
            size="xs"
            color="neutral"
            variant="soft"
            icon="i-lucide-plus"
            @click="addContext(field)"
          >
            {{ contextLabels[field] }}
          </UButton>
        </div>
        <div class="run-actions">
          <UButton icon="i-lucide-play" :loading="busy" @click="run()">{{ busy ? 'Loading LinTi / checking…' : `Run ${selected.id}` }}</UButton>
          <UButton v-if="selected.auto_fix" icon="i-lucide-wand-sparkles" color="neutral" variant="outline" :disabled="busy" @click="run(true)">Apply auto-fix</UButton>
        </div>
        <p v-if="error" role="alert" class="error">{{ error }}</p>
        <section v-if="result" class="findings" aria-live="polite" aria-label="Findings">
          <p class="summary">
            <strong>{{ result.issues.length }}</strong> finding{{ result.issues.length === 1 ? '' : 's' }}
            <span v-if="result.issues.length" class="muted">
              · {{ errorCount }} error{{ errorCount === 1 ? '' : 's' }}, {{ warningCount }} warning{{ warningCount === 1 ? '' : 's' }}, {{ fixableCount }} auto-fixable
            </span>
          </p>
          <p v-if="result.fixes" class="success">Applied {{ result.fixes }} fix{{ result.fixes === 1 ? '' : 'es' }}.</p>
          <ul v-if="result.warnings.length" class="warnings">
            <li v-for="(warning, index) in result.warnings" :key="index">{{ warning }}</li>
          </ul>
          <p v-if="!result.issues.length" class="success">No findings for {{ selected.id }}. 🎉</p>
          <ol v-else class="issues">
            <li v-for="(issue, index) in result.issues" :key="index" :class="`severity-${issue.severity}`">
              <button class="issue" :aria-label="`Line ${issue.line}, column ${issue.column}: ${issue.message}`" @click="jumpTo(issue)">
                <span class="location">{{ issue.line }}:{{ issue.column }}</span>
                <span class="message">{{ issue.message }}</span>
              </button>
              <span class="meta">
                <code>{{ issue.rule_id }}</code> · {{ procedure }}
                <span v-if="issue.fixable" class="fixable">auto-fix</span>
              </span>
            </li>
          </ol>
        </section>
      </div>

    </section>
  </div>
</template>

<style scoped>
.reference { display: grid; grid-template-columns: minmax(14rem, 19rem) minmax(0, 1fr); gap: 2rem; margin-top: 2rem; align-items: start; }
.reference-sidebar { position: sticky; top: 1.5rem; max-height: calc(100vh - 3rem); display: flex; flex-direction: column; min-width: 0; }
.field-label { display: block; margin: .7rem 0 .35rem; font-size: .85rem; font-weight: 650; }
.rule-count, .muted { color: var(--ui-text-muted); font-size: .85rem; }
.rule-count { margin: .5rem 0; }
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
.playground h3 { font-size: 1.2rem; font-weight: 700; margin-bottom: .3rem; }
.playground p { font-size: .9rem; }
.example-actions { margin: 1rem 0; }
.example-button { max-width: 100%; text-align: left; white-space: normal; }
.code-editor { width: 100%; resize: vertical; padding: .8rem; border-radius: .45rem; border: 1px solid var(--ui-border-accented); background: var(--ui-bg); color: var(--ui-text); font: .85rem/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; tab-size: 4; }
.code-editor:focus { outline: 2px solid var(--ui-primary); outline-offset: -1px; }
.run-actions { margin-top: .8rem; }
.context { margin-top: .8rem; padding: .2rem .8rem .8rem; border: 1px solid var(--ui-border-accented); border-left: 3px solid var(--ui-primary); border-radius: .45rem; background: var(--ui-bg); }
.context-title { margin: .5rem 0 0; font-size: .75rem; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; color: var(--ui-text-muted); }
.context-label { display: flex; align-items: end; justify-content: space-between; gap: .5rem; }
.datasource-fields { display: grid; grid-template-columns: 7rem minmax(0, 1fr); gap: .5rem; }
.context-add { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; margin-top: .7rem; }
.error { color: var(--ui-error); overflow-wrap: anywhere; }
.success { color: var(--ui-success); }
.findings { margin-top: 1rem; padding: 1rem; border: 1px solid var(--ui-border); border-radius: .5rem; background: var(--ui-bg); }
.summary { margin: .6rem 0; }
.warnings { margin: .5rem 0; padding: .6rem .8rem; border-left: 3px solid var(--ui-warning); font-size: .85rem; }
.issues { list-style: none; padding: 0; margin: 0; }
.issues li { padding: .5rem .2rem .5rem .6rem; border-bottom: 1px solid var(--ui-border); border-left: 3px solid var(--ui-error); }
.issues li.severity-warning { border-left-color: var(--ui-warning); }
.issue { display: flex; gap: .6rem; width: 100%; text-align: left; font-size: .88rem; }
.issue:hover .message { text-decoration: underline; }
.location { flex: none; min-width: 3.2rem; color: var(--ui-text-muted); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .8rem; padding-top: .1rem; }
.message { overflow-wrap: anywhere; }
.meta { display: block; margin: .2rem 0 0 3.8rem; font-size: .78rem; color: var(--ui-text-muted); }
.fixable { margin-left: .3rem; padding: 0 .4rem; border-radius: 1rem; background: color-mix(in srgb, var(--ui-success) 15%, transparent); color: var(--ui-success); }
.run-config { margin-top: 1rem; padding: .8rem; border: 1px solid var(--ui-border-accented); border-radius: .45rem; background: var(--ui-bg); }
.run-config h4 { font-size: .95rem; font-weight: 700; }
.run-config .muted { margin: .45rem 0; }
.config-choices { display: flex; flex-wrap: wrap; gap: .35rem; margin-top: .5rem; }
.config-choices button { padding: .35rem .65rem; border: 1px solid var(--ui-border); border-radius: .4rem; font-size: .82rem; }
.config-choices button:hover, .config-choices button.active { border-color: var(--ui-primary); }
.config-choices button.active { color: var(--ui-primary); background: color-mix(in srgb, var(--ui-primary) 8%, var(--ui-bg)); }
.default-values { margin: .6rem 0; font-size: .85rem; }
.default-values summary { cursor: pointer; color: var(--ui-primary); }
.default-values pre { margin-top: .5rem; padding: .7rem; overflow-x: auto; border-radius: .4rem; background: var(--ui-bg-elevated); }
.empty { padding: .8rem; }
@media (max-width: 760px) {
  .reference { grid-template-columns: minmax(0, 1fr); gap: 1.5rem; }
  .reference-sidebar { position: static; max-height: none; }
  .rule-list { max-height: 15rem; }
  .playground { padding: 1rem; }
  /* 16px text on phones keeps iOS Safari from zooming in when the editor gets focus. */
  .code-editor { font-size: 1rem; }
}
</style>
