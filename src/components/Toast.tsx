/**
 * 顶部通知
 */

import type { ReactElement } from "react";
import type { Notice } from "../core/workspace";

interface ToastProps {
  message: Notice | null;
}

export function Toast({ message }: ToastProps): ReactElement | null {
  if (message === null) {
    return null;
  }
  return (
    <div className="notification">
      <span>{message.text}</span>
      {message.action ? (
        <button type="button" className="action" onClick={message.action.onClick}>
          {message.action.label}
        </button>
      ) : null}
    </div>
  );
}
