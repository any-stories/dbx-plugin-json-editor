/**
 * 编辑器配置模型
 *
 * useConfig 默认值
 * 字段: fontSize / indentation / tabSize / maxLineLength /
 * escapeControlCharacters / escapeUnicodeCharacters / flattenColumns / parserId
 * indentation 取正整数空格数或制表符 "\t"
 * fontSize 取正整数字符串, 可带 px / pt 后缀 (useConfig 校验范围 10-99)
 * parserId 决定编辑器使用的 JSON 解析器: auto 按文档体量在 lossless 与 native 间自动选择
 */

export type ParserId = "auto" | "native" | "lossless";

// 制表符缩进取值 (字符串 "\t"), 空格缩进为正整数空格数
export type IndentValue = number | "\t";

export interface EditorConfig {
  fontSize: string;
  indentation: IndentValue;
  tabSize: number;
  maxLineLength: number;
  escapeControlCharacters: boolean;
  escapeUnicodeCharacters: boolean;
  flattenColumns: boolean;
  parserId: ParserId;
}

// useConfig 默认值
export const DEFAULT_EDITOR_CONFIG: EditorConfig = {
  fontSize: "14px",
  indentation: 2,
  tabSize: 4,
  maxLineLength: 80,
  escapeControlCharacters: false,
  escapeUnicodeCharacters: false,
  flattenColumns: true,
  parserId: "lossless"
};

// Configuration 弹框校验文案
export const FONT_SIZE_ERROR_MESSAGE =
  'Error: invalid font size. Must be an integer number between 10 and 99 with an optional suffix "px" or "pt".';
export const POSITIVE_INTEGER_ERROR_MESSAGE = "Error: value must be a positive integer number";

const FONT_SIZE_PATTERN = /^(\d+)(px|pt)?$/;

// 正整数校验: NaN / 非有限 / 非整数 / 非正数均不合法
export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && !isNaN(value) && isFinite(value) && value > 0 && Math.round(value) === value;
}

// 字号解析: 返回 10-99 的整数, 不合法返回 null
export function parseFontSize(value: string): number | null {
  const match = FONT_SIZE_PATTERN.exec(value.trim());
  if (match === null) {
    return null;
  }
  const size = Number(match[1]);
  if (!isPositiveInteger(size) || size < 10 || size > 99) {
    return null;
  }
  return size;
}

// 缩进值解析: 空格数取正整数, 不合法返回 null
export function parseIndentation(value: string): number | null {
  const parsed = Number(value);
  return isPositiveInteger(parsed) ? parsed : null;
}

// 配置校验结果: 字段到错误文案的映射
export interface ConfigValidationErrors {
  fontSize?: string;
  indentation?: string;
  maxLineLength?: string;
}

export function validateEditorConfig(config: EditorConfig): ConfigValidationErrors | null {
  const errors: ConfigValidationErrors = {};
  if (parseFontSize(config.fontSize) === null) {
    errors.fontSize = FONT_SIZE_ERROR_MESSAGE;
  }
  if (config.indentation !== "\t" && !isPositiveInteger(config.indentation)) {
    errors.indentation = POSITIVE_INTEGER_ERROR_MESSAGE;
  }
  if (!isPositiveInteger(config.maxLineLength)) {
    errors.maxLineLength = POSITIVE_INTEGER_ERROR_MESSAGE;
  }
  return Object.keys(errors).some((key) => errors[key as keyof ConfigValidationErrors] !== undefined) ? errors : null;
}

function isParserId(value: unknown): value is ParserId {
  return value === "auto" || value === "native" || value === "lossless";
}

// 快照反序列化的结构校验: 任一字段不合法即回退默认值
export function isEditorConfig(value: unknown): value is EditorConfig {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const config = value as Partial<EditorConfig>;
  return (
    parseFontSize(String(config.fontSize)) !== null &&
    (config.indentation === "\t" || isPositiveInteger(config.indentation)) &&
    isPositiveInteger(config.tabSize) &&
    isPositiveInteger(config.maxLineLength) &&
    typeof config.escapeControlCharacters === "boolean" &&
    typeof config.escapeUnicodeCharacters === "boolean" &&
    typeof config.flattenColumns === "boolean" &&
    isParserId(config.parserId)
  );
}
