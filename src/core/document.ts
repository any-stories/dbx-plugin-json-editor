/**
 * JSON 文档模型
 *
 * 原始文本是唯一权威来源, 解析结果与错误定位按需派生
 * 解析失败时保留原始输入, 保证非法 JSON 不会丢失
 * Document properties > Schema 配置 (JSON Schema 校验)
 */

import type { SchemaConfig } from "./schema";

export type ViewMode = "tree" | "table" | "text";

export interface JsonParseError {
  message: string;
  line?: number;
  column?: number;
  position?: number;
}

export interface JsonDocument {
  id: string;
  // null = 未命名 (文档在首次保存时才创建并命名, 名称按钮仅对已命名文档渲染)
  name: string | null;
  content: string;
  parsedData?: unknown;
  isValid: boolean;
  error?: JsonParseError;
  isDirty: boolean;
  schema?: SchemaConfig;
  createdAt: number;
  updatedAt: number;
}

let idSeed = 0;

function nextId(): string {
  idSeed += 1;
  return `doc-${Date.now().toString(36)}-${idSeed}`;
}

// 从解析异常中提取位置信息, 兼容 V8 的 line/column 与纯 position 两种格式
export function buildParseError(message: string, content: string): JsonParseError {
  const error: JsonParseError = { message };
  const lineColumn = /line (\d+) column (\d+)/.exec(message);
  if (lineColumn) {
    error.line = Number(lineColumn[1]);
    error.column = Number(lineColumn[2]);
    return error;
  }
  const position = /position (\d+)/.exec(message);
  if (!position) {
    return error;
  }
  const at = Number(position[1]);
  error.position = at;
  const before = content.slice(0, at);
  const lines = before.split("\n");
  error.line = lines.length;
  error.column = (lines[lines.length - 1]?.length ?? 0) + 1;
  return error;
}

export function refreshParse(doc: JsonDocument): JsonDocument {
  if (doc.content.trim() === "") {
    return { ...doc, parsedData: undefined, isValid: false, error: undefined };
  }
  try {
    return { ...doc, parsedData: JSON.parse(doc.content), isValid: true, error: undefined };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { ...doc, parsedData: undefined, isValid: false, error: buildParseError(message, doc.content) };
  }
}

// 新建文档内容为空串 (tree 模式渲染内置欢迎屏)
export function createDocument(name: string | null, content = ""): JsonDocument {
  const now = Date.now();
  const doc: JsonDocument = {
    id: nextId(),
    name,
    content,
    isValid: false,
    isDirty: false,
    createdAt: now,
    updatedAt: now
  };
  return refreshParse(doc);
}

// 缩进取值: 正整数空格数或制表符 (Configuration > Indentation)
export type IndentValue = number | "\t";

function indentValue(indent: IndentValue): string | number {
  return indent === "\t" ? indent : indent;
}

// 格式化与压缩统一走 JSON.parse + stringify, 失败时抛出由调用方定位
export function formatJson(content: string, indent: IndentValue = 2): string {
  return JSON.stringify(JSON.parse(content), null, indentValue(indent));
}

export function minifyJson(content: string): string {
  return JSON.stringify(JSON.parse(content));
}

// 按 key 深度升序排序, 数组保持原始顺序
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item));
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.keys(source)
      .sort(compareKeysAscending)
      .reduce<Record<string, unknown>>((sorted, key) => {
        sorted[key] = sortKeysDeep(source[key]);
        return sorted;
      }, {});
  }
  return value;
}

function compareKeysAscending(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortJsonKeys(content: string, indent: IndentValue = 2): string {
  return JSON.stringify(sortKeysDeep(JSON.parse(content)), null, indentValue(indent));
}

// Smart format: 容器内条目全为基础值时保持单行 (不超过 maxLineLength), 其余展开缩进
export const SMART_FORMAT_DEFAULT_MAX_LINE_LENGTH = 80;

function isPrimitive(value: unknown): boolean {
  return value === null || typeof value !== "object";
}

function withinLineLength(text: string, maxLineLength: number): string | null {
  return text.length <= maxLineLength ? text : null;
}

function stringifySmart(value: unknown, depth: number, maxLineLength: number): string {
  const pad = "  ".repeat(depth);
  const padIn = "  ".repeat(depth + 1);
  if (isPrimitive(value)) {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    if (value.every(isPrimitive)) {
      const single = withinLineLength(JSON.stringify(value) ?? "[]", maxLineLength);
      if (single !== null) {
        return single;
      }
    }
    const items = value.map((item) => padIn + stringifySmart(item, depth + 1, maxLineLength));
    return `[\n${items.join(",\n")}\n${pad}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    return "{}";
  }
  if (entries.every(([, item]) => isPrimitive(item))) {
    const lines = entries.map(([key, item]) => `${JSON.stringify(key)}: ${JSON.stringify(item) ?? "null"}`);
    const single = withinLineLength(`{${lines.join(",")}}`, maxLineLength);
    if (single !== null) {
      return single;
    }
  }
  const items = entries.map(
    ([key, item]) => `${padIn}${JSON.stringify(key)}: ${stringifySmart(item, depth + 1, maxLineLength)}`
  );
  return `{\n${items.join(",\n")}\n${pad}}`;
}

export function smartFormatJson(content: string, maxLineLength = SMART_FORMAT_DEFAULT_MAX_LINE_LENGTH): string {
  return stringifySmart(JSON.parse(content), 0, maxLineLength);
}

// 自动命名: "New document N"
// 基于本地库文档列表取号; 插件无文档重开通道, New 会移除不再被引用的文档,
// 故以持久化的名称序列 (nameSequence) 取号, 保证移除文档后编号不回退
const NEW_DOCUMENT_NAME_PATTERN = /^New document (\d+)$/;

// 按序列生成下一个自动名称: sequence 为已分配的最大编号
export function newDocumentName(sequence: number): string {
  return `New document ${sequence + 1}`;
}

// 由现有文档名称推导名称序列初值 (旧快照缺少 nameSequence 字段时使用)
export function maxNewDocumentNumber(names: Array<string | null>): number {
  let max = 0;
  for (const name of names) {
    if (name === null) {
      continue;
    }
    const match = NEW_DOCUMENT_NAME_PATTERN.exec(name);
    if (match !== null) {
      const number = Number(match[1]);
      if (number > max) {
        max = number;
      }
    }
  }
  return max;
}
