/**
 * 上下文菜单的玻璃浮层宿主
 *
 * 菜单项来自 jse 的 onRenderContextMenu (见 core/jseContextMenu.ts), 这里只做 "菜单项数组 -> GlassMenu"
 * 的拍平: jse 的行 / 列 / 下拉子菜单都是二级结构, 玻璃菜单只有一级, 因此下拉子项直接摊平,
 * 与主项文案重复的 (Edit value 的主项和第一子项是同一个动作) 只留一条
 * 触发交互全部留在 jse 原生侧 (行内三点 / 插入线按钮 / 右键 / Ctrl+Q), 这里只负责渲染浮层;
 * 工具栏那颗常驻 GlassMenu 直接复用下面导出的 flattenContextMenuItems 消费同一份菜单项
 */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";
import { GlassMenu, type GlassMenuItem } from "@zakisheriff/liquid-glass";
import type { MenuButton } from "vanilla-jsoneditor";
import { Icon } from "./Icon";
import { useT } from "../i18n/useT";
import {
  closeContextMenu,
  getContextMenuState,
  subscribeContextMenu,
  type ContextMenuState
} from "../core/jseContextMenu";

/** 菜单宽度: 与原生菜单 (255px) 接近, 但玻璃浮层的内边距更大, 收窄一点更平衡 */
const MENU_WIDTH = 232;
/** 关闭延时: 让库自己的收拢动画播完再卸载 */
const CLOSE_DELAY = 220;

/** jse 的菜单图标是 FontAwesome 定义 ([宽, 高, 别名, 字符, 路径]), 这里直接拼成内联 svg */
function jseIcon(icon: MenuButton["icon"]): ReactNode {
  if (icon === undefined || typeof icon.icon === "string") {
    return undefined;
  }
  const [width, height, , , data] = icon.icon;
  const path = Array.isArray(data) ? data.join(" ") : data;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={13} height={13} aria-hidden="true" focusable="false">
      <path d={path} fill="currentColor" />
    </svg>
  );
}

/** 分隔线 / 分组标题: 借用菜单项渲染, 用 CSS (:has) 认出这两颗 span 后去掉按钮外观 */
const separatorLabel = <span className="ctx-menu-sep" />;
const headerLabel = (text: string): ReactNode => <span className="ctx-menu-header">{text}</span>;

/**
 * jse 的菜单项 -> 玻璃菜单项
 * jse 顶层是 row / separator, 行内又是 button / dropdown-button / column, 列内还有 label 与 separator,
 * 全部拍平成一级 (玻璃菜单没有子菜单), 列标题变成分组标题
 */
type MenuEntry = MenuButton | ContextMenuEntry;

interface ContextMenuEntry {
  type: string;
  items?: MenuEntry[];
  main?: MenuButton;
  text?: string;
  onClick?: (event: MouseEvent) => void;
  title?: string;
  disabled?: boolean;
}

export function flattenContextMenuItems(items: MenuEntry[], run: (button: MenuButton) => void): GlassMenuItem[] {
  const out: GlassMenuItem[] = [];

  const pushButton = (button: MenuButton): void => {
    out.push({
      label: button.text ?? button.title ?? "",
      icon: jseIcon(button.icon),
      disabled: button.disabled,
      // Remove 是唯一不可撤销的动作, 标红
      destructive: button.text === "Remove",
      onSelect: () => run(button)
    });
  };

  const pushEntry = (entry: MenuEntry): void => {
    if (entry.type === "separator") {
      out.push({ label: separatorLabel, disabled: true, onSelect: () => undefined });
      return;
    }
    if (entry.type === "row" || entry.type === "column") {
      entry.items?.forEach(pushEntry);
      return;
    }
    if (entry.type === "label") {
      out.push({ label: headerLabel(entry.text ?? ""), disabled: true, onSelect: () => undefined });
      return;
    }
    if (entry.type === "dropdown-button") {
      if (entry.main !== undefined) {
        pushButton(entry.main);
      }
      for (const child of entry.items ?? []) {
        // 子项里与主项同一动作的 (Cut formatted / Copy formatted 都是主项的别名) 去掉避免重复
        if (
          child.type === "button" &&
          child.text !== undefined &&
          !child.text.startsWith(entry.main?.text ?? "\u0000")
        ) {
          pushButton(child as MenuButton);
        }
      }
      return;
    }
    if (entry.type === "button") {
      pushButton(entry as MenuButton);
    }
  };

  items.forEach(pushEntry);
  return out;
}

