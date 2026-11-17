/**
 * 面板菜单
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { GlassButton, GlassMenu, type GlassMenuItem } from "@zakisheriff/liquid-glass";
import { Icon, type IconName } from "./Icon";
import { useT } from "../i18n/useT";
import { CSV_ACCEPT, OPEN_FILE_ACCEPT } from "../config/constants";
import type { JsonDocument } from "../core/document";

export type CopyVariant = "formatted" | "smart" | "compacted" | "escaped" | "as-is";

interface PanelMenuProps {
  /** 所属面板方位: 决定三个下拉菜单从哪一侧展开 (左面板 start / 右面板 end, 避免越界遮挡) */
  side: "left" | "right";
  /** 面板当前文档; name 为 null 时文档尚未保存命名, 名称按钮不渲染 */
  doc: JsonDocument | null;
  /** Schema 入口状态: active 表示已配置 (type 非 none), error 为解析失败原因 */
  schemaStatus: { active: boolean; error: string | null };
  /** 打开 JSON Schema 配置弹框 (盾牌按钮) */
  onOpenSchema: () => void;
  /** Document properties 弹框 (文档名按钮) */
  onOpenProperties: () => void;
  onNew: () => void;
  /** 从磁盘导入: 文件选择由本组件的隐藏 input 负责 */
  onImportFile: (file: File) => void;
  /** Import CSV 通道: CSV 转 JSON 对象数组 */
  onImportCsv: (file: File) => void;
  onSaveDisk: () => void;
  /** Export to CSV 通道: JSON 文档导出为 CSV */
  onExportCsv: () => void;
  onCopy: (variant: CopyVariant) => void;
  onSaveNow: () => void;
  onToggleFullScreen: () => void;
  /** 菜单按钮排满 (含文案) 的自然宽度; 由 App 量取后回传, 用于窄面板自动收起文案 */
  fitWidth?: number;
  /** 量取按钮"排满"与"仅图标"两种自然宽度, 供分隔条收起阈值与恢复尺寸使用 */
  onMeasureMenu?: (full: number, compact: number) => void;
}

/** 库的 GlassMenu 没有 separator 类型: 用一颗禁用的空项承载分隔线 (CSS 去掉按钮外观) */
const separator: GlassMenuItem = {
  label: <span className="ctx-menu-sep" />,
  disabled: true
};

/** 库 GlassMenu 只暴露 icon 作为触发器内容, 这里把 "图标 + 文案 + 下拉箭头" 组合成一个节点 */
function menuTrigger(icon: IconName, label: string, title: string): ReactNode {
  return (
    <span className="panel-menu-trigger" title={title}>
      <Icon name={icon} />
      <span className="menu-label">{label}</span>
      <Icon name="caretDown" />
    </span>
  );
}

/** 库的菜单项没有 title 字段, 悬浮说明挂在文案元素上 */
function labeled(label: string, title: string): ReactNode {
  return <span title={title}>{label}</span>;
}

