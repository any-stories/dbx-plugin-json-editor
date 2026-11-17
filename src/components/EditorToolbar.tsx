/**
 * 编辑器工具栏: 取代 vanilla-jsoneditor 自带菜单条
 */

import { useMemo, useSyncExternalStore, type ReactElement } from "react";
import { GlassMenu, GlassSegmented } from "@zakisheriff/liquid-glass";
import type { MenuButton } from "vanilla-jsoneditor";
import { Icon, type IconName } from "./Icon";
import { flattenContextMenuItems } from "./EditorContextMenu";
import { useT } from "../i18n/useT";
import type { ViewMode } from "../core/document";
import { closeContextMenu, getToolbarMenuItems, subscribeContextMenu, type MenuAnchor } from "../core/jseContextMenu";

/** 可委托给编辑器原生菜单按钮的动作 (类名后缀 jse-<action>) */
export type EditorMenuAction =
  | "expand-all"
  | "collapse-all"
  | "format"
  | "format-smart"
  | "compact"
  | "sort"
  | "context-menu"
  | "undo"
  | "redo"
  | "search";

interface EditorToolbarProps {
  mode: ViewMode;
  onMode: (mode: ViewMode) => void;
  /** 委托给编辑器原生菜单按钮 (上下文菜单额外带上按钮矩形作为锚点); 返回该动作是否生效 */
  onAction: (action: EditorMenuAction, anchor: MenuAnchor) => boolean;
  /** 打开本插件的 Transform 弹框 */
  onTransform: () => void;
  fullScreen: boolean;
  onExitFullScreen: () => void;
}

interface ToolButtonSpec {
  key: string;
  icon: IconName;
  labelKey: string;
  titleKey: string;
  /** text 模式下改用这组 (展开/折叠走 CodeMirror 代码折叠, 行为与 tree 不同) */
  textLabelKey?: string;
  textTitleKey?: string;
  /** 委托给原生菜单按钮的动作名; transform 走本插件弹框 */
  action?: EditorMenuAction;
  /** 不含当前模式时隐藏 (格式化仅 text) */
  modes?: ViewMode[];
}

/** 菜单条的动作分组, 组间以分隔线区隔 */
const TOOLBAR_BUTTONS: Array<Array<ToolButtonSpec>> = [
  [
    // 展开/折叠在三种模式下都可见: tree/table 折叠结构节点, text 折叠代码 (CodeMirror),
    // text 下折叠处显示为省略号占位 (悬浮提示 unfold), 因此 tooltip 用 textLabelKey/textTitleKey 如实描述
    {
      key: "expand-all",
      icon: "unfoldVertical",
      labelKey: "editor.expandAll",
      titleKey: "editor.expandAllTitle",
      textLabelKey: "editor.unfoldAll",
      textTitleKey: "editor.unfoldAllTitle",
      action: "expand-all"
    },
    {
      key: "collapse-all",
      icon: "foldVertical",
      labelKey: "editor.collapseAll",
      titleKey: "editor.collapseAllTitle",
      textLabelKey: "editor.foldAll",
      textTitleKey: "editor.foldAllTitle",
      action: "collapse-all"
    }
  ],
  [
    {
      key: "format",
      icon: "alignLeft",
      labelKey: "editor.format",
      titleKey: "editor.formatTitle",
      action: "format",
      modes: ["text"]
    },
    {
      key: "format-smart",
      icon: "sparkles",
      labelKey: "editor.formatSmart",
      titleKey: "editor.formatSmartTitle",
      action: "format-smart",
      modes: ["text"]
    },
    {
      key: "compact",
      icon: "compact",
      labelKey: "editor.compact",
      titleKey: "editor.compactTitle",
      action: "compact",
      modes: ["text"]
    }
  ],
  [
    // sort / transform / 搜索为通用动作, 上下文菜单仅 tree 与 table
    { key: "sort", icon: "sortAsc", labelKey: "editor.sort", titleKey: "editor.sortTitle", action: "sort" },
    { key: "transform", icon: "wand", labelKey: "editor.transform", titleKey: "editor.transformTitle" },
    { key: "search", icon: "search", labelKey: "editor.search", titleKey: "editor.searchTitle", action: "search" },
    {
      key: "context-menu",
      icon: "more",
      labelKey: "editor.contextMenu",
      titleKey: "editor.contextMenuTitle",
      action: "context-menu",
      modes: ["tree", "table"]
    }
  ],
  [
    { key: "undo", icon: "undo", labelKey: "editor.undo", titleKey: "editor.undoTitle", action: "undo" },
    { key: "redo", icon: "redo", labelKey: "editor.redo", titleKey: "editor.redoTitle", action: "redo" }
  ]
];

