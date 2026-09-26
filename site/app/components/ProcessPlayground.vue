<script setup lang="ts">
import type { EditorView } from '@codemirror/view'

type Finding = {
  procedure: string
  rule_id: string
  message: string
  line: number
  column: number
  severity: 'error' | 'warning'
  fixable: boolean
}
type Result = {
  format: 'ti' | 'pa' | 'yaml'
  process_name: string
  code: string
  fixes: Record<string, number>
  issues: Finding[]
  warnings: string[]
}

const examples: Record<string, { label: string, code: string }> = {
  regions: {
    label: '.ti with #region sections',
    code: `#region Prolog
sCube = 'Sales';
if (DimensionExists('Year') = 0);
    ProcessQuit;
endif;
nRows=0;
#endregion
#region Data
nRows = nRows + 1;
CellPutN(nRows, sCube, 'Total', 'Count');
#endregion
#region Epilog
LogOutput('INFO', 'Rows: ' | NumberToString(nRows));
#endregion
`,
  },
  pa: {
    label: 'PA code (#SECTION)',
    code: `#SECTION Prolog
cTarget = 'Sales';
IF (pYear @= '');
  pYear = '2026';
endif;

#SECTION Metadata

#SECTION Data
CellPutN(vValue, cTarget, pYear, vMonth);

#SECTION Epilog

#JSON_PROPERTIES
{
  "Parameters": [{"Name": "pYear", "Prompt": "", "Value": "", "Type": "String"}],
  "DataSource": {"Type": "None"},
  "Variables": [{"Name": "vMonth", "Type": "String"}, {"Name": "vValue", "Type": "Numeric"}],
  "HasSecurityAccess": false
}

`,
  },
  yaml: {
    label: 'TM1py YAML',
    code: `!TM1py.ProcessObject
Name: Load-Sales
Parameters:
- Name: pYear
  Prompt: ''
  Type: String
  Value: ''
PrologProcedure: |-
  sSource = 'Sales';
  if (pYear @= '');
      sYear = '2026';
  endif;
DataProcedure: |-
  CellPutN(1, sSource, pYear, 'Count');
EpilogProcedure: |-
  ExecuteCommand('cmd /c del ' | pFile, 0);
`,
  },
}

// Keep an edited process while moving to the configurator and back.
const draftCode = useState('linti-playground-code', () => examples.regions!.code)

const formatNames: Record<Result['format'], string> = {
  ti: '.ti',
  pa: 'PA code',
  yaml: 'YAML',
}

const config = useRuntimeConfig()
const editorHost = ref<HTMLElement | null>(null)
// The linti.yaml shared with the configurator (kept in this browser).
const { text: configText, restored: configRestored } = useSharedConfig()
const busy = ref(false)
const loading = ref(true)
const error = ref('')
const result = ref<Result | null>(null)
const fixSummary = ref('')
const copied = ref(false)

let view: EditorView | undefined
let setDiagnostics: typeof import('@codemirror/lint').setDiagnostics | undefined
let worker: Worker | undefined
let requestId = 0
let lintTimer: ReturnType<typeof setTimeout> | undefined

const fixableCount = computed(() => result.value?.issues.filter(issue => issue.fixable).length ?? 0)
const errorCount = computed(() => result.value?.issues.filter(issue => issue.severity === 'error').length ?? 0)
const warningCount = computed(() => (result.value?.issues.length ?? 0) - errorCount.value)

function currentCode() {
  return view?.state.doc.toString() ?? ''
}

function lineRange(line: number, column: number) {
  const doc = view!.state.doc
  const target = doc.line(Math.min(Math.max(line, 1), doc.lines))
  const from = Math.min(target.from + Math.max(column, 1) - 1, target.to)
  const word = /^\w+/.exec(doc.sliceString(from, target.to))
  const to = word ? from + word[0].length : Math.min(from + 1, target.to)
  return { from, to }
}

function showDiagnostics(issues: Finding[]) {
  if (!view || !setDiagnostics) return
  const diagnostics = issues.map((issue) => {
    const { from, to } = lineRange(issue.line, issue.column)
    return { from, to, severity: issue.severity, source: issue.rule_id, message: issue.message }
  })
  view.dispatch(setDiagnostics(view.state, diagnostics))
}

