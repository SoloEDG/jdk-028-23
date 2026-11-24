import type {
  CircuitDocument,
  Endpoint,
  GateNode,
  Point,
  Wire,
} from "@/shared/types";
import { cloneDocument, createId } from "@/shared/document";
import { getSpec } from "@/features/catalog";
import { topologicalOrder } from "@/features/circuit";
import type {
  DiffItem,
  ManualWire,
  MergeIssue,
  MergePreview,
  ResolutionChoice,
  ResolutionMap,
  ThreeWayDiff,
} from "../types";
import { flattenDiff } from "./diff";

export interface MergeOutcome {
  preview: MergePreview;
  /** 还有冲突条目未给出明确选择。 */
  unresolved: string[];
}

function chosenWire(choice: ResolutionChoice, item: DiffItem): Wire | null {
  if (choice.side === "manual") {
    const manual = choice.manualWire;
    if (!manual) return null;
    return {
      id: item.targetId,
      from: { ...manual.from },
      to: { ...manual.to },
    };
  }
  const source =
    choice.side === "local"
      ? item.localWire
      : choice.side === "remote"
        ? item.remoteWire
        : item.baseWire;
  return source ? JSON.parse(JSON.stringify(source)) : null;
}

/**
 * 依据逐条选择构建合并文档。
 * 顺序固定：先处理元件（增删 / 名称 / 位置 / 值），再处理连线，
 * 最后级联清理引用了已删除元件的连线。
 */
export function buildMerge(
  base: CircuitDocument,
  diff: ThreeWayDiff,
  resolutions: ResolutionMap,
): { document: CircuitDocument; unresolved: string[] } {
  const merged = cloneDocument(base);
  const items = flattenDiff(diff);
  const unresolved: string[] = [];
  const removedNodes = new Set<string>();
  const nodeItems = items.filter((item) =>
    item.kind.startsWith("node-") ||
    item.kind === "position" ||
    item.kind === "value" ||
    item.kind === "label",
  );
  const wireItems = items.filter((item) => item.kind.startsWith("wire-"));

  for (const item of nodeItems) {
    const choice = resolutions[item.id];
    if (item.severity === "conflict" && !choice) {
      unresolved.push(item.id);
      continue;
    }
    const resolved = choice ?? item.suggested;
    applyNodeResolution(merged, item, resolved, removedNodes);
  }

  // 先移除所有出现在差异中的 base 连线，再按逐条选择重建，
  // 否则重接 / 删除会残留旧连线。
  const diffWireIds = new Set(wireItems.map((item) => item.targetId));
  merged.wires = merged.wires.filter((wire) => !diffWireIds.has(wire.id));

  for (const item of wireItems) {
    const choice = resolutions[item.id];
    if (item.severity === "conflict" && !choice) {
      unresolved.push(item.id);
      continue;
    }
    const resolved = choice ?? item.suggested;
    const wire = chosenWire(resolved, item);
    if (wire) merged.wires.push(wire);
  }

  // 级联：删除元件时移除其全部连线。
  merged.wires = merged.wires.filter(
    (wire) =>
      !removedNodes.has(wire.from.nodeId) &&
      !removedNodes.has(wire.to.nodeId),
  );
  return { document: normalizeDocument(merged), unresolved };
}

function applyNodeResolution(
  merged: CircuitDocument,
  item: DiffItem,
  choice: ResolutionChoice,
  removedNodes: Set<string>,
): void {
  const id = item.targetId;
  if (item.kind === "node-remove") {
    const remove =
      choice.side === "manual"
        ? false
        : choice.side === "base"
          ? false
          : (item[choice.side] as GateNode | undefined) === undefined;
    if (remove) {
      merged.nodes = merged.nodes.filter((node) => node.id !== id);
      removedNodes.add(id);
    } else {
      const survivor = (item.local ?? item.remote ?? item.base) as
        | GateNode
        | undefined;
      if (survivor && !merged.nodes.some((node) => node.id === id))
        merged.nodes.push(JSON.parse(JSON.stringify(survivor)));
    }
    return;
  }

  if (item.kind === "node-add") {
    if (choice.side === "manual") {
      const node = manualNode(item, choice);
      if (node) {
        merged.nodes = merged.nodes.filter((node) => node.id !== id);
        merged.nodes.push(node);
      }
      return;
    }
    const source =
      choice.side === "local"
        ? (item.local as GateNode | undefined)
        : choice.side === "remote"
          ? (item.remote as GateNode | undefined)
          : (item.base as GateNode | undefined);
    if (source) {
      merged.nodes = merged.nodes.filter((node) => node.id !== id);
      merged.nodes.push(JSON.parse(JSON.stringify(source)));
    }
    return;
  }

  const node = merged.nodes.find((candidate) => candidate.id === id);
  if (!node) return;
  if (choice.side === "manual") {
    if (item.kind === "position" && choice.manualPosition) {
      node.x = choice.manualPosition.x;
      node.y = choice.manualPosition.y;
    }
    if (item.kind === "value" && choice.manualValue !== undefined)
      node.value = choice.manualValue;
    if (item.kind === "label" && choice.manualLabel !== undefined)
      node.label = choice.manualLabel;
    return;
  }
  const source = (
    choice.side === "local"
      ? item.local
      : choice.side === "remote"
        ? item.remote
        : item.base
  ) as GateNode | undefined;
  if (!source) return;
  if (item.kind === "position") {
    node.x = source.x;
    node.y = source.y;
  } else if (item.kind === "value") {
    node.value = source.value;
  } else if (item.kind === "label") {
    node.label = source.label;
  }
}

