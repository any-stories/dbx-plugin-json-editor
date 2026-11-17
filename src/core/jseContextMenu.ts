/**
 * 上下文菜单的玻璃浮层入口 (与 EditorContextMenu.tsx 配合)
 *
 * jse 自渲染的 .jse-contextmenu 被 onRenderContextMenu 拦下 (返回 false 不渲染), 菜单项仍由 jse 按
 * 当前选中内容生成, 动作 / 禁用态 / 图标与原生菜单完全一致, 只是浮层换成 GlassMenu 的玻璃材质
 *
 * 交互:
 *   1) 行内三点: "点击 key / value 选中该行后才出现", 这里保留原生按钮 (只换玻璃外观),
 *      点击它派发的菜单被 onRenderContextMenu 接管成玻璃浮层 (库 GlassMenu)
 *   2) 插入线右端的按钮: 同一颗玻璃圆钮, 点开的是 "往这个位置插什么" 的插入菜单, 同样接管成玻璃
 *   3) 工具栏 "上下文菜单" 按钮: 本身就是一颗常驻的库 GlassMenu 触发器, 按下时先取当前选中内容
 *      (选中的行, 或点击横线选中的插入位) 的菜单项, 再由它自己展开 (items-only, 不挂浮层)
 *   4) 右键
 *   5) Ctrl+Q: jse 自带的快捷键, 打开当前选中内容的菜单, 按键时先预约锚点, 菜单即由玻璃浮层接管
 *
 * 使用"预约锚点"原因: jse 是在自己的 popup 里按事件坐标定位并渲染菜单, 要拿到菜单项却不要它的定位;
 * 因此触发前先 armMenuAnchor 写好锚点与挂载方式, onRenderContextMenu 读走即接管;
 * 读不到时 (没有预约的菜单) 返回 undefined, 继续交给 jse 原生渲染, 不影响原有交互
 */

import type { ContextMenuItem } from "vanilla-jsoneditor";

/** 触发器在视口中的矩形 (玻璃菜单从这个矩形里长出来) */
export interface MenuAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ContextMenuState {
  /** 打开这份菜单的编辑器实例, 只有它自己的宿主会渲染 (两面板各有一个宿主) */
  owner: string;
  items: ContextMenuItem[];
  anchor: MenuAnchor;
  /**
   * true: 由 EditorContextMenu 挂一份玻璃浮层 (行内三点 / 插入线按钮 / 右键 / Ctrl+Q 走这条)
   * false: 只把 jse 生成的菜单项存进 store, 由常驻的库 GlassMenu 自己展开 (工具栏 "上下文菜单" 按钮)
   */
  mount: boolean;
  /** 每次打开自增: 换菜单时强制重挂载, 让形变动画从头播 */
  nonce: number;
}

let state: ContextMenuState | null = null;
let nonce = 0;
const listeners = new Set<() => void>();
/** 最近一份 items-only 菜单 (工具栏常驻 GlassMenu 消费): 引用稳定, 可直接做 useSyncExternalStore 快照 */
const EMPTY_ITEMS: ContextMenuItem[] = [];
let toolbarItems: ContextMenuItem[] = EMPTY_ITEMS;

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeContextMenu(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getContextMenuState(): ContextMenuState | null {
  return state;
}

/** 工具栏那颗常驻 GlassMenu 读这份: 菜单展开期间即使切到浮层菜单, 列表也不会闪空 */
export function getToolbarMenuItems(): ContextMenuItem[] {
  return toolbarItems;
}

export function openContextMenu(next: Omit<ContextMenuState, "nonce">): void {
  nonce += 1;
  state = { ...next, nonce };
  if (!next.mount) {
    toolbarItems = next.items;
  }
  emit();
}

export function closeContextMenu(): void {
  if (state === null) {
    return;
  }
  state = null;
  emit();
}

// #region 锚点预约

interface ArmedAnchor {
  anchor: MenuAnchor;
  mount: boolean;
  expires: number;
}

/** 约 250ms 内的下一次 onRenderContextMenu 会被接管; 没被消费就自然过期, 不会误伤其它菜单 */
const ARM_TTL = 250;

let armed: ArmedAnchor | null = null;

export function armMenuAnchor(anchor: MenuAnchor, mount = true): void {
  armed = { anchor, mount, expires: performance.now() + ARM_TTL };
}

export function takeMenuAnchor(): { anchor: MenuAnchor; mount: boolean } | null {
  if (armed === null) {
    return null;
  }
  const value = armed;
  armed = null;
  return performance.now() <= value.expires ? { anchor: value.anchor, mount: value.mount } : null;
}

/** 以某个元素的矩形为锚点预约 (行内三点 / 插入线按钮: 菜单从这颗按钮里长出来) */
function armFromElement(element: Element): void {
  const box = element.getBoundingClientRect();
  armMenuAnchor({ left: box.left, top: box.top, width: box.width, height: box.height }, true);
}
// #endregion

// #region 行与选中态

const ROW_SELECTOR =
  ".jse-json-node > .jse-contents-outer, .jse-json-node > .jse-header-outer, .jse-json-node > .jse-footer-outer";

/** 从任意节点向上找到它所属的行容器 (jse 的节点是嵌套的, 必须停在最近一层) */
function rowOf(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) {
    return null;
  }
  return node.closest<HTMLElement>(ROW_SELECTOR);
}

