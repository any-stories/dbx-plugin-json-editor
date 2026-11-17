/**
 * 工作区持久化层
 */

import { dbx } from "../host/DBXAdapter";
import { createDocument, maxNewDocumentNumber, refreshParse, type JsonDocument, type ViewMode } from "./document";
import {
  DEFAULT_EDITOR_CONFIG,
  isEditorConfig,
  parseFontSize,
  type EditorConfig,
  type IndentValue
} from "./editorConfig";
import { isSchemaConfig, NONE_SCHEMA, type SchemaConfig } from "./schema";
import {
  DEFAULT_CSV_EXPORT_OPTIONS,
  DEFAULT_CSV_IMPORT_OPTIONS,
  isRecord,
  type CsvExportOptions,
  type CsvImportOptions
} from "./csv";
import { DOC_VALUE_LIMIT, SAMPLE_DOCUMENT_DATA } from "../config/constants";

export type PaneKey = "left" | "right";
// 外观三态: auto = 跟随宿主
export type AppearanceMode = "auto" | "light" | "dark";

export interface PaneModes {
  left: ViewMode;
  right: ViewMode;
}

// 通知条
export interface Notice {
  text: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export interface DocumentMeta {
  id: string;
  // null = 未命名 (尚未保存命名)
  name: string | null;
  createdAt: number;
  updatedAt: number;
  /** Document properties > Schema 配置 (缺省为 none) */
  schema?: SchemaConfig;
}

export interface WorkspaceSnapshot {
  version: 4;
  documents: DocumentMeta[];
  // 旧 v4 快照缺少该字段, 恢复时由文档名称推导 (见 finalizeState)
  nameSequence?: number;
  leftId: string | null;
  rightId: string | null;
  paneModes: PaneModes;
  appearanceMode: AppearanceMode;
  editorConfig: EditorConfig;
  csvExportOptions: CsvExportOptions;
  csvImportOptions: CsvImportOptions;
}

// v3 旧快照: editorConfig 为旧字段模型 (fontSize: number / indentation: 2|4|"tab"), 迁移时转换
interface WorkspaceSnapshotV3 {
  version: 3;
  documents: DocumentMeta[];
  leftId: string | null;
  rightId: string | null;
  paneModes: PaneModes;
  appearanceMode: AppearanceMode;
  editorConfig: {
    fontSize: number;
    indentation: 2 | 4 | "tab";
    escapeControlCharacters: boolean;
    escapeUnicodeCharacters: boolean;
  };
}

// v2 旧快照: 尚无 editorConfig, 迁移时补默认值
interface WorkspaceSnapshotV2 {
  version: 2;
  documents: DocumentMeta[];
  leftId: string | null;
  rightId: string | null;
  paneModes: PaneModes;
  appearanceMode: AppearanceMode;
}

// v1 旧快照: viewMode 挂在文档元数据上, 迁移时并入 paneModes
interface WorkspaceSnapshotV1 {
  version: 1;
  documents: Array<{ id: string; name: string; viewMode: ViewMode; createdAt: number; updatedAt: number }>;
  leftId: string | null;
  rightId: string | null;
}

export interface WorkspaceState {
  documents: JsonDocument[];
  leftId: string | null;
  rightId: string | null;
  paneModes: PaneModes;
  appearanceMode: AppearanceMode;
  editorConfig: EditorConfig;
  csvExportOptions: CsvExportOptions;
  csvImportOptions: CsvImportOptions;
  // 已分配的 "New document N" 最大编号
  nameSequence: number;
}

function isViewMode(value: unknown): value is ViewMode {
  return value === "tree" || value === "table" || value === "text";
}

function isAppearanceMode(value: unknown): value is AppearanceMode {
  return value === "auto" || value === "light" || value === "dark";
}

function isPaneModes(value: unknown): value is PaneModes {
  return (
    value !== null &&
    typeof value === "object" &&
    isViewMode((value as PaneModes).left) &&
    isViewMode((value as PaneModes).right)
  );
}

// v3 旧缩进取值转换: "tab" -> "\t", 其余保留数值
function migrateIndentation(value: 2 | 4 | "tab"): IndentValue {
  return value === "tab" ? "\t" : value;
}

// v3 无法识别的字段回退默认值
function migrateEditorConfigV3(value: WorkspaceSnapshotV3["editorConfig"]): EditorConfig {
  const fontSize = `${parseFontSize(String(value.fontSize)) ?? 14}px`;
  return {
    ...DEFAULT_EDITOR_CONFIG,
    fontSize,
    indentation: migrateIndentation(value.indentation),
    escapeControlCharacters: value.escapeControlCharacters,
    escapeUnicodeCharacters: value.escapeUnicodeCharacters
  };
}

// 首访默认态: 左面板载入产品特色示例文档 (SAMPLE_DOCUMENT_DATA, 与示例 Schema 配套),
// text 模式起步; 文档未命名未变更.
// 注: enum 下拉 / 时间戳时钟 / 颜色选择器 / 布尔开关等增强渲染只在 tree 模式可见,
// 用户配置示例 Schema 后切到 tree 模式即可看到效果.
// 右面板无文档 (tree 模式, 空内容渲染内置欢迎屏)
export function defaultWorkspace(): WorkspaceState {
  const sample = JSON.stringify(SAMPLE_DOCUMENT_DATA, null, DEFAULT_EDITOR_CONFIG.indentation);
  const first = createDocument(null, sample);
  return {
    documents: [first],
    leftId: first.id,
    rightId: null,
    paneModes: { left: "text", right: "tree" },
    appearanceMode: "auto",
    editorConfig: DEFAULT_EDITOR_CONFIG,
    csvExportOptions: DEFAULT_CSV_EXPORT_OPTIONS,
    csvImportOptions: DEFAULT_CSV_IMPORT_OPTIONS,
    nameSequence: 0
  };
}

// 文档元数据校验: schema 字段不合法时回退 none
function normalizeDocumentMeta(meta: unknown): DocumentMeta | null {
  if (meta === null || typeof meta !== "object") {
    return null;
  }
  const candidate = meta as Partial<DocumentMeta>;
  if (typeof candidate.id !== "string" || (candidate.name !== null && typeof candidate.name !== "string")) {
    return null;
  }
  return {
    id: candidate.id,
    name: candidate.name,
    createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : 0,
    updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : 0,
    schema: isSchemaConfig(candidate.schema) ? candidate.schema : NONE_SCHEMA
  };
}

async function loadDocuments(metas: DocumentMeta[]): Promise<JsonDocument[]> {
  const docs: JsonDocument[] = [];
  for (const meta of metas) {
    const content = await dbx.getStorageValue(`doc:${meta.id}`);
    const text = typeof content === "string" ? content : "";
    docs.push(
      refreshParse({
        id: meta.id,
        name: meta.name,
        content: text,
        isValid: false,
        isDirty: false,
        schema: meta.schema,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt
      })
    );
  }
  return docs;
}

// 读取并迁移工作区: v4 直接恢复, v3/v2/v1 逐级迁移
export async function loadWorkspace(): Promise<WorkspaceState> {
  const restored = (await dbx.getStorageValue(dbx.workspaceKey())) as
    WorkspaceSnapshot | WorkspaceSnapshotV3 | WorkspaceSnapshotV2 | WorkspaceSnapshotV1 | null;
  if (restored === null || !Array.isArray(restored.documents)) {
    return defaultWorkspace();
  }

  const metas = restored.documents.map(normalizeDocumentMeta).filter((meta) => meta !== null) as DocumentMeta[];

  if (restored.version === 4) {
    const docs = await loadDocuments(metas);
    return finalizeState(restored, docs);
  }

  if (restored.version === 3) {
    const docs = await loadDocuments(metas);
    return finalizeState(
      {
        ...restored,
        editorConfig: migrateEditorConfigV3(restored.editorConfig)
      },
      docs
    );
  }

  if (restored.version === 2) {
    const docs = await loadDocuments(metas);
    return finalizeState({ ...restored, editorConfig: DEFAULT_EDITOR_CONFIG }, docs);
  }

  if (restored.version === 1) {
    let v1LeftViewMode: ViewMode = "tree";
    for (const meta of restored.documents) {
      if (meta.id === restored.leftId && isViewMode(meta.viewMode)) {
        v1LeftViewMode = meta.viewMode;
      }
    }
    const docs = await loadDocuments(metas);
    return finalizeState(
      {
        ...restored,
        paneModes: { left: v1LeftViewMode, right: "tree" },
        appearanceMode: "auto",
        editorConfig: DEFAULT_EDITOR_CONFIG
      },
      docs
    );
  }

  return defaultWorkspace();
}

// 恢复收尾: 剔除指向不存在文档的 id, 缺省回退到首篇文档
function finalizeState(
  snapshot: Pick<WorkspaceSnapshot, "leftId" | "rightId" | "paneModes" | "appearanceMode" | "editorConfig"> &
    Partial<Pick<WorkspaceSnapshot, "csvExportOptions" | "csvImportOptions" | "nameSequence">>,
  docs: JsonDocument[]
): WorkspaceState {
  const known = new Set(docs.map((doc) => doc.id));
  const leftId = snapshot.leftId !== null && known.has(snapshot.leftId) ? snapshot.leftId : (docs[0]?.id ?? null);
  const rightId = snapshot.rightId !== null && known.has(snapshot.rightId) ? snapshot.rightId : null;
  return {
    documents: docs,
    leftId,
    rightId,
    paneModes: isPaneModes(snapshot.paneModes) ? snapshot.paneModes : { left: "tree", right: "tree" },
    appearanceMode: isAppearanceMode(snapshot.appearanceMode) ? snapshot.appearanceMode : "auto",
    editorConfig: isEditorConfig(snapshot.editorConfig) ? snapshot.editorConfig : DEFAULT_EDITOR_CONFIG,
    csvExportOptions: normalizeCsvExportOptions(snapshot.csvExportOptions),
    csvImportOptions: normalizeCsvImportOptions(snapshot.csvImportOptions),
    // 旧快照缺少 nameSequence 时由文档名称推导 (取现有编号最大值)
    nameSequence:
      typeof snapshot.nameSequence === "number" && snapshot.nameSequence >= 0
        ? snapshot.nameSequence
        : maxNewDocumentNumber(docs.map((doc) => doc.name))
  };
}

// CSV 选项结构校验
function isCsvDelimiter(value: unknown): boolean {
  return value === "," || value === ";" || value === "\t" || value === " ";
}

function normalizeCsvExportOptions(value: unknown): CsvExportOptions {
  if (!isRecord(value)) {
    return DEFAULT_CSV_EXPORT_OPTIONS;
  }
  return {
    header: value.header === true,
    delimiter: isCsvDelimiter(value.delimiter) ? (value.delimiter as CsvExportOptions["delimiter"]) : ",",
    flattenObject: value.flattenObject === true,
    flattenArray: value.flattenArray === true
  };
}

function normalizeCsvImportOptions(value: unknown): CsvImportOptions {
  if (!isRecord(value)) {
    return DEFAULT_CSV_IMPORT_OPTIONS;
  }
  return {
    header: value.header === true,
    delimiter:
      value.delimiter === "auto" || isCsvDelimiter(value.delimiter)
        ? (value.delimiter as CsvImportOptions["delimiter"])
        : "auto",
    nested: value.nested === true
  };
}

// 快照序列化: 内容不进快照 (按 doc:<id> 分片, 适配 host.storage 单值容量)
export function toSnapshot(state: WorkspaceState): WorkspaceSnapshot {
  return {
    version: 4,
    documents: state.documents.map(({ id, name, schema, createdAt, updatedAt }) => ({
      id,
      name,
      schema,
      createdAt,
      updatedAt
    })),
    leftId: state.leftId,
    rightId: state.rightId,
    paneModes: state.paneModes,
    appearanceMode: state.appearanceMode,
    editorConfig: state.editorConfig,
    csvExportOptions: state.csvExportOptions,
    csvImportOptions: state.csvImportOptions,
    nameSequence: state.nameSequence
  };
}

// 变更签名: 快照结构 + 各文档内容长度, 未变化时跳过写入
export function snapshotSignature(state: WorkspaceState): string {
  return JSON.stringify(toSnapshot(state)) + state.documents.map((doc) => `${doc.id}:${doc.content.length}`).join("|");
}

// 写入工作区: 快照 + 文档内容分片; 内容超限的分片跳过 (下次写入重试)
export async function persistWorkspace(state: WorkspaceState): Promise<boolean> {
  try {
    await dbx.setStorageValue(dbx.workspaceKey(), toSnapshot(state));
    for (const doc of state.documents) {
      if (doc.content.length <= DOC_VALUE_LIMIT) {
        await dbx.setStorageValue(`doc:${doc.id}`, doc.content);
      }
    }
    return true;
  } catch {
    return false;
  }
}

// 删除文档内容分片: New 移除不再被引用的文档时调用
export async function forgetDocumentChunk(docId: string): Promise<void> {
  try {
    await dbx.deleteStorageValue(`doc:${docId}`);
  } catch {
    // 删除失败不影响面板重置, 残留分片不参与快照恢复
  }
}
