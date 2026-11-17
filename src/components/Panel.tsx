/**
 * 面板容器
 */

import { useRef, type DragEvent, type ReactElement, type ReactNode } from "react";
import { useRefraction } from "@zakisheriff/liquid-glass";
import { useT } from "../i18n/useT";

interface PanelProps {
  pane: "left" | "right";
  /** 内联宽度: flex: `${ratio} 1 0%`, 一侧收起时比例为 0 */
  flex: string;
  /** 比例逼近端点时的淡出系数, 由 splitter 拖拽/收起的同一比例推导 */
  opacity: number;
  /** 收起态: 宽度收到 0, 动画结束后退出可见性 (含键盘焦点顺序与点击命中) */
  collapsed: boolean;
  focused: boolean;
  /** file-drop 遮罩: 拖拽悬停时叠加虚线目标 (over-frame) */
  dragging: boolean;
  /** 分隔条拖动中: 暂停折射图重建, 尺寸每帧都在变, 重算会掉帧 */
  resizing: boolean;
  onFocusPane: () => void;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDropFile: (file: File) => void;
  menu: ReactNode;
  children: ReactNode;
}

export function Panel({
  pane,
  flex,
  opacity,
  collapsed,
  focused,
  dragging,
  resizing,
  onFocusPane,
  onDragEnter,
  onDragLeave,
  onDropFile,
  menu,
  children
}: PanelProps): ReactElement {
  const t = useT();
  const panelRef = useRef<HTMLElement>(null);
  // surface 形状与 GlassCard 同参数 (bezel 16 / thickness 22): 折射集中在圆角边沿
  // resizing 时 enabled=false: 库会移除内联折射变量, backdrop-filter 退回纯模糊
  useRefraction(panelRef, { kind: "surface", bezel: 16, thickness: 22 }, !resizing);
  // 拖拽深度计数: dragenter/dragleave 在子元素间往返会成对触发, 计数归零才算真正离开
  const dragDepthRef = useRef(0);
  const handleDragEnter = () => {
    dragDepthRef.current += 1;
    onDragEnter();
  };
  const handleDragLeave = () => {
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      onDragLeave();
    }
  };
  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
  };
  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    const file = event.dataTransfer.files?.[0];
    onDragLeave();
    if (file !== undefined) {
      onDropFile(file);
    }
  };
  return (
    <section
      ref={panelRef}
      className={`lg-glass ${pane}-panel${focused ? " focus" : ""}${collapsed ? " is-collapsed" : ""}`}
      style={{ flex, opacity }}
      onPointerDown={onFocusPane}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="panel">
        <div className="file-drop">
          <div
            className={`file-drop-target${
              dragging ? " file-drop-dragging-over-frame file-drop-dragging-over-target" : ""
            }`}
          >
            <div className="drag-space-before" />
            <div className="drag-info">{t("panel.dragInfo")}</div>
            <div className="drag-space-after" />
          </div>
        </div>
        {menu}
        {children}
      </div>
    </section>
  );
}
