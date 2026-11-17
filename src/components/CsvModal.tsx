/**
 * CSV 通道弹框
 *
 * CSV Export: 文件名输入 + Options (Delimiter / Header / Flatten nested objects /
 * Flatten nested arrays) + 预览 (数组取前 100 条并追加省略号) + Copy to clipboard /
 * Save to disk / Close; JSON 解析失败时预览区展示错误文案
 * CSV Import: File (只读) + Options (Delimiter auto / Header / Nested objects) +
 * 预览编辑器 (默认 table 模式, 可切换; 源文本超限截断并提示) + Import / Close
 * 选项由 App 持久化到 host.storage (localStorage 键 csvExportOptions / csvImportOptions)
 */

import { useMemo, useState, type ReactElement } from "react";
import { GlassButton, GlassSwitch } from "@zakisheriff/liquid-glass";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
import { GlassMenu } from "./GlassMenu";
import { JsonEditor } from "./JsonEditor";
import { useT } from "../i18n/useT";
import { dbx } from "../host/DBXAdapter";
import { getParser } from "../core/parser";
import {
  csvFileNameToDocumentName,
  csvExportFileName,
  csvToJson,
  jsonToCsv,
  EXPORT_DELIMITERS,
  IMPORT_DELIMITERS,
  type CsvExportOptions,
  type CsvImportOptions
} from "../core/csv";
import {
  CSV_EXPORT_PREVIEW_RECORD_LIMIT,
  CSV_EXPORT_PREVIEW_SUFFIX,
  CSV_IMPORT_PREVIEW_CHAR_LIMIT,
  CSV_IMPORT_PREVIEW_SUFFIX
} from "../config/constants";
import type { EditorConfig } from "../core/editorConfig";

interface CsvExportModalProps {
  /** 导出文件名初值 (文档名, 不含 .csv) */
  fileName: string;
  /** 源 JSON 文本 */
  jsonText: string;
  options: CsvExportOptions;
  onOptionsChange: (options: CsvExportOptions) => void;
  /** 保存到磁盘 (文件名已补 .csv 后缀) */
  onSave: (fileName: string, csv: string) => void;
  /** 复制成功后弹出 toast (由 App 的 flashMessage 提供) */
  onNotify: (text: string) => void;
  onClose: () => void;
}

interface CsvImportModalProps {
  /** 源文件名 (含 .csv) */
  fileName: string;
  /** CSV 源文本 */
  csvText: string;
  options: CsvImportOptions;
  onOptionsChange: (options: CsvImportOptions) => void;
  /** 确认导入: 回传 JSON 文本与结果文档名 */
  onImport: (jsonText: string, documentName: string) => void;
  config: EditorConfig;
  dark: boolean;
  onClose: () => void;
}

