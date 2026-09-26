<script setup lang="ts">
import type { EditorView } from '@codemirror/view'
import type { AnnotationType } from '@codemirror/state'

const route = useRoute()
const { text: sharedText } = useSharedConfig()

const editorHost = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const parsed = shallowRef<ParsedConfig>(parseConfig(''))
/** The YAML the form currently reflects (the editor's text as last parsed). */
const yamlText = ref('')
const query = ref('')
const onlyChanged = ref(false)
const highlighted = ref('')
const openCards = ref(new Set<string>())
const mobilePane = ref<'form' | 'yaml'>('form')
const copied = ref('')

let view: EditorView | undefined
let setDiagnostics: typeof import('@codemirror/lint').setDiagnostics | undefined
// Marks editor transactions this component made itself (form edits, presets,
// uploads), which are already parsed and must not be parsed again.
let programmatic: AnnotationType<boolean> | undefined
let parseTimer: ReturnType<typeof setTimeout> | undefined

const data = computed(() => parsed.value.data)
const locked = computed(() => parsed.value.parseErrors.length > 0)
const issues = computed(() => (locked.value ? [] : validateConfig(data.value)))
const allFields = [...topLevelFields, ...ruleCards.flatMap(card => card.fields)]
const changedCount = computed(() => allFields.filter(field => isChanged(data.value, field)).length)
const errorCount = computed(() => parsed.value.parseErrors.length + issues.value.filter(issue => issue.level === 'error').length)
const warningCount = computed(() => issues.value.filter(issue => issue.level === 'warning').length)
const activePreset = computed(() => presets.find(preset => presetText(preset) === yamlText.value))

const groups = computed(() => {
  const needle = query.value.toLowerCase().trim()
  const visible = ruleCards.filter((card) => {
    if (onlyChanged.value && !cardChanged(card)) return false
    if (!needle) return true
    const haystack = `${card.configKey} ${card.title} ${card.description} ${card.rules.map(rule => `${rule.id} ${rule.name}`).join(' ')}`
    return haystack.toLowerCase().includes(needle)
  })
  const byGroup = new Map<string, { name: string, cards: RuleCard[] }>()
  for (const card of visible) {
    const group = byGroup.get(card.group) ?? { name: card.groupName, cards: [] }
    group.cards.push(card)
    byGroup.set(card.group, group)
  }
  return [...byGroup.entries()].map(([letter, group]) => ({ letter, ...group }))
})

function currentText() {
  return view?.state.doc.toString() ?? sharedText.value
}

function valueOf(field: FieldSpec) {
  return effectiveValue(data.value, field)
}

function changed(field: FieldSpec) {
  return isChanged(data.value, field)
}

function issueFor(field: FieldSpec) {
  const path = field.path.join('.')
  return issues.value.find(issue => issue.path.join('.') === path)
}

/** Hidden fields (deprecated spellings) appear only while the YAML sets them. */
function visibleFields(fields: FieldSpec[]) {
  return fields.filter(field => !field.hidden || changed(field) || issueFor(field))
}

function cardField(card: RuleCard, key: string) {
  return card.fields.find(field => field.key === key)!
}

function cardOptions(card: RuleCard) {
  return visibleFields(card.fields.filter(field => field.key !== 'enabled'))
}

function cardChanged(card: RuleCard) {
  return card.fields.some(field => changed(field))
}

function cardIssues(card: RuleCard) {
  const prefix = `rules.${card.configKey}`
  return issues.value.filter(issue => issue.path.join('.') === prefix)
}

/** Open when the visitor opened it, or while one of its options has a problem. */
function isOpen(card: RuleCard) {
  const prefix = `rules.${card.configKey}.`
  return openCards.value.has(card.configKey) || issues.value.some(issue => `${issue.path.join('.')}.`.startsWith(prefix))
}

function toggleCard(card: RuleCard, open: boolean) {
  const next = new Set(openCards.value)
  if (open) next.add(card.configKey)
  else next.delete(card.configKey)
  openCards.value = next
}

function severityLabel(card: RuleCard) {
  const declared = [...new Set(card.rules.map(rule => rule.severity))].join(' / ')
  return `Rule default (${declared})`
}

function ruleLink(ruleId: string) {
  return `/rules?rule=${encodeURIComponent(ruleId)}`
}

