/**
 * 通用确认弹框
 *
 * New 关闭占用当前文档前提示内容将被丢弃
 */

import type { ReactElement } from "react";
import { GlassButton } from "@zakisheriff/liquid-glass";
import { Modal } from "./Modal";
import { useT } from "../i18n/useT";

interface ConfirmModalProps {
  title: string;
  message: string;
  /** 确认按钮文案 */
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmModal({ title, message, confirmLabel, onConfirm, onClose }: ConfirmModalProps): ReactElement {
  const t = useT();
  return (
    <Modal title={title} variant="confirm" onClose={onClose}>
      <div className="modal-contents">{message}</div>
      <div className="modal-action-menu">
        <GlassButton size="sm" variant="glass" onClick={onClose}>
          {t("confirm.cancel")}
        </GlassButton>
        <GlassButton size="sm" variant="filled" onClick={onConfirm}>
          {confirmLabel}
        </GlassButton>
      </div>
    </Modal>
  );
}
