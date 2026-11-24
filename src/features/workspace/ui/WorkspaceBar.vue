<script setup lang="ts">
import { ref } from "vue";
const props = defineProps<{ name: string; status: string }>();
const emit = defineEmits<{
  rename: [name: string];
  clear: [];
  save: [];
  export: [];
  import: [text: string];
  importConflict: [text: string];
  recover: [];
  error: [message: string];
}>();
const input = ref<HTMLInputElement | null>(null);
const conflictInput = ref<HTMLInputElement | null>(null);

async function readFile(
  event: Event,
  forward: (text: string) => void,
  limit: number,
) {
  const el = event.target as HTMLInputElement,
    file = el.files?.[0];
  if (!file) return;
  if (file.size > limit) {
    emit("error", "文件超过大小限制，当前实验已保留");
    el.value = "";
    return;
  }
  try {
    forward(await file.text());
  } catch {
    emit("error", "文件读取失败，当前实验已保留");
  }
  el.value = "";
}

function confirmClear() {
  window.confirm("新建会替换当前工作台，未保存改动仍保留在分支记录中。继续吗？") &&
    emit("clear");
}
</script>

<template>
  <div class="workspace-bar">
    <div class="document-name">
      <input
        :value="props.name"
        aria-label="实验名称"
        maxlength="80"
        @change="
          emit(
            'rename',
            ($event.target as HTMLInputElement).value.trim() || '未命名实验',
          )
        "
      /><span class="save-status">● {{ status }}</span>
    </div>
    <div class="workspace-actions">
      <button @click="emit('recover')">分支恢复</button
      ><button @click="confirmClear">新建</button
      ><button class="primary" @click="emit('save')">保存</button
      ><button @click="input?.click()">导入实验</button
      ><button @click="conflictInput?.click()">导入冲突副本</button
      ><button class="export-button" @click="emit('export')">导出实验 ↓</button
      ><input
        ref="input"
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="导入实验文件"
        @change="readFile($event, (t) => emit('import', t), 2_000_000)"
      /><input
        ref="conflictInput"
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="导入冲突副本"
        @change="readFile($event, (t) => emit('importConflict', t), 4_000_000)"
      />
    </div>
  </div>
</template>
