<script setup lang="ts">
import { computed, ref } from "vue";
import type { CircuitDocument } from "@/shared/types";
import { CircuitBoard } from "@/features/circuit";
import type {
  ConflictSession,
  DiffItem,
  ManualWire,
  MergeIssue,
  MergePreview,
  ResolutionChoice,
  ThreeWayDiff,
} from "../types";
import { formatWire } from "../lib/diff";
import { manualPositionChoice, manualWireChoice } from "../lib/merge";
import type { PreviewSignals } from "../lib/preview";
import ManualRewireForm from "./ManualRewireForm.vue";

const props = defineProps<{
  session: ConflictSession;
  diff: ThreeWayDiff;
  preview: MergePreview;
  signals: PreviewSignals;
  resolutions: Record<string, ResolutionChoice>;
  rebaseNotice: string | null;
}>();
const emit = defineEmits<{
  resolve: [itemId: string, choice: ResolutionChoice];
  commit: [];
  cancel: [];
  discard: [];
  export: [];
}>();

const activeTab = ref<"position" | "value" | "wiring" | "identity">("wiring");
const manualItemId = ref<string | null>(null);
const manualPositionId = ref<string | null>(null);
const manualPositionX = ref(0);
const manualPositionY = ref(0);

const tabs = computed(() => [
  { key: "position" as const, label: "位置改动", items: props.diff.position },
  { key: "value" as const, label: "输入值改动", items: props.diff.value },
  { key: "wiring" as const, label: "接线改动", items: props.diff.wiring },
  { key: "identity" as const, label: "元件增删与命名", items: props.diff.identity },
]);

const totalItems = computed(
  () =>
    props.diff.position.length +
    props.diff.value.length +
    props.diff.wiring.length +
    props.diff.identity.length,
);
const conflictCount = computed(
  () =>
    [...props.diff.position, ...props.diff.value, ...props.diff.wiring, ...props.diff.identity]
      .filter((item) => item.severity === "conflict").length,
);
const staleSet = computed(() => new Set(props.session.staleItemIds));

function choiceOf(item: DiffItem): ResolutionChoice {
  return props.resolutions[item.id] ?? item.suggested;
}
function sideOf(item: DiffItem): string {
  return choiceOf(item).side;
}
function choose(item: DiffItem, side: "base" | "local" | "remote") {
  emit("resolve", item.id, { side });
  manualItemId.value = null;
}
function startManualWire(item: DiffItem) {
  manualItemId.value = manualItemId.value === item.id ? null : item.id;
}
function applyManualWire(item: DiffItem, wire: ManualWire) {
  emit("resolve", item.id, manualWireChoice(wire.from, wire.to));
  manualItemId.value = null;
}
function startManualPosition(item: DiffItem) {
  const point = (choiceOf(item).side === "manual"
    ? (choiceOf(item) as { manualPosition?: { x: number; y: number } })
        .manualPosition
    : (item.local as { x: number; y: number })) ?? { x: 0, y: 0 };
  manualPositionX.value = point.x;
  manualPositionY.value = point.y;
  manualPositionId.value = item.id;
}
function applyManualPosition(item: DiffItem) {
  emit(
    "resolve",
    item.id,
    manualPositionChoice({
      x: Number(manualPositionX.value),
      y: Number(manualPositionY.value),
    }),
  );
  manualPositionId.value = null;
}

const previewDocument = computed<CircuitDocument>(() => props.preview.document);
const emptySignals = computed(() => ({
  values: {},
  pins: {},
  wires: {},
  order: [],
}));
const boardSignals = computed(() => props.signals.simulation ?? emptySignals.value);