export function PanelMenu({
  side,
  doc,
  schemaStatus,
  onOpenSchema,
  onOpenProperties,
  onNew,
  onImportFile,
  onImportCsv,
  onSaveDisk,
  onExportCsv,
  onCopy,
  onSaveNow,
  onToggleFullScreen,
  fitWidth,
  onMeasureMenu
}: PanelMenuProps): ReactElement {
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  // 菜单根与按钮组: 前者量取面板当前宽度驱动 compact, 后者量取排满 / 仅图标两种自然宽度
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef<HTMLDivElement>(null);
  // 面板当前宽度不足以排满全部按钮 (含文案) 时收起文案, 仅留图标, 直到分隔条收起整块面板
  const [compact, setCompact] = useState(false);

  // 量取按钮组两种自然宽度: 先临时隐藏文案量得"仅图标"宽度, 再复原量得"排满"宽度;
  // 用 layout effect 在绘制前完成, 避免隐藏文案的操作晚于首帧绘制造成闪烁; 库 GlassButton 的 DOM 此时已挂载
  useLayoutEffect(() => {
    const el = buttonsRef.current;
    if (el === null || onMeasureMenu === undefined) {
      return;
    }
    const labels = Array.from(el.querySelectorAll<HTMLElement>(".menu-label, .lg-button__label"));
    const prev = labels.map((node) => node.style.display);
    labels.forEach((node) => {
      node.style.display = "none";
    });
    const compactWidth = el.getBoundingClientRect().width;
    labels.forEach((node, index) => {
      node.style.display = prev[index];
    });
    const fullWidth = el.getBoundingClientRect().width;
    onMeasureMenu(fullWidth, compactWidth);
  }, [t, onMeasureMenu]);

  // 面板宽度随分隔条变化: 低于排满宽度即转入 compact (仅图标), 高于则恢复完整文案
  useEffect(() => {
    const el = menuRef.current;
    if (el === null) {
      return;
    }
    const measure = () => {
      const width = el.getBoundingClientRect().width;
      setCompact(fitWidth !== undefined && width > 0 && width < fitWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fitWidth]);

  const openItems: GlassMenuItem[] = [
    {
      label: labeled(t("panel.openFromDisk"), t("panel.openFromDiskTitle")),
      icon: <Icon name="laptop" />,
      onSelect: () => fileInputRef.current?.click()
    },
    separator,
    // 隐藏 CSV input 与菜单同级 (accept="text/csv")
    {
      label: labeled(t("panel.importCsv"), t("panel.importCsvTitle")),
      icon: <Icon name="table" />,
      onSelect: () => csvInputRef.current?.click()
    }
  ];

  const saveItems: GlassMenuItem[] = [
    {
      label: labeled(t("panel.saveToDisk"), t("panel.saveToDiskTitle")),
      icon: <Icon name="laptop" />,
      onSelect: onSaveDisk
    },
    separator,
    {
      label: labeled(t("panel.exportCsv"), t("panel.exportCsvTitle")),
      icon: <Icon name="table" />,
      onSelect: onExportCsv
    }
  ];

  // Copy 五变体: (formatted / smart / compacted / escaped / as-is)
  const copyItems: GlassMenuItem[] = (
    [
      ["formatted", "panel.copyFormatted", "panel.copyFormattedTitle"],
      ["smart", "panel.copySmart", "panel.copySmartTitle"],
      ["compacted", "panel.copyCompacted", "panel.copyCompactedTitle"],
      ["escaped", "panel.copyEscaped", "panel.copyEscapedTitle"],
      ["as-is", "panel.copyAsIs", "panel.copyAsIsTitle"]
    ] as Array<[CopyVariant, string, string]>
  ).map(([variant, labelKey, titleKey]) => ({
    label: labeled(t(labelKey), t(titleKey)),
    icon: <Icon name="copy" />,
    onSelect: () => onCopy(variant)
  }));

  return (
    <div className={`panel-menu${compact ? " compact" : ""}`} ref={menuRef}>
      <div className="document-details">
        {/* schema 盾牌仅对已配置 Schema 的文档渲染, 解析失败时进入 error 态 */}
        {doc !== null && schemaStatus.active ? (
          <button
            type="button"
            className={`menu-button schema${schemaStatus.error !== null ? " error" : ""}`}
            title={
              schemaStatus.error !== null
                ? t("panel.schemaErrorTitle", { error: schemaStatus.error })
                : t("panel.schemaTitle")
            }
            onClick={onOpenSchema}
          >
            <Icon name="shield" />
          </button>
        ) : null}
        {/* 名称按钮仅对已命名文档渲染 */}
        {doc !== null && doc.name !== null ? (
          <button
            type="button"
            className="menu-button name"
            title={t("panel.configureDocument")}
            onClick={onOpenProperties}
          >
            {doc.name} <Icon name="edit" />
          </button>
        ) : null}
      </div>
      {/* 常驻 DOM, 未保存时可见 (CSS visibility 控制) */}
      <div className={`unsaved-changes${doc?.isDirty ? " visible" : ""}`} title={t("panel.unsavedTitle")}>
        <span>{t("panel.unsavedPrefix")}</span>
        <button type="button" className="save-now" onClick={onSaveNow}>
          {t("panel.saveNow")}
        </button>
        <span>{t("panel.unsavedSuffix")}</span>
      </div>
      <div className="space" />
      <div className="buttons" ref={buttonsRef}>
        {/* New / Full screen 也是库 GlassButton (sm/glass): 与三个 GlassMenu 触发器同一颗 .lg-button,
            同一折射材质与尺寸 */}
        <GlassButton
          size="sm"
          variant="glass"
          className="panel-menu-action"
          icon={<Icon name="file" />}
          title={t("panel.new")}
          aria-label={t("panel.newLabel")}
          onClick={onNew}
        >
          <span className="menu-label">{t("panel.newLabel")}</span>
        </GlassButton>
        <GlassMenu
          icon={menuTrigger("folderOpen", t("panel.open"), t("panel.open"))}
          items={openItems}
          aria-label={t("panel.open")}
          align={side === "right" ? "end" : "start"}
          size="sm"
          width={220}
          className="panel-menu-glass"
        />
        {/* 隐藏 file input 与 Open 菜单同级, 由菜单项触发选择 */}
        <input
          ref={fileInputRef}
          type="file"
          accept={OPEN_FILE_ACCEPT}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) {
              onImportFile(file);
            }
            event.target.value = "";
          }}
        />
        {/* CSV 隐藏 input 与 Open 菜单同级, 由菜单项触发选择 */}
        <input
          ref={csvInputRef}
          type="file"
          accept={CSV_ACCEPT}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) {
              onImportCsv(file);
            }
            event.target.value = "";
          }}
        />
        <GlassMenu
          icon={menuTrigger("save", t("panel.save"), t("panel.save"))}
          items={saveItems}
          aria-label={t("panel.save")}
          align={side === "right" ? "end" : "start"}
          size="sm"
          width={220}
          className="panel-menu-glass"
        />
        <GlassMenu
          icon={menuTrigger("copy", t("panel.copy"), t("panel.copy"))}
          items={copyItems}
          aria-label={t("panel.copy")}
          align={side === "right" ? "end" : "start"}
          size="sm"
          width={220}
          className="panel-menu-glass"
        />
        <GlassButton
          size="sm"
          variant="glass"
          className="panel-menu-action"
          icon={<Icon name="fullscreen" />}
          title={t("panel.fullscreen")}
          aria-label={t("panel.fullscreenLabel")}
          onClick={onToggleFullScreen}
        >
          <span className="menu-label">{t("panel.fullscreenLabel")}</span>
        </GlassButton>
      </div>
    </div>
  );
}
