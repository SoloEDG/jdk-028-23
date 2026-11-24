import type {
  CircuitDocument,
  Endpoint,
  GateNode,
  Point,
  Wire,
} from "@/shared/types";

/** 正式存档：在实验文档外再包裹一层单调递增的版本号。 */
export interface HeadRevision {
  revision: number;
  updatedAt: number;
  document: CircuitDocument;
}

/** 单个标签（分支）的工作草稿。 */
export interface DraftBranch {
  branchId: string;
  label: string;
  baseRevision: number;
  /** 分支创建时所依据的正式存档快照，作为三方合并的共同祖先。 */
  baseDocument: CircuitDocument;
  document: CircuitDocument;
  createdAt: number;
  updatedAt: number;
  lastHeartbeat: number;
  active: boolean;
}

/** 手动重接时由用户填写的连线终点（起点沿用当前选择或自定义）。 */
export interface ManualWire {
  from: Endpoint;
  to: Endpoint;
}

/** 一条差异条目的解决方式。 */
export type ResolutionChoice =
  | { side: "base" | "local" | "remote" }
  | { side: "manual"; manualPosition?: Point; manualValue?: 0 | 1; manualLabel?: string; manualWire?: ManualWire };

export type ChangeKind =
  | "position"
  | "value"
  | "label"
  | "node-add"
  | "node-remove"
  | "wire-add"
  | "wire-remove"
  | "wire-rewire";

export type ConflictSeverity = "none" | "conflict";

/** 三方差异中的单条变更。 */
export interface DiffItem {
  id: string;
  kind: ChangeKind;
  /** 节点或连线的稳定编号。 */
  targetId: string;
  title: string;
  detail: string;
  severity: ConflictSeverity;
  base: unknown;
  local: unknown;
  remote: unknown;
  /** 仅当三方都存在该节点时用于名称/类型展示。 */
  nodeKind?: GateNode["kind"];
  nodeLabel?: string;
  /** 连线条目专用：三方连线（可能缺省）。 */
  baseWire?: Wire;
  localWire?: Wire;
  remoteWire?: Wire;
  /** 默认建议选择。 */
  suggested: ResolutionChoice;
}

/** 分组后的三方差异。 */
export interface ThreeWayDiff {
  position: DiffItem[];
  value: DiffItem[];
  wiring: DiffItem[];
  identity: DiffItem[];
  hasConflict: boolean;
  /** 无冲突、可直接自动合并的条目数。 */
  autoCount: number;
}

export type ResolutionMap = Record<string, ResolutionChoice>;

/** 解决冲突期间，每个条目所依据的远端快照版本，用于检测再次保存。 */
export type RemoteSnapshotMap = Record<string, number>;

export interface ConflictSession {
  sessionId: string;
  branchId: string;
  label: string;
  baseRevision: number;
  /** 打开会话时的远端（head）版本；rebase 时整体刷新。 */
  remoteRevision: number;
  baseDocument: CircuitDocument;
  localDocument: CircuitDocument;
  remoteDocument: CircuitDocument;
  resolutions: ResolutionMap;
  remoteSnapshots: RemoteSnapshotMap;
  /** 被 rebase 判定失效、需要用户重新确认的条目 id。 */
  staleItemIds: string[];
  createdAt: number;
  updatedAt: number;
}

/** 导出到文件的冲突副本，可在任意浏览器独立恢复。 */
export interface ConflictExport {
  format: "logic-lab-conflict";
  formatVersion: 1;
  exportedAt: number;
  session: Omit<ConflictSession, "sessionId"> & { sessionId?: string };
}

export interface MergeIssue {
  level: "error" | "warning";
  code:
    | "feedback-loop"
    | "double-driver"
    | "dangling-wire"
    | "duplicate-input-label"
    | "duplicate-id"
    | "node-limit"
    | "wire-limit"
    | "invalid-port"
    | "self-wire"
    | "unresolved";
  message: string;
  targetId?: string;
}

export interface MergePreview {
  document: CircuitDocument;
  issues: MergeIssue[];
  errors: MergeIssue[];
  warnings: MergeIssue[];
  /** 无阻断错误时才会给出信号与目标检测结果。 */
  runnable: boolean;
}

/** 启动时可供恢复的分支 / 会话清单。 */
export interface RecoveryOption {
  id: string;
  kind: "draft" | "conflict";
  label: string;
  baseRevision: number;
  remoteRevision?: number;
  updatedAt: number;
  stale: boolean;
  description: string;
}