/** 当前选中行: 先找选中行上的三点, 再退回 jse 打在节点上的 jse-selected */
export function findSelectedRow(root: HTMLElement): HTMLElement | null {
  const pointer = root.querySelector<HTMLElement>(".jse-context-menu-pointer.jse-selected:not(.jse-insert)");
  const row = pointer === null ? null : rowOf(pointer);
  if (row !== null) {
    return row;
  }
  const node = root.querySelector<HTMLElement>(".jse-json-node.jse-selected");
  return node === null ? null : (node.querySelector<HTMLElement>(":scope > .jse-contents-outer") ?? node);
}

/**
 * 当前选中的插入位: 点击插入线 (横线) 后 jse 给 .jse-insert-area 打上 jse-selected,
 * 工具栏按钮与 Ctrl+Q 对这种选中同样有效, 这里保持一致
 */
function findSelectedInsertPointer(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(".jse-insert-area.jse-selected .jse-context-menu-pointer");
}

/**
 * table 模式的选中项: 与 tree 不同, 表格里没有 .jse-json-node, 选中态是
 * .jse-value-outer.jse-selected-value 内的 .jse-context-menu-pointer.jse-selected
 * (findSelectedRow 的 rowOf 找不到 .jse-json-node 会返回 null, 因此必须单独识别).
 * 工具栏按钮对表格选中同样有效, 这里点这颗原生按钮让 jse 按选中单元格生成菜单
 */
function findSelectedTablePointer(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(".jse-table-mode .jse-context-menu-pointer.jse-selected:not(.jse-insert)");
}

/** 在行上派发一次 contextmenu: jse 据此按该行的选中内容生成菜单项 */
function dispatchRowContextMenu(row: Element, anchor: MenuAnchor): void {
  const contents = row.querySelector<HTMLElement>(".jse-contents") ?? row;
  contents.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: anchor.left + anchor.width / 2,
      clientY: anchor.top + anchor.height / 2
    })
  );
}

/**
 * 工具栏入口: 取当前选中内容的菜单项, 存成 items-only 状态 (mount=false) 供工具栏那颗
 * 常驻的库 GlassMenu 展开. tree 选中行 -> 行菜单; table 选中单元格 -> 单元格菜单;
 * 点过插入线 -> 插入菜单; 都没有 -> false 由调用方提示
 */
export function openSelectionContextMenu(root: HTMLElement | null, anchor: MenuAnchor | null): boolean {
  if (root === null) {
    return false;
  }
  const row = findSelectedRow(root);
  if (row !== null) {
    const target = anchor ?? row.getBoundingClientRect();
    armMenuAnchor(target, false);
    dispatchRowContextMenu(row, target);
    return true;
  }
  // table 与插入位都靠点击各自的原生三点按钮让 jse 生成菜单; 程序派发的 click 不会被
  // installJseContextMenuGuard 的 isTrusted 过滤误判成 "新锚点", 预约的工具栏锚点保持有效
  const tablePointer = findSelectedTablePointer(root);
  if (tablePointer !== null) {
    armMenuAnchor(anchor ?? tablePointer.getBoundingClientRect(), false);
    tablePointer.click();
    return true;
  }
  const insertPointer = findSelectedInsertPointer(root);
  if (insertPointer === null) {
    return false;
  }
  armMenuAnchor(anchor ?? insertPointer.getBoundingClientRect(), false);
  insertPointer.click();
  return true;
}
// #endregion

