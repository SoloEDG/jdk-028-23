import type {
  CircuitDocument,
  Endpoint,
  GateNode,
  Point,
  Wire,
} from "@/shared/types";
import type {
  ConflictSeverity,
  DiffItem,
  ResolutionChoice,
  ThreeWayDiff,
} from "../types";

interface NodeTriple {
  base?: GateNode;
  local?: GateNode;
  remote?: GateNode;
}
interface WireTriple {
  base?: Wire;
  local?: Wire;
  remote?: Wire;
}

function indexNodes(document: CircuitDocument): Map<string, GateNode> {
  return new Map(document.nodes.map((node) => [node.id, node]));
}
function indexWires(document: CircuitDocument): Map<string, Wire> {
  return new Map(document.wires.map((wire) => [wire.id, wire]));
}
function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}
function sameEndpoint(a: Endpoint, b: Endpoint): boolean {
  return a.nodeId === b.nodeId && a.port === b.port;
}
function sameWire(a: Wire | undefined, b: Wire | undefined): boolean {
  if (!a || !b) return a === b;
  return sameEndpoint(a.from, b.from) && sameEndpoint(a.to, b.to);
}

/**
 * 判断条目是否构成真正的双方冲突：本地与远端都相对共同祖先发生了变化，
 * 且变化结果不一致。只有一方改动时可直接采纳该方，不算冲突。
 */
function severityOf(
  localChanged: boolean,
  remoteChanged: boolean,
  equal: boolean,
): ConflictSeverity {
  return localChanged && remoteChanged && !equal ? "conflict" : "none";
}

function suggestion(
  severity: ConflictSeverity,
  localChanged: boolean,
  remoteChanged: boolean,
): ResolutionChoice {
  if (severity === "conflict") return { side: "local" };
  if (localChanged) return { side: "local" };
  if (remoteChanged) return { side: "remote" };
  return { side: "base" };
}

function nodeTitle(node: GateNode | undefined, id: string): string {
  return node ? `${node.label}（${node.kind}）` : id;
}