function pushDiagnostics() {
  if (!view || !setDiagnostics) return
  const length = view.state.doc.length
  const clamp = (range: { from: number, to: number }) => {
    const from = Math.min(range.from, length)
    return { from, to: Math.min(Math.max(range.to, from), length) }
  }
  const { doc, parseErrors } = parsed.value
  const diagnostics = [
    ...parseErrors.map(error => ({ ...clamp(error), severity: 'error' as const, message: error.message })),
    ...issues.value.map((issue) => {
      const range = rangeOf(doc, issue.path) ?? { from: 0, to: 0 }
      return { ...clamp(range), severity: issue.level, message: issue.message }
    }),
  ]
  view.dispatch(setDiagnostics(view.state, diagnostics))
}

/** Parse the editor's current text into the form state. */
function syncFromEditor() {
  clearTimeout(parseTimer)
  parseTimer = undefined
  const text = currentText()
  yamlText.value = text
  parsed.value = parseConfig(text)
  sharedText.value = text
  pushDiagnostics()
}

/** Replace the YAML (form edit, preset, upload) and parse it right away. */
function applyText(text: string) {
  if (view && text !== view.state.doc.toString()) {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      annotations: programmatic!.of(true),
    })
  }
  yamlText.value = text
  parsed.value = parseConfig(text)
  sharedText.value = text
  pushDiagnostics()
}

function updateField(field: FieldSpec, value: unknown) {
  // Typing in the YAML that is still waiting for its debounce comes first.
  if (parseTimer) syncFromEditor()
  if (locked.value) return
  const { doc } = parsed.value
  setOption(doc, field.path, value, field.default)
  applyText(stringifyConfig(doc))
}

function hasOwnContent() {
  const text = currentText()
  return !!text.trim() && !presets.some(preset => presetText(preset) === text)
}

function choosePreset(preset: Preset) {
  if (hasOwnContent() && !confirm(`Replace your linti.yaml with the “${preset.title}” preset?`)) return
  applyText(presetText(preset))
  openCards.value = new Set(ruleCards.filter(card => cardChanged(card)).map(card => card.configKey))
}

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = what
    setTimeout(() => (copied.value = ''), 1500)
  } catch {
    copied.value = ''
  }
}

function download() {
  const url = URL.createObjectURL(new Blob([currentText()], { type: 'text/yaml' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: 'linti.yaml' })
  link.click()
  URL.revokeObjectURL(url)
}

async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (hasOwnContent() && !confirm(`Replace your linti.yaml with ${file.name}?`)) return
  applyText(await file.text())
}

function openInPlayground() {
  if (parseTimer) syncFromEditor()
  void navigateTo('/playground')
}

function focusIssue(issue: ConfigIssue) {
  const range = rangeOf(parsed.value.doc, issue.path)
  mobilePane.value = 'yaml'
  if (!view || !range) return
  view.dispatch({ selection: { anchor: range.from, head: range.to }, scrollIntoView: true })
  view.focus()
}