function run(fix = false) {
  if (!view) return
  clearTimeout(lintTimer)
  const code = currentCode()
  const id = ++requestId
  busy.value = true
  error.value = ''
  worker ||= new Worker(`${config.app.baseURL}linti-worker.js`)
  worker.onmessage = ({ data }: MessageEvent<{ id: number, status?: 'running', result?: Result, error?: string }>) => {
    // The worker announces when Pyodide has loaded and the lint starts; only
    // the final reply for the latest request matters here.
    if (data.status || data.id !== requestId) return
    busy.value = false
    loading.value = false
    if (data.error) {
      error.value = data.error
      return
    }
    const next = data.result!
    if (fix && currentCode() !== code) {
      // Never overwrite edits made while the fix was being computed.
      fixSummary.value = 'The code changed while fixing; run auto-fix again.'
      scheduleLint()
      return
    }
    if (fix) {
      const total = Object.values(next.fixes).reduce((sum, count) => sum + count, 0)
      fixSummary.value = total
        ? `Applied ${total} fix${total === 1 ? '' : 'es'}. Undo with Ctrl+Z / ⌘Z.`
        : 'Nothing to fix automatically.'
      if (next.code !== code) {
        view!.dispatch({ changes: { from: 0, to: view!.state.doc.length, insert: next.code } })
        clearTimeout(lintTimer)
      }
    }
    // Findings belong to the text they were computed for; skip stale ones.
    if (currentCode() !== (fix ? next.code : code)) return
    result.value = next
    showDiagnostics(next.issues)
  }
  worker.onerror = (event) => {
    // The worker script itself failed; start from scratch on the next run.
    worker?.terminate()
    worker = undefined
    busy.value = false
    loading.value = false
    error.value = event.message || 'The browser could not load Pyodide.'
  }
  worker.postMessage({ id, action: 'process', code, config: configText.value, fix })
}

function scheduleLint() {
  clearTimeout(lintTimer)
  lintTimer = setTimeout(() => run(), 500)
}

function jumpTo(issue: Finding) {
  if (!view) return
  const { from, to } = lineRange(issue.line, issue.column)
  view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true })
  view.focus()
}

function loadExample(key: string) {
  if (!view || !examples[key]) return
  fixSummary.value = ''
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: examples[key].code } })
}

async function copyCode() {
  await navigator.clipboard.writeText(currentCode())
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

function downloadCode() {
  const extension = result.value?.format === 'yaml' ? 'yaml' : 'ti'
  const name = (result.value?.process_name || 'process').replace(/[^\w.-]+/g, '_')
  const url = URL.createObjectURL(new Blob([currentCode()], { type: 'text/plain' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: `${name}.${extension}` })
  link.click()
  URL.revokeObjectURL(url)
}

function ruleLink(ruleId: string) {
  return `${config.app.baseURL}rules?rule=${encodeURIComponent(ruleId)}`
}

watch(configText, scheduleLint)

onMounted(async () => {
  const [{ EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection }, { EditorState }, commands, lint] = await Promise.all([
    import('@codemirror/view'),
    import('@codemirror/state'),
    import('@codemirror/commands'),
    import('@codemirror/lint'),
  ])
  setDiagnostics = lint.setDiagnostics
  view = new EditorView({
    parent: editorHost.value!,
    state: EditorState.create({
      doc: draftCode.value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        commands.history(),
        lint.lintGutter(),
        keymap.of([
          { key: 'Mod-Enter', run: () => (run(), true) },
          { key: 'Mod-Shift-Enter', run: () => (run(true), true) },
          ...commands.defaultKeymap,
          ...commands.historyKeymap,
          commands.indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            draftCode.value = update.state.doc.toString()
            scheduleLint()
          }
        }),
        EditorView.contentAttributes.of({ 'aria-label': 'TI process source' }),
      ],
    }),
  })
  run()
})

onBeforeUnmount(() => {
  clearTimeout(lintTimer)
  view?.destroy()
  worker?.terminate()
})
</script>

