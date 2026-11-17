/**
 * Settings > Configuration 弹框
 */

import { useEffect, useRef, useState, type ReactElement } from "react";
import { GlassButton, GlassSegmented, GlassSwitch } from "@zakisheriff/liquid-glass";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
import { GlassMenu } from "./GlassMenu";
import { JsonEditor, type JsonEditorHandle } from "./JsonEditor";
import { ModalEditorBar } from "./ModalEditorBar";
import { useT } from "../i18n/useT";
import { CONFIG_PREVIEW_TABLE_CONTENT, CONFIG_PREVIEW_TEXT_CONTENT } from "../config/constants";
import {
  FONT_SIZE_ERROR_MESSAGE,
  POSITIVE_INTEGER_ERROR_MESSAGE,
  isPositiveInteger,
  parseFontSize,
  type ConfigValidationErrors,
  type EditorConfig,
  type IndentValue,
  type ParserId
} from "../core/editorConfig";
import { getParser } from "../core/parser";
import { smartFormatJson, type ViewMode } from "../core/document";

interface ConfigurationModalProps {
  config: EditorConfig;
  dark: boolean;
  /** 应用配置并关闭弹框 */
  onApply: (config: EditorConfig) => void;
  /** 保存配置并重载页面 */
  onApplyAndReload: (config: EditorConfig) => void;
  onCancel: () => void;
}

const PARSER_OPTIONS: ParserId[] = ["auto", "native", "lossless"];
// 智能格式预览使用 50 项顺序数组
const SMART_PREVIEW_ITEMS = Array.from({ length: 50 }, (_, index) => index);

