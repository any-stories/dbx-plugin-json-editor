/**
 * 图标系统
 */

import type { ReactElement } from "react";
import {
  AlignLeft,
  ArrowDownAZ,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Code,
  Copy,
  Ellipsis,
  EllipsisVertical,
  File,
  FolderOpen,
  FoldVertical,
  Info,
  Laptop,
  type LucideIcon,
  Maximize,
  Menu,
  Minimize,
  Monitor,
  Moon,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  Settings,
  Shield,
  Shrink,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquareCheck,
  SquarePen,
  Sun,
  SunMoon,
  Table,
  TriangleAlert,
  UnfoldVertical,
  WandSparkles,
  X
} from "lucide-react";

const glyphs = {
  alignLeft: AlignLeft,
  caretDown: ChevronDown,
  check: Check,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  chevronUp: ChevronUp,
  code: Code,
  compact: Shrink,
  copy: Copy,
  // 弹框标题栏的关闭按钮 (X)
  close: X,
  edit: SquarePen,
  exitFullscreen: Minimize,
  file: File,
  folderOpen: FolderOpen,
  // 折叠全部: 箭头向中心聚拢 (与 jse 原生 Collapse all 图标同语义)
  foldVertical: FoldVertical,
  fullscreen: Maximize,
  info: Info,
  laptop: Laptop,
  menu: Menu,
  monitor: Monitor,
  moon: Moon,
  more: Ellipsis,
  moreVertical: EllipsisVertical,
  redo: RotateCw,
  save: Save,
  search: Search,
  settings: Settings,
  shield: Shield,
  sliders: SlidersHorizontal,
  sortAsc: ArrowDownAZ,
  sparkles: Sparkles,
  square: Square,
  squareCheck: SquareCheck,
  sun: Sun,
  sunMoon: SunMoon,
  table: Table,
  undo: RotateCcw,
  // 展开全部: 箭头向两端撑开
  unfoldVertical: UnfoldVertical,
  wand: WandSparkles,
  warning: TriangleAlert
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof glyphs;

interface IconProps {
  name: IconName;
  className?: string;
  /** 视觉尺寸, 默认跟随当前字号 (1em) */
  size?: string | number;
}

export function Icon({ name, className = "", size = "1em" }: IconProps): ReactElement {
  const Glyph = glyphs[name];
  return (
    <Glyph className={`icon ${className}`.trim()} size={size} strokeWidth={1.9} aria-hidden="true" focusable="false" />
  );
}
