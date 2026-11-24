import {
  computed,
  getCurrentInstance,
  onUnmounted,
  ref,
  shallowRef,
  watch,
  type Ref,
} from "vue";
import type { CircuitDocument } from "@/shared/types";
import type { Notice } from "@/shared/commands";
import { decodeDocument } from "@/features/workspace/lib/codec";
import { sampleCircuit } from "@/features/workspace/lib/seeds";
import {
  createBranchId,
  createSessionId,
  encodeConflict,
  decodeConflict,
  heartbeat,
  migrateLegacy,
  onStorageChange,
  readConflicts,
  readDrafts,
  readHead,
  removeConflict,
  removeDraft,
  touchDraft,
  upsertConflict,
  upsertDraft,
  writeHead,
  HEAD_KEY,
} from "../lib/storage";
import { threeWayDiff, flattenDiff } from "../lib/diff";
import { mergePreview } from "../lib/merge";
import { rebaseSession } from "../lib/rebase";
import { previewSignals } from "../lib/preview";
import { listRecoveryOptions } from "../lib/recovery";
import type {
  ConflictSession,
  DraftBranch,
  HeadRevision,
  MergePreview,
  RecoveryOption,
  ResolutionChoice,
  ThreeWayDiff,
} from "../types";

export interface CollaborationStart {
  document: CircuitDocument;
  warning: string | null;
  hasRecoverable: boolean;
}

const HEARTBEAT_MS = 5000;