/** 计算 base / local / remote 三份文档之间的三方差异，并按类别分组。 */
export function threeWayDiff(
  base: CircuitDocument,
  local: CircuitDocument,
  remote: CircuitDocument,
): ThreeWayDiff {
  const baseNodes = indexNodes(base),
    localNodes = indexNodes(local),
    remoteNodes = indexNodes(remote);
  const baseWires = indexWires(base),
    localWires = indexWires(local),
    remoteWires = indexWires(remote);

  const position: DiffItem[] = [],
    value: DiffItem[] = [],
    wiring: DiffItem[] = [],
    identity: DiffItem[] = [];

  const nodeIds = new Set<string>([
    ...baseNodes.keys(),
    ...localNodes.keys(),
    ...remoteNodes.keys(),
  ]);

  for (const id of [...nodeIds].sort()) {
    const triple: NodeTriple = {
      base: baseNodes.get(id),
      local: localNodes.get(id),
      remote: remoteNodes.get(id),
    };
    const { base: b, local: l, remote: r } = triple;

    if (!b && (l || r)) {
      // 新增元件：双方都新增且结果不同才算冲突。
      const both = l && r;
      const equal =
        both &&
        l.kind === r.kind &&
        l.label === r.label &&
        l.value === r.value &&
        samePoint(l, r);
      const severity = both && !equal ? "conflict" : "none";
      identity.push({
        id: `node-add:${id}`,
        kind: "node-add",
        targetId: id,
        title: `新增元件 ${nodeTitle(l ?? r, id)}`,
        detail: l && r ? "两个标签都新增了同编号元件" : "仅一个标签新增该元件",
        severity,
        base: undefined,
        local: l,
        remote: r,
        nodeKind: (l ?? r)?.kind,
        nodeLabel: (l ?? r)?.label,
        suggested: suggestion(severity, !!l, !!r),
      });
      continue;
    }
    if (b && (!l || !r)) {
      const localRemoved = !l,
        remoteRemoved = !r;
      const severity = severityOf(
        localRemoved,
        remoteRemoved,
        localRemoved === remoteRemoved,
      );
      identity.push({
        id: `node-remove:${id}`,
        kind: "node-remove",
        targetId: id,
        title: `删除元件 ${nodeTitle(b, id)}`,
        detail: localRemoved
          ? remoteRemoved
            ? "两个标签都删除了该元件"
            : "本地删除，远端保留"
          : "远端删除，本地保留",
        severity,
        base: b,
        local: l,
        remote: r,
        nodeKind: b.kind,
        nodeLabel: b.label,
        suggested: suggestion(severity, localRemoved, remoteRemoved),
      });
      continue;
    }
    if (!b || !l || !r) continue;

    // 位置改动
    const localMoved = !samePoint(b, l),
      remoteMoved = !samePoint(b, r);
    if (localMoved || remoteMoved) {
      const severity = severityOf(
        localMoved,
        remoteMoved,
        samePoint(l, r),
      );
      position.push({
        id: `position:${id}`,
        kind: "position",
        targetId: id,
        title: `移动 ${nodeTitle(b, id)}`,
        detail: `(${b.x}, ${b.y}) → 本地 (${l.x}, ${l.y}) / 远端 (${r.x}, ${r.y})`,
        severity,
        base: { x: b.x, y: b.y },
        local: { x: l.x, y: l.y },
        remote: { x: r.x, y: r.y },
        nodeKind: b.kind,
        nodeLabel: b.label,
        suggested: suggestion(severity, localMoved, remoteMoved),
      });
    }

    // 输入值改动
    const localToggled = b.value !== l.value,
      remoteToggled = b.value !== r.value;
    if (localToggled || remoteToggled) {
      const severity = severityOf(
        localToggled,
        remoteToggled,
        l.value === r.value,
      );
      value.push({
        id: `value:${id}`,
        kind: "value",
        targetId: id,
        title: `输入值 ${nodeTitle(b, id)}`,
        detail: `共同祖先 ${b.value} → 本地 ${l.value} / 远端 ${r.value}`,
        severity,
        base: b.value,
        local: l.value,
        remote: r.value,
        nodeKind: b.kind,
        nodeLabel: b.label,
        suggested: suggestion(severity, localToggled, remoteToggled),
      });
    }

    // 名称改动
    const localRenamed = b.label !== l.label,
      remoteRenamed = b.label !== r.label;
    if (localRenamed || remoteRenamed) {
      const severity = severityOf(
        localRenamed,
        remoteRenamed,
        l.label === r.label,
      );
      identity.push({
        id: `label:${id}`,
        kind: "label",
        targetId: id,
        title: `重命名 ${b.label}`,
        detail: `“${b.label}” → 本地 “${l.label}” / 远端 “${r.label}”`,
        severity,
        base: b.label,
        local: l.label,
        remote: r.label,
        nodeKind: b.kind,
        nodeLabel: b.label,
        suggested: suggestion(severity, localRenamed, remoteRenamed),
      });
    }
  }

  const wireIds = new Set<string>([
    ...baseWires.keys(),
    ...localWires.keys(),
    ...remoteWires.keys(),
  ]);

  for (const id of [...wireIds].sort()) {
    const triple: WireTriple = {
      base: baseWires.get(id),
      local: localWires.get(id),
      remote: remoteWires.get(id),
    };
    const { base: bw, local: lw, remote: rw } = triple;

    if (!bw && (lw || rw)) {
      const both = lw && rw;
      const equal = both && sameWire(lw, rw);
      const severity = both && !equal ? "conflict" : "none";
      wiring.push({
        id: `wire-add:${id}`,
        kind: "wire-add",
        targetId: id,
        title: "新增连线",
        detail: lw && rw ? "两个标签都新增了连线，落点不同" : "仅一个标签新增该连线",
        severity,
        base: undefined,
        local: lw,
        remote: rw,
        localWire: lw,
        remoteWire: rw,
        suggested: suggestion(severity, !!lw, !!rw),
      });
      continue;
    }
    if (bw && (!lw || !rw)) {
      const localRemoved = !lw,
        remoteRemoved = !rw;
      const severity = severityOf(
        localRemoved,
        remoteRemoved,
        localRemoved === remoteRemoved,
      );
      wiring.push({
        id: `wire-remove:${id}`,
        kind: "wire-remove",
        targetId: id,
        title: "删除连线",
        detail: localRemoved
          ? remoteRemoved
            ? "两个标签都断开了该连线"
            : "本地断开，远端保留"
          : "远端断开，本地保留",
        severity,
        base: bw,
        local: lw,
        remote: rw,
        baseWire: bw,
        localWire: lw,
        remoteWire: rw,
        suggested: suggestion(severity, localRemoved, remoteRemoved),
      });
      continue;
    }
    if (!bw || !lw || !rw) continue;

    const localChanged = !sameWire(bw, lw),
      remoteChanged = !sameWire(bw, rw);
    if (localChanged || remoteChanged) {
      const severity = severityOf(
        localChanged,
        remoteChanged,
        sameWire(lw, rw),
      );
      wiring.push({
        id: `wire-rewire:${id}`,
        kind: "wire-rewire",
        targetId: id,
        title: "重新接线",
        detail: `本地 ${formatWire(lw)} ／ 远端 ${formatWire(rw)}`,
        severity,
        base: bw,
        local: lw,
        remote: rw,
        baseWire: bw,
        localWire: lw,
        remoteWire: rw,
        suggested: suggestion(severity, localChanged, remoteChanged),
      });
    }
  }

  const all = [...position, ...value, ...wiring, ...identity];
  return {
    position,
    value,
    wiring,
    identity,
    hasConflict: all.some((item) => item.severity === "conflict"),
    autoCount: all.filter((item) => item.severity === "none").length,
  };
}

export function formatWire(wire: Wire): string {
  return `${wire.from.nodeId}:${wire.from.port} → ${wire.to.nodeId}:${wire.to.port}`;
}

/** 汇总所有条目，便于合并引擎统一遍历。 */
export function flattenDiff(diff: ThreeWayDiff): DiffItem[] {
  return [...diff.identity, ...diff.position, ...diff.value, ...diff.wiring];
}

export function diffItemKey(item: DiffItem): string {
  return `${item.kind}:${item.targetId}`;
}

export function cloneDiff(diff: ThreeWayDiff): ThreeWayDiff {
  return JSON.parse(JSON.stringify(diff)) as ThreeWayDiff;
}
