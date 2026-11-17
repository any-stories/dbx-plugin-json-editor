/**
 * GlassMenu
 *
 * 玻璃浮层菜单 (Liquid Glass 材质, 与下拉/弹框同一套令牌)
 * 结构: 触发按钮 + portal 到 body 的固定定位菜单
 * 之所以 portal 到 body: 面板与面板内容区都有 overflow 裁剪, 且玻璃卡片带 backdrop-filter,
 * 菜单若挂在原地会被裁切或被祖先的层叠上下文覆盖; 固定定位 + 视口坐标最可靠
 * 支持分组 (header) / 分隔线 / 勾选态 (checked -> 右侧对勾) / 图标 / 禁用
 * 交互: 点击外部与 Esc 关闭, 上下键循环, Home/End 跳转, Enter/Space 选中, 关闭后焦点回到触发器
 * 勾选列: 同一菜单里只要有一项带 checked, 其余项也保留等宽空位, 保证文字左侧对齐
 */

import { Icon } from "./Icon";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { useRefraction } from "@zakisheriff/liquid-glass";

export interface GlassMenuItem {
  type?: "item";
  key: string;
  label: string;
  icon?: ReactNode;
  title?: string;
  /** 有值即占据勾选列: true 显示对勾, false 留空位 */
  checked?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface GlassMenuGroup {
  type: "group";
  key: string;
  header: string;
  items: GlassMenuItem[];
}

export interface GlassMenuSeparator {
  type: "separator";
  key: string;
}

export type GlassMenuEntry = GlassMenuItem | GlassMenuGroup | GlassMenuSeparator;

interface GlassMenuProps {
  /** 触发器内容 (图标 / 文案由调用方组合) */
  trigger: ReactNode;
  triggerTitle?: string;
  triggerClassName?: string;
  entries: GlassMenuEntry[];
  /** end: 菜单右边与触发器右边对齐; start: 左边对齐 */
  align?: "start" | "end";
  minWidth?: number;
  ariaLabel?: string;
  /** 打开时回调 (面板工具栏用它按模式重算可用项) */
  onOpen?: () => void;
}

/** 菜单浮层本体: 独立子组件, 只在打开时挂载 */
/* 折射必须在子组件里烤: 父组件挂载时菜单尚未打开, menuRef 还是 null,
   useRefraction 的 effect 依赖 ref 对象 (稳定不变) 不会重跑, 浮层永远拿不到折射图 */
function GlassMenuSurface({
  setMenuNode,
  ariaLabel,
  position,
  minWidth,
  onKeyDown,
  children
}: {
  setMenuNode: (element: HTMLDivElement | null) => void;
  ariaLabel?: string;
  position: { top: number; left: number };
  minWidth: number;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  // 菜单本体是液态玻璃 (.lg-glass + surface 折射): 小面积玻璃, 边沿位移肉眼可见;
  // 打开时才挂载, 折射图按首帧实际尺寸烤制, 视口钳制重定位后 ResizeObserver 自动重烤
  useRefraction(ref, { kind: "surface" });
  return createPortal(
    <div
      ref={(element) => {
        ref.current = element;
        setMenuNode(element);
      }}
      className="lg-glass glass-menu"
      role="menu"
      aria-label={ariaLabel}
      style={{ top: position.top, left: position.left, minWidth }}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>,
    document.body
  );
}

function isItem(entry: GlassMenuEntry): entry is GlassMenuItem {
  return entry.type !== "group" && entry.type !== "separator";
}

function isGroup(entry: GlassMenuEntry): entry is GlassMenuGroup {
  return entry.type === "group";
}

export function GlassMenu({
  trigger,
  triggerTitle,
  triggerClassName = "",
  entries,
  align = "end",
  minWidth = 220,
  ariaLabel,
  onOpen
}: GlassMenuProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [activeIndex, setActiveIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // 可聚焦项按渲染顺序展平: 键盘导航只在这批里循环
  const focusable = useMemo(
    () =>
      entries
        .flatMap((entry) => (isGroup(entry) ? entry.items : isItem(entry) ? [entry] : []))
        .filter((item) => !item.disabled),
    [entries]
  );
  // 勾选列开关: 任一勾选项存在则整列保留
  const hasChecks = useMemo(
    () =>
      entries.some((entry) =>
        (isGroup(entry) ? entry.items : isItem(entry) ? [entry] : []).some((item) => item.checked !== undefined)
      ),
    [entries]
  );

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    setActiveIndex(-1);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  // 定位: 先按触发器矩形与菜单实际宽度算, 再钳制在视口内
  const reposition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect === undefined) {
      return;
    }
    const width = menuRef.current?.offsetWidth ?? minWidth;
    const rawLeft = align === "end" ? rect.right - width : rect.left;
    const left = Math.max(8, Math.min(rawLeft, window.innerWidth - width - 8));
    const top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 16));
    setPosition({ top, left });
  }, [align, minWidth]);

  useLayoutEffect(() => {
    if (open) {
      reposition();
    }
  }, [open, reposition]);

  // 打开时把焦点放到首个勾选项 (没有勾选项则放到第一项)
  // 只做聚焦: 选中态由各选项的 onFocus 回写, 避免在 effect 里直接 setState
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const initial = focusable.findIndex((item) => item.checked === true);
    itemRefs.current[initial >= 0 ? initial : 0]?.focus();
  }, [open, focusable]);

  // 外部点击 / 视口尺寸变化 / 滚动: 关闭或重新定位
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) === true || triggerRef.current?.contains(target) === true) {
        return;
      }
      close(false);
    };
    const onResize = () => reposition();
    const onScroll = () => close(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, close, reposition]);

  const moveActive = (delta: number) => {
    if (focusable.length === 0) {
      return;
    }
    const next = (activeIndex + delta + focusable.length) % focusable.length;
    setActiveIndex(next);
    itemRefs.current[next]?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveActive(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveActive(-1);
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        itemRefs.current[0]?.focus();
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(focusable.length - 1);
        itemRefs.current[focusable.length - 1]?.focus();
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      case "Tab":
        close();
        break;
      default:
        break;
    }
  };

  const renderItem = (item: GlassMenuItem) => {
    const index = focusable.findIndex((entry) => entry.key === item.key);
    return (
      <button
        key={item.key}
        ref={(element) => {
          if (index >= 0) {
            itemRefs.current[index] = element;
          }
        }}
        type="button"
        role="menuitem"
        className="glass-menu-item"
        title={item.title}
        disabled={item.disabled === true}
        aria-checked={item.checked === undefined ? undefined : item.checked}
        tabIndex={-1}
        onClick={() => {
          item.onSelect();
          close();
        }}
        onMouseEnter={() => {
          if (index >= 0) {
            setActiveIndex(index);
          }
        }}
        onFocus={() => {
          if (index >= 0) {
            setActiveIndex(index);
          }
        }}
      >
        {item.icon === undefined ? null : <span className="glass-menu-item-icon">{item.icon}</span>}
        <span className="glass-menu-item-label">{item.label}</span>
        {hasChecks ? (
          <span className="glass-menu-item-check" aria-hidden="true">
            {item.checked === true ? <Icon name="check" /> : null}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`glass-menu-trigger ${triggerClassName}`.trim()}
        title={triggerTitle}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            close(false);
            return;
          }
          onOpen?.();
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen?.();
            setOpen(true);
          }
        }}
      >
        {trigger}
      </button>
      {open ? (
        <GlassMenuSurface
          setMenuNode={(element) => {
            menuRef.current = element;
          }}
          ariaLabel={ariaLabel}
          position={position}
          minWidth={minWidth}
          onKeyDown={onKeyDown}
        >
          {entries.map((entry) => {
            if (isGroup(entry)) {
              return (
                <div key={entry.key} className="glass-menu-group" role="group" aria-label={entry.header}>
                  <div className="glass-menu-header">{entry.header}</div>
                  {entry.items.map(renderItem)}
                </div>
              );
            }
            if (entry.type === "separator") {
              return <div key={entry.key} className="glass-menu-separator" role="separator" />;
            }
            return renderItem(entry);
          })}
        </GlassMenuSurface>
      ) : null}
    </>
  );
}
