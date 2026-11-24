import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sampleCircuit } from "@/features/workspace/lib/seeds";
import {
  CONFLICTS_KEY,
  DRAFTS_KEY,
  HEAD_KEY,
  LEGACY_BACKUP_KEY,
  LEGACY_KEY,
  decodeConflict,
  encodeConflict,
  migrateLegacy,
  readConflicts,
  readDrafts,
  readHead,
  removeConflict,
  removeDraft,
  upsertConflict,
  upsertDraft,
  writeHead,
} from "./storage";
import type { ConflictSession, DraftBranch, HeadRevision } from "../types";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

beforeAll(() => {
  // storage 模块在函数内部访问 localStorage，可在导入后再注入。
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage =
    new MemoryStorage();
});

function headOf(doc = sampleCircuit(), revision = 1): HeadRevision {
  return { revision, updatedAt: Date.now(), document: JSON.parse(JSON.stringify(doc)) };
}
function draftOf(revision = 1): DraftBranch {
  const now = Date.now();
  const document = sampleCircuit();
  return {
    branchId: "branch-1",
    label: "标签分支 test",
    baseRevision: revision,
    baseDocument: JSON.parse(JSON.stringify(document)),
    document: JSON.parse(JSON.stringify(document)),
    createdAt: now,
    updatedAt: now,
    lastHeartbeat: now,
    active: true,
  };
}
function sessionOf(): ConflictSession {
  const now = Date.now();
  const document = sampleCircuit();
  return {
    sessionId: "conflict-1",
    branchId: "branch-1",
    label: "冲突",
    baseRevision: 1,
    remoteRevision: 2,
    baseDocument: JSON.parse(JSON.stringify(document)),
    localDocument: JSON.parse(JSON.stringify(document)),
    remoteDocument: JSON.parse(JSON.stringify(document)),
    resolutions: {},
    remoteSnapshots: {},
    staleItemIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

describe("migrateLegacy 旧版无损升级", () => {
  beforeEach(() => localStorage.clear());

  it("无 head 且存在 v1 存档时迁移，并保留原键与备份", () => {
    const legacy = JSON.stringify(sampleCircuit());
    localStorage.setItem(LEGACY_KEY, legacy);
    const result = migrateLegacy();
    expect(result.document).not.toBeNull();
    expect(result.document?.name).toBe(sampleCircuit().name);
    // 原键保持不动
    expect(localStorage.getItem(LEGACY_KEY)).toBe(legacy);
    // 备份键写入相同内容
    expect(localStorage.getItem(LEGACY_BACKUP_KEY)).toBe(legacy);
  });

  it("已有 v2 head 时不触发迁移", () => {
    writeHead(headOf());
    localStorage.setItem(LEGACY_KEY, JSON.stringify(sampleCircuit()));
    const result = migrateLegacy();
    expect(result.document).toBeNull();
  });

  it("损坏的 v1 存档被原样保留且不抛出", () => {
    localStorage.setItem(LEGACY_KEY, "{ not valid json");
    const result = migrateLegacy();
    expect(result.document).toBeNull();
    expect(result.warning).toContain("原样保留");
    expect(localStorage.getItem(LEGACY_KEY)).toBe("{ not valid json");
  });
});

describe("head / draft / conflict 持久化", () => {
  beforeEach(() => localStorage.clear());

  it("head 写入后可读出且版本号保留", () => {
    writeHead(headOf(sampleCircuit(), 7));
    expect(readHead()?.revision).toBe(7);
    expect(readHead()?.document.nodes.length).toBe(
      sampleCircuit().nodes.length,
    );
  });

  it("草稿分支 upsert/remove 往返", () => {
    upsertDraft(draftOf());
    expect(Object.keys(readDrafts())).toContain("branch-1");
    removeDraft("branch-1");
    expect(readDrafts()["branch-1"]).toBeUndefined();
  });

  it("冲突会话 upsert/remove 往返", () => {
    upsertConflict(sessionOf());
    expect(Object.keys(readConflicts())).toContain("conflict-1");
    removeConflict("conflict-1");
    expect(readConflicts()["conflict-1"]).toBeUndefined();
  });

  it("冲突副本可编码并被独立解码恢复", () => {
    const session = sessionOf();
    const text = encodeConflict(session);
    const payload = decodeConflict(text);
    expect(payload.format).toBe("logic-lab-conflict");
    expect(payload.session.remoteRevision).toBe(2);
    expect(payload.session.localDocument.nodes.length).toBe(
      session.localDocument.nodes.length,
    );
  });

  it("非冲突副本文件解码时抛错", () => {
    expect(() => decodeConflict(JSON.stringify({ foo: 1 }))).toThrow();
  });
});

describe("存储键命名稳定", () => {
  it("使用带 v2 版本的独立键，不与 v1 冲突", () => {
    expect(HEAD_KEY).toContain("v2");
    expect(DRAFTS_KEY).toContain("v2");
    expect(CONFLICTS_KEY).toContain("v2");
    expect(LEGACY_KEY).toContain("v1");
  });
});
