<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { CatalogPanel } from "@/features/catalog";
import { CircuitBoard } from "@/features/circuit";
import { InputRack, SignalMonitor } from "@/features/simulation";
import { ChallengePanel } from "@/features/challenge";
import { WorkspaceBar } from "@/features/workspace";
import { ConflictDialog, RecoveryDialog } from "@/features/collaboration";
import { useLab } from "./useLab";
const lab = useLab();
const { document, notice } = lab;
const { tool } = lab.placement,
  { selected, pending } = lab.circuit,
  { signals } = lab.simulation;
const { target, table, passed, inspected, hint } = lab.challenge;
const { collab } = lab;
const selectedNode = computed(() =>
  document.value.nodes.find((node) => node.id === selected.value),
);
function keydown(event: KeyboardEvent) {
  if (collab.activeSession.value) return;
  if ((event.target as HTMLElement).closest("input,textarea,select")) return;
  if (event.key === "Escape") lab.cancel();
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    lab.circuit.deleteSelected();
  }
}
onMounted(() => window.addEventListener("keydown", keydown));
onUnmounted(() => window.removeEventListener("keydown", keydown));
</script>
<template>
  <div class="lab-app" :class="{ 'modal-open': collab.activeSession.value }">
    <header class="masthead">
      <div class="brand">
        <span class="brand-icon">⌘</span>
        <div>
          <h1>LOGIC <em>LAB</em><span>数字电路逻辑实验室</span></h1>
          <p>把逻辑，连接起来。</p>
        </div>
      </div>
      <div class="instrument-label">
        <span class="power-light" />多标签协同模式 <small>BENCH / JDK–028</small>
      </div>
    </header>
    <WorkspaceBar
      :name="document.name"
      :status="collab.status.value"
      @rename="document.name = $event"
      @clear="lab.workspace.clear"
      @save="collab.save"
      @export="lab.workspace.exportFile"
      @import="lab.workspace.importText"
      @import-conflict="lab.workspace.importConflict"
      @recover="collab.openRecovery"
      @error="lab.notify({ tone: 'error', message: $event })"
    />
    <div v-if="collab.remoteAhead.value" class="remote-banner" role="status">
      远端已有新版本 r{{ collab.remoteHeadRevision.value }}（你的分支基于
      r{{ collab.baseRevision.value }}）。继续编辑不会被覆盖，点击“保存”进入三方合并。
    </div>
    <main class="workbench">
      <CatalogPanel
        :tool="tool"
        @choose="
          tool = $event;
          pending = null;
        "
      />
      <section class="center-workspace">
        <div class="board-toolbar">
          <span><b>工作台</b><small>单比特 · 即时传播 · 分支 r{{ collab.baseRevision.value }}</small></span>
          <div>
            <button
              :disabled="!selected"
              aria-label="删除所选"
              @click="lab.circuit.deleteSelected"
            >
              删除所选</button
            ><button :disabled="!pending && !tool" @click="lab.cancel">
              取消 / Esc
            </button>
          </div>
        </div>
        <div class="mode-strip" v-if="tool || pending">
          {{ tool ? `点击网格放置 ${tool}` : "已选择输出，请点击目标输入端口"
          }}<button @click="lab.cancel">取消</button>
        </div>
        <CircuitBoard
          :document="document"
          :signals="signals"
          :selected="selected"
          :pending="pending"
          :tool="tool"
          @place="lab.place"
          @move="lab.move"
          @select="selected = $event"
          @port="lab.circuit.pickPort"
          @toggle="lab.simulation.toggle"
        />
        <div class="selection-strip">
          <template v-if="selectedNode"
            ><label
              >元件名称
              <input
                :key="selectedNode.id"
                :value="selectedNode.label"
                maxlength="40"
                aria-label="所选元件名称"
                @change="
                  lab.renameNode(($event.target as HTMLInputElement).value)
                " /></label
            ><span
              >{{ selectedNode.kind }} · 拖动移动 · Delete 删除</span
            ></template
          ><span v-else>{{
            selected
              ? "已选择连线，按 Delete 或点击“删除所选”断开。"
              : "拖动元件移动位置 · 点击端口连接 · Esc 取消"
          }}</span
          ><span class="grid-label">GRID 20</span>
        </div>
        <div class="instruments">
          <InputRack
            :nodes="document.nodes"
            :signals="signals"
            @toggle="lab.simulation.toggle"
          /><SignalMonitor
            :document="document"
            :signals="signals"
            :selected="selected"
          />
        </div>
      </section>
      <ChallengePanel
        :document="document"
        :target="target"
        :table="table"
        :passed="passed"
        :inspected="inspected"
        :hint="hint"
        @choose="lab.challenge.choose"
        @check="inspected = true"
        @hint="hint = !hint"
      />
    </main>
    <footer class="status-bar" :class="notice.tone" role="status">
      <span
        >{{
          notice.tone === "error" ? "!" : notice.tone === "success" ? "✓" : "●"
        }}
        {{ notice.message }}</span
      ><small>LOCAL LAB / 多标签分支 · 分支 {{ collab.branchId.slice(-6) }}</small>
    </footer>

    <ConflictDialog
      v-if="collab.activeSession.value && collab.conflictDiff.value && collab.conflictPreview.value"
      :session="collab.activeSession.value"
      :diff="collab.conflictDiff.value"
      :preview="collab.conflictPreview.value"
      :signals="collab.preview.value"
      :resolutions="collab.resolutions.value"
      :rebase-notice="collab.rebaseNotice.value"
      @resolve="collab.setResolution"
      @commit="collab.commitMerge"
      @cancel="collab.cancelConflict"
      @discard="collab.discardConflict"
      @export="lab.workspace.exportConflictFile"
    />
    <RecoveryDialog
      v-if="collab.showRecovery.value"
      :options="collab.recoveryOptions.value"
      :current-branch-id="collab.branchId"
      @recover="collab.recover"
      @discard="collab.discardRecovery"
      @close="collab.closeRecovery"
    />
  </div>
</template>