<template>
  <div class="playground">
    <div class="toolbar">
      <label class="example-picker">
        <span>Load example</span>
        <select class="field" @change="loadExample(($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''">
          <option value="">Choose…</option>
          <option v-for="(example, key) in examples" :key="key" :value="key">{{ example.label }}</option>
        </select>
      </label>
      <span class="spacer" />
      <button class="secondary" :disabled="busy" title="Ctrl+Enter / ⌘Enter" @click="run()">Lint</button>
      <button class="primary" :disabled="busy || !fixableCount" title="Ctrl+Shift+Enter / ⌘⇧Enter" @click="run(true)">
        Auto-fix{{ fixableCount ? ` (${fixableCount})` : '' }}
      </button>
      <button class="secondary" @click="copyCode()">{{ copied ? 'Copied' : 'Copy' }}</button>
      <button class="secondary" @click="downloadCode()">Download</button>
    </div>

    <div class="layout">
      <div class="editor-column">
        <div ref="editorHost" class="editor" />
        <details class="config" :open="configRestored">
          <summary>
            Configuration (<code>linti.yaml</code>)
            <span v-if="configText.trim()" class="badge">saved in this browser</span>
          </summary>
          <textarea
            v-model="configText"
            class="config-editor"
            spellcheck="false"
            rows="8"
            aria-label="linti.yaml configuration"
            placeholder="rules:&#10;  keyword_casing:&#10;    enabled: false"
          />
          <p class="config-hint">
            Shared with the <NuxtLink :to="{ path: '/config', query: { from: 'playground' } }">configurator</NuxtLink>, where you can build it from a use case and download it.
            <button v-if="configText.trim()" class="link" @click="configText = ''">Clear</button>
          </p>
        </details>
      </div>

      <section class="results" aria-live="polite" aria-label="Findings">
        <p v-if="loading" class="status">Loading LinTi in your browser… the first run downloads Pyodide.</p>
        <template v-else-if="result">
          <p class="status">
            <span class="badge">{{ formatNames[result.format] }}</span>
            <span class="badge">{{ result.process_name }}</span>
            <span v-if="busy" class="muted">checking…</span>
          </p>
          <p class="summary">
            <strong>{{ result.issues.length }}</strong> finding{{ result.issues.length === 1 ? '' : 's' }}
            <span v-if="result.issues.length" class="muted">
              · {{ errorCount }} error{{ errorCount === 1 ? '' : 's' }}, {{ warningCount }} warning{{ warningCount === 1 ? '' : 's' }}, {{ fixableCount }} auto-fixable
            </span>
          </p>
        </template>
        <p v-if="fixSummary" class="success">{{ fixSummary }}</p>
        <p v-if="error" role="alert" class="error">{{ error }}</p>
        <ul v-if="result?.warnings.length" class="warnings">
          <li v-for="(warning, index) in result.warnings" :key="index">{{ warning }}</li>
        </ul>
        <p v-if="result && !result.issues.length && !error" class="success">No findings. 🎉</p>
        <ol v-if="result?.issues.length" class="issues">
          <li v-for="(issue, index) in result.issues" :key="index" :class="`severity-${issue.severity}`">
            <button class="issue" @click="jumpTo(issue)">
              <span class="location">{{ issue.line }}:{{ issue.column }}</span>
              <span class="message">{{ issue.message }}</span>
            </button>
            <span class="meta">
              <a :href="ruleLink(issue.rule_id)" target="_blank" rel="noopener"><code>{{ issue.rule_id }}</code></a>
              · {{ issue.procedure }}
              <span v-if="issue.fixable" class="fixable">auto-fix</span>
            </span>
          </li>
        </ol>
      </section>
    </div>
  </div>
</template>

