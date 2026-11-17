/**
 * JSON Schema 弹框
 */

import { useMemo, useRef, useState, type ReactElement } from "react";
import { GlassButton, GlassSegmented } from "@zakisheriff/liquid-glass";
import { Modal } from "./Modal";
import { JsonEditor, type JsonEditorHandle } from "./JsonEditor";
import { ModalEditorBar } from "./ModalEditorBar";
import { useT } from "../i18n/useT";
import { getParser } from "../core/parser";
import type { SchemaConfig } from "../core/schema";
import { compileSchemaError, NONE_SCHEMA } from "../core/schema";
import type { JSONSchema } from "vanilla-jsoneditor";
import type { PaneKey } from "../core/workspace";
import type { EditorConfig } from "../core/editorConfig";
import type { ViewMode } from "../core/document";

type SchemaConfigDraft = SchemaConfig;

// 示例 Schema
const EXAMPLE_SCHEMA = `{
  "type": "object",
  "title": "Example Schema",
  "properties": {
    "timestamp": {
      "type": "integer",
      "minimum": 0,
      "description": "Millisecond timestamp",
      "examples": [1794454741287]
    },
    "email": {
      "type": "string",
      "pattern": "^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\\\.[A-Za-z]{2,}$",
      "description": "Email address",
      "examples": ["halo@example.com"]
    },
    "color": {
      "type": "string",
      "examples": ["#7c6cf0"]
    },
    "boolean": {
      "type": "boolean"
    },
    "language": {
      "type": "string",
      "enum": ["en-US", "en-GB", "zh-CN", "ja-JP", "ko-KR", "fr-FR"],
      "examples": ["en-US"]
    }
  },
  "required": ["language"]
}`;

interface JsonSchemaModalProps {
  /** 当前配置的所属面板 */
  pane: PaneKey;
  initialSchema: SchemaConfig;
  /** 另一侧面板文档内容 (panel 类型预览与解析) */
  otherPanelContent: string;
  /** 另一侧面板名称 */
  otherPanelLabel: string;
  config: EditorConfig;
  dark: boolean;
  onOk: (schema: SchemaConfig) => void;
  onClose: () => void;
}

