/**
 * 全局弹窗淡入/淡出
 *
 * 入场走纯 CSS 动画 (新挂载节点必然播放, 由 app.css 的 modal-*-in /
 * nice-day-*-in 提供); 出场不能通过"改类名重播 CSS 动画 / transition"实现:
 * 在已挂载元素上替换 animation-name 会冻结在第一帧 (经 CDP 页内 rAF
 * 采样验证), 因此统一用 Web Animations API: 对弹窗根元素 el.animate()
 * 整层淡出, 播完 (finished promise) 才回调真正卸载, 动画进度与卸载
 * 严格同步
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

const REDUCED =
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** 全局统一的出场淡出时长 */
export const MODAL_FADE_OUT_MS = REDUCED ? 1 : 260;

export interface ModalFade {
  /** true = 正在播出场淡出 (根元素挂 is-closing, 仅用于 CSS 屏蔽指针事件) */
  closing: boolean;
  /** 关闭统一入口: 幂等, 淡出播完才调 onClose */
  beginClose: () => void;
}

/**
 * 弹窗关闭过渡: 关闭入口 (ESC / 关闭按钮 / 遮罩点击) 统一走 beginClose,
 * 对 rootRef 指向的弹窗根元素播整层淡出, 播完再调 onClose 卸载
 */
export function useModalFade(rootRef: RefObject<HTMLElement | null>, onClose: () => void): ModalFade {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const beginClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    // finish 幂等
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      closeRef.current();
    };
    const root = rootRef.current;
    if (root === null || MODAL_FADE_OUT_MS <= 1) {
      finish();
      return;
    }
    // 起点取当前计算值
    const anim = root.animate([{ opacity: getComputedStyle(root).opacity }, { opacity: "0" }], {
      duration: MODAL_FADE_OUT_MS,
      easing: "ease-in",
      fill: "forwards"
    });
    window.setTimeout(finish, MODAL_FADE_OUT_MS + 120);
    anim.finished.then(finish, finish);
  }, [rootRef]);

  return { closing, beginClose };
}
