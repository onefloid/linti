<script setup lang="ts">
import type { EditorView } from '@codemirror/view'
import type { AnnotationType } from '@codemirror/state'

const route = useRoute()
const configs = useConfigLibrary()
const validator = useLintiWorker<{ valid: boolean, message?: string }>()
const origin = computed(() => route.query.from === 'rules' || route.query.from === 'playground' ? route.query.from : null)
const originRule = computed(() => {
  const id = String(route.query.rule || '').toUpperCase()
  return ruleCards.some(card => card.rules.some(rule => rule.id === id)) ? id : null
})
const returnLink = computed(() => origin.value === 'playground'
  ? { to: '/playground', label: 'Back to playground' }
  : origin.value === 'rules'
    ? { to: originRule.value ? `/rules?rule=${encodeURIComponent(originRule.value)}&config=working` : '/rules?config=working', label: originRule.value ? `Back to rule ${originRule.value}` : 'Back to rule reference' }
    : null)

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
const nameDialog = ref<HTMLDialogElement | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
const nameMode = ref<'new' | 'duplicate' | 'rename'>('new')
const nameValue = ref('')
const newTemplate = ref(presets[0]!.key)
const nameError = ref('')
const profileError = ref('')
const pendingSwitch = shallowRef<(() => void) | null>(null)
const libraryInput = ref<HTMLInputElement | null>(null)
const shareError = ref('')
const hasUnsavedChanges = configs.dirty

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
const switcherValue = computed(() => configs.status.value === 'draft'
  ? 'draft'
  : configs.activeProfile.value ? `profile:${configs.activeProfile.value.id}` : 'defaults')

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
  return view?.state.doc.toString() ?? configs.yaml.value
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
  configs.yaml.value = text
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
  configs.yaml.value = text
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

function askBeforeSwitch(action: () => void) {
  if (parseTimer) syncFromEditor()
  if (hasUnsavedChanges.value) pendingSwitch.value = action
  else action()
}

function setWorking(yaml: string) {
  applyText(yaml)
  profileError.value = ''
  openCards.value = new Set(ruleCards.filter(card => cardChanged(card)).map(card => card.configKey))
}

function switchProfile(value: string) {
  if (value === switcherValue.value) return
  askBeforeSwitch(() => {
    if (value === 'defaults') configs.selectDefaults()
    else if (value.startsWith('profile:')) configs.selectProfile(value.slice(8))
    setWorking(configs.yaml.value)
  })
}

function createVariant() {
  askBeforeSwitch(() => openNameDialog('new'))
}

function openNameDialog(mode: 'new' | 'duplicate' | 'rename') {
  nameMode.value = mode
  newTemplate.value = presets[0]!.key
  nameValue.value = mode === 'new' ? '' : mode === 'duplicate'
    ? `${configs.label.value} copy` : configs.activeProfile.value?.name ?? ''
  nameError.value = ''
  nameDialog.value?.showModal()
  void nextTick(() => nameInput.value?.focus())
}

function submitName() {
  const name = nameValue.value.trim()
  if (nameMode.value !== 'new' && validator.busy.value) {
    nameError.value = 'Please wait for the current save to finish.'
    return
  }
  if (!name) {
    nameError.value = 'Give this configuration a name.'
    return
  }
  if (configs.library.value.profiles.some(profile => profile.name.toLowerCase() === name.toLowerCase()
    && (nameMode.value !== 'rename' || profile.id !== configs.activeProfile.value?.id))) {
    nameError.value = 'A configuration with this name already exists.'
    return
  }
  nameDialog.value?.close()
  if (nameMode.value === 'new') {
    const preset = presets.find(item => item.key === newTemplate.value) ?? presets[0]!
    const source = presetText(preset)
    configs.startDraft(name, source)
    setWorking(source)
  } else {
    submitSave(name, nameMode.value === 'duplicate')
  }
}

function availableName(preferred: string): string {
  const names = new Set(configs.library.value.profiles.map(profile => profile.name.toLowerCase()))
  let name = preferred
  let suffix = 2
  while (names.has(name.toLowerCase())) name = `${preferred} (${suffix++})`
  return name
}

function saveCurrent(name: string, asNew = false): boolean {
  try {
    configs.save(name, asNew)
    profileError.value = ''
    return true
  } catch (error) {
    profileError.value = (error as Error).message
    return false
  }
}

