import { STALE_AFTER_MS, readConflicts, readDrafts } from "./storage";
import type { RecoveryOption } from "../types";

function timeLabel(updatedAt: number): string {
  const diff = Date.now() - updatedAt;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

/** 汇总关闭标签后仍可找回的草稿分支与未完成冲突会话。 */
export function listRecoveryOptions(now = Date.now()): RecoveryOption[] {
  const drafts = readDrafts();
  const conflicts = readConflicts();
  const options: RecoveryOption[] = [];

  for (const draft of Object.values(drafts)) {
    const stale = now - draft.lastHeartbeat > STALE_AFTER_MS;
    options.push({
      id: draft.branchId,
      kind: "draft",
      label: draft.label,
      baseRevision: draft.baseRevision,
      updatedAt: draft.updatedAt,
      stale,
      description: `草稿分支 · 基于版本 r${draft.baseRevision} · ${timeLabel(draft.updatedAt)}${
        stale ? " · 标签可能已关闭" : " · 仍在编辑"
      }`,
    });
  }

  for (const session of Object.values(conflicts)) {
    const stale = now - session.updatedAt > STALE_AFTER_MS;
    const remaining = session.staleItemIds.length;
    options.push({
      id: session.sessionId,
      kind: "conflict",
      label: session.label,
      baseRevision: session.baseRevision,
      remoteRevision: session.remoteRevision,
      updatedAt: session.updatedAt,
      stale,
      description: `未完成冲突 · 本地 r${session.baseRevision} / 远端 r${session.remoteRevision} · ${timeLabel(session.updatedAt)}${
        remaining ? ` · ${remaining} 项待重核` : ""
      }`,
    });
  }

  return options.sort((a, b) => b.updatedAt - a.updatedAt);
}
