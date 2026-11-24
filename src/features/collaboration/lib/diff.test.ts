import { describe, expect, it } from "vitest";
import type { CircuitDocument, GateNode, Wire } from "@/shared/types";
import { sampleCircuit } from "@/features/workspace/lib/seeds";
import { threeWayDiff, flattenDiff } from "./diff";

function clone(doc: CircuitDocument): CircuitDocument {
  return JSON.parse(JSON.stringify(doc)) as CircuitDocument;
}
function node(doc: CircuitDocument, id: string): GateNode {
  return doc.nodes.find((n) => n.id === id)!;
}
function move(doc: CircuitDocument, id: string, x: number, y: number) {
  node(doc, id).x = x;
  node(doc, id).y = y;
}
function removeWire(doc: CircuitDocument, id: string) {
  doc.wires = doc.wires.filter((w) => w.id !== id);
}
function addWire(doc: CircuitDocument, wire: Wire) {
  doc.wires.push(wire);
}

describe("threeWayDiff 分类", () => {
  it("无改动时不产生任何差异", () => {
    const base = sampleCircuit();
    const diff = threeWayDiff(clone(base), clone(base), clone(base));
    expect(flattenDiff(diff)).toHaveLength(0);
    expect(diff.hasConflict).toBe(false);
  });

  it("仅本地移动 -> 位置条目，非冲突，建议采纳本地", () => {
    const base = sampleCircuit();
    const local = clone(base);
    move(local, "a", 200, 200);
    const diff = threeWayDiff(base, local, clone(base));
    expect(diff.position).toHaveLength(1);
    expect(diff.position[0].kind).toBe("position");
    expect(diff.position[0].severity).toBe("none");
    expect(diff.position[0].suggested).toEqual({ side: "local" });
    expect(diff.hasConflict).toBe(false);
  });

  it("双方把同一元件移动到不同坐标 -> 位置冲突", () => {
    const base = sampleCircuit();
    const local = clone(base);
    const remote = clone(base);
    move(local, "a", 200, 200);
    move(remote, "a", 400, 300);
    const diff = threeWayDiff(base, local, remote);
    expect(diff.position[0].severity).toBe("conflict");
    expect(diff.hasConflict).toBe(true);
  });

  it("输入值改动被归入输入值类别", () => {
    const base = sampleCircuit();
    const local = clone(base);
    node(local, "a").value = 1;
    const diff = threeWayDiff(base, local, clone(base));
    expect(diff.value).toHaveLength(1);
    expect(diff.value[0].base).toBe(0);
    expect(diff.value[0].local).toBe(1);
  });

  it("双方对同一输入取不同值 -> 输入值冲突", () => {
    const base = sampleCircuit();
    const local = clone(base);
    const remote = clone(base);
    node(local, "a").value = 1;
    node(remote, "a").value = 0; // 与 base 相同 => 远端未改
    const diff = threeWayDiff(base, local, remote);
    // 远端未改，只有本地改 => 非冲突
    expect(diff.value[0].severity).toBe("none");

    node(remote, "b").value = 1; // 远端改的是另一个元件
    const diff2 = threeWayDiff(base, local, remote);
    expect(diff2.value).toHaveLength(2);
  });

  it("连线新增/删除/重接都归入接线类别", () => {
    const base = sampleCircuit();
    const local = clone(base);
    const remote = clone(base);
    removeWire(local, "w1");
    addWire(remote, {
      id: "w-new",
      from: { nodeId: "a", port: 0 },
      to: { nodeId: "and", port: 0 },
    });
    const diff = threeWayDiff(base, local, remote);
    const kinds = diff.wiring.map((d) => d.kind).sort();
    expect(kinds).toContain("wire-remove");
    expect(kinds).toContain("wire-add");
    expect(diff.position).toHaveLength(0);
    expect(diff.value).toHaveLength(0);
  });

  it("双方重接同一连线到不同落点 -> 接线冲突", () => {
    const base = sampleCircuit();
    const local = clone(base);
    const remote = clone(base);
    const lw = local.wires.find((w) => w.id === "w7")!;
    lw.to = { nodeId: "or", port: 0 };
    const rw = remote.wires.find((w) => w.id === "w7")!;
    rw.to = { nodeId: "nand", port: 0 };
    const diff = threeWayDiff(base, local, remote);
    const item = diff.wiring.find((d) => d.targetId === "w7");
    expect(item?.kind).toBe("wire-rewire");
    expect(item?.severity).toBe("conflict");
  });

  it("元件重命名归入身份/命名类别", () => {
    const base = sampleCircuit();
    const local = clone(base);
    node(local, "a").label = "A1";
    const diff = threeWayDiff(base, local, clone(base));
    expect(diff.identity.some((d) => d.kind === "label")).toBe(true);
  });

  it("新增与删除元件归入身份类别", () => {
    const base = sampleCircuit();
    const local = clone(base);
    const remote = clone(base);
    local.nodes.push({
      id: "n1",
      kind: "NOT",
      label: "NOT 1",
      value: 0,
      x: 400,
      y: 100,
    });
    remote.nodes = remote.nodes.filter((n) => n.id !== "y");
    const diff = threeWayDiff(base, local, remote);
    const kinds = diff.identity.map((d) => d.kind);
    expect(kinds).toContain("node-add");
    expect(kinds).toContain("node-remove");
  });

  it("双方各自改动不同元件时不算冲突（但仍逐条列出）", () => {
    const base = sampleCircuit();
    const local = clone(base);
    const remote = clone(base);
    move(local, "a", 120, 120);
    move(remote, "b", 120, 120);
    const diff = threeWayDiff(base, local, remote);
    expect(diff.position.every((d) => d.severity === "none")).toBe(true);
    expect(diff.autoCount).toBe(2);
  });
});
