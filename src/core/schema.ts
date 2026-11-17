/**
 * 文档 JSON Schema 配置模型
 */

import type { JSONSchema } from "vanilla-jsoneditor";
import { validateSchemaStructure } from "./schemaValidator";
import type { PaneKey } from "./workspace";

/** 试校验一个 Schema 的结构, 返回 null 表示可用, 否则返回人类可读的错误信息.
 *
 *  纯 JS 结构校验 (不依赖 Ajv 的 new Function): 插件宿主 iframe 的 CSP 禁止
 *  unsafe-eval, Ajv.compile 会直接抛 CSP 错误, 因此配置页校验与运行时校验均使用
 *  core/schemaValidator 的解释执行实现, 网页与插件行为一致.
 *  - 未知的 format (email/date-time/...) 一律忽略, Schema 仍可用 (与旧 strictSchema:false
 *    的降级策略一致, 不产生告警噪音).
 *  - 结构性错误 (type 非法 / required 非数组 / 正则非法 / $ref 无法解析 ...) 在这里拦下
 *    变成 error, 不让有问题的 Schema 进入编辑器.
 */
export function compileSchemaError(schema: JSONSchema): string | null {
  return validateSchemaStructure(schema);
}

export type SchemaConfig =
  { type: "none" } | { type: "panel"; panelId: PaneKey } | { type: "content"; content: string };

export const NONE_SCHEMA: SchemaConfig = { type: "none" };

export function isSchemaConfig(value: unknown): value is SchemaConfig {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const config = value as Partial<SchemaConfig>;
  if (config.type === "none") {
    return true;
  }
  if (config.type === "panel") {
    return config.panelId === "left" || config.panelId === "right";
  }
  if (config.type === "content") {
    return typeof config.content === "string";
  }
  return false;
}

// 解析结果: schema 为 null 且 error 非 null 表示已配置 Schema 但无法解析,
// 编辑器此时回退为不校验, UI 侧以 Error 态提示, 不把 Schema 故障误报成文档内容不合规
export interface ResolvedSchema {
  schema: JSONSchema | null;
  error: string | null;
}

// Document properties 弹框中的 Schema 描述文案, 解析失败时进入 Error 态
export function describeSchema(
  config: SchemaConfig,
  error: string | null = null
): { description: string; title: string; isError: boolean } {
  if (error !== null) {
    return { description: "Error", title: `Failed to load JSON Schema: ${error}`, isError: true };
  }
  switch (config.type) {
    case "none":
      return { description: "None", title: "No JSON Schema selected", isError: false };
    case "panel": {
      const panel = config.panelId === "left" ? "Left panel" : "Right panel";
      return { description: `${panel} contents`, title: "Panel contents used as JSON Schema", isError: false };
    }
    case "content":
      return { description: "Embedded schema", title: "Embedded JSON Schema", isError: false };
  }
}

// 将 Schema 配置解析为编辑器可用的 JSON Schema 对象
// panel 类型恒取另一侧面板内容 (弹框只允许选择对面, 禁止面板自身作为 Schema);
// 未配置返回空结果, 解析失败返回 error 供 UI 提示
export function resolveSchema(config: SchemaConfig | undefined, otherPanelContent: string): ResolvedSchema {
  if (config === undefined || config.type === "none") {
    return { schema: null, error: null };
  }
  const text = config.type === "content" ? config.content : otherPanelContent;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { schema: null, error: error instanceof Error ? error.message : String(error) };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { schema: null, error: "JSON Schema must be an object" };
  }
  // 非法的 Schema 在这里的结构校验就被拦下, 不交给编辑器 (旧 Ajv 路径会因 CSP
  // unsafe-eval 抛错). 降级为 error 态: schema=null 让编辑器不校验,
  // UI 侧 describeSchema 显示 "Failed to load JSON Schema: ...", 不影响文档编辑.
  const schema = parsed as JSONSchema;
  const compileError = compileSchemaError(schema);
  if (compileError !== null) {
    return { schema: null, error: compileError };
  }
  return { schema, error: null };
}