export function ConfigurationModal({
  config,
  dark,
  onApply,
  onApplyAndReload,
  onCancel
}: ConfigurationModalProps): ReactElement {
  const t = useT();
  // 草稿态: 应用前不改动当前编辑器
  const [fontSizeInput, setFontSizeInput] = useState(config.fontSize);
  const [indentIsTab, setIndentIsTab] = useState(config.indentation === "\t");
  const [indentInput, setIndentInput] = useState(
    config.indentation === "\t" ? String(config.tabSize) : String(config.indentation)
  );
  const [maxLineLengthInput, setMaxLineLengthInput] = useState(String(config.maxLineLength));
  const [escapeControl, setEscapeControl] = useState(config.escapeControlCharacters);
  const [escapeUnicode, setEscapeUnicode] = useState(config.escapeUnicodeCharacters);
  const [flattenColumns, setFlattenColumns] = useState(config.flattenColumns);
  const [parserId, setParserId] = useState<ParserId>(config.parserId);
  // 校验错误仅在提交后展示
  const [submitted, setSubmitted] = useState(false);
  // 预览: tree 模式起步, 内容为文本示例; 后续模式由编辑器内置下拉切换
  const [previewMode, setPreviewMode] = useState<ViewMode>("tree");
  const [previewContent, setPreviewContent] = useState(CONFIG_PREVIEW_TEXT_CONTENT);
  const fontSizeInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  // 预览卡片的原生菜单按钮委托入口 (顶栏动作与主工具栏同语义)
  const previewEditorRef = useRef<JsonEditorHandle>(null);

  // 弹框打开时聚焦字号输入并全选
  useEffect(() => {
    fontSizeInputRef.current?.select();
  }, []);

  // 字号输入合法时即时刷新预览字号 (非法时沿用原配置)
  useEffect(() => {
    if (previewRef.current === null || parseFontSize(fontSizeInput) === null) {
      return;
    }
    previewRef.current.style.setProperty("--jse-font-size-mono", fontSizeInput.trim());
  }, [fontSizeInput]);

  // 制表符取 "\t", 否则取输入的空格数; 非法输入沿用原配置
  const indentation: IndentValue = indentIsTab
    ? "\t"
    : isPositiveInteger(Number(indentInput))
      ? Number(indentInput)
      : config.indentation === "\t"
        ? 2
        : config.indentation;
  const draft: EditorConfig = {
    fontSize: parseFontSize(fontSizeInput) !== null ? fontSizeInput.trim() : config.fontSize,
    indentation,
    tabSize: isPositiveInteger(Number(indentInput)) ? Number(indentInput) : config.tabSize,
    maxLineLength: isPositiveInteger(Number(maxLineLengthInput)) ? Number(maxLineLengthInput) : config.maxLineLength,
    escapeControlCharacters: escapeControl,
    escapeUnicodeCharacters: escapeUnicode,
    flattenColumns,
    parserId
  };

  // 字号 10-99 (可带 px/pt 后缀), 缩进与行宽为正整数
  // 校验结果始终参与提交判定, 错误文案仅在提交后展示
  const validation = {
    fontSize: parseFontSize(fontSizeInput) === null ? FONT_SIZE_ERROR_MESSAGE : undefined,
    indentation: isPositiveInteger(Number(indentInput)) ? undefined : POSITIVE_INTEGER_ERROR_MESSAGE,
    maxLineLength: isPositiveInteger(Number(maxLineLengthInput)) ? undefined : POSITIVE_INTEGER_ERROR_MESSAGE
  };
  const hasErrors =
    validation.fontSize !== undefined || validation.indentation !== undefined || validation.maxLineLength !== undefined;
  const errors: ConfigValidationErrors = submitted ? validation : {};

  // 表格模式示例内容按当前缩进序列化
  const tableContent = () => JSON.stringify(CONFIG_PREVIEW_TABLE_CONTENT.json, null, indentation);

  // 切换预览模式并把内容重置为该模式的示例
  const showMode = (mode: ViewMode) => {
    setPreviewMode(mode);
    setPreviewContent(mode === "table" ? tableContent() : CONFIG_PREVIEW_TEXT_CONTENT);
  };

  // 按新缩进重排当前预览内容 (非 JSON 内容保持不变)
  const reindentPreview = (useTab: boolean, indentRaw: string) => {
    const nextIndent: IndentValue = useTab
      ? "\t"
      : isPositiveInteger(Number(indentRaw))
        ? Number(indentRaw)
        : indentation;
    setPreviewContent((current) => {
      try {
        return JSON.stringify(JSON.parse(current), null, nextIndent);
      } catch {
        return current;
      }
    });
  };

  const changeIndentType = (useTab: boolean) => {
    setIndentIsTab(useTab);
    setPreviewMode("text");
    reindentPreview(useTab, indentInput);
  };

  const changeIndentValue = (value: string) => {
    setIndentInput(value);
    setPreviewMode("text");
    reindentPreview(indentIsTab, value);
  };

  // 行宽变更后以 50 项数组生成智能格式预览
  const changeMaxLineLength = (value: string) => {
    setMaxLineLengthInput(value);
    setPreviewMode("text");
    const limit = Number(value);
    if (!isPositiveInteger(limit)) {
      return;
    }
    try {
      setPreviewContent(smartFormatJson(JSON.stringify(SMART_PREVIEW_ITEMS), limit));
    } catch {
      // 内容生成失败时保留当前预览
    }
  };

  // 转义 Unicode 变更; 表格模式先退回 tree 模式再展示文本示例
  const changeEscapeUnicode = (checked: boolean) => {
    setEscapeUnicode(checked);
    if (previewMode === "table") {
      showMode("tree");
      return;
    }
    setPreviewContent(CONFIG_PREVIEW_TEXT_CONTENT);
  };

  const submit = () => {
    setSubmitted(true);
    if (hasErrors) {
      return;
    }
    onApply(draft);
  };

  const saveAndReload = () => {
    setSubmitted(true);
    if (hasErrors) {
      return;
    }
    onApplyAndReload(draft);
  };

  return (
    <Modal title={t("config.title")} variant="configuration" onClose={onCancel}>
      <div className="columns">
        <div className="column left">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <h2>{t("config.fontSize")}</h2>
            <div className="modal-text">
              {t("config.fontSizeDescriptionPrefix")} <code>"14px"</code> {t("config.fontSizeDescriptionMiddle")}{" "}
              <code>"12pt"</code>.
            </div>
            <table>
              <tbody>
                <tr>
                  <td>{t("config.fontSizeLabel")}</td>
                  <td>
                    <input
                      ref={fontSizeInputRef}
                      type="text"
                      className={`fontSize regular${errors.fontSize !== undefined ? " error" : ""}`}
                      value={fontSizeInput}
                      onChange={(event) => setFontSizeInput(event.target.value)}
                    />
                  </td>
                </tr>
              </tbody>
            </table>
            {errors.fontSize !== undefined ? <div className="error-message">{errors.fontSize}</div> : null}

            <h2>{t("config.indentation")}</h2>
            <div className="modal-text">{t("config.indentationDescription")}</div>
            <table>
              <tbody>
                <tr>
                  <td>{t("config.indentationType")}</td>
                  <td className="indentation-types">
                    {/* 单选组, GlassSegmented */}
                    <GlassSegmented
                      size="sm"
                      options={[t("config.indentationSpaces"), t("config.indentationTabs")]}
                      value={indentIsTab ? 1 : 0}
                      onChange={(index) => changeIndentType(index === 1)}
                      aria-label={t("config.indentationType")}
                    />
                  </td>
                </tr>
                <tr>
                  <td>{indentIsTab ? t("config.tabSizeLabel") : t("config.spacesCountLabel")}</td>
                  <td>
                    <input
                      type="text"
                      className={`indentation regular${errors.indentation !== undefined ? " error" : ""}`}
                      value={indentInput}
                      onChange={(event) => changeIndentValue(event.target.value)}
                    />
                  </td>
                </tr>
                {errors.indentation !== undefined ? (
                  <tr className="error-message">
                    <td colSpan={2}>{errors.indentation}</td>
                  </tr>
                ) : null}
                <tr>
                  <td>
                    {t("config.maxLineLengthLabel")}
                    <div className="explanation" title={t("config.maxLineLengthTitle")}>
                      <Icon name="info" />
                    </div>
                  </td>
                  <td>
                    <input
                      type="text"
                      name="maxLineLength"
                      className={`max-line-length regular${errors.maxLineLength !== undefined ? " error" : ""}`}
                      value={maxLineLengthInput}
                      onChange={(event) => changeMaxLineLength(event.target.value)}
                    />
                  </td>
                </tr>
                {errors.maxLineLength !== undefined ? (
                  <tr className="error-message">
                    <td colSpan={2}>{errors.maxLineLength}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>

            <h2>{t("config.escapeCharacters")}</h2>
            <table>
              <tbody>
                <tr>
                  <td>
                    <label className="switch-row">
                      <GlassSwitch
                        checked={escapeControl}
                        onChange={(checked) => {
                          setEscapeControl(checked);
                          showMode("tree");
                        }}
                        aria-label={`${t("config.escapeControlPrefix")} "\\n" ${t("config.escapeControlAndTab")} "\\t"`}
                      />{" "}
                      {t("config.escapeControlPrefix")} <code>"\n"</code> {t("config.escapeControlAndTab")}{" "}
                      <code>"\t"</code>{" "}
                      <div className="explanation" title={t("config.escapeControlTitle")}>
                        <Icon name="info" />
                      </div>
                    </label>
                  </td>
                </tr>
                <tr>
                  <td>
                    <label className="switch-row">
                      <GlassSwitch
                        checked={escapeUnicode}
                        onChange={(checked) => changeEscapeUnicode(checked)}
                        aria-label={t("config.escapeUnicodeLabel")}
                      />{" "}
                      {t("config.escapeUnicodeLabel")}
                    </label>
                  </td>
                </tr>
              </tbody>
            </table>

            <h2>{t("config.tableView")}</h2>
            <label className="switch-row">
              <GlassSwitch
                checked={flattenColumns}
                onChange={(checked) => {
                  setFlattenColumns(checked);
                  showMode("table");
                }}
                aria-label={t("config.flattenColumns")}
              />{" "}
              {t("config.flattenColumns")}
            </label>

            <h2>{t("config.parser")}</h2>
            <div className="modal-text">{t("config.parserDescription")}</div>
            <GlassMenu
              trigger={
                <>
                  {t(`config.parser_${parserId}`)} <Icon name="caretDown" />
                </>
              }
              triggerClassName="modal-select"
              triggerTitle={t(`config.parser_${parserId}Title`)}
              ariaLabel={t("config.parser")}
              align="start"
              entries={PARSER_OPTIONS.map((option) => ({
                key: option,
                label: t(`config.parser_${option}`),
                title: t(`config.parser_${option}Title`),
                checked: parserId === option,
                onSelect: () => {
                  setParserId(option);
                  showMode("tree");
                }
              }))}
            />
            {parserId !== config.parserId ? (
              <div className="reload-warning">
                <div className="reload-message">{t("config.reloadMessage")}</div>
                <div>
                  <GlassButton size="sm" variant="filled" onClick={saveAndReload}>
                    {t("config.reloadNow")}
                  </GlassButton>
                </div>
              </div>
            ) : null}
          </form>
        </div>

        <div className="column right">
          <h2>{t("config.preview")}</h2>
          <div className="preview-container" ref={previewRef}>
            {/* 模式分段控件与动作按钮嵌在预览卡片顶栏内 (原生 jse 菜单条在弹窗内已隐藏) */}
            <ModalEditorBar
              mode={previewMode}
              onMode={showMode}
              onAction={(action) => previewEditorRef.current?.runMenuAction(action)}
            />
            <JsonEditor
              ref={previewEditorRef}
              content={previewContent}
              mode={previewMode}
              dark={dark}
              config={draft}
              parser={getParser(parserId, previewContent.length)}
              onChange={(content) => setPreviewContent(content)}
              onModeChange={(mode) => setPreviewMode(mode)}
            />
          </div>
        </div>
      </div>

      <div className="modal-action-menu">
        <GlassButton size="sm" variant="glass" onClick={onCancel}>
          {t("config.cancel")}
        </GlassButton>
        <GlassButton size="sm" variant="filled" onClick={submit}>
          {t("config.ok")}
        </GlassButton>
      </div>
    </Modal>
  );
}