/** `?rule=F110` (or `?rule=keyword_casing`): open, reveal and flash that card. */
function applyRuleQuery() {
  const wanted = String(route.query.rule || '')
  if (!wanted) return
  const card = ruleCards.find(item => item.configKey === wanted || item.rules.some(rule => rule.id === wanted.toUpperCase()))
  if (!card) return
  query.value = ''
  onlyChanged.value = false
  mobilePane.value = 'form'
  toggleCard(card, true)
  highlighted.value = card.configKey
  void nextTick(() => document.getElementById(`rule-${card.configKey}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  setTimeout(() => (highlighted.value = ''), 2500)
}

watch(() => route.query.rule, applyRuleQuery)

onMounted(async () => {
  // Nothing is stored until the visitor changes something: the recommended
  // preset is what LinTi does without a linti.yaml anyway.
  const initial = sharedText.value || presetText(presets[0]!)
  yamlText.value = initial
  parsed.value = parseConfig(initial)
  openCards.value = new Set(ruleCards.filter(card => cardChanged(card)).map(card => card.configKey))

  const [{ EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection }, { EditorState, Annotation }, commands, lint, { yaml }, language, { tags }] = await Promise.all([
    import('@codemirror/view'),
    import('@codemirror/state'),
    import('@codemirror/commands'),
    import('@codemirror/lint'),
    import('@codemirror/lang-yaml'),
    import('@codemirror/language'),
    import('@lezer/highlight'),
  ])
  setDiagnostics = lint.setDiagnostics
  programmatic = Annotation.define<boolean>()
  // Theme colors instead of a fixed palette, so light and dark mode both read well.
  const highlight = language.HighlightStyle.define([
    { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: 'var(--ui-primary)' },
    { tag: tags.comment, color: 'var(--ui-text-muted)', fontStyle: 'italic' },
    { tag: [tags.string, tags.special(tags.string), tags.content], color: 'var(--ui-info)' },
    { tag: [tags.bool, tags.number, tags.null, tags.keyword, tags.atom], color: 'var(--ui-warning)' },
    { tag: [tags.punctuation, tags.separator, tags.squareBracket, tags.brace], color: 'var(--ui-text-muted)' },
  ])
  view = new EditorView({
    parent: editorHost.value!,
    state: EditorState.create({
      doc: initial,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        EditorView.lineWrapping,
        commands.history(),
        lint.lintGutter(),
        yaml(),
        language.syntaxHighlighting(highlight),
        keymap.of([...commands.defaultKeymap, ...commands.historyKeymap, commands.indentWithTab]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || update.transactions.some(tr => tr.annotation(programmatic!))) return
          clearTimeout(parseTimer)
          parseTimer = setTimeout(syncFromEditor, 200)
        }),
        EditorView.contentAttributes.of({ 'aria-label': 'linti.yaml' }),
      ],
    }),
  })
  pushDiagnostics()
  applyRuleQuery()
})

watch(mobilePane, pane => pane === 'yaml' && nextTick(() => view?.requestMeasure()))

onBeforeUnmount(() => {
  if (parseTimer) syncFromEditor()
  view?.destroy()
})
</script>

<template>
  <div class="configurator">
    <section class="presets" aria-label="Start from a use case">
      <button
        v-for="preset in presets"
        :key="preset.key"
        class="preset"
        :class="{ active: activePreset?.key === preset.key }"
        :aria-pressed="activePreset?.key === preset.key"
        @click="choosePreset(preset)"
      >
        <span class="preset-title">{{ preset.title }}</span>
        <span class="preset-description">{{ preset.description }}</span>
      </button>
    </section>

    <div class="pane-switch" role="tablist" aria-label="View">
      <button role="tab" :aria-selected="mobilePane === 'form'" :class="{ active: mobilePane === 'form' }" @click="mobilePane = 'form'">Form</button>
      <button role="tab" :aria-selected="mobilePane === 'yaml'" :class="{ active: mobilePane === 'yaml' }" @click="mobilePane = 'yaml'">linti.yaml</button>
    </div>

    <div class="layout">
      <div class="form-pane" :class="{ hidden: mobilePane !== 'form' }">
        <p v-if="locked" role="alert" class="banner error">
          The YAML has a syntax error, so the form is paused. Fix it on the right and the form picks it up again.
        </p>
        <fieldset :disabled="locked" class="form">
          <section class="form-section">
            <h2>Run settings</h2>
            <ConfigField
              v-for="field in visibleFields(runFields)"
              :key="field.key"
              :field="field"
              :value="valueOf(field)"
              :changed="changed(field)"
              :issue="issueFor(field)"
              :disabled="locked"
              :unset-label="field.key === 'target_version' ? 'Not set (each rule\'s default)' : undefined"
              @update="updateField(field, $event)"
            />
            <details class="limits">
              <summary>Input limits</summary>
              <ConfigField
                v-for="field in limitFields"
                :key="field.key"
                :field="field"
                :value="valueOf(field)"
                :changed="changed(field)"
                :issue="issueFor(field)"
                :disabled="locked"
                @update="updateField(field, $event)"
              />
            </details>
          </section>

          <section class="form-section">
            <h2>Rules</h2>
            <div class="rule-filters">
              <UInput v-model="query" type="search" icon="i-lucide-search" placeholder="Filter by ID, name, key…" aria-label="Filter rules" class="grow" :ui="{ base: 'text-base sm:text-sm' }" />
              <USwitch v-model="onlyChanged" label="Only changed" />
            </div>
            <div v-for="group in groups" :key="group.letter" class="rule-group">
              <h3>{{ group.letter }} · {{ group.name }}</h3>
              <article
                v-for="card in group.cards"
                :id="`rule-${card.configKey}`"
                :key="card.configKey"
                class="rule-card"
                :class="{ changed: cardChanged(card), highlighted: highlighted === card.configKey }"
              >
                <div class="rule-card-head">
                  <USwitch
                    :model-value="valueOf(cardField(card, 'enabled')) === true"
                    :disabled="locked"
                    :aria-label="`Enable ${card.title}`"
                    @update:model-value="updateField(cardField(card, 'enabled'), $event)"
                  />
                  <div class="rule-card-title">
                    <strong>{{ card.title }}</strong>
                    <span class="rule-ids">
                      <NuxtLink v-for="rule in card.rules" :key="rule.id" :to="ruleLink(rule.id)" :title="`${rule.id}: ${rule.name}`"><code>{{ rule.id }}</code></NuxtLink>
                    </span>
                  </div>
                  <span v-if="cardChanged(card)" class="changed-badge">changed</span>
                </div>
                <p class="rule-card-description">{{ card.description }}</p>
                <p v-for="(issue, index) in cardIssues(card)" :key="index" class="field-issue" :class="issue.level">{{ issue.message }}</p>
                <details :open="isOpen(card)" @toggle="toggleCard(card, ($event.target as HTMLDetailsElement).open)">
                  <summary>Options</summary>
                  <ConfigField
                    v-for="field in cardOptions(card)"
                    :key="field.key"
                    :field="field"
                    :value="valueOf(field)"
                    :changed="changed(field)"
                    :issue="issueFor(field)"
                    :disabled="locked"
                    :unset-label="field.key === 'severity' ? severityLabel(card) : undefined"
                    @update="updateField(field, $event)"
                  />
                </details>
              </article>
            </div>
            <p v-if="!groups.length" class="muted">No rules match.</p>
          </section>
        </fieldset>
      </div>

      <aside class="yaml-pane" :class="{ hidden: mobilePane !== 'yaml' }" aria-label="linti.yaml">
        <div class="yaml-toolbar">
          <UButton icon="i-lucide-download" size="sm" @click="download()">Download linti.yaml</UButton>
          <UButton icon="i-lucide-square-terminal" size="sm" color="neutral" variant="outline" @click="openInPlayground()">Try in playground</UButton>
          <UButton icon="i-lucide-copy" size="sm" color="neutral" variant="ghost" @click="copyText(currentText(), 'yaml')">{{ copied === 'yaml' ? 'Copied' : 'Copy' }}</UButton>
          <UButton icon="i-lucide-link" size="sm" color="neutral" variant="ghost" @click="copyText(shareLink(currentText()), 'link')">{{ copied === 'link' ? 'Link copied' : 'Share link' }}</UButton>
          <UButton icon="i-lucide-upload" size="sm" color="neutral" variant="ghost" @click="fileInput?.click()">Open file</UButton>
          <input ref="fileInput" type="file" accept=".yaml,.yml,text/yaml" class="sr-only" aria-label="Open a linti.yaml file" @change="upload">
        </div>
        <p class="yaml-summary" aria-live="polite">
          <span>{{ changedCount }} setting{{ changedCount === 1 ? '' : 's' }} differ{{ changedCount === 1 ? 's' : '' }} from the defaults</span>
          <span v-if="errorCount" class="error">· {{ errorCount }} error{{ errorCount === 1 ? '' : 's' }}</span>
          <span v-if="warningCount" class="warning">· {{ warningCount }} warning{{ warningCount === 1 ? '' : 's' }}</span>
        </p>
        <div ref="editorHost" class="editor" />
        <ul v-if="parsed.parseErrors.length || issues.length" class="problems">
          <li v-for="(error, index) in parsed.parseErrors" :key="`p${index}`" class="error">{{ error.message }}</li>
          <li v-for="(issue, index) in issues" :key="`i${index}`" :class="issue.level">
            <button @click="focusIssue(issue)">{{ issue.message }}</button>
          </li>
        </ul>
        <p class="muted">Your linti.yaml stays in this browser. It is also used by the <NuxtLink to="/playground">playground</NuxtLink>.</p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.configurator { margin-top: 1.5rem; }
.presets { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: .75rem; margin-bottom: 1.4rem; }
.preset { display: flex; flex-direction: column; gap: .3rem; padding: .9rem 1rem; text-align: left; border: 1px solid var(--ui-border); border-radius: .6rem; background: var(--ui-bg); }
.preset:hover { border-color: var(--ui-primary); }
.preset.active { border-color: var(--ui-primary); box-shadow: inset 0 0 0 1px var(--ui-primary); background: color-mix(in srgb, var(--ui-primary) 6%, var(--ui-bg)); }
.preset-title { font-weight: 700; }
.preset-description { font-size: .82rem; line-height: 1.4; color: var(--ui-text-muted); }
.pane-switch { display: none; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(18rem, 26rem); gap: 1.4rem; align-items: start; }
.form { min-width: 0; border: 0; padding: 0; margin: 0; }
.form-section + .form-section { margin-top: 1.6rem; }
.form-section h2 { font-size: 1.15rem; font-weight: 700; margin-bottom: .3rem; }
.limits { margin-top: .5rem; }
.limits summary, .rule-card summary { cursor: pointer; font-size: .85rem; font-weight: 600; color: var(--ui-text-muted); }
.rule-filters { display: flex; flex-wrap: wrap; align-items: center; gap: .8rem; margin: .5rem 0 1rem; }
.rule-group h3 { margin: 1.2rem 0 .5rem; font-size: .78rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--ui-text-muted); }
.rule-card { padding: .75rem .9rem; margin-bottom: .6rem; border: 1px solid var(--ui-border); border-radius: .55rem; background: var(--ui-bg); transition: box-shadow .3s; scroll-margin: 6rem; }
.rule-card.changed { border-left: 3px solid var(--ui-primary); }
.rule-card.highlighted { box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-primary) 45%, transparent); }
.rule-card-head { display: flex; align-items: center; gap: .6rem; }
.rule-card-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: .2rem .5rem; flex: 1; min-width: 0; }
.rule-ids { display: flex; flex-wrap: wrap; gap: .3rem; }
.rule-ids a { font-size: .75rem; color: var(--ui-primary); }
.rule-ids a:hover { text-decoration: underline; }
.rule-card-description { margin: .3rem 0 .4rem; font-size: .83rem; line-height: 1.4; color: var(--ui-text-muted); }
.changed-badge { padding: 0 .45rem; border-radius: 1rem; font-size: .7rem; font-weight: 650; color: var(--ui-primary); background: color-mix(in srgb, var(--ui-primary) 12%, transparent); }
.banner { padding: .7rem .9rem; margin-bottom: 1rem; border-left: 3px solid var(--ui-error); background: var(--ui-bg-elevated); }
.yaml-pane { position: sticky; top: 1.5rem; display: flex; flex-direction: column; gap: .6rem; min-width: 0; }
.yaml-toolbar { display: flex; flex-wrap: wrap; gap: .35rem; }
.yaml-summary { display: flex; flex-wrap: wrap; gap: .3rem; font-size: .82rem; color: var(--ui-text-muted); }
.editor { border: 1px solid var(--ui-border); border-radius: .5rem; overflow: hidden; background: var(--ui-bg); }
.editor :deep(.cm-editor) { height: min(60vh, 34rem); font-size: .85rem; }
.editor :deep(.cm-editor.cm-focused) { outline: 2px solid var(--ui-primary); outline-offset: -1px; }
.editor :deep(.cm-scroller) { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.5; }
.editor :deep(.cm-content) { caret-color: var(--ui-text); }
.editor :deep(.cm-gutters) { background: var(--ui-bg-elevated); color: var(--ui-text-muted); border-right: 1px solid var(--ui-border); }
.editor :deep(.cm-activeLine), .editor :deep(.cm-activeLineGutter) { background: color-mix(in srgb, var(--ui-primary) 7%, transparent); }
.editor :deep(.cm-selectionBackground), .editor :deep(.cm-focused .cm-selectionBackground) { background: color-mix(in srgb, var(--ui-primary) 25%, transparent) !important; }
.editor :deep(.cm-tooltip) { background: var(--ui-bg-elevated); color: var(--ui-text); border: 1px solid var(--ui-border); }
.problems { list-style: none; margin: 0; padding: .5rem .7rem; border: 1px solid var(--ui-border); border-radius: .5rem; background: var(--ui-bg-elevated); font-size: .8rem; }
.problems li { padding: .25rem 0; border-left: 3px solid; padding-left: .5rem; margin: .2rem 0; overflow-wrap: anywhere; }
.problems li.error { border-color: var(--ui-error); }
.problems li.warning { border-color: var(--ui-warning); }
.problems button { text-align: left; }
.problems button:hover { text-decoration: underline; }
.muted { color: var(--ui-text-muted); font-size: .82rem; }
.muted a { color: var(--ui-primary); }
.error { color: var(--ui-error); }
.warning { color: var(--ui-warning); }
.field-issue { font-size: .8rem; margin-bottom: .3rem; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 860px) {
  .layout { grid-template-columns: minmax(0, 1fr); }
  .pane-switch { display: flex; gap: .3rem; margin-bottom: 1rem; padding: .25rem; border: 1px solid var(--ui-border); border-radius: .55rem; }
  .pane-switch button { flex: 1; padding: .45rem; border-radius: .4rem; font-weight: 600; font-size: .9rem; }
  .pane-switch button.active { background: var(--ui-primary); color: white; }
  .form-pane.hidden, .yaml-pane.hidden { display: none; }
  .yaml-pane { position: static; }
  .editor :deep(.cm-editor) { height: 60vh; font-size: 1rem; }
}
</style>
