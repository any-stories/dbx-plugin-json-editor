/**
 * Document properties 弹框
 *
 * 结构: table.properties (Name + Rename / 分隔线 / Schema + Configure / Updated / Size)
 * Name 行为 form 提交语义: 名称未变化时 Rename 按钮禁用, 成功后关闭弹框
 */

import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { GlassButton } from "@zakisheriff/liquid-glass";
import { Modal } from "./Modal";
import { useT } from "../i18n/useT";
import { describeSchema, type SchemaConfig } from "../core/schema";
import type { JsonDocument } from "../core/document";

interface DocumentPropertiesModalProps {
  doc: JsonDocument;
  schemaConfig: SchemaConfig;
  /** Schema 解析失败原因: 非空时 Schema 行显示 Error 态 */
  schemaError: string | null;
  onRename: (name: string) => void;
  onConfigureSchema: () => void;
  onClose: () => void;
}

// 本地日期时间格式化为 YYYY-MM-DD HH:mm
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 字符数按体量单位展示
export function formatSize(length: number): string {
  if (length < 1000) {
    return `${length}`;
  }
  if (length < 1_000_000) {
    return `${(length / 1000).toFixed(2)} kB`;
  }
  return `${(length / 1_000_000).toFixed(2)} MB`;
}

export function DocumentPropertiesModal({
  doc,
  schemaConfig,
  schemaError,
  onRename,
  onConfigureSchema,
  onClose
}: DocumentPropertiesModalProps): ReactElement {
  const t = useT();
  // 名称按钮仅对已命名文档渲染, 此处 name 恒非空 (null 收敛为空串仅为类型完备)
  const currentName = doc.name ?? "";
  const [draftName, setDraftName] = useState(currentName);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // 弹框打开时聚焦名称输入并全选
  useEffect(() => {
    nameInputRef.current?.select();
  }, []);

  const rename = () => {
    if (draftName !== currentName) {
      onRename(draftName);
    }
    onClose();
  };

  // 提交语义不依赖 <form> 的 submit 事件: 插件 UI 所在的 sandbox iframe 通常没有
  // allow-forms, 浏览器会在派发 submit 之前就中止表单提交, 导致 React 的 onSubmit
  // 永不触发 (表现为"点重命名没反应", 网页调试因无 sandbox 所以正常). 改为按钮
  // onClick + 输入框 Enter 键显式触发, 不经过任何表单提交路径.
  const onNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      rename();
    }
  };

  const schema = describeSchema(schemaConfig, schemaError);

  return (
    <Modal title={t("properties.heading")} variant="document-properties" closeOnBackdrop onClose={onClose}>
      <table className="properties">
        <tbody>
          <tr>
            <th>{t("properties.name")}</th>
            <td>
              <div className="document-name">
                <input
                  ref={nameInputRef}
                  type="text"
                  className="regular"
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onKeyDown={onNameKeyDown}
                />
                <GlassButton size="sm" variant="filled" onClick={rename} disabled={currentName === draftName}>
                  {t("properties.rename")}
                </GlassButton>
              </div>
            </td>
          </tr>
          <tr>
            <td className="space" colSpan={2}>
              <div className="line" />
            </td>
          </tr>
          <tr>
            <th title={t("properties.schema")}>{t("properties.schemaLabel")}</th>
            <td>
              <div className="schema-container">
                <div className={`schema-description${schema.isError ? " error" : ""}`} title={schema.title}>
                  {schema.description}
                </div>
                <GlassButton
                  size="sm"
                  variant="glass"
                  onClick={onConfigureSchema}
                  title={t("properties.configureSchemaTitle")}
                >
                  {t("properties.configure")}
                </GlassButton>
              </div>
            </td>
          </tr>
          <tr>
            <th>{t("properties.updated")}</th>
            <td>{formatTimestamp(doc.updatedAt)}</td>
          </tr>
          <tr>
            <th>{t("properties.size")}</th>
            <td>{formatSize(doc.content.length)}</td>
          </tr>
        </tbody>
      </table>
    </Modal>
  );
}