export function JsonSchemaModal({
  pane,
  initialSchema,
  otherPanelContent,
  otherPanelLabel,
  config,
  dark,
  onOk,
  onClose
}: JsonSchemaModalProps): ReactElement {
  const t = useT();
  // 内嵌类型默认填入示例 Schema (仅当原本为空 / 占位 {} 时), 否则保留用户已有内容
  const [draft, setDraft] = useState<SchemaConfigDraft>(() =>
    initialSchema.type === "content" && (initialSchema.content.trim() === "" || initialSchema.content.trim() === "{}")
      ? { type: "content", content: EXAMPLE_SCHEMA }
      : initialSchema
  );
  // 一键把示例 Schema 写回编辑器: 始终是覆盖, 方便用户随时参考格式
  const insertExample = () => setDraft({ type: "content", content: EXAMPLE_SCHEMA });
  // 内嵌 Schema 编辑器的视图模式 (原生菜单条的模式组已隐藏, 由分段控件接管)
  const [contentMode, setContentMode] = useState<ViewMode>("text");
  // 内嵌 Schema 编辑器的原生菜单按钮委托入口
  const contentEditorRef = useRef<JsonEditorHandle>(null);

  // 配置页 validation: 不只查 JSON 语法, 还用编辑器同款 Ajv 试编译, 提前拦下会导致
  // 运行时崩溃的非法 Schema (type 非法 / $ref 无法解析 ...). 未知 format 走降级
  // warn, 不算错误. 对 panel 类型, Schema 来自对面面板内容, 同样校验.
  const schemaCheck = useMemo<{ valid: boolean; error: string | null }>(() => {
    const text = draft.type === "content" ? draft.content : draft.type === "panel" ? otherPanelContent : null;
    if (text === null) {
      return { valid: true, error: null };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { valid: false, error: t("schema.notObject") };
    }
    const compileError = compileSchemaError(parsed as JSONSchema);
    return { valid: compileError === null, error: compileError };
  }, [draft, otherPanelContent, t]);
  const schemaValid = schemaCheck.valid;

  const apply = () => {
    onOk(draft);
    onClose();
  };

  return (
    <Modal title={t("schema.heading")} variant="schema" onClose={onClose}>
      <p>{t("schema.forPanel", { panel: t(pane === "left" ? "schema.leftPanel" : "schema.rightPanel") })}</p>
      <div className="contents">
        {/* .toggle 三选一按钮组, 换成库的 GlassSegmented (与工具栏视图切换同组件) */}
        <GlassSegmented
          size="sm"
          options={[t("schema.typeNone"), t("schema.typePanel"), t("schema.typeContent")]}
          value={draft.type === "none" ? 0 : draft.type === "panel" ? 1 : 2}
          onChange={(index) => {
            if (index === 0) {
              setDraft(NONE_SCHEMA);
            } else if (index === 1) {
              setDraft({ type: "panel", panelId: pane === "left" ? "right" : "left" });
            } else {
              // 切到内嵌类型: 仅在尚无内容 (空 / 占位 {}) 时预填示例, 避免冲掉用户已写的内容
              setDraft((prev) =>
                prev.type === "content" && prev.content.trim() !== "" && prev.content.trim() !== "{}"
                  ? prev
                  : { type: "content", content: EXAMPLE_SCHEMA }
              );
            }
          }}
          aria-label={t("schema.heading")}
        />

        {draft.type === "none" ? <div className="config">{t("schema.noneDescription")}</div> : null}

        {draft.type === "panel" ? (
          <div className="config">
            <p>{t("schema.panelDescription", { panel: otherPanelLabel })}</p>
            <p>{t("schema.preview")}</p>
            <div className="schema-panel-preview">
              <JsonEditor
                content={otherPanelContent}
                mode="tree"
                dark={dark}
                config={config}
                parser={getParser(config.parserId, otherPanelContent.length)}
                readOnly
                mainMenuBar={false}
                navigationBar={false}
                statusBar={false}
              />
            </div>
          </div>
        ) : null}

        {draft.type === "content" ? (
          <div className="config config-jsoneditor">
            <p>{t("schema.contentDescription")}</p>
            <p className="schema-example-hint">{t("schema.exampleHint")}</p>
            <div className="schema-example-row">
              <GlassButton size="sm" variant="glass" onClick={insertExample}>
                {t("schema.insertExample")}
              </GlassButton>
            </div>
            <div className="text-schema">
              {/* 模式分段控件与动作按钮嵌在编辑器顶栏内 (原生 jse 菜单条在弹窗内已隐藏) */}
              <ModalEditorBar
                mode={contentMode}
                onMode={setContentMode}
                onAction={(action) => contentEditorRef.current?.runMenuAction(action)}
              />
              <JsonEditor
                ref={contentEditorRef}
                content={draft.content}
                mode={contentMode}
                dark={dark}
                config={config}
                parser={getParser(config.parserId, draft.content.length)}
                onChange={(content) => setDraft({ type: "content", content })}
              />
            </div>
          </div>
        ) : null}

        {!schemaValid ? (
          <div className="error" title={schemaCheck.error ?? undefined}>
            {t("schema.invalidJson")}
            {schemaCheck.error ? <span className="schema-error-detail"> — {schemaCheck.error}</span> : null}
          </div>
        ) : null}
      </div>

      <div className="modal-action-menu">
        <GlassButton size="sm" variant="glass" onClick={onClose}>
          {t("schema.cancel")}
        </GlassButton>
        <GlassButton size="sm" variant="filled" disabled={!schemaValid} onClick={apply}>
          {t("schema.ok")}
        </GlassButton>
      </div>
    </Modal>
  );
}
