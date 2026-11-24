<script setup lang="ts">
import type { RecoveryOption } from "../types";

defineProps<{ options: RecoveryOption[]; currentBranchId: string }>();
const emit = defineEmits<{
  recover: [option: RecoveryOption];
  discard: [option: RecoveryOption];
  close: [];
}>();

function kindLabel(kind: RecoveryOption["kind"]): string {
  return kind === "draft" ? "草稿分支" : "冲突会话";
}
</script>

<template>
  <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="分支与冲突恢复">
    <div class="recovery-dialog">
      <header class="recovery-header">
        <h2>找回未提交的分支</h2>
        <p>关闭标签后的草稿与未完成的冲突合并都会保留在这里，可随时继续。</p>
      </header>
      <div class="recovery-scroll">
        <p v-if="!options.length" class="empty-recovery">
          当前没有可恢复的草稿分支或冲突会话。
        </p>
        <article
          v-for="option in options"
          :key="`${option.kind}-${option.id}`"
          class="recovery-item"
          :class="{ stale: option.stale }"
        >
          <div class="recovery-meta">
            <span class="tag" :class="option.kind">{{ kindLabel(option.kind) }}</span>
            <strong>{{ option.label }}</strong>
            <p>{{ option.description }}</p>
          </div>
          <div class="recovery-actions">
            <button class="primary" @click="emit('recover', option)">
              {{ option.kind === "conflict" ? "继续解决" : "恢复分支" }}
            </button>
            <button class="ghost" @click="emit('discard', option)">删除</button>
          </div>
        </article>
      </div>
      <footer class="recovery-footer">
        <button @click="emit('close')">关闭</button>
      </footer>
    </div>
  </div>
</template>
