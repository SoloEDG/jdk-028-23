// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref, type Ref } from "vue";
import type { CircuitDocument } from "@/shared/types";
import { useCollaboration } from "./useCollaboration";
import { HEAD_KEY } from "../lib/storage";

async function flush() {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function notifyRemote() {
  // 模拟浏览器向“其他标签”投递 storage 事件。
  window.dispatchEvent(new StorageEvent("storage", { key: HEAD_KEY }));
}

function newTab(): {
  documentRef: Ref<CircuitDocument>;
  tab: ReturnType<typeof useCollaboration>;
} {
  const documentRef = ref({} as CircuitDocument);
  const tab = useCollaboration(documentRef, vi.fn());
  documentRef.value = tab.start().document;
  return { documentRef, tab };
}

describe("多标签协同端到端", () => {
  beforeEach(() => localStorage.clear());

  it("两标签并行编辑 -> 冲突 -> 逐项解决 -> 远端再保存 rebase -> 提交", async () => {
    // 标签 A 启动，建立 r1
    const { documentRef: refA, tab: tabA } = newTab();
    tabA.dispose();

    // 标签 B 启动，读取同一 head r1
    const { documentRef: refB, tab: tabB } = newTab();
    await flush();
    expect(tabB.baseRevision.value).toBe(1);

    // A、B 把同一元件移动到不同位置（真正的双方冲突）
    const nodeA = refA.value.nodes.find((n) => n.id === "a")!;
    nodeA.x = 200;
    nodeA.y = 200;
    const nodeB = refB.value.nodes.find((n) => n.id === "a")!;
    nodeB.x = 400;
    nodeB.y = 300;
    await flush();

    // A 先保存 -> r2
    tabA.save();
    expect(tabA.baseRevision.value).toBe(2);

    // 通知 B 远端已变
    notifyRemote();
    expect(tabB.remoteAhead.value).toBe(true);

    // B 保存 -> 进入冲突会话
    tabB.save();
    expect(tabB.activeSession.value).not.toBeNull();
    expect(tabB.conflictDiff.value?.hasConflict).toBe(true);
    const positionItem = tabB.conflictDiff.value!.position[0];
    expect(positionItem.severity).toBe("conflict");
    expect(tabB.canCommit.value).toBe(false); // 冲突未解决

    // B 逐项选择“本地”
    tabB.setResolution(positionItem.id, { side: "local" });
    expect(tabB.canCommit.value).toBe(true);

    // 解决期间 A 再次保存 r3，且再次移动同一元件 -> 触发 rebase
    nodeA.x = 220;
    nodeA.y = 220;
    await flush();
    tabA.save();
    expect(tabA.baseRevision.value).toBe(3);
    notifyRemote();

    // B 的解决进度保留，但该条目标记为待重核，且禁止提交
    expect(
      tabB.activeSession.value?.resolutions[positionItem.id],
    ).toEqual({ side: "local" });
    expect(tabB.activeSession.value?.staleItemIds).toContain(positionItem.id);
    expect(tabB.canCommit.value).toBe(false);

    // B 重新确认选择 -> 解除重核标记 -> 可提交
    tabB.setResolution(positionItem.id, { side: "local" });
    expect(tabB.activeSession.value?.staleItemIds).not.toContain(
      positionItem.id,
    );
    expect(tabB.canCommit.value).toBe(true);

    // 提交合并 -> r4，正式存档被替换，会话关闭
    tabB.commitMerge();
    expect(tabB.baseRevision.value).toBe(4);
    expect(tabB.activeSession.value).toBeNull();
    const head = JSON.parse(localStorage.getItem(HEAD_KEY)!);
    expect(head.revision).toBe(4);
    // B 选择了本地坐标
    expect(
      head.document.nodes.find((n: { id: string }) => n.id === "a").x,
    ).toBe(400);

    tabB.dispose();
  });

  it("不合法的合并（双驱动）禁止替换正式存档", async () => {
    const { documentRef: refA, tab: tabA } = newTab();
    const { documentRef: refB, tab: tabB } = newTab();
    await flush();

    // A 新增一条连到 and#0 的线（该端口已被 w5 占用则会形成双驱动）
    refA.value.wires.push({
      id: "w-conflict-a",
      from: { nodeId: "b", port: 0 },
      to: { nodeId: "and", port: 0 },
    });
    tabA.save();
    expect(tabA.baseRevision.value).toBe(2);

    notifyRemote();
    // B 做一个无关改动后保存进入冲突
    const nodeB = refB.value.nodes.find((n) => n.id === "b")!;
    nodeB.x = 120;
    await flush();
    tabB.save();
    expect(tabB.activeSession.value).not.toBeNull();

    // 合并结果包含双驱动 -> 不可运行 -> 禁止提交
    expect(tabB.conflictPreview.value?.runnable).toBe(false);
    expect(
      tabB.conflictPreview.value?.errors.some(
        (e) => e.code === "double-driver",
      ),
    ).toBe(true);
    expect(tabB.canCommit.value).toBe(false);

    const headBefore = JSON.parse(localStorage.getItem(HEAD_KEY)!).revision;
    tabB.commitMerge();
    const headAfter = JSON.parse(localStorage.getItem(HEAD_KEY)!).revision;
    expect(headAfter).toBe(headBefore); // 正式存档未被替换

    tabA.dispose();
    tabB.dispose();
  });

  it("关闭标签后重新打开可找回未提交的草稿分支", async () => {
    const { documentRef, tab } = newTab();
    // 做出未保存改动
    documentRef.value.name = "未提交的改动";
    const node = documentRef.value.nodes[0];
    node.x = 240;
    await flush();

    const branchId = tab.branchId;
    // 模拟标签关闭
    tab.dispose();

    // 重新打开：恢复列表里应能看到该草稿
    const reopened = newTab();
    reopened.tab.openRecovery();
    const option = reopened.tab.recoveryOptions.value.find(
      (o) => o.id === branchId && o.kind === "draft",
    );
    expect(option).toBeDefined();

    // 恢复后改动原样回来
    reopened.tab.recover(option!);
    expect(reopened.documentRef.value.name).toBe("未提交的改动");
    expect(reopened.documentRef.value.nodes[0].x).toBe(240);
    reopened.tab.dispose();
  });
});