// CSV Export 预览: JSON 解析失败时展示错误文案
export function CsvExportModal({
  fileName,
  jsonText,
  options,
  onOptionsChange,
  onSave,
  onNotify,
  onClose
}: CsvExportModalProps): ReactElement {
  const t = useT();
  const [name, setName] = useState(fileName);
  const [copied, setCopied] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const preview = useMemo<{ csv: string | null; truncated: boolean; error: string | null }>(() => {
    try {
      const parsed = JSON.parse(jsonText) as unknown;
      const truncated = Array.isArray(parsed) && parsed.length > CSV_EXPORT_PREVIEW_RECORD_LIMIT;
      const source = truncated ? parsed.slice(0, CSV_EXPORT_PREVIEW_RECORD_LIMIT) : parsed;
      return { csv: jsonToCsv(source, options) + (truncated ? CSV_EXPORT_PREVIEW_SUFFIX : ""), truncated, error: null };
    } catch {
      return { csv: null, truncated: false, error: "parse" };
    }
  }, [jsonText, options]);

  const fullCsv = useMemo(() => {
    try {
      return jsonToCsv(JSON.parse(jsonText) as unknown, options);
    } catch {
      return null;
    }
  }, [jsonText, options]);

  const copy = () => {
    if (fullCsv === null) {
      return;
    }
    void dbx.copyText(fullCsv).then((ok) => {
      if (ok) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
        onNotify(t("csv.copied"));
      } else {
        setOptionsError("clipboard");
      }
    });
  };

  const save = () => {
    if (fullCsv === null) {
      return;
    }
    onSave(csvExportFileName(name), fullCsv);
  };

  return (
    <Modal title={t("csv.exportTitle")} icon={<Icon name="table" />} variant="csv-export" onClose={onClose}>
      <div className="modal-contents">
        <div className="modal-text">{t("csv.enterFileName")}</div>
        <input type="text" className="regular" value={name} onChange={(event) => setName(event.target.value)} />
        <div className="modal-text">
          {t("csv.options")}
          <label className="delimiter-row" title={t("csv.delimiterTitle")}>
            {t("csv.delimiter")}{" "}
            {/* 原生 select 换成 GlassMenu 选择器: 触发器显示当前值, 项带对勾 (与查询语言选择器同组件) */}
            <GlassMenu
              trigger={
                <>
                  {EXPORT_DELIMITERS.find((item) => item.value === options.delimiter)?.label ?? options.delimiter}{" "}
                  <Icon name="caretDown" />
                </>
              }
              triggerClassName="modal-select"
              ariaLabel={t("csv.delimiter")}
              align="start"
              entries={EXPORT_DELIMITERS.map((item) => ({
                key: item.value,
                label: item.label,
                checked: options.delimiter === item.value,
                onSelect: () => onOptionsChange({ ...options, delimiter: item.value as CsvExportOptions["delimiter"] })
              }))}
            />
          </label>
          <label className="switch-row" title={t("csv.headerExportTitle")}>
            <GlassSwitch
              checked={options.header}
              onChange={(checked) => onOptionsChange({ ...options, header: checked })}
              aria-label={t("csv.header")}
            />{" "}
            {t("csv.header")}
          </label>
          <label className="switch-row" title={t("csv.flattenObjectTitle")}>
            <GlassSwitch
              checked={options.flattenObject}
              onChange={(checked) => onOptionsChange({ ...options, flattenObject: checked })}
              aria-label={t("csv.flattenObjects")}
            />{" "}
            {t("csv.flattenObjects")}
          </label>
          <label
            className={options.flattenObject ? "switch-row" : "switch-row disabled"}
            title={t("csv.flattenArrayTitle")}
          >
            <GlassSwitch
              disabled={!options.flattenObject}
              checked={options.flattenArray}
              onChange={(checked) => onOptionsChange({ ...options, flattenArray: checked })}
              aria-label={t("csv.flattenArrays")}
            />{" "}
            {t("csv.flattenArrays")}
          </label>
        </div>
        <div className={`preview-area${preview.error !== null ? " error" : ""}`}>
          <textarea
            readOnly
            wrap={preview.error !== null ? "" : "off"}
            className={`regular csv-preview${preview.error !== null ? " error" : ""}`}
            value={preview.error !== null ? t("csv.exportParseError") : (preview.csv ?? "")}
          />
          {preview.truncated ? (
            <div className="truncated-overlay">
              <div className="truncated">
                <Icon name="warning" /> {t("csv.previewTruncated")}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="modal-action-menu">
        <GlassButton size="sm" variant="glass" disabled={fullCsv === null} onClick={copy} title={t("csv.copyTitle")}>
          {copied ? t("csv.copied") : t("csv.copy")}
        </GlassButton>
        <GlassButton size="sm" variant="filled" icon={<Icon name="save" />} disabled={fullCsv === null} onClick={save}>
          {t("csv.saveToDisk")}
        </GlassButton>
        <GlassButton size="sm" variant="glass" onClick={onClose}>
          {t("csv.close")}
        </GlassButton>
        {optionsError !== null ? <span className="error">{t("csv.copyFailed")}</span> : null}
      </div>
    </Modal>
  );
}

// CSV Import 预览: table 模式编辑器, 源文本超限时截断
export function CsvImportModal({
  fileName,
  csvText,
  options,
  onOptionsChange,
  onImport,
  config,
  dark,
  onClose
}: CsvImportModalProps): ReactElement {
  const t = useT();
  const truncatedText =
    csvText.length > CSV_IMPORT_PREVIEW_CHAR_LIMIT
      ? csvText.slice(0, CSV_IMPORT_PREVIEW_CHAR_LIMIT) + CSV_IMPORT_PREVIEW_SUFFIX
      : csvText;
  const truncated = truncatedText !== csvText;

  const parsed = useMemo<{ json: unknown; error: string | null }>(() => {
    try {
      return { json: csvToJson(truncatedText, options), error: null };
    } catch (cause) {
      return { json: undefined, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [truncatedText, options]);

  const importAll = () => {
    try {
      const json = csvToJson(csvText, options);
      onImport(JSON.stringify(json, null, 2), csvFileNameToDocumentName(fileName));
    } catch {
      // 全量转换失败时保持弹框开启, 预览区已展示解析错误
    }
  };

  // 预览文本按配置缩进序列化; 解析器与主编辑器同一档 (auto 按内容长度选择)
  const previewContent =
    parsed.json === undefined
      ? ""
      : JSON.stringify(parsed.json, null, config.indentation === "\t" ? 4 : config.indentation);

  return (
    <Modal title={t("csv.importTitle")} icon={<Icon name="table" />} variant="csv-import" onClose={onClose}>
      <div className="modal-contents">
        <div className="modal-text">{t("csv.file")}</div>
        <input type="text" readOnly disabled className="regular" value={fileName} />
        <div className="modal-text">
          {t("csv.options")}
          <label className="delimiter-row" title={t("csv.delimiterTitle")}>
            {t("csv.delimiter")}{" "}
            <GlassMenu
              trigger={
                <>
                  {IMPORT_DELIMITERS.find((item) => item.value === options.delimiter)?.label ?? options.delimiter}{" "}
                  <Icon name="caretDown" />
                </>
              }
              triggerClassName="modal-select"
              ariaLabel={t("csv.delimiter")}
              align="start"
              entries={IMPORT_DELIMITERS.map((item) => ({
                key: item.value,
                label: item.label,
                checked: options.delimiter === item.value,
                onSelect: () => onOptionsChange({ ...options, delimiter: item.value as CsvImportOptions["delimiter"] })
              }))}
            />
          </label>
          <label className="switch-row" title={t("csv.headerImportTitle")}>
            <GlassSwitch
              checked={options.header}
              onChange={(checked) => onOptionsChange({ ...options, header: checked })}
              aria-label={t("csv.header")}
            />{" "}
            {t("csv.header")}
          </label>
          <label className="switch-row" title={t("csv.nestedTitle")}>
            <GlassSwitch
              checked={options.nested}
              onChange={(checked) => onOptionsChange({ ...options, nested: checked })}
              aria-label={t("csv.nestedObjects")}
            />{" "}
            {t("csv.nestedObjects")}
          </label>
        </div>
        {parsed.error !== null ? <div className="error">{parsed.error}</div> : null}
        <div className="preview-area csv-import">
          {parsed.json !== undefined && parsed.error === null ? (
            <JsonEditor
              key={JSON.stringify(options)}
              content={previewContent}
              mode="table"
              dark={dark}
              config={config}
              parser={getParser(config.parserId, previewContent.length)}
              readOnly
            />
          ) : null}
          {parsed.error !== null ? <textarea readOnly className="regular csv-preview" value={truncatedText} /> : null}
          {truncated && parsed.error === null ? (
            <div className="truncated-overlay">
              <div className="truncated">
                <Icon name="warning" /> {t("csv.previewTruncated")}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="modal-action-menu">
        <GlassButton size="sm" variant="filled" disabled={parsed.error !== null} onClick={importAll}>
          {t("csv.import")}
        </GlassButton>
        <GlassButton size="sm" variant="glass" onClick={onClose}>
          {t("csv.close")}
        </GlassButton>
      </div>
    </Modal>
  );
}