function issueType(issue: MergeIssue): string {
  return issue.level === "error" ? "阻断错误" : "警告";
}
function wireText(item: DiffItem, side: "base" | "local" | "remote"): string {
  const wire =
    side === "local" ? item.localWire : side === "remote" ? item.remoteWire : item.baseWire;
  return wire ? formatWire(wire) : "（无连线 / 已断开）";
}
function valueText(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
function isWiring(item: DiffItem): boolean {
  return item.kind.startsWith("wire-");
}
function isPosition(item: DiffItem): boolean {
  return item.kind === "position";
}
function noop(): void {
  /* 预览板只读，吞掉所有交互事件 */
}
</script>

<template>
  <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="三方冲突合并">
    <div class="conflict-dialog">
      <header class="conflict-header">
        <div>
          <h2>三方冲突合并</h2>
          <p>
            共同祖先 r{{ session.baseRevision }} · 你的分支 · 远端
            r{{ session.remoteRevision }}
          </p>
        </div>
        <div class="conflict-counts">
          <span class="count-badge">{{ totalItems }} 项差异</span>
          <span class="count-badge conflict">{{ conflictCount }} 项冲突</span>
          <span v-if="session.staleItemIds.length" class="count-badge stale">
            {{ session.staleItemIds.length }} 项待重核
          </span>
        </div>
      </header>

      <div v-if="rebaseNotice" class="rebase-banner">
        ⟳ {{ rebaseNotice }}
      </div>

      <div class="conflict-body">
        <section class="diff-panel">
          <nav class="diff-tabs">
            <button
              v-for="tab in tabs"
              :key="tab.key"
              :class="{ active: activeTab === tab.key }"
              @click="activeTab = tab.key"
            >
              {{ tab.label }}
              <b>{{ tab.items.length }}</b>
            </button>
          </nav>

          <div class="diff-scroll">
            <p v-if="!tabs.find((t) => t.key === activeTab)?.items.length" class="empty-diff">
              该类别下没有差异。
            </p>
            <article
              v-for="item in tabs.find((t) => t.key === activeTab)?.items"
              :key="item.id"
              class="diff-item"
              :class="{
                conflict: item.severity === 'conflict',
                stale: staleSet.has(item.id),
              }"
            >
              <header>
                <strong>{{ item.title }}</strong>
                <span v-if="item.severity === 'conflict'" class="tag conflict-tag">双方冲突</span>
                <span v-else class="tag">可自动合并</span>
                <span v-if="staleSet.has(item.id)" class="tag stale-tag">远端再变 · 待重核</span>
              </header>
              <p class="diff-detail">{{ item.detail }}</p>

              <div class="three-way" v-if="!isWiring(item)">
                <div class="way"><small>共同祖先</small><b>{{ valueText(item.base) }}</b></div>
                <div class="way local"><small>本地</small><b>{{ valueText(item.local) }}</b></div>
                <div class="way remote"><small>远端</small><b>{{ valueText(item.remote) }}</b></div>
              </div>
              <div class="three-way wiring-way" v-else>
                <div class="way"><small>共同祖先</small><b>{{ wireText(item, "base") }}</b></div>
                <div class="way local"><small>本地</small><b>{{ wireText(item, "local") }}</b></div>
                <div class="way remote"><small>远端</small><b>{{ wireText(item, "remote") }}</b></div>
              </div>

              <div class="resolution-row">
                <button
                  :class="{ picked: sideOf(item) === 'local' }"
                  @click="choose(item, 'local')"
                >采用本地</button>
                <button
                  :class="{ picked: sideOf(item) === 'remote' }"
                  @click="choose(item, 'remote')"
                >采用远端</button>
                <button
                  v-if="isWiring(item)"
                  :class="{ picked: sideOf(item) === 'manual' }"
                  @click="startManualWire(item)"
                >手动重接</button>
                <button
                  v-if="isPosition(item)"
                  :class="{ picked: sideOf(item) === 'manual' }"
                  @click="startManualPosition(item)"
                >手动坐标</button>
              </div>

              <ManualRewireForm
                v-if="isWiring(item) && manualItemId === item.id"
                :document="previewDocument"
                :item="item"
                @apply="(wire) => applyManualWire(item, wire)"
                @cancel="manualItemId = null"
              />
              <div v-if="isPosition(item) && manualPositionId === item.id" class="manual-position">
                <label>X <input v-model.number="manualPositionX" type="number" min="24" max="864" step="20" /></label>
                <label>Y <input v-model.number="manualPositionY" type="number" min="48" max="412" step="20" /></label>
                <button class="primary" @click="applyManualPosition(item)">应用坐标</button>
              </div>
            </article>
          </div>
        </section>

        <section class="preview-panel">
          <h3>完整结果预览</h3>
          <div class="preview-board">
            <CircuitBoard
              :document="previewDocument"
              :signals="boardSignals"
              :selected="null"
              :pending="null"
              :tool="null"
              @place="noop"
              @move="noop"
              @select="noop"
              @port="noop"
              @toggle="noop"
            />
          </div>

          <div class="issue-list">
            <h4>合法性校验</h4>
            <p v-if="!preview.issues.length" class="ok-line">✓ 无悬空线、双驱动、反馈环或命名冲突。</p>
            <ul>
              <li
                v-for="(issue, index) in preview.issues"
                :key="`${issue.code}-${index}`"
                :class="issue.level"
              >
                <span class="issue-level">{{ issueType(issue) }}</span>
                {{ issue.message }}
              </li>
            </ul>
          </div>

          <div class="target-check">
            <h4>信号与目标检测</h4>
            <template v-if="preview.runnable && signals.truth">
              <p v-if="signals.truth.error" class="warn-line">{{ signals.truth.error }}</p>
              <p v-else :class="signals.targetPassed ? 'ok-line' : 'warn-line'">
                {{ signals.targetPassed ? "✓ 合并结果满足当前目标真值表。" : "合并结果可运行，但尚未满足目标真值表。" }}
              </p>
              <table v-if="!signals.truth.error" class="mini-truth">
                <thead><tr><th>A</th><th>B</th><th>期望</th><th>合并输出</th></tr></thead>
                <tbody>
                  <tr v-for="(row, i) in signals.truth.rows" :key="i">
                    <td>{{ row.a }}</td><td>{{ row.b }}</td>
                    <td>{{ row.expected }}</td>
                    <td :class="row.matches ? 'match' : 'mismatch'">{{ row.actual }}</td>
                  </tr>
                </tbody>
              </table>
            </template>
            <p v-else class="warn-line">存在阻断错误，信号传播与目标检测暂停；修复后自动恢复。</p>
          </div>
        </section>
      </div>

      <footer class="conflict-footer">
        <div class="footer-left">
          <button @click="emit('export')">导出冲突副本 ↓</button>
          <button class="ghost" @click="emit('discard')">放弃合并</button>
          <button class="ghost" @click="emit('cancel')">暂停（稍后恢复）</button>
        </div>
        <button
          class="primary commit"
          :disabled="!preview.runnable || session.staleItemIds.length > 0"
          @click="emit('commit')"
        >
          {{ preview.runnable ? `提交合并为 r${session.remoteRevision + 1}` : "存在阻断错误，禁止提交" }}
        </button>
      </footer>
    </div>
  </div>
</template>
