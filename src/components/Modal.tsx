/**
 * 通用弹框外壳
 *
 * 全局弹窗淡入淡出 (hooks/useModalFade): 入场是 app.css 里的纯 CSS 动画
 * (遮罩淡入 + 卡片上浮回弹), 出场是 WAAPI 整层淡出, 播完才真正卸载;
 * ESC / 关闭按钮 / 遮罩点击统一走 beginClose
 */

import { useEffect, useId, useRef, type ReactElement, type ReactNode } from "react";
import { GlassCard } from "@zakisheriff/liquid-glass";
import { Icon } from "./Icon";
import { useT } from "../i18n/useT";
import { useModalFade } from "../hooks/useModalFade";

export interface ModalProps {
  /** 弹框标题 */
  title: string;
  /** 标题前置图标 */
  icon?: ReactNode;
  /** 变体名: 同时用于 modal-foreground 与 modal 的类名 (如 configuration / csv-import) */
  variant: string;
  /** 点击遮罩 (弹框外的暗色区域) 是否关闭: 有草稿的弹框保持 false, 只读弹框传 true */
  closeOnBackdrop?: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, icon, variant, closeOnBackdrop = false, onClose, children }: ModalProps): ReactElement {
  const t = useT();
  const titleId = useId();
  // 弹框窗口直接用库的 GlassCard: 内部即 .lg-glass + useRefraction(surface),
  // 与面板 / 菜单 / 按钮同一套材质, 不再手写一层等价的玻璃根节点
  // 关闭淡出走全局机制: 根元素整层淡出, 播完才调 onClose 卸载
  const rootRef = useRef<HTMLDivElement>(null);
  const { closing, beginClose } = useModalFade(rootRef, onClose);
  // ESC 关闭: 监听器仅注册一次, 统一入口 beginClose 内部取最新回调
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

  return (
    <div
      ref={rootRef}
      className={`modal-background${closing ? " is-closing" : ""}`}
      onClick={(event) => {
        // 遮罩 = 弹框窗口本身以外的区域; 弹框内的点击不冒泡处理
        if (closeOnBackdrop && event.target === event.currentTarget) {
          beginClose();
        }
      }}
    >
      <GlassCard
        className={`modal-foreground ${variant}`}
        padding="0"
        radius="var(--lg-radius-lg)"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-titlebar">
          <span className="modal-titlebar-space" aria-hidden="true" />
          <h1 className="modal-title" id={titleId}>
            {icon === undefined ? (
              title
            ) : (
              <>
                {icon} {title}
              </>
            )}
          </h1>
          <button
            type="button"
            className="modal-close"
            aria-label={t("app.closeDialog")}
            title={t("app.closeDialog")}
            onClick={beginClose}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className={`modal modal-${variant}`}>{children}</div>
      </GlassCard>
    </div>
  );
}
