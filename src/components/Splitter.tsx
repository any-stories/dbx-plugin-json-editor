/**
 * 可拖拽分隔条
 *
 * 图标随状态切换: 两侧可见 ellipsis-vertical, 仅左可见 chevron-right (指向收起的右侧),
 * 仅右可见 chevron-left (指向收起的左侧); 点击恢复收起一侧
 * 拖拽逻辑由 App 的 startResize 回调注入, 本组件只负责展示
 */

import type { PointerEvent, Ref, ReactElement } from "react";
import { Icon } from "./Icon";
import { useT } from "../i18n/useT";

interface SplitterProps {
  bothVisible: boolean;
  leftVisible: boolean;
  /** App 侧量取 splitter 位置用于拖拽锚点 */
  innerRef?: Ref<HTMLDivElement>;
  onDragStart: (event: PointerEvent<HTMLDivElement>) => void;
}

export function Splitter({ bothVisible, leftVisible, innerRef, onDragStart }: SplitterProps): ReactElement {
  const t = useT();
  const icon = bothVisible ? "moreVertical" : leftVisible ? "chevronRight" : "chevronLeft";
  return (
    <div
      ref={innerRef}
      className="draggable-splitter"
      onPointerDown={onDragStart}
      role="separator"
      aria-orientation="vertical"
      title={t("actions.splitter")}
    >
      <div className="draggable-splitter-icon">
        <Icon name={icon} />
      </div>
    </div>
  );
}
