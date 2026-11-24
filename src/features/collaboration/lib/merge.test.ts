import { describe, expect, it } from "vitest";
import type { CircuitDocument, GateNode, Wire } from "@/shared/types";
import { threeWayDiff } from "./diff";
import {
  buildMerge,
  mergePreview,
  validateMerged,
  manualWireChoice,
} from "./merge";

function doc(nodes: GateNode[], wires: Wire[] = []): CircuitDocument {
  return {
    version: 1,
    name: "t",
    targetId: "xor",
    nodes: JSON.parse(JSON.stringify(nodes)),
    wires: JSON.parse(JSON.stringify(wires)),
  };
}
function inNode(id: string, label: string, x = 60, y = 120): GateNode {
  return { id, kind: "INPUT", label, value: 0, x, y };
}
function gate(id: string, kind: GateNode["kind"], x = 300, y = 120): GateNode {
  return { id, kind, label: id.toUpperCase(), value: 0, x, y };
}
function outNode(id = "y"): GateNode {
  return { id, kind: "OUTPUT", label: "Y", value: 0, x: 800, y: 120 };
}
function wire(id: string, f: [string, number], t: [string, number]): Wire {
  return {
    id,
    from: { nodeId: f[0], port: f[1] },
    to: { nodeId: t[0], port: t[1] },
  };
}

describe("buildMerge 选择采纳", () => {
  it("位置冲突选择本地则采用本地坐标", () => {
    const base = doc([inNode("a", "A")]);
    const local = doc([{ ...inNode("a", "A"), x: 200, y: 200 }]);
    const remote = doc([{ ...inNode("a", "A"), x: 400, y: 300 }]);
    const diff = threeWayDiff(base, local, remote);
    const item = diff.position[0];
    const { document } = buildMerge(base, diff, {
      [item.id]: { side: "local" },
    });
    expect(document.nodes[0].x).toBe(200);

    const remotePick = buildMerge(base, diff, {
      [item.id]: { side: "remote" },
    }).document;
    expect(remotePick.nodes[0].x).toBe(400);
  });

  it("未解决的冲突条目会出现在 unresolved 中", () => {
    const base = doc([inNode("a", "A")]);
    const local = doc([{ ...inNode("a", "A"), x: 200, y: 200 }]);
    const remote = doc([{ ...inNode("a", "A"), x: 400, y: 300 }]);
    const diff = threeWayDiff(base, local, remote);
    const { unresolved } = buildMerge(base, diff, {});
    expect(unresolved).toContain(diff.position[0].id);
  });

  it("删除元件会级联清理其连线", () => {
    const base = doc(
      [inNode("a", "A"), gate("and", "AND"), outNode()],
      [
        wire("w1", ["a", 0], ["and", 0]),
        wire("w2", ["and", 0], ["y", 0]),
      ],
    );
    const local = doc(base.nodes.filter((n) => n.id !== "a"), base.wires);
    const remote = doc(base.nodes, base.wires);
    const diff = threeWayDiff(base, local, remote);
    const removeItem = diff.identity.find((d) => d.kind === "node-remove")!;
    const { document } = buildMerge(base, diff, {
      [removeItem.id]: { side: "local" },
    });
    expect(document.nodes.some((n) => n.id === "a")).toBe(false);
    expect(document.wires.some((w) => w.id === "w1")).toBe(false);
  });

  it("手动重接产生用户指定的连线", () => {
    const base = doc(
      [inNode("a", "A"), gate("and", "AND"), gate("or", "OR")],
      [wire("w1", ["a", 0], ["and", 0])],
    );
    const local = doc(base.nodes, [
      { ...base.wires[0], to: { nodeId: "or", port: 0 } },
    ]);
    const remote = doc(base.nodes, [
      { ...base.wires[0], to: { nodeId: "and", port: 1 } },
    ]);
    const diff = threeWayDiff(base, local, remote);
    const item = diff.wiring[0];
    const choice = manualWireChoice(
      { nodeId: "a", port: 0 },
      { nodeId: "or", port: 0 },
    );
    const { document } = buildMerge(base, diff, { [item.id]: choice });
    const merged = document.wires.find((w) => w.id === "w1")!;
    expect(merged.to).toEqual({ nodeId: "or", port: 0 });
  });
});

describe("validateMerged 跨元件合并的系统性问题", () => {
  it("检测双驱动：同一输入端口被两条线占用", () => {
    const merged = doc(
      [inNode("a", "A"), inNode("b", "B"), gate("and", "AND")],
      [
        wire("w1", ["a", 0], ["and", 0]),
        wire("w2", ["b", 0], ["and", 0]),
      ],
    );
    const issues = validateMerged(merged);
    expect(issues.some((i) => i.code === "double-driver")).toBe(true);
  });

  it("检测反馈环", () => {
    const merged = doc(
      [inNode("a", "A"), gate("and", "AND"), gate("or", "OR")],
      [
        wire("w1", ["a", 0], ["and", 0]),
        wire("w2", ["and", 0], ["or", 0]),
        wire("w3", ["or", 0], ["and", 1]),
      ],
    );
    const issues = validateMerged(merged);
    expect(issues.some((i) => i.code === "feedback-loop")).toBe(true);
  });

  it("检测目标输入名称重复（A 出现两次）", () => {
    const merged = doc([
      inNode("a", "A"),
      inNode("b", "A"),
      gate("and", "AND"),
      outNode(),
    ]);
    const issues = validateMerged(merged);
    expect(issues.some((i) => i.code === "duplicate-input-label")).toBe(true);
  });

  it("检测悬空连线", () => {
    const merged = doc([inNode("a", "A")], [
      wire("w1", ["a", 0], ["ghost", 0]),
    ]);
    const issues = validateMerged(merged);
    expect(issues.some((i) => i.code === "dangling-wire")).toBe(true);
  });

  it("合法无环电路无阻断错误", () => {
    const merged = doc(
      [inNode("a", "A"), inNode("b", "B"), gate("and", "AND"), outNode()],
      [
        wire("w1", ["a", 0], ["and", 0]),
        wire("w2", ["b", 0], ["and", 1]),
        wire("w3", ["and", 0], ["y", 0]),
      ],
    );
    const issues = validateMerged(merged);
    expect(issues.filter((i) => i.level === "error")).toHaveLength(0);
  });
});

describe("mergePreview 提交门槛", () => {
  it("存在阻断错误时 runnable 为 false", () => {
    const merged = doc(
      [inNode("a", "A"), inNode("b", "B"), gate("and", "AND")],
      [
        wire("w1", ["a", 0], ["and", 0]),
        wire("w2", ["b", 0], ["and", 0]),
      ],
    );
    const issues = validateMerged(merged);
    const preview = mergePreview(merged, {
      position: [],
      value: [],
      wiring: [],
      identity: [],
      hasConflict: false,
      autoCount: 0,
    }, {});
    expect(preview.preview.runnable).toBe(false);
    expect(issues.some((i) => i.code === "double-driver")).toBe(true);
  });
});
