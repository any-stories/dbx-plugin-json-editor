/**
 * Nice Day Card 弹窗组件
 */

import { useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { GlassButton, SPRINGS, createSpring, usePress, useRefraction } from "@zakisheriff/liquid-glass";
import { Icon } from "./Icon";
import { HeartParticles } from "./HeartParticles";
import { useT } from "../i18n/useT";
import { useModalFade } from "../hooks/useModalFade";
import { BODY_LINES, HEART_ICON, MONTHS, QUESTION_TEXT } from "../config/niceDay";

const TYPE_INTERVAL_MS = 34;
const ERASE_INTERVAL_MS = 24;
const HOLD_AFTER_QUESTION_MS = 900;
const PAUSE_AFTER_ERASE_MS = 420;

/** 打字机时间线 */
const TYPE_FRAMES: Array<{ text: string; delay: number }> = (() => {
  const frames: Array<{ text: string; delay: number }> = [];
  const answer = BODY_LINES.join("\n");
  for (let i = 1; i <= QUESTION_TEXT.length; i++) {
    frames.push({ text: QUESTION_TEXT.slice(0, i), delay: TYPE_INTERVAL_MS });
  }
  frames.push({ text: QUESTION_TEXT, delay: HOLD_AFTER_QUESTION_MS });
  for (let i = QUESTION_TEXT.length - 1; i >= 0; i--) {
    frames.push({ text: QUESTION_TEXT.slice(0, i), delay: ERASE_INTERVAL_MS });
  }
  frames.push({ text: "", delay: PAUSE_AFTER_ERASE_MS });
  for (let i = 1; i <= answer.length; i++) {
    frames.push({ text: answer.slice(0, i), delay: TYPE_INTERVAL_MS });
  }
  return frames;
})();

interface NiceDayCardProps {
  onClose: () => void;
}

export function NiceDayCard({ onClose }: NiceDayCardProps): ReactElement {
  const t = useT();
  const today = new Date();
  const title = `Nice Day ${MONTHS[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()}`;
  // 标题栏显示完整日期, 正文按预生成时间线播放 打字 → 退格 → 打字
  const [frame, setFrame] = useState(0);
  const layerRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const blobRef = useRef<HTMLDivElement>(null);
  // 关闭走全局弹窗淡出: is-closing 只屏蔽指针, 整层 WAAPI 淡出播完才卸载
  const { closing, beginClose } = useModalFade(layerRef, onClose);

  // 打字机: 逐帧推进时间线, 每帧按自身 delay 停留; 播完停在最后一帧 (完整回答)
  useEffect(() => {
    if (frame >= TYPE_FRAMES.length) {
      return undefined;
    }
    const timer = window.setTimeout(() => setFrame((value) => value + 1), TYPE_FRAMES[frame].delay);
    return () => window.clearTimeout(timer);
  }, [frame]);

  // ESC 关闭 (同样走淡出)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        beginClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [beginClose]);

  // 厚透镜折射 + 按压/拖拽的果冻形变
  useRefraction(blobRef, { kind: "lens", zoom: 1.035, thickness: 64, bezel: 40, dispersion: 0.7 });
  usePress(blobRef, { grow: 0.05, lean: 0, stretch: 0.1 });

  // 弹簧拖拽
  useEffect(() => {
    const anchor = anchorRef.current;
    const blob = blobRef.current;
    if (anchor === null || blob === null) {
      return undefined;
    }

    let x = 0;
    let y = 0;
    const paint = () => {
      blob.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    };
    const springX = createSpring(0, SPRINGS.drag, (value) => {
      x = value;
      paint();
    });
    const springY = createSpring(0, SPRINGS.drag, (value) => {
      y = value;
      paint();
    });

    // 锚点 (未位移的居中容器) 的矩形不受 blob 的 transform / usePress 的 scale 影响;
    // 按下时量一次并缓存, 拖拽期间不重复读布局, 避免逐帧 reflow 与坐标漂移
    let baseLeft = 0;
    let baseTop = 0;
    const measureBase = () => {
      const rect = anchor.getBoundingClientRect();
      baseLeft = rect.left;
      baseTop = rect.top;
    };
    const clamp = (value: number, axis: "x" | "y"): number => {
      const size = axis === "x" ? blob.offsetWidth : blob.offsetHeight;
      const viewport = axis === "x" ? window.innerWidth : window.innerHeight;
      const start = axis === "x" ? baseLeft : baseTop;
      const low = Math.min(12 - start, viewport - size - 12 - start);
      const high = Math.max(12 - start, viewport - size - 12 - start);
      return Math.max(low, Math.min(value, high));
    };
    measureBase();

    let drag: { id: number; dx: number; dy: number } | null = null;

    const down = (event: PointerEvent) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest("button") !== null) {
        return;
      }
      measureBase();
      drag = {
        id: event.pointerId,
        dx: event.clientX - baseLeft - x,
        dy: event.clientY - baseTop - y
      };
      try {
        blob.setPointerCapture(event.pointerId);
      } catch {
        // 合成 PointerEvent (自动化 / 无障碍驱动) 没有活动指针, 捕获失败不影响拖拽状态机
      }
      springX.tune(SPRINGS.drag);
      springY.tune(SPRINGS.drag);
      blob.dataset.dragging = "";
    };

    const move = (event: PointerEvent) => {
      if (drag === null || event.pointerId !== drag.id) {
        return;
      }
      springX.set(clamp(event.clientX - drag.dx - baseLeft, "x"));
      springY.set(clamp(event.clientY - drag.dy - baseTop, "y"));
    };

    const up = (event: PointerEvent) => {
      if (drag === null || event.pointerId !== drag.id) {
        return;
      }
      drag = null;
      delete blob.dataset.dragging;
      springX.tune(SPRINGS.release);
      springY.tune(SPRINGS.release);
      springX.set(clamp(springX.target, "x"));
      springY.set(clamp(springY.target, "y"));
      try {
        if (blob.hasPointerCapture(event.pointerId)) {
          blob.releasePointerCapture(event.pointerId);
        }
      } catch {
        // 同上
      }
    };

    const onResize = () => {
      measureBase();
      springX.set(clamp(springX.target, "x"));
      springY.set(clamp(springY.target, "y"));
    };

    blob.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("resize", onResize);
    return () => {
      blob.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("resize", onResize);
      springX.stop();
      springY.stop();
    };
  }, []);

  const bodyTyped = frame < TYPE_FRAMES.length ? TYPE_FRAMES[frame].text : TYPE_FRAMES[TYPE_FRAMES.length - 1].text;
  const bodyLines = bodyTyped.split("\n");
  const caret = <span className="nice-day-caret" aria-hidden="true" />;

  return createPortal(
    <div ref={layerRef} className={`nice-day-layer${closing ? " is-closing" : ""}`}>
      {/* 遮罩纯视觉: 点空白处不关闭, 只留 Esc 与右上角关闭按钮两个入口.
          pointer-events 仍由 CSS 保持 auto, 拦住点击不穿透到下层编辑器 */}
      <div className="nice-day-backdrop" />
      {/* 只在打开时挂载: 关闭即卸载 canvas / rAF */}
      <HeartParticles />
      <div ref={anchorRef} className="nice-day-anchor">
        <div ref={blobRef} className="nice-day-blob lg-glass" role="dialog" aria-modal="true" aria-label={title}>
          <div className="nice-day-titlebar">
            <img className="nice-day-heart" src={HEART_ICON} alt="" />
            <span className="nice-day-titlebar-title">{title}</span>
            <GlassButton
              size="sm"
              variant="glass"
              className="nice-day-close"
              icon={<Icon name="close" />}
              title={t("app.closeDialog")}
              aria-label={t("app.closeDialog")}
              onClick={beginClose}
            />
          </div>
          <div className="nice-day-content">
            <div className="nice-day-lines">
              {bodyLines.map((line, index) => (
                <p className="nice-day-line" key={index}>
                  {line}
                  {index === bodyLines.length - 1 ? caret : null}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