function submitSave(explicitName?: string, asNew = false) {
  if (validator.busy.value) return
  if (parseTimer) syncFromEditor()
  const text = currentText()
  const baseId = configs.library.value.draft.baseId
  const draftName = configs.library.value.draft.name
  const name = explicitName ?? (configs.activeProfile.value?.name
    || availableName(configs.library.value.draft.name.trim() || 'My configuration'))
  profileError.value = ''
  validator.run({ action: 'validate', config: text }, (result) => {
    if (currentText() !== text || configs.library.value.draft.baseId !== baseId
      || configs.library.value.draft.name !== draftName) {
      profileError.value = 'The configuration changed during validation. Please save again.'
      return
    }
    if (!result.valid) {
      profileError.value = result.message || 'LinTi could not load this YAML.'
      return
    }
    if (!saveCurrent(name, asNew)) return
    const action = pendingSwitch.value
    pendingSwitch.value = null
    action?.()
  }, message => (profileError.value = message))
}

function finishSwitch(saveFirst: boolean) {
  if (saveFirst) {
    submitSave()
    return
  }
  if (!saveFirst) {
    if (configs.activeProfile.value) configs.selectProfile(configs.activeProfile.value.id)
    else configs.selectDefaults()
    setWorking(configs.yaml.value)
  }
  const action = pendingSwitch.value
  pendingSwitch.value = null
  action?.()
}

function deleteSelected(id: string) {
  const profile = configs.library.value.profiles.find(item => item.id === id)
  if (!profile || !confirm(`Delete "${profile.name}" from this browser? Any unsaved edits to it will also be discarded.`)) return
  configs.deleteProfile(profile.id)
  setWorking(configs.yaml.value)
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

function downloadLibrary() {
  const backup = { version: 1, profiles: configs.library.value.profiles, draft: { yaml: '', baseId: null, name: '' } }
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: 'linti-configurations.json' })
  link.click()
  URL.revokeObjectURL(url)
}

async function uploadLibrary(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  profileError.value = configs.importLibrary(await file.text()) ? '' : 'This is not a LinTi configuration library.'
}

async function copyShareLink() {
  if (parseTimer) syncFromEditor()
  const link = shareLink(configs.label.value, currentText())
  shareError.value = link ? '' : 'This configuration is too large for a link. Download its YAML instead.'
  if (link) await copyText(link, 'link')
}

async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const text = await file.text()
  askBeforeSwitch(() => {
    configs.startDraft(file.name.replace(/\.ya?ml$/i, ''), text)
    setWorking(text)
  })
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
  const initial = configs.yaml.value
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
  if (route.query.save === '1') {
    submitSave()
  }
})

watch(mobilePane, pane => pane === 'yaml' && nextTick(() => view?.requestMeasure()))

onBeforeUnmount(() => {
  if (parseTimer) syncFromEditor()
  view?.destroy()
})
</script>