// #region 原生菜单与入口接管

const POINTER_SELECTOR = ".jse-context-menu-pointer";
const NATIVE_MENU_SELECTOR = '.jse-contextmenu[role="menu"]';

/**
 * document 捕获阶段的三件:
 * 1) click 落在行内三点 / 插入线按钮上: 以这颗按钮为锚点预约, 菜单即从按钮里长出来;
 *    交互里这颗按钮只在选中内容上出现, 点击本身由 jse 处理 (打开菜单), 只换浮层.
 *    用 click 而不是 pointerdown: jse 在 click 上开菜单, 捕获阶段的 click 一定先于它的处理
 * 2) 右键: 记下鼠标位置作为玻璃菜单锚点 (jse 随后打开菜单时被 onRenderContextMenu 接管);
 *    插入线上右键同样接管 (插入菜单也走玻璃)
 * 3) 仍由 jse 原生渲染的菜单打开时, 点菜单外只收起菜单, 不再让底层行同时响应
 */
export function installJseContextMenuGuard(): () => void {
  const onClick = (event: MouseEvent): void => {
    // 只认真实点击: openSelectionContextMenu 里 insertPointer.click() 是程序派发 (isTrusted=false),
    // 它已经预约了工具栏锚点, 不能被这里的 "按钮矩形锚点" 覆盖
    if (!event.isTrusted) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const pointer = target.closest<HTMLElement>(POINTER_SELECTOR);
    if (pointer !== null && pointer.closest(".jse-main") !== null) {
      armFromElement(pointer);
    }
  };

  const onPointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const menu = document.querySelector<HTMLElement>(NATIVE_MENU_SELECTOR);
    if (menu === null) {
      return;
    }
    if (menu.contains(target)) {
      return;
    }
    // 只收起菜单, 本次按下不再传给底下的行 / 按钮 (关闭用菜单自己的 Escape 处理, 不冒泡到应用层)
    event.preventDefault();
    event.stopImmediatePropagation();
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: false }));
  };

  const onContextMenu = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element) || target.closest(".jse-main") === null) {
      return;
    }
    armMenuAnchor({ left: event.clientX, top: event.clientY, width: 0, height: 0 }, true);
  };

  // Ctrl+Q: jse 自带的 "打开上下文菜单" 快捷键. 在它处理之前预约锚点:
  // 选中插入位 -> 从插入线按钮长出来; 选中行 -> 从行内三点长出来; 都没有就交给 jse (多半无事发生)
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "q" || event.altKey) {
      return;
    }
    const target = event.target;
    const root =
      target instanceof Element
        ? (target.closest<HTMLElement>(".jse-host") ?? document.querySelector<HTMLElement>(".jse-host"))
        : document.querySelector<HTMLElement>(".jse-host");
    if (root === null) {
      return;
    }
    const insertPointer = findSelectedInsertPointer(root);
    if (insertPointer !== null) {
      armFromElement(insertPointer);
      return;
    }
    // table 模式选中单元格: 菜单从表格里那颗三点按钮长出来 (与工具栏同一份菜单项)
    const tablePointer = findSelectedTablePointer(root);
    if (tablePointer !== null) {
      armFromElement(tablePointer);
      return;
    }
    const row = findSelectedRow(root);
    if (row !== null) {
      const pointer = row.querySelector<HTMLElement>(".jse-context-menu-pointer:not(.jse-insert)");
      if (pointer !== null) {
        armFromElement(pointer);
      } else {
        const box = row.getBoundingClientRect();
        armMenuAnchor({ left: box.right, top: box.top, width: 0, height: 0 }, true);
      }
    }
  };

  document.addEventListener("click", onClick, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("contextmenu", onContextMenu, true);
  document.addEventListener("keydown", onKeyDown, true);
  return () => {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("contextmenu", onContextMenu, true);
    document.removeEventListener("keydown", onKeyDown, true);
  };
}
// #endregion