function manualNode(
  item: DiffItem,
  choice: Extract<ResolutionChoice, { side: "manual" }>,
): GateNode | null {
  const template = (item.local ?? item.remote ?? item.base) as
    | GateNode
    | undefined;
  if (!template) return null;
  const node: GateNode = JSON.parse(JSON.stringify(template));
  if (choice.manualPosition) {
    node.x = choice.manualPosition.x;
    node.y = choice.manualPosition.y;
  }
  if (choice.manualValue !== undefined) node.value = choice.manualValue;
  if (choice.manualLabel !== undefined) node.label = choice.manualLabel;
  return node;
}

/** 去除重复编号、重复连线，保证结构干净。 */
function normalizeDocument(document: CircuitDocument): CircuitDocument {
  const seenNodes = new Set<string>();
  document.nodes = document.nodes.filter((node) => {
    if (seenNodes.has(node.id)) return false;
    seenNodes.add(node.id);
    return true;
  });
  const seenWires = new Set<string>();
  document.wires = document.wires.filter((wire) => {
    const key = `${wire.from.nodeId}:${wire.from.port}->${wire.to.nodeId}:${wire.to.port}`;
    if (seenWires.has(key)) return false;
    seenWires.add(key);
    return true;
  });
  return document;
}

/* ---------------- 合法性校验 ---------------- */

export function validateMerged(document: CircuitDocument): MergeIssue[] {
  const issues: MergeIssue[] = [];
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));

  if (document.nodes.length > 120)
    issues.push({
      level: "error",
      code: "node-limit",
      message: `合并后有 ${document.nodes.length} 个元件，超过 120 个上限`,
    });
  if (document.wires.length > 480)
    issues.push({
      level: "error",
      code: "wire-limit",
      message: `合并后有 ${document.wires.length} 条连线，超过 480 条上限`,
    });

  const nodeIds = new Set<string>();
  for (const node of document.nodes) {
    if (nodeIds.has(node.id))
      issues.push({
        level: "error",
        code: "duplicate-id",
        message: `元件编号 ${node.id} 重复`,
        targetId: node.id,
      });
    nodeIds.add(node.id);
  }

  const inputOwners = new Map<string, string>();
  for (const wire of document.wires) {
    if (!nodes.has(wire.from.nodeId) || !nodes.has(wire.to.nodeId)) {
      issues.push({
        level: "error",
        code: "dangling-wire",
        message: `连线 ${wire.id} 引用了已删除的元件`,
        targetId: wire.id,
      });
      continue;
    }
    const from = nodes.get(wire.from.nodeId)!,
      to = nodes.get(wire.to.nodeId)!;
    if (from.id === to.id)
      issues.push({
        level: "error",
        code: "self-wire",
        message: `元件 ${from.label} 不能连接到自身`,
        targetId: wire.id,
      });
    if (
      wire.from.port < 0 ||
      wire.from.port >= getSpec(from.kind).outputs ||
      wire.to.port < 0 ||
      wire.to.port >= getSpec(to.kind).inputs
    )
      issues.push({
        level: "error",
        code: "invalid-port",
        message: `连线 ${wire.id} 使用了无效端口`,
        targetId: wire.id,
      });
    const key = `${to.id}:${wire.to.port}`;
    if (inputOwners.has(key))
      issues.push({
        level: "error",
        code: "double-driver",
        message: `输入端口 ${to.label}#${wire.to.port + 1} 被 ${from.label} 与 ${nodes.get(inputOwners.get(key)!)?.label ?? "另一路"} 同时驱动（双驱动）`,
        targetId: wire.id,
      });
    else inputOwners.set(key, from.id);
  }

  // 反馈环（组合电路必须无环）。
  try {
    topologicalOrder(document);
  } catch {
    issues.push({
      level: "error",
      code: "feedback-loop",
      message: "合并结果形成了反馈环，本实验室仅支持无环组合电路",
    });
  }

  // 目标输入名称重复：真值表依赖唯一的 A / B / Y。
  const labels = document.nodes.map((node) => node.label);
  for (const name of ["A", "B", "Y"]) {
    const count = labels.filter((label) => label === name).length;
    if (count > 1)
      issues.push({
        level: "error",
        code: "duplicate-input-label",
        message: `目标检测要求名称 ${name} 唯一，当前出现了 ${count} 次`,
      });
  }

  return issues;
}

/** 构建并校验，产出供预览的完整结果。 */
export function mergePreview(
  base: CircuitDocument,
  diff: ThreeWayDiff,
  resolutions: ResolutionMap,
): MergeOutcome {
  const { document, unresolved } = buildMerge(base, diff, resolutions);
  const issues = validateMerged(document);
  for (const id of unresolved)
    issues.unshift({
      level: "error",
      code: "unresolved",
      message: `尚有冲突条目未选择处理方式（${id}）`,
      targetId: id,
    });
  const errors = issues.filter((issue) => issue.level === "error");
  const warnings = issues.filter((issue) => issue.level === "warning");
  return {
    unresolved,
    preview: {
      document,
      issues,
      errors,
      warnings,
      runnable: errors.length === 0,
    },
  };
}

/* ---------------- 手动重接辅助 ---------------- */

export function manualWireChoice(from: Endpoint, to: Endpoint): ResolutionChoice {
  const manual: ManualWire = {
    from: { ...from },
    to: { ...to },
  };
  return { side: "manual", manualWire: manual };
}

export function manualPositionChoice(point: Point): ResolutionChoice {
  return { side: "manual", manualPosition: { ...point } };
}

export function ensureWireId(wire: Omit<Wire, "id">): Wire {
  return { ...wire, id: createId("wire") };
}
