export { useCollaboration } from "./model/useCollaboration";
export type { Collaboration } from "./model/useCollaboration";
export { threeWayDiff, flattenDiff, formatWire } from "./lib/diff";
export {
  mergePreview,
  validateMerged,
  manualWireChoice,
  manualPositionChoice,
} from "./lib/merge";
export { rebaseSession } from "./lib/rebase";
export { previewSignals } from "./lib/preview";
export { listRecoveryOptions } from "./lib/recovery";
export {
  encodeConflict,
  decodeConflict,
  HEAD_KEY,
  DRAFTS_KEY,
  CONFLICTS_KEY,
  LEGACY_KEY,
  LEGACY_BACKUP_KEY,
} from "./lib/storage";
export { default as ConflictDialog } from "./ui/ConflictDialog.vue";
export { default as RecoveryDialog } from "./ui/RecoveryDialog.vue";
export type {
  DiffItem,
  ThreeWayDiff,
  ResolutionChoice,
  ResolutionMap,
  ConflictSession,
  MergePreview,
  MergeIssue,
  RecoveryOption,
  ManualWire,
} from "./types";