<template>
  <div class="configurator">
    <nav class="return-links" aria-label="Continue with your configuration">
      <UButton v-if="returnLink" :to="returnLink.to" icon="i-lucide-arrow-left" color="neutral" variant="soft" size="sm">{{ returnLink.label }}</UButton>
      <UButton v-if="origin !== 'rules'" to="/rules" icon="i-lucide-list" color="neutral" variant="ghost" size="sm">Rule reference</UButton>
      <UButton v-if="origin !== 'playground'" to="/playground" icon="i-lucide-square-terminal" color="neutral" variant="ghost" size="sm">Try in playground</UButton>
    </nav>
    <section class="library-panel" aria-label="Current configuration">
      <div class="library-heading">
        <div class="library-title">
          <h2>Current configuration</h2>
          <span class="status-badge" :class="hasUnsavedChanges ? 'draft' : configs.status.value">{{ hasUnsavedChanges ? 'Unsaved changes' : configs.status.value === 'saved' ? 'Saved in this browser' : 'LinTi defaults' }}</span>
        </div>
        <p class="muted">{{ configs.status.value === 'defaults' ? 'Create a configuration with + or adjust a rule below, then save it.' : 'Adjust the rules below. Save when you want to keep this version.' }}</p>
      </div>
      <p v-if="configs.storageError.value" class="error" role="alert">Browser storage is unavailable. Download your YAML before leaving this page.</p>
      <div class="library-primary" :class="{ 'with-save': hasUnsavedChanges }">
        <ConfigSwitcher
          :model-value="switcherValue"
          :profiles="configs.library.value.profiles"
          :show-draft="configs.status.value === 'draft'"
          :draft-name="configs.label.value"
          show-add
          show-delete
          @update:model-value="switchProfile"
          @add="createVariant()"
          @delete="deleteSelected"
        />
        <UButton v-if="hasUnsavedChanges" class="save-action" size="sm" :loading="validator.busy.value" @click="submitSave()">{{ configs.activeProfile.value ? 'Save changes' : 'Save configuration' }}</UButton>
      </div>
      <p class="local-note">Only in this browser · no account or sync</p>
      <p v-if="profileError" class="error" role="alert">{{ profileError }}</p>
      <div v-if="pendingSwitch" class="switch-prompt" role="alert">
        <span>There are unsaved changes. Save them before switching?</span>
        <UButton size="xs" @click="finishSwitch(true)">Save</UButton>
        <UButton size="xs" color="neutral" variant="outline" @click="finishSwitch(false)">Discard changes</UButton>
        <UButton size="xs" color="neutral" variant="ghost" @click="pendingSwitch = null">Cancel</UButton>
      </div>
      <details class="library-more">
        <summary>Manage configurations</summary>
        <p class="muted">Profiles stay in this browser only. Clearing its data removes them; export a copy to keep them elsewhere.</p>
        <div class="library-actions">
          <UButton v-if="configs.activeProfile.value" size="sm" color="neutral" variant="outline" @click="openNameDialog('duplicate')">Duplicate current</UButton>
          <UButton v-if="configs.activeProfile.value" size="sm" color="neutral" variant="outline" @click="openNameDialog('rename')">Rename</UButton>
        </div>
        <div class="library-actions">
          <UButton size="sm" color="neutral" variant="ghost" @click="downloadLibrary()">Export saved profiles</UButton>
          <UButton size="sm" color="neutral" variant="ghost" @click="libraryInput?.click()">Import profiles</UButton>
          <input ref="libraryInput" type="file" accept=".json,application/json" class="sr-only" aria-label="Import configuration backup" @change="uploadLibrary">
        </div>
      </details>
    </section>
    <dialog ref="nameDialog" class="name-dialog" aria-labelledby="name-dialog-title">
      <form @submit.prevent="submitName()">
        <h2 id="name-dialog-title">{{ nameMode === 'new' ? 'New configuration' : nameMode === 'duplicate' ? 'Duplicate configuration' : 'Rename configuration' }}</h2>
        <p v-if="nameMode === 'new'" class="muted">Choose a starting point. You can change every setting before saving.</p>
        <label class="profile-picker">Configuration name
          <input ref="nameInput" v-model="nameValue" type="text" maxlength="100" required placeholder="e.g. Strict CI" aria-label="Configuration name" @input="nameError = ''">
        </label>
        <fieldset v-if="nameMode === 'new'" class="template-options">
          <legend>Start from</legend>
          <label v-for="preset in presets" :key="preset.key" class="template-option">
            <input v-model="newTemplate" type="radio" name="new-template" :value="preset.key">
            <span><strong>{{ preset.title }}</strong><small>{{ preset.description }}</small></span>
          </label>
        </fieldset>
        <p v-if="nameError" class="error" role="alert">{{ nameError }}</p>
        <div class="save-buttons">
          <UButton type="submit" size="sm">{{ nameMode === 'new' ? 'Create' : nameMode === 'duplicate' ? 'Duplicate' : 'Rename' }}</UButton>
          <UButton type="button" size="sm" color="neutral" variant="ghost" @click="nameDialog?.close()">Cancel</UButton>
        </div>
      </form>
    </dialog>
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
          <UButton icon="i-lucide-link" size="sm" color="neutral" variant="ghost" @click="copyShareLink()">{{ copied === 'link' ? 'Link copied' : 'Share link' }}</UButton>
          <UButton icon="i-lucide-upload" size="sm" color="neutral" variant="ghost" @click="fileInput?.click()">Open file</UButton>
          <input ref="fileInput" type="file" accept=".yaml,.yml,text/yaml" class="sr-only" aria-label="Open a linti.yaml file" @change="upload">
        </div>
        <p v-if="shareError" class="error" role="alert">{{ shareError }}</p>
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
        <p class="muted">Edits here are used by the <NuxtLink to="/playground">playground</NuxtLink> immediately. Save them above when you want to keep this version. A share link contains this YAML and opens as a local draft.</p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.configurator { margin-top: 1.5rem; }