<style scoped>
.playground { margin-top: 1.5rem; }
.toolbar { display: flex; flex-wrap: wrap; gap: .5rem; align-items: end; margin-bottom: .8rem; }
.example-picker { display: flex; flex-direction: column; gap: .25rem; font-size: .8rem; font-weight: 650; }
.spacer { flex: 1; }
.field { border: 1px solid var(--ui-border); border-radius: .45rem; padding: .4rem .6rem; color: var(--ui-text); background: var(--ui-bg); font-weight: 400; }
button.primary, button.secondary { padding: .45rem .85rem; border-radius: .4rem; font-size: .88rem; font-weight: 600; }
button.primary { background: var(--ui-primary); color: white; }
button.secondary { border: 1px solid var(--ui-border); }
button.secondary:hover { border-color: var(--ui-primary); }
button:disabled { opacity: .55; cursor: not-allowed; }
.layout { display: grid; grid-template-columns: minmax(0, 3fr) minmax(16rem, 2fr); gap: 1.2rem; align-items: start; }
.editor { border: 1px solid var(--ui-border); border-radius: .5rem; overflow: hidden; background: var(--ui-bg); }
.editor :deep(.cm-editor) { height: min(70vh, 40rem); font-size: .85rem; }
.editor :deep(.cm-editor.cm-focused) { outline: 2px solid var(--ui-primary); outline-offset: -1px; }
.editor :deep(.cm-scroller) { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.5; }
.editor :deep(.cm-content) { caret-color: var(--ui-text); }
.editor :deep(.cm-gutters) { background: var(--ui-bg-elevated); color: var(--ui-text-muted); border-right: 1px solid var(--ui-border); }
.editor :deep(.cm-activeLine), .editor :deep(.cm-activeLineGutter) { background: color-mix(in srgb, var(--ui-primary) 7%, transparent); }
.editor :deep(.cm-selectionBackground), .editor :deep(.cm-focused .cm-selectionBackground) { background: color-mix(in srgb, var(--ui-primary) 25%, transparent) !important; }
.editor :deep(.cm-tooltip) { background: var(--ui-bg-elevated); color: var(--ui-text); border: 1px solid var(--ui-border); }
.config { margin-top: .8rem; }
.config summary { cursor: pointer; font-size: .9rem; font-weight: 600; }
.config-hint { margin-top: .4rem; font-size: .8rem; color: var(--ui-text-muted); }
.config-hint a, .config-hint .link { color: var(--ui-primary); }
.config-hint .link:hover { text-decoration: underline; }
.config summary .badge { margin-left: .4rem; font-weight: 500; }
.config-editor { width: 100%; margin-top: .5rem; resize: vertical; padding: .7rem; border-radius: .45rem; border: 1px solid var(--ui-border); background: var(--ui-bg); color: var(--ui-text); font: .82rem/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.results { position: sticky; top: 1.5rem; max-height: calc(100vh - 3rem); overflow-y: auto; padding: 1rem; border: 1px solid var(--ui-border); border-radius: .5rem; background: var(--ui-bg-elevated); }
.status { display: flex; gap: .4rem; align-items: center; flex-wrap: wrap; font-size: .88rem; }
.badge { border: 1px solid var(--ui-border); border-radius: 1rem; padding: .1rem .55rem; font-size: .75rem; }
.summary { margin: .6rem 0; }
.muted { color: var(--ui-text-muted); font-size: .85rem; }
.error { color: var(--ui-error); overflow-wrap: anywhere; white-space: pre-wrap; }
.success { color: var(--ui-success); }
.warnings { margin: .5rem 0; padding: .6rem .8rem; border-left: 3px solid var(--ui-warning); font-size: .85rem; }
.issues { list-style: none; padding: 0; margin: 0; }
.issues li { padding: .5rem .2rem .5rem .6rem; border-bottom: 1px solid var(--ui-border); border-left: 3px solid var(--ui-error); }
.issues li.severity-warning { border-left-color: var(--ui-warning); }
.issue { display: flex; gap: .6rem; width: 100%; text-align: left; font-size: .88rem; }
.issue:hover .message { text-decoration: underline; }
.location { flex: none; min-width: 3.2rem; color: var(--ui-text-muted); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .8rem; padding-top: .1rem; }
.message { overflow-wrap: anywhere; }
.meta { display: block; margin: .2rem 0 0 3.8rem; font-size: .78rem; color: var(--ui-text-muted); }
.meta a { color: var(--ui-primary); }
.fixable { margin-left: .3rem; padding: 0 .4rem; border-radius: 1rem; background: color-mix(in srgb, var(--ui-success) 15%, transparent); color: var(--ui-success); }
@media (max-width: 860px) {
  .layout { grid-template-columns: 1fr; }
  .results { position: static; max-height: none; }
  .editor :deep(.cm-editor) { height: 55vh; }
}
</style>
