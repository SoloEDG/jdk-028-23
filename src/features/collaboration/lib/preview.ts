import type { SimulationResult } from "@/shared/types";
import { evaluate } from "@/features/simulation";
import { truthTable } from "@/features/challenge/lib/truthTable";
import { targetById } from "@/features/challenge/lib/targets";
import type { MergePreview } from "../types";

export interface PreviewSignals {
  simulation: SimulationResult | null;
  truth: ReturnType<typeof truthTable> | null;
  targetPassed: boolean | null;
}

/** 仅当合并结果无阻断错误时才运行信号传播与目标检测。 */
export function previewSignals(preview: MergePreview): PreviewSignals {
  if (!preview.runnable)
    return { simulation: null, truth: null, targetPassed: null };
  try {
    const simulation = evaluate(preview.document);
    const target = targetById(preview.document.targetId);
    const truth = truthTable(preview.document, target);
    const targetPassed =
      !truth.error && truth.rows.every((row) => row.matches === true);
    return { simulation, truth, targetPassed };
  } catch {
    return { simulation: null, truth: null, targetPassed: null };
  }
}