/** 菜单浮层: 独立子组件, 只在打开时挂载 (每次打开都是新实例, 形变动画从头播) */
function ContextMenuSurface({ state, label }: { state: ContextMenuState; label: string }): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);

  // 库里的菜单只能由它自己的触发器点开 (内部 open 状态不对外), 因此挂载后补一次触发器点击,
  // 让菜单走它自带的 "按钮长成菜单" 动效; 触发器本身就在锚点位置, 视觉上就是这颗按钮展开的
  useEffect(() => {
    hostRef.current?.querySelector<HTMLButtonElement>(".lg-menu-anchor > button")?.click();
  }, []);

  // 视口钳制: 库只按锚点摆放, 不做边界修正; 贴边时整体平移一点, 避免菜单出屏.
  // 浮层展开动画期间内容带 scale/clip, 尺寸量不准, 因此动画结束前每帧都校一次 (菜单短命, 开销可忽略);
  // 平移量直接写目标值 (不累加): 中途量到的尺寸不准 (展开动画带 scale), 每帧按未平移的基准位置重算即可收敛
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return undefined;
    }
    const applied = { dx: 0, dy: 0 };
    const clamp = (): void => {
      const content = host.querySelector<HTMLElement>(".lg-menu__content");
      if (content === null) {
        return;
      }
      const box = content.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) {
        return;
      }
      const left = box.left - applied.dx;
      const right = box.right - applied.dx;
      const top = box.top - applied.dy;
      const bottom = box.bottom - applied.dy;
      const dx = right > window.innerWidth - 8 ? window.innerWidth - 8 - right : left < 8 ? 8 - left : 0;
      const dy = bottom > window.innerHeight - 8 ? window.innerHeight - 8 - bottom : top < 8 ? 8 - top : 0;
      applied.dx = dx;
      applied.dy = dy;
      if (dx === 0 && dy === 0) {
        host.style.transform = "";
        return;
      }
      host.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
    };
    let frame = 0;
    const start = performance.now();
    const tick = (): void => {
      clamp();
      if (performance.now() - start < 1200) {
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, []);

  const closeSoon = useCallback(
    (delay = CLOSE_DELAY) => {
      window.setTimeout(() => {
        // 期间若换了另一份菜单, 不要把它关掉
        if (getContextMenuState()?.nonce === state.nonce) {
          closeContextMenu();
        }
      }, delay);
    },
    [state.nonce]
  );

  // 点外面 / Esc / 滚动都收起 (库自己也会收起浮层, 这里同步卸载宿主)
  useEffect(() => {
    const host = hostRef.current;
    const onPointerDown = (event: PointerEvent): void => {
      if (host !== null && event.target instanceof Node && host.contains(event.target)) {
        return;
      }
      closeSoon(160);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeSoon(160);
      }
    };
    const onScroll = (): void => closeSoon(0);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [closeSoon]);

  const items = useMemo(
    () =>
      flattenContextMenuItems(state.items, (button) => {
        button.onClick(new MouseEvent("click"));
        closeSoon();
      }),
    [state.items, closeSoon]
  );

  const align = state.anchor.left + MENU_WIDTH + 16 <= window.innerWidth ? "start" : "end";

  return createPortal(
    <div
      ref={hostRef}
      className="ctx-menu-host ctx-menu-surface"
      style={{ left: state.anchor.left, top: state.anchor.top }}
    >
      <GlassMenu
        icon={<Icon name="more" />}
        items={items}
        aria-label={label}
        align={align}
        size="sm"
        width={MENU_WIDTH}
      />
    </div>,
    document.body
  );
}

interface EditorContextMenuProps {
  /** 编辑器实例标识: 只有打开菜单的那个实例渲染浮层 (两个面板各有一份宿主) */
  owner: string;
}

export function EditorContextMenu({ owner }: EditorContextMenuProps): ReactElement {
  const t = useT();
  const state = useSyncExternalStore(subscribeContextMenu, getContextMenuState);
  // items-only 状态 (工具栏常驻 GlassMenu) 不在这里挂浮层
  const menuOpen = state !== null && state.mount && state.owner === owner;

  return (
    <>
      {menuOpen && state !== null ? (
        <ContextMenuSurface key={state.nonce} state={state} label={t("editor.contextMenu")} />
      ) : null}
    </>
  );
}
