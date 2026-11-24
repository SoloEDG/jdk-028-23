import { ref } from "vue";
import type { Notice } from "@/shared/commands";
import type { CircuitDocument, Point } from "@/shared/types";
import { usePlacement } from "@/features/catalog";
import { useCircuit } from "@/features/circuit";
import { useSimulation } from "@/features/simulation";
import { useChallenge } from "@/features/challenge";
import { useCollaboration } from "@/features/collaboration";
import { useWorkspace } from "@/features/workspace";

export function useLab() {
  // 先用占位文档建立引用，真正的初始文档由协作层启动后写入。
  const document = ref<CircuitDocument>({
    version: 1,
    name: "",
    nodes: [],
    wires: [],
    targetId: "xor",
  });
  const notice = ref<Notice>({
    tone: "info",
    message: "正在恢复本地实验…",
  });
  const notify = (next: Notice) => {
    notice.value = next;
  };

  const collab = useCollaboration(document, notify);
  const started = collab.start();
  document.value = started.document;
  notice.value = {
    tone: started.warning ? "info" : "info",
    message:
      started.warning ??
      "示例已就绪。切换输入，观察信号如何到达输出；多个标签可并行编辑。",
  };

  const placement = usePlacement();
  const circuit = useCircuit(document, notify);
  const simulation = useSimulation(document),
    challenge = useChallenge(document);
  const workspace = useWorkspace(
    document,
    notify,
    collab,
    () => {
      circuit.resetSelection();
      challenge.reset();
      placement.tool.value = null;
    },
  );

  function place(point: Point) {
    if (!placement.tool.value) return;
    if (document.value.nodes.length >= 120) {
      notify({
        tone: "error",
        message: "最多支持 120 个元件，请先删除不用的元件",
      });
      return;
    }
    const node = placement.createNode(
      document.value,
      placement.tool.value,
      point,
    );
    document.value.nodes.push(node);
    circuit.selected.value = node.id;
    placement.tool.value = null;
    notify({
      tone: "success",
      message: `已放置 ${node.label}，点击端口开始连线`,
    });
  }
  function move(id: string, point: Point) {
    const node = document.value.nodes.find((n) => n.id === id);
    if (node) {
      node.x = point.x;
      node.y = point.y;
    }
  }
  function cancel() {
    circuit.pending.value = null;
    placement.tool.value = null;
    notify({ tone: "info", message: "已取消当前放置或连线" });
  }
  function renameNode(label: string) {
    const node = document.value.nodes.find(
      (n) => n.id === circuit.selected.value,
    );
    if (node) node.label = label.trim().slice(0, 40) || node.kind;
  }

  return {
    document,
    notice,
    notify,
    placement,
    circuit,
    simulation,
    challenge,
    workspace,
    collab,
    place,
    move,
    cancel,
    renameNode,
  };
}