/**
 * 工具栏 "打开所选内容的上下文菜单" 按钮: 直接用库的 GlassMenu (触发器 + 菜单一体),
 * 菜单项仍由 jse 按当前选中内容生成, 按下时先同步取一次,
 * 存成 items-only 状态 (mount=false), 随后库自己的 onClick 展开时读到的就是最新一份.
 * 没有选中内容时阻止这次展开, 由调用方提示 "请先选择一项内容".
 */
function runToolbarMenuAction(button: MenuButton): void {
  button.onClick(new MouseEvent("click"));
  closeContextMenu();
}

function ToolbarContextMenu({
  label,
  title,
  onOpen
}: {
  label: string;
  title: string;
  onOpen: (anchor: MenuAnchor) => boolean;
}): ReactElement {
  // store 缓存最近一份 items-only 菜单, 引用稳定; 展开期间切到别的菜单也不会让列表闪空
  const rawItems = useSyncExternalStore(subscribeContextMenu, getToolbarMenuItems);
  const items = useMemo(() => flattenContextMenuItems(rawItems, runToolbarMenuAction), [rawItems]);

  return (
    <span
      className="toolbar-context-menu-host"
      title={title}
      onClickCapture={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        const ok = onOpen({ left: box.left, top: box.bottom + 2, width: box.width, height: 0 });
        if (!ok) {
          // 捕获阶段截断: 库的触发器收不到 onClick, 不会展开一个空菜单.
          // 用 click 而不是 pointerdown: 键盘 (Enter / Space) 激活同样经过这里,
          // 且 jse 的 onRenderContextMenu 是同步回调, 同一次事件里菜单项已写进 store
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <GlassMenu
        icon={<Icon name="more" />}
        items={items}
        aria-label={label}
        align="start"
        size="sm"
        width={232}
        className="toolbar-context-menu ctx-menu-surface"
      />
    </span>
  );
}

export function EditorToolbar({
  mode,
  onMode,
  onAction,
  onTransform,
  fullScreen,
  onExitFullScreen
}: EditorToolbarProps): ReactElement {
  const t = useT();

  // 视图切换用库的 GlassSegmented (iOS 26 分段控件: 整轨液态玻璃, 选中段是可按可拖的透镜)
  const modes: Array<{ id: ViewMode; labelKey: string }> = [
    { id: "text", labelKey: "editor.modeText" },
    { id: "tree", labelKey: "editor.modeTree" },
    { id: "table", labelKey: "editor.modeTable" }
  ];

  return (
    <div className="editor-toolbar">
      <GlassSegmented
        size="sm"
        options={modes.map((entry) => t(entry.labelKey))}
        value={modes.findIndex((entry) => entry.id === mode)}
        onChange={(index) => onMode(modes[index].id)}
        aria-label={t("editor.modeGroup")}
      />
      {TOOLBAR_BUTTONS.map((group, groupIndex) => {
        const visible = group.filter((spec) => spec.modes === undefined || spec.modes.includes(mode));
        if (visible.length === 0) {
          return null;
        }
        return (
          <span key={`group-${groupIndex}`} className="toolbar-group">
            <span className="toolbar-separator" aria-hidden="true" />
            {visible.map((spec) => {
              const inText = mode === "text";
              const label = t(inText && spec.textLabelKey ? spec.textLabelKey : spec.labelKey);
              const title = t(inText && spec.textTitleKey ? spec.textTitleKey : spec.titleKey);
              return spec.key === "context-menu" ? (
                <ToolbarContextMenu
                  key={spec.key}
                  label={label}
                  title={title}
                  onOpen={(anchor) => onAction("context-menu", anchor)}
                />
              ) : (
                <button
                  key={spec.key}
                  type="button"
                  className="toolbar-button"
                  title={title}
                  aria-label={label}
                  onClick={(event) => {
                    if (spec.key === "transform") {
                      onTransform();
                      return;
                    }
                    if (spec.action === undefined) {
                      return;
                    }
                    const box = event.currentTarget.getBoundingClientRect();
                    onAction(spec.action, { left: box.left, top: box.bottom + 2, width: box.width, height: 0 });
                  }}
                >
                  <Icon name={spec.icon} />
                </button>
              );
            })}
          </span>
        );
      })}
      <div className="editor-toolbar-space" />
      {fullScreen ? (
        <button
          type="button"
          className="toolbar-button with-label"
          title={t("panel.exitFullScreen")}
          onClick={onExitFullScreen}
        >
          <Icon name="exitFullscreen" />
          <span>{t("editor.exitFullScreen")}</span>
        </button>
      ) : null}
    </div>
  );
}