.library-panel { min-width: 0; padding: .85rem 1rem; margin-bottom: 1.2rem; border: 1px solid var(--ui-border-accented); border-radius: .6rem; background: var(--ui-bg-elevated); }
.library-title, .library-actions, .save-buttons, .switch-prompt { display: flex; gap: .55rem; align-items: center; flex-wrap: wrap; }
.library-title h2 { font-size: 1.1rem; font-weight: 700; }
.library-heading p { margin: .25rem 0 .7rem; }
.library-primary { display: grid; grid-template-columns: minmax(0, 1fr); gap: .6rem; align-items: end; }
.library-primary.with-save { grid-template-columns: minmax(0, 1fr) auto; }
.profile-picker { display: flex; flex-direction: column; gap: .2rem; min-width: 0; font-size: .8rem; font-weight: 650; }
.profile-picker select, .profile-picker input { box-sizing: border-box; width: 100%; min-width: 0; border: 1px solid var(--ui-border); border-radius: .4rem; padding: .35rem .5rem; color: var(--ui-text); background: var(--ui-bg); font-size: 1rem; }
.local-note { margin: .5rem 0 0; color: var(--ui-text-muted); font-size: .76rem; }
.name-dialog { width: min(32rem, calc(100vw - 2rem)); max-width: none; max-height: min(90dvh, 48rem); overflow-y: auto; padding: 1.2rem; border: 1px solid var(--ui-border); border-radius: .6rem; color: var(--ui-text); background: var(--ui-bg); box-shadow: 0 1rem 3rem rgb(0 0 0 / 20%); }
.name-dialog::backdrop { background: rgb(0 0 0 / 45%); }
.name-dialog form { display: grid; gap: .8rem; }
.name-dialog h2 { font-size: 1.15rem; font-weight: 700; }
.template-options { min-width: 0; padding: 0; border: 0; }
.template-options legend { margin-bottom: .4rem; font-size: .8rem; font-weight: 650; }
.template-option { display: flex; gap: .7rem; align-items: start; padding: .55rem .65rem; border: 1px solid var(--ui-border); border-radius: .45rem; cursor: pointer; }
.template-option + .template-option { margin-top: .4rem; }
.template-option:has(input:checked) { border-color: var(--ui-primary); background: color-mix(in srgb, var(--ui-primary) 6%, var(--ui-bg)); }
.template-option input { margin-top: .2rem; accent-color: var(--ui-primary); }
.template-option span { display: grid; gap: .15rem; min-width: 0; }
.template-option strong { font-size: .9rem; }
.template-option small { color: var(--ui-text-muted); font-size: .76rem; line-height: 1.35; }
.save-buttons { justify-content: flex-end; }
.library-more { margin-top: .75rem; padding-top: .6rem; border-top: 1px solid var(--ui-border); }
.library-more summary { width: fit-content; cursor: pointer; color: var(--ui-primary); font-size: .82rem; font-weight: 600; }
.library-more .muted { margin: .5rem 0; }
.library-actions { margin: .55rem 0; }
.status-badge { border: 1px solid var(--ui-border); border-radius: 1rem; padding: .2rem .6rem; font-size: .75rem; white-space: nowrap; }
.status-badge.draft { border-color: var(--ui-warning); }
.status-badge.saved { border-color: var(--ui-success); }
.switch-prompt { padding: .6rem; border-left: 3px solid var(--ui-warning); background: var(--ui-bg); }
.return-links { position: sticky; top: .5rem; z-index: 10; display: flex; flex-wrap: wrap; gap: .4rem; align-items: center; margin-bottom: 1.2rem; padding: .5rem; border: 1px solid var(--ui-border); border-radius: .5rem; background: var(--ui-bg); }
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
@media (max-width: 600px) {
  .library-primary.with-save { grid-template-columns: minmax(0, 1fr); }
  .save-action { width: 100%; justify-content: center; }
  .save-buttons { justify-content: flex-start; }
}
</style>
