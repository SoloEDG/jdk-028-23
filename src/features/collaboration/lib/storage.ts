import type { CircuitDocument } from "@/shared/types";
import { decodeDocument, encodeDocument } from "@/features/workspace/lib/codec";
import type {
  ConflictExport,
  ConflictSession,
  DraftBranch,
  HeadRevision,
} from "../types";

export const HEAD_KEY = "logic-lab-jdk-028-v2-head";
export const DRAFTS_KEY = "logic-lab-jdk-028-v2-drafts";
export const CONFLICTS_KEY = "logic-lab-jdk-028-v2-conflicts";
/** 旧版单槽位键，首次升级时读取并保留备份，绝不覆盖。 */
export const LEGACY_KEY = "logic-lab-jdk-028-v1";
export const LEGACY_BACKUP_KEY = "logic-lab-jdk-028-v1-backup";

/** 心跳超过该毫秒数未更新，视为标签已关闭的陈旧分支。 */
export const STALE_AFTER_MS = 1000 * 60 * 15;
const DRAFT_LIMIT = 24;
const CONFLICT_LIMIT = 12;

function safeParse<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function readJson<T>(key: string): T | null {
  try {
    return safeParse<T>(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function createBranchId(): string {
  return `branch-${crypto.randomUUID()}`;
}

export function createSessionId(): string {
  return `conflict-${crypto.randomUUID()}`;
}

/* ---------------- 正式存档 head ---------------- */

export function readHead(): HeadRevision | null {
  return readJson<HeadRevision>(HEAD_KEY);
}

export function writeHead(head: HeadRevision): boolean {
  return writeJson(HEAD_KEY, head);
}

/* ---------------- 草稿分支 ---------------- */

export function readDrafts(): Record<string, DraftBranch> {
  return readJson<Record<string, DraftBranch>>(DRAFTS_KEY) ?? {};
}

function persistDrafts(drafts: Record<string, DraftBranch>): boolean {
  return writeJson(DRAFTS_KEY, drafts);
}

export function upsertDraft(draft: DraftBranch): boolean {
  const drafts = readDrafts();
  drafts[draft.branchId] = draft;
  pruneBranches(drafts);
  return persistDrafts(drafts);
}

export function removeDraft(branchId: string): boolean {
  const drafts = readDrafts();
  if (!(branchId in drafts)) return true;
  delete drafts[branchId];
  return persistDrafts(drafts);
}

export function touchDraft(
  branchId: string,
  document: CircuitDocument,
  baseRevision: number,
  active: boolean,
  baseDocument?: CircuitDocument,
): void {
  const drafts = readDrafts();
  const draft = drafts[branchId];
  if (!draft) return;
  const now = Date.now();
  draft.document = document;
  draft.baseRevision = baseRevision;
  if (baseDocument) draft.baseDocument = baseDocument;
  draft.updatedAt = now;
  draft.lastHeartbeat = now;
  draft.active = active;
  persistDrafts(drafts);
}

export function heartbeat(branchId: string, active: boolean): void {
  const drafts = readDrafts();
  const draft = drafts[branchId];
  if (!draft) return;
  const now = Date.now();
  draft.lastHeartbeat = now;
  draft.active = active;
  persistDrafts(drafts);
}

function pruneBranches(drafts: Record<string, DraftBranch>): void {
  const ids = Object.keys(drafts);
  if (ids.length <= DRAFT_LIMIT) return;
  const sorted = ids.sort(
    (a, b) => drafts[a].updatedAt - drafts[b].updatedAt,
  );
  const excess = ids.length - DRAFT_LIMIT;
  for (let i = 0; i < excess; i++) delete drafts[sorted[i]];
}

/* ---------------- 冲突会话 ---------------- */

export function readConflicts(): Record<string, ConflictSession> {
  return readJson<Record<string, ConflictSession>>(CONFLICTS_KEY) ?? {};
}

function persistConflicts(
  conflicts: Record<string, ConflictSession>,
): boolean {
  return writeJson(CONFLICTS_KEY, conflicts);
}

export function upsertConflict(session: ConflictSession): boolean {
  const conflicts = readConflicts();
  conflicts[session.sessionId] = session;
  const ids = Object.keys(conflicts);
  if (ids.length > CONFLICT_LIMIT) {
    ids
      .sort((a, b) => conflicts[a].updatedAt - conflicts[b].updatedAt)
      .slice(0, ids.length - CONFLICT_LIMIT)
      .forEach((id) => delete conflicts[id]);
  }
  return persistConflicts(conflicts);
}

export function removeConflict(sessionId: string): boolean {
  const conflicts = readConflicts();
  if (!(sessionId in conflicts)) return true;
  delete conflicts[sessionId];
  return persistConflicts(conflicts);
}

/* ---------------- 旧版迁移 ---------------- */

export interface MigrationResult {
  document: CircuitDocument | null;
  warning: string | null;
}

/**
 * 首次升级：若没有 v2 head，则读取 v1 单槽位。
 * 成功读取后把原文备份到独立键，原键保持不动，任何情况下都不丢内容。
 */
export function migrateLegacy(): MigrationResult {
  if (readHead()) return { document: null, warning: null };
  let legacyText: string | null = null;
  try {
    legacyText = localStorage.getItem(LEGACY_KEY);
  } catch {
    legacyText = null;
  }
  if (!legacyText) return { document: null, warning: null };
  try {
    const document = decodeDocument(legacyText);
    try {
      if (!localStorage.getItem(LEGACY_BACKUP_KEY))
        localStorage.setItem(LEGACY_BACKUP_KEY, legacyText);
    } catch {
      /* 备份失败不阻断迁移，原键仍保留 */
    }
    return {
      document,
      warning:
        "已从旧版单槽位存档无损升级：原存档已备份，可继续在多个标签中并行编辑。",
    };
  } catch {
    return {
      document: null,
      warning:
        "检测到旧版存档但无法解析，已原样保留；可通过导入旧实验文件恢复。",
    };
  }
}

/* ---------------- 冲突副本导入 / 导出 ---------------- */

export function encodeConflict(session: ConflictSession): string {
  const payload: ConflictExport = {
    format: "logic-lab-conflict",
    formatVersion: 1,
    exportedAt: Date.now(),
    session,
  };
  return JSON.stringify(payload, null, 2);
}

export function decodeConflict(text: string): ConflictExport {
  if (text.length > 4_000_000)
    throw new Error("冲突副本超过 4 MB，无法恢复");
  const data = safeParse<ConflictExport>(text);
  if (
    !data ||
    data.format !== "logic-lab-conflict" ||
    data.formatVersion !== 1 ||
    !data.session ||
    typeof data.session !== "object"
  )
    throw new Error("文件不是有效的冲突恢复副本");
  // 触发一次结构校验：三份文档都必须可解析为合法实验。
  decodeDocument(encodeDocument(data.session.baseDocument));
  decodeDocument(encodeDocument(data.session.localDocument));
  decodeDocument(encodeDocument(data.session.remoteDocument));
  return data;
}

/** 监听其他标签写入的存储键变化。 */
export function onStorageChange(
  handler: (event: StorageEvent) => void,
): () => void {
  const listener = (event: StorageEvent) => {
    if (
      event.key === HEAD_KEY ||
      event.key === DRAFTS_KEY ||
      event.key === CONFLICTS_KEY
    )
      handler(event);
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}
