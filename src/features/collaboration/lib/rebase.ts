import type { CircuitDocument } from "@/shared/types";
import type {
  ConflictSession,
  DiffItem,
  ResolutionMap,
  ThreeWayDiff,
} from "../types";
import { threeWayDiff } from "./diff";

/** 提取条目在某份文档中的远端负载，用于判断远端是否再次变化。 */
function remotePayload(item: DiffItem): unknown {
  return JSON.stringify(item.remote);
}

export interface RebaseResult {
  diff: ThreeWayDiff;
  resolutions: ResolutionMap;
  staleItemIds: string[];
  /** 新增、之前没有任何选择的条目 id。 */
  newItemIds: string[];
  remoteRevision: number;
}

/**
 * 远端在冲突解决期间再次保存时的 rebase。
 * 保留用户已做的全部选择；仅把远端负载发生变化的条目标记为需重核，
 * 不弹窗、不覆盖用户进度。
 */
export function rebaseSession(
  session: ConflictSession,
  newRemote: CircuitDocument,
  newRemoteRevision: number,
): RebaseResult {
  const nextDiff = threeWayDiff(
    session.baseDocument,
    session.localDocument,
    newRemote,
  );
  const previousDiff = threeWayDiff(
    session.baseDocument,
    session.localDocument,
    session.remoteDocument,
  );
  const previousById = new Map(
    [...previousDiff.position, ...previousDiff.value, ...previousDiff.wiring, ...previousDiff.identity].map(
      (item) => [item.id, item],
    ),
  );

  const resolutions: ResolutionMap = { ...session.resolutions };
  const staleItemIds: string[] = [];
  const newItemIds: string[] = [];
  const all: DiffItem[] = [
    ...nextDiff.identity,
    ...nextDiff.position,
    ...nextDiff.value,
    ...nextDiff.wiring,
  ];

  for (const item of all) {
    const previous = previousById.get(item.id);
    if (!previous) {
      // 远端新一轮保存带来的全新条目。
      newItemIds.push(item.id);
      continue;
    }
    if (remotePayload(previous) !== remotePayload(item)) {
      // 远端该条目又变了：保留旧选择，但标记需要重新确认。
      staleItemIds.push(item.id);
      continue;
    }
    // 远端该条目未变：既有选择继续有效（若有）。
    if (session.staleItemIds.includes(item.id)) staleItemIds.push(item.id);
  }

  // 清理已经不复存在的条目选择，避免悬挂数据。
  const liveIds = new Set(all.map((item) => item.id));
  for (const key of Object.keys(resolutions))
    if (!liveIds.has(key)) delete resolutions[key];

  return {
    diff: nextDiff,
    resolutions,
    staleItemIds,
    newItemIds,
    remoteRevision: newRemoteRevision,
  };
}

/** 用户重新确认某个条目后，解除其重核标记。 */
export function confirmStale(
  session: ConflictSession,
  itemId: string,
): string[] {
  return session.staleItemIds.filter((id) => id !== itemId);
}