export function useCollaboration(
  document: Ref<CircuitDocument>,
  notify: (notice: Notice) => void,
) {
  const branchId = createBranchId();
  const head = shallowRef<HeadRevision | null>(readHead());
  const baseRevision = ref(head.value?.revision ?? 0);
  const status = ref("");
  const remoteAhead = ref(false);
  const remoteHeadRevision = ref(head.value?.revision ?? 0);

  const activeSession = shallowRef<ConflictSession | null>(null);
  const conflictDiff = shallowRef<ThreeWayDiff | null>(null);
  const conflictPreview = shallowRef<MergePreview | null>(null);
  const rebaseNotice = ref<string | null>(null);
  const recoveryOptions = ref<RecoveryOption[]>([]);
  const showRecovery = ref(false);

  // 选择项始终从当前会话派生，保证逐项选择后 UI 立即刷新。
  const resolutions = computed<Record<string, ResolutionChoice>>(
    () => activeSession.value?.resolutions ?? {},
  );

  let currentDraft: DraftBranch | null = null;
  let suppressDraft = false;

  /* ---------------- 初始化 / 迁移 ---------------- */

  function start(): CollaborationStart {
    refreshRecovery();
    const migration = migrateLegacy();
    let initial: CircuitDocument;
    let warning: string | null = migration.warning;

    const existingHead = readHead();
    if (existingHead) {
      head.value = existingHead;
      baseRevision.value = existingHead.revision;
      remoteHeadRevision.value = existingHead.revision;
      initial = cloneDoc(existingHead.document);
    } else if (migration.document) {
      // 旧版无损升级：以 r1 建立正式存档，内容与旧槽位完全一致。
      const first: HeadRevision = {
        revision: 1,
        updatedAt: Date.now(),
        document: cloneDoc(migration.document),
      };
      writeHead(first);
      head.value = first;
      baseRevision.value = 1;
      remoteHeadRevision.value = 1;
      initial = cloneDoc(migration.document);
    } else {
      initial = sampleCircuit();
      const first: HeadRevision = {
        revision: 1,
        updatedAt: Date.now(),
        document: cloneDoc(initial),
      };
      writeHead(first);
      head.value = first;
      baseRevision.value = 1;
      remoteHeadRevision.value = 1;
    }

    currentDraft = makeDraft(initial);
    upsertDraft(currentDraft);
    status.value = draftStatus();
    return {
      document: initial,
      warning,
      hasRecoverable: recoveryOptions.value.length > 0,
    };
  }

  function makeDraft(doc: CircuitDocument): DraftBranch {
    const now = Date.now();
    return {
      branchId,
      label: `标签分支 ${now.toString(36).slice(-4)}`,
      baseRevision: baseRevision.value,
      baseDocument: cloneDoc(doc),
      document: cloneDoc(doc),
      createdAt: now,
      updatedAt: now,
      lastHeartbeat: now,
      active: true,
    };
  }

  function cloneDoc(doc: CircuitDocument): CircuitDocument {
    return JSON.parse(JSON.stringify(doc)) as CircuitDocument;
  }

  /* ---------------- 草稿自动保存（每标签独立分支） ---------------- */

  function persistDraft() {
    if (suppressDraft || !currentDraft) return;
    touchDraft(
      branchId,
      document.value,
      baseRevision.value,
      !activeSession.value,
      currentDraft.baseDocument,
    );
  }
  const stopDraftWatch = watch(document, persistDraft, { deep: true });

  const heartbeatTimer = window.setInterval(() => {
    heartbeat(branchId, !activeSession.value);
    checkRemoteHead();
  }, HEARTBEAT_MS);

  function draftStatus(): string {
    return remoteAhead.value
      ? `分支基于 r${baseRevision.value}，远端已到 r${remoteHeadRevision.value}，保存时进入冲突合并`
      : `分支基于 r${baseRevision.value} · 本地自动保存`;
  }

  /* ---------------- 跨标签 head 变化 ---------------- */

  function checkRemoteHead(): void {
    const latest = readHead();
    if (!latest) return;
    remoteHeadRevision.value = latest.revision;
    const ahead = latest.revision > baseRevision.value;
    if (ahead !== remoteAhead.value) {
      remoteAhead.value = ahead;
      status.value = draftStatus();
    }
    if (ahead && !activeSession.value)
      notify({
        tone: "info",
        message: `另一标签已发布 r${latest.revision}，你的改动保留在当前分支；点击“保存”进行三方合并。`,
      });
  }

  const offStorage = onStorageChange((event) => {
    if (event.key === HEAD_KEY) {
      const latest = readHead();
      if (!latest) return;
      if (activeSession.value) handleRemoteRebase(latest);
      else checkRemoteHead();
    }
  });

  /* ---------------- 保存：直存或进入冲突 ---------------- */

  function save(): void {
    const latest = readHead();
    if (!latest) {
      notify({ tone: "error", message: "正式存档缺失，无法保存，请刷新页面。" });
      return;
    }
    if (latest.revision === baseRevision.value) {
      commitDirect(latest);
      return;
    }
    openConflict(latest);
  }

  function commitDirect(latest: HeadRevision): void {
    const next: HeadRevision = {
      revision: latest.revision + 1,
      updatedAt: Date.now(),
      document: cloneDoc(document.value),
    };
    if (!writeHead(next)) {
      notify({ tone: "error", message: "浏览器存储不可用，请导出实验文件。" });
      return;
    }
    head.value = next;
    baseRevision.value = next.revision;
    remoteHeadRevision.value = next.revision;
    remoteAhead.value = false;
    if (currentDraft) currentDraft.baseDocument = cloneDoc(next.document);
    status.value = `已保存为 r${next.revision}`;
    notify({ tone: "success", message: `已保存为正式存档 r${next.revision}。` });
  }

  /* ---------------- 冲突会话 ---------------- */

  function openConflict(latest: HeadRevision): void {
    const baseDoc = currentDraft
      ? cloneDoc(currentDraft.baseDocument)
      : cloneDoc(document.value);
    const session: ConflictSession = {
      sessionId: createSessionId(),
      branchId,
      label: currentDraft?.label ?? "冲突合并",
      baseRevision: baseRevision.value,
      remoteRevision: latest.revision,
      baseDocument: baseDoc,
      localDocument: cloneDoc(document.value),
      remoteDocument: cloneDoc(latest.document),
      resolutions: {},
      remoteSnapshots: {},
      staleItemIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    startSession(session);
    notify({
      tone: "info",
      message: `检测到远端 r${latest.revision}，已生成三方差异；逐项选择后才能提交合并。`,
    });
  }

  function startSession(session: ConflictSession): void {
    activeSession.value = session;
    recomputeSession(session);
    upsertConflict(session);
    rebaseNotice.value = null;
    heartbeat(branchId, false);
  }

  function recomputeSession(session: ConflictSession): void {
    const diff = threeWayDiff(
      session.baseDocument,
      session.localDocument,
      session.remoteDocument,
    );
    conflictDiff.value = diff;
    const snapshot: Record<string, number> = {};
    for (const item of flattenDiff(diff))
      snapshot[item.id] = session.remoteRevision;
    session.remoteSnapshots = snapshot;
    const preview = mergePreview(
      session.baseDocument,
      diff,
      session.resolutions,
    );
    conflictPreview.value = preview.preview;
  }

  const preview = computed(() =>
    conflictPreview.value
      ? previewSignals(conflictPreview.value)
      : { simulation: null, truth: null, targetPassed: null },
  );

  function setResolution(itemId: string, choice: ResolutionChoice): void {
    const session = activeSession.value;
    if (!session) return;
    const next: ConflictSession = {
      ...session,
      resolutions: { ...session.resolutions, [itemId]: choice },
      staleItemIds: session.staleItemIds.filter((id) => id !== itemId),
      updatedAt: Date.now(),
    };
    activeSession.value = next;
    persistSession(next);
  }

  function persistSession(session = activeSession.value): void {
    if (!session) return;
    const diff = threeWayDiff(
      session.baseDocument,
      session.localDocument,
      session.remoteDocument,
    );
    conflictDiff.value = diff;
    const outcome = mergePreview(session.baseDocument, diff, session.resolutions);
    conflictPreview.value = outcome.preview;
    upsertConflict(session);
  }

  const canCommit = computed(() => {
    if (!activeSession.value || !conflictPreview.value) return false;
    return (
      conflictPreview.value.runnable &&
      activeSession.value.staleItemIds.length === 0
    );
  });

  function commitMerge(): void {
    const session = activeSession.value;
    if (!session || !conflictPreview.value) return;
    const latest = readHead();
    if (!latest) {
      notify({ tone: "error", message: "正式存档缺失，无法提交合并。" });
      return;
    }
    if (latest.revision !== session.remoteRevision) {
      handleRemoteRebase(latest);
      notify({
        tone: "error",
        message: "远端又有新版本，已保留你的全部选择，请先复核标记项再提交。",
      });
      return;
    }
    if (!canCommit.value) {
      notify({
        tone: "error",
        message: "合并结果仍不合法或存在待重核项，不能替换正式存档。",
      });
      return;
    }
    const next: HeadRevision = {
      revision: latest.revision + 1,
      updatedAt: Date.now(),
      document: cloneDoc(conflictPreview.value.document),
    };
    if (!writeHead(next)) {
      notify({ tone: "error", message: "浏览器存储不可用，请导出冲突副本。" });
      return;
    }
    suppressDraft = true;
    document.value = cloneDoc(next.document);
    head.value = next;
    baseRevision.value = next.revision;
    remoteHeadRevision.value = next.revision;
    remoteAhead.value = false;
    removeConflict(session.sessionId);
    activeSession.value = null;
    conflictDiff.value = null;
    conflictPreview.value = null;
    rebaseNotice.value = null;
    if (currentDraft) {
      currentDraft.baseRevision = next.revision;
      currentDraft.baseDocument = cloneDoc(next.document);
      currentDraft.document = cloneDoc(next.document);
    }
    window.setTimeout(() => (suppressDraft = false), 0);
    status.value = `合并结果已提交为 r${next.revision}`;
    notify({
      tone: "success",
      message: `冲突合并完成，已替换正式存档为 r${next.revision}。`,
    });
  }

  function handleRemoteRebase(latest: HeadRevision): void {
    const session = activeSession.value;
    if (!session) return;
    if (latest.revision === session.remoteRevision) return;
    const result = rebaseSession(
      session,
      cloneDoc(latest.document),
      latest.revision,
    );
    const next: ConflictSession = {
      ...session,
      remoteDocument: cloneDoc(latest.document),
      remoteRevision: latest.revision,
      resolutions: result.resolutions,
      staleItemIds: result.staleItemIds,
      updatedAt: Date.now(),
    };
    activeSession.value = next;
    remoteHeadRevision.value = latest.revision;
    persistSession(next);
    const parts: string[] = [];
    if (result.staleItemIds.length)
      parts.push(`${result.staleItemIds.length} 项选择因远端再变需重核`);
    if (result.newItemIds.length)
      parts.push(`新增 ${result.newItemIds.length} 个差异条目`);
    rebaseNotice.value = `远端已更新到 r${latest.revision}，当前解决进度全部保留；${parts.join("，") || "无需重核"}。`;
  }

  function cancelConflict(): void {
    const session = activeSession.value;
    if (!session) return;
    // 会话已持久化，关闭后仍可从“分支恢复”找回，不会丢失进度。
    activeSession.value = null;
    conflictDiff.value = null;
    conflictPreview.value = null;
    rebaseNotice.value = null;
    heartbeat(branchId, true);
    notify({
      tone: "info",
      message: "已暂停冲突合并，进度已保留；可通过“分支恢复”继续。",
    });
  }

  function discardConflict(): void {
    const session = activeSession.value;
    if (session) {
      removeConflict(session.sessionId);
      const latest = readHead();
      suppressDraft = true;
      if (latest) {
        document.value = cloneDoc(latest.document);
        baseRevision.value = latest.revision;
        remoteHeadRevision.value = latest.revision;
        head.value = latest;
      }
      window.setTimeout(() => (suppressDraft = false), 0);
    }
    activeSession.value = null;
    conflictDiff.value = null;
    conflictPreview.value = null;
    rebaseNotice.value = null;
    refreshRecovery();
    notify({ tone: "info", message: "已放弃本次合并，工作台回到远端最新存档。" });
  }

  /* ---------------- 冲突副本导出 / 导入 ---------------- */

  function exportConflict(): string | null {
    const session = activeSession.value;
    if (!session) return null;
    notify({ tone: "success", message: "冲突副本已导出，可在任意标签导入后独立恢复。" });
    return encodeConflict(session);
  }

  function importConflictText(text: string): boolean {
    try {
      const payload = decodeConflict(text);
      const session: ConflictSession = {
        ...(payload.session as ConflictSession),
        sessionId: payload.session.sessionId ?? createSessionId(),
      };
      // 导入的是独立副本：作为新会话保存，不影响当前 head。
      upsertConflict(session);
      startSession(session);
      refreshRecovery();
      notify({
        tone: "success",
        message: "冲突副本已恢复，可继续逐项解决；提交时会基于当前正式存档校验。",
      });
      return true;
    } catch (error) {
      notify({
        tone: "error",
        message: `冲突副本恢复失败：${error instanceof Error ? error.message : "文件无法读取"}`,
      });
      return false;
    }
  }

  /* ---------------- 分支 / 会话恢复 ---------------- */

  function refreshRecovery(): void {
    recoveryOptions.value = listRecoveryOptions();
  }

  function openRecovery(): void {
    refreshRecovery();
    showRecovery.value = true;
  }

  function closeRecovery(): void {
    showRecovery.value = false;
  }

  function recover(option: RecoveryOption): void {
    if (option.kind === "draft") {
      const draft = readDrafts()[option.id];
      if (!draft) {
        notify({ tone: "error", message: "该草稿分支已不存在。" });
        refreshRecovery();
        return;
      }
      suppressDraft = true;
      document.value = cloneDoc(draft.document);
      baseRevision.value = draft.baseRevision;
      currentDraft = {
        ...draft,
        baseDocument: cloneDoc(draft.baseDocument),
        document: cloneDoc(draft.document),
        branchId,
        active: true,
      };
      upsertDraft(currentDraft);
      removeDraft(option.id);
      window.setTimeout(() => (suppressDraft = false), 0);
      checkRemoteHead();
      showRecovery.value = false;
      notify({
        tone: "success",
        message: `已恢复草稿分支（基于 r${draft.baseRevision}），改动未丢失。`,
      });
    } else {
      const session = readConflicts()[option.id];
      if (!session) {
        notify({ tone: "error", message: "该冲突会话已不存在。" });
        refreshRecovery();
        return;
      }
      showRecovery.value = false;
      startSession(session);
      // 若恢复期间远端又推进，先做一次 rebase。
      const latest = readHead();
      if (latest && latest.revision > session.remoteRevision)
        handleRemoteRebase(latest);
      notify({ tone: "success", message: "已恢复未完成的冲突合并，可继续解决。" });
    }
    refreshRecovery();
  }

  function discardRecovery(option: RecoveryOption): void {
    if (option.kind === "draft") removeDraft(option.id);
    else removeConflict(option.id);
    refreshRecovery();
    notify({ tone: "info", message: "已清理该恢复项。" });
  }

  /* ---------------- 文档替换（新建 / 示例 / 普通导入） ---------------- */

  function rebaseDocumentToHead(next: CircuitDocument): void {
    const latest = readHead();
    suppressDraft = true;
    document.value = cloneDoc(next);
    if (latest) {
      baseRevision.value = latest.revision;
      remoteHeadRevision.value = latest.revision;
      remoteAhead.value = false;
      if (currentDraft) {
        currentDraft.baseRevision = latest.revision;
        currentDraft.baseDocument = cloneDoc(next);
      }
    }
    window.setTimeout(() => (suppressDraft = false), 0);
    status.value = draftStatus();
  }

  function importDocumentText(text: string): boolean {
    try {
      const next = decodeDocument(text);
      rebaseDocumentToHead(next);
      notify({ tone: "success", message: "导入成功，实验已恢复为当前分支内容。" });
      return true;
    } catch (error) {
      notify({
        tone: "error",
        message: `导入失败：${error instanceof Error ? error.message : "文件无法读取"}；当前实验已保留`,
      });
      return false;
    }
  }

  function dispose(): void {
    clearInterval(heartbeatTimer);
    stopDraftWatch();
    offStorage();
    heartbeat(branchId, false);
  }
  if (getCurrentInstance()) onUnmounted(dispose);

  return {
    branchId,
    status,
    remoteAhead,
    baseRevision,
    remoteHeadRevision,
    start,
    save,
    // conflict state
    activeSession,
    conflictDiff,
    resolutions,
    conflictPreview,
    preview,
    rebaseNotice,
    canCommit,
    setResolution,
    commitMerge,
    cancelConflict,
    discardConflict,
    exportConflict,
    importConflictText,
    // recovery
    recoveryOptions,
    showRecovery,
    openRecovery,
    closeRecovery,
    recover,
    discardRecovery,
    // document lifecycle
    rebaseDocumentToHead,
    importDocumentText,
    refreshRecovery,
    dispose,
  };
}

export type Collaboration = ReturnType<typeof useCollaboration>;
