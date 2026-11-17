/**
 * jse tooltip 面板内钳制
 *
 * jse 的 .jse-tooltip 走 openAbsolutePopup 的手写定位 (不是 floating-ui): 把提示的左缘
 * 对齐锚点 (timestamp 时钟图标) 的左缘, 只用 window.innerWidth 判断要不要翻到左侧, 完全
 * 不知道编辑器 panel 的边界. 面板只有 ~654px 宽, 而 timestamp 提示文案很长
 * ("Time: Thu Nov 12 2026 11:39:01 GMT+0800 (中国标准时间)" ~390px), 于是提示右缘冲出面板,
 * 被 .panel-contents 的 overflow:hidden 裁掉尾部 (左右面板都会出现, 越靠右的值越明显).
 *
 * 库内部定位没有 boundary 配置项可改, 这里在提示插入 DOM 后量它与所属 .panel-contents 的
 * 边界, 用 transform 把它平移回边界内 (只读地叠加位移, 不改 jse 写在 popup-content 上的
 * left/bottom, 那些值 jse 会重写). 两个轴都钳制: 横向防面板边缘裁切, 纵向防顶部溢出.
 * 提示比面板还宽时优先贴左边, 保证开头文字可见.
 */

/** jse 浮层提示 (tooltip / 柱状提示) 的统一类名 */
const TOOLTIP_SELECTOR = ".jse-tooltip";
/** 提示与面板边界保留的呼吸间距 */
const CLAMP_PAD = 10;

/** 把单个提示钳制回它所属面板的内容区; 面板不存在时不动 (安全降级) */
function clampTooltip(tip: HTMLElement): void {
  const bounds = tip.closest<HTMLElement>(".panel-contents") ?? tip.closest<HTMLElement>(".panel");
  if (bounds === null) {
    return;
  }
  // 先清掉上次位移再量, 否则重复钳制会在旧 transform 上叠加
  tip.style.transform = "";
  const tipRect = tip.getBoundingClientRect();
  const boxRect = bounds.getBoundingClientRect();

  const minLeft = boxRect.left + CLAMP_PAD;
  const minTop = boxRect.top + CLAMP_PAD;
  // 提示比可用空间还宽/高时, max 收敛到 min, 优先让左上角贴边, 宁可尾部被裁也保住开头
  const maxLeft = Math.max(minLeft, boxRect.right - CLAMP_PAD - tipRect.width);
  const maxTop = Math.max(minTop, boxRect.bottom - CLAMP_PAD - tipRect.height);
  const targetLeft = Math.min(Math.max(tipRect.left, minLeft), maxLeft);
  const targetTop = Math.min(Math.max(tipRect.top, minTop), maxTop);

  const dx = Math.round(targetLeft - tipRect.left);
  const dy = Math.round(targetTop - tipRect.top);
  if (dx !== 0 || dy !== 0) {
    tip.style.transform = `translate(${dx}px, ${dy}px)`;
  }
}

/**
 * 安装全局钳制: 监听提示节点插入 (jse 在 mouseenter 时才创建, 不在 React 树里, 拿不到引用),
 * 插入后在下一帧测量并平移. 返回卸载函数, 与 installJseContextMenuGuard 同一套生命周期.
 */
export function installJseTooltipBounds(): () => void {
  const observer = new MutationObserver((records) => {
    let addedTip = false;
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (
          node instanceof HTMLElement &&
          (node.matches(TOOLTIP_SELECTOR) || node.querySelector(TOOLTIP_SELECTOR) !== null)
        ) {
          addedTip = true;
          break;
        }
      }
      if (addedTip) {
        break;
      }
    }
    if (!addedTip) {
      return;
    }
    // 等这一帧的样式与布局落定 (文案是 svelte 响应式写入的), 再量尺寸
    requestAnimationFrame(() => {
      for (const tip of document.querySelectorAll<HTMLElement>(TOOLTIP_SELECTOR)) {
        clampTooltip(tip);
      }
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}
