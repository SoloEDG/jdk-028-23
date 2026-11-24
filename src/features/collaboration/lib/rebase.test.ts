import { describe, expect, it } from "vitest";
import type { CircuitDocument } from "@/shared/types";
import { sampleCircuit } from "@/features/workspace/lib/seeds";
import { rebaseSession } from "./rebase";
import type { ConflictSession } from "../types";

function clone(d: CircuitDocument): CircuitDocument {
  return JSON.parse(JSON.stringify(d)) as CircuitDocument;
}

function makeSession(
  base: CircuitDocument,
  local: CircuitDocument,
  remote: CircuitDocument,
  remoteRevision: number,
  resolutions: ConflictSession["resolutions"] = {},
  stale: string[] = [],
): ConflictSession {
  const now = Date.now();
  return {
    sessionId: "conflict-test",
    branchId: "branch-test",
    label: "test",
    baseRevision: 1,
    remoteRevision,
    baseDocument: clone(base),
    localDocument: clone(local),
    remoteDocument: clone(remote),
    resolutions,
    remoteSnapshots: {},
    staleItemIds: stale,
    createdAt: now,
    updatedAt: now,
  };
}

describe("rebaseSession 远端再次保存", () => {
  it("保留用户已做的选择，仅标记远端再变的条目为待重核", () => {
    const base = sampleCircuit();
    const local = clone(base);
    local.nodes.find((n) => n.id === "a")!.x = 200;

    const remote1 = clone(base);
    remote1.nodes.find((n) => n.id === "a")!.x = 400;

    const session = makeSession(base, local, remote1, 2);
    const firstDiff = rebaseSession(session, clone(remote1), 2).diff;
    const positionItem = firstDiff.position[0];
    // 用户已经选择了本地
    session.resolutions[positionItem.id] = { side: "local" };

    // 远端又保存一次，把 a 移到 600
    const remote2 = clone(base);
    remote2.nodes.find((n) => n.id === "a")!.x = 600;
    const result = rebaseSession(session, remote2, 3);

    // 选择被保留
    expect(result.resolutions[positionItem.id]).toEqual({ side: "local" });
    // 该条目因远端再变被标记为待重核
    expect(result.staleItemIds).toContain(positionItem.id);
    expect(result.remoteRevision).toBe(3);
  });

  it("远端未再变的条目选择继续有效，不标记重核", () => {
    const base = sampleCircuit();
    const local = clone(base);
    local.nodes.find((n) => n.id === "b")!.y = 200;
    const remote = clone(base); // 远端对 b 无改动

    const session = makeSession(base, local, remote, 2);
    const diff = rebaseSession(session, clone(remote), 2).diff;
    const item = diff.position[0];
    session.resolutions[item.id] = { side: "local" };

    // 远端再次保存但内容与上次相同（revision 推进、文档一致）
    const result = rebaseSession(session, clone(remote), 3);
    expect(result.resolutions[item.id]).toEqual({ side: "local" });
    expect(result.staleItemIds).not.toContain(item.id);
  });

  it("新一轮远端带来全新差异条目时列入 newItemIds", () => {
    const base = sampleCircuit();
    const local = clone(base);
    const remote1 = clone(base);
    const session = makeSession(base, local, remote1, 2);

    const remote2 = clone(base);
    remote2.nodes.find((n) => n.id === "a")!.value = 1;
    const result = rebaseSession(session, remote2, 3);
    expect(result.newItemIds.length).toBeGreaterThan(0);
    expect(result.newItemIds).toContain(`value:a`);
  });
});
