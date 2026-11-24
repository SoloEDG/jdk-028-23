import type { Ref } from "vue";
import type { CircuitDocument } from "@/shared/types";
import type { Notice } from "@/shared/commands";
import { emptyCircuit } from "../lib/seeds";
import type { Collaboration } from "@/features/collaboration";

/**
 * 工作区操作：新建 / 示例 / 导入 / 导出。
 * 保存与多标签协同全部委托给 collaboration 层，这里只保留文档替换类操作。
 */
export function useWorkspace(
  document: Ref<CircuitDocument>,
  notify: (notice: Notice) => void,
  collab: Collaboration,
  reset: () => void,
) {
  function replace(next: CircuitDocument) {
    collab.rebaseDocumentToHead(next);
    reset();
  }
  function clear() {
    if (
      !window.confirm("新建会替换当前工作台，未保存改动仍保留在分支记录中。继续吗？")
    )
      return;
    replace(emptyCircuit());
    notify({ tone: "info", message: "已新建空白实验，改动记录在当前分支" });
  }
  function importText(text: string) {
    if (collab.importDocumentText(text)) reset();
  }
  function importConflict(text: string) {
    collab.importConflictText(text);
  }
  function exportFile() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(document.value, null, 2)], {
        type: "application/json",
      }),
    );
    const a = window.document.createElement("a");
    a.href = url;
    a.download = `${document.value.name.replace(/[^\p{L}\p{N}_-]/gu, "_") || "logic-lab"}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify({ tone: "success", message: "实验文件已导出" });
  }
  function exportConflictFile() {
    const text = collab.exportConflict();
    if (!text) return;
    const url = URL.createObjectURL(
      new Blob([text], { type: "application/json" }),
    );
    const a = window.document.createElement("a");
    a.href = url;
    a.download = `conflict-copy-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return {
    clear,
    importText,
    importConflict,
    exportFile,
    exportConflictFile,
  };
}
