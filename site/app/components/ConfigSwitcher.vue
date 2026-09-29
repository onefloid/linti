<script setup lang="ts">
import type { SavedConfig } from '../utils/configLibrary'

type ExtraOption = { value: string, label: string }

const props = withDefaults(defineProps<{
  modelValue: string
  profiles: SavedConfig[]
  draftName?: string
  showDraft?: boolean
  extraOptions?: ExtraOption[]
  showAdd?: boolean
  showDelete?: boolean
  label?: string
}>(), {
  draftName: 'Local variant',
  showDraft: false,
  extraOptions: () => [],
  showAdd: false,
  showDelete: false,
  label: 'Use configuration',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  add: []
  delete: [id: string]
}>()

const selectedProfileId = computed(() => props.modelValue.startsWith('profile:') ? props.modelValue.slice(8) : null)

function choose(event: Event) {
  const select = event.target as HTMLSelectElement
  const value = select.value
  // The parent may need to confirm before discarding a draft.
  select.value = props.modelValue
  emit('update:modelValue', value)
}
</script>

<template>
  <div class="config-switcher">
    <label class="switcher-label">{{ label }}
      <select :value="modelValue" @change="choose">
        <option value="defaults">LinTi defaults</option>
        <option v-for="option in extraOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        <option v-if="showDraft" value="draft">{{ draftName }} (draft)</option>
        <option v-for="profile in profiles" :key="profile.id" :value="`profile:${profile.id}`">{{ profile.name }}</option>
      </select>
    </label>
    <div v-if="showAdd || showDelete" class="switcher-actions">
      <UButton v-if="showAdd" type="button" icon="i-lucide-plus" color="neutral" variant="outline" size="sm" aria-label="Create empty configuration" title="New configuration" @click="emit('add')" />
      <UButton v-if="showDelete" type="button" icon="i-lucide-trash-2" color="error" variant="ghost" size="sm" aria-label="Delete selected configuration" title="Delete selected configuration" :disabled="!selectedProfileId" @click="selectedProfileId && emit('delete', selectedProfileId)" />
    </div>
  </div>
</template>

<style scoped>
.config-switcher { display: flex; gap: .45rem; align-items: end; min-width: 0; }
.switcher-label { display: flex; flex: 1; flex-direction: column; gap: .2rem; min-width: 0; font-size: .8rem; font-weight: 650; }
.switcher-label select { box-sizing: border-box; width: 100%; min-width: 0; padding: .35rem .5rem; border: 1px solid var(--ui-border); border-radius: .4rem; color: var(--ui-text); background: var(--ui-bg); font-size: 1rem; }
.switcher-actions { display: flex; flex: none; gap: .25rem; }
</style>
