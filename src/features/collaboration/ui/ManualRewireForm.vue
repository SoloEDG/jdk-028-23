<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { CircuitDocument } from "@/shared/types";
import { getSpec } from "@/features/catalog";
import type { DiffItem, ManualWire } from "../types";

const props = defineProps<{
  document: CircuitDocument;
  item: DiffItem;
}>();
const emit = defineEmits<{
  apply: [wire: ManualWire];
  cancel: [];
}>();

const sourceNodeId = ref("");
const sourcePort = ref(0);
const targetNodeId = ref("");
const targetPort = ref(0);

const nodes = computed(() => props.document.nodes);
const sourceNode = computed(() =>
  nodes.value.find((node) => node.id === sourceNodeId.value),
);
const targetNode = computed(() =>
  nodes.value.find((node) => node.id === targetNodeId.value),
);
const sourcePorts = computed(() =>
  sourceNode.value ? getSpec(sourceNode.value.kind).outputs : 0,
);
const targetPorts = computed(() =>
  targetNode.value ? getSpec(targetNode.value.kind).inputs : 0,
);

watch(
  () => props.item.id,
  () => {
    const wire =
      (props.item.localWire ?? props.item.remoteWire ?? props.item.baseWire) ||
      null;
    sourceNodeId.value = wire?.from.nodeId ?? nodes.value[0]?.id ?? "";
    sourcePort.value = wire?.from.port ?? 0;
    targetNodeId.value = wire?.to.nodeId ?? nodes.value[0]?.id ?? "";
    targetPort.value = wire?.to.port ?? 0;
  },
  { immediate: true },
);

watch(sourceNodeId, () => (sourcePort.value = 0));
watch(targetNodeId, () => (targetPort.value = 0));

const valid = computed(
  () =>
    !!sourceNode.value &&
    !!targetNode.value &&
    sourceNodeId.value !== targetNodeId.value &&
    sourcePort.value < sourcePorts.value &&
    targetPort.value < targetPorts.value,
);

function submit() {
  if (!valid.value) return;
  emit("apply", {
    from: { nodeId: sourceNodeId.value, port: sourcePort.value },
    to: { nodeId: targetNodeId.value, port: targetPort.value },
  });
}

function label(id: string): string {
  const node = nodes.value.find((candidate) => candidate.id === id);
  return node ? `${node.label}（${node.kind}）` : id;
}
</script>

<template>
  <div class="rewire-form" role="group" aria-label="手动重接">
    <div class="rewire-row">
      <label
        >起点元件
        <select v-model="sourceNodeId">
          <option v-for="node in nodes" :key="`s-${node.id}`" :value="node.id">
            {{ label(node.id) }}
          </option>
        </select>
      </label>
      <label v-if="sourcePorts > 1"
        >输出端口
        <select v-model.number="sourcePort">
          <option v-for="p in sourcePorts" :key="`sp-${p}`" :value="p - 1">
            {{ p }}
          </option>
        </select>
      </label>
    </div>
    <div class="rewire-row">
      <label
        >目标元件
        <select v-model="targetNodeId">
          <option v-for="node in nodes" :key="`t-${node.id}`" :value="node.id">
            {{ label(node.id) }}
          </option>
        </select>
      </label>
      <label v-if="targetPorts > 1"
        >输入端口
        <select v-model.number="targetPort">
          <option v-for="p in targetPorts" :key="`tp-${p}`" :value="p - 1">
            {{ p }}
          </option>
        </select>
      </label>
    </div>
    <p v-if="sourceNodeId === targetNodeId" class="rewire-error">
      起点与目标不能是同一元件。
    </p>
    <div class="rewire-actions">
      <button class="primary" :disabled="!valid" @click="submit">
        应用手动接线
      </button>
      <button @click="emit('cancel')">取消</button>
    </div>
    <p class="rewire-hint">
      提交后会在完整结果上重新校验双驱动、反馈环与端口占用。
    </p>
  </div>
</template>
