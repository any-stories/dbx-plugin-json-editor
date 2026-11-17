/**
 * 弹窗内编辑器的顶栏
 *
 * 与面板工具栏同一套玻璃控件, 只是取最小集合
 * (模式分段控件 + 展开 / 折叠 或 格式化 / 压缩 + 搜索)
 * jse 原生菜单条在弹窗内整体隐藏, 这里按类名点击原生按钮委托动作,
 * 嵌在编辑器容器内部 (预览卡片 / 文本域) 顶部, 因此分段控件属于编辑器本身而不是浮在编辑器上方
 */

import type { ReactElement } from "react";
import { GlassSegmented } from "@zakisheriff/liquid-glass";
import { Icon, type IconName } from "./Icon";
import { useT } from "../i18n/useT";
import type { EditorMenuAction } from "./EditorToolbar";
import type { ViewMode } from "../core/document";

// 顺序与主工具栏一致 (text / tree / table)
const MODES: ViewMode[] = ["text", "tree", "table"];
const MODE_LABEL_KEYS: Record<ViewMode, string> = {
  text: "editor.modeText",
  tree: "editor.modeTree",
  table: "editor.modeTable"
};

interface BarButtonSpec {
  action: EditorMenuAction;
  icon: IconName;
  labelKey: string;
  titleKey: string;
  /** 仅这些模式显示 (展开折叠只对 tree / table 有意义, 格式化只对 text) */
  modes?: ViewMode[];
}

const BAR_BUTTONS: BarButtonSpec[] = [
  {
    action: "expand-all",
    icon: "unfoldVertical",
    labelKey: "editor.expandAll",
    titleKey: "editor.expandAllTitle",
    modes: ["tree", "table"]
  },
  {
    action: "collapse-all",
    icon: "foldVertical",
    labelKey: "editor.collapseAll",
    titleKey: "editor.collapseAllTitle",
    modes: ["tree", "table"]
  },
  { action: "format", icon: "alignLeft", labelKey: "editor.format", titleKey: "editor.formatTitle", modes: ["text"] },
  { action: "compact", icon: "compact", labelKey: "editor.compact", titleKey: "editor.compactTitle", modes: ["text"] },
  { action: "search", icon: "search", labelKey: "editor.search", titleKey: "editor.searchTitle" }
];

interface ModalEditorBarProps {
  mode: ViewMode;
  onMode: (mode: ViewMode) => void;
  /** 委托给编辑器原生菜单按钮 (编辑器实例的 runMenuAction) */
  onAction: (action: EditorMenuAction) => void;
  /** 只读预览可关掉动作按钮 (模式分段仍可用) */
  actions?: boolean;
}

export function ModalEditorBar({ mode, onMode, onAction, actions = true }: ModalEditorBarProps): ReactElement {
  const t = useT();
  const visible = BAR_BUTTONS.filter((spec) => spec.modes === undefined || spec.modes.includes(mode));

  return (
    <div className="modal-editor-bar">
      <GlassSegmented
        size="sm"
        options={MODES.map((entry) => t(MODE_LABEL_KEYS[entry]))}
        value={MODES.indexOf(mode)}
        onChange={(index) => onMode(MODES[index])}
        aria-label={t("editor.modeGroup")}
      />
      {actions ? <span className="toolbar-separator" aria-hidden="true" /> : null}
      {actions
        ? visible.map((spec) => (
            <button
              key={spec.action}
              type="button"
              className="toolbar-button"
              title={t(spec.titleKey)}
              aria-label={t(spec.labelKey)}
              onClick={() => onAction(spec.action)}
            >
              <Icon name={spec.icon} />
            </button>
          ))
        : null}
    </div>
  );
}
