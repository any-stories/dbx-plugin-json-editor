/**
 * 面板间操作区
 *
 * 四组: Copy / Transform / Differences (Compare) / 差异计数导航 (常驻空组, 激活时填充)
 * 按钮全部用库的 GlassButton (sm 玻璃圆钮 / 胶囊, 带按压回弹与边缘折射);
 * 差异计数是只读小胶囊, 仍用 .lg-glass + useRefraction 让它与按钮同一材质
 */

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";
import { GlassButton, useRefraction } from "@zakisheriff/liquid-glass";
import type { ReactElement } from "react";
import { useT } from "../i18n/useT";

/** 窄屏下面板改为上下堆叠, 复制/转换箭头相应换成上下方向 */
function useIsVerticalLayout(): boolean {
  const query = "(max-width: 980px)";
  const [vertical, setVertical] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setVertical(event.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return vertical;
}

interface PanelActionsProps {
  hasLeftDoc: boolean;
  hasRightDoc: boolean;
  showDiff: boolean;
  /** diff 解析失败时的错误信息 */
  diffError: string | null;
  diffIndex: number;
  diffCount: number;
  onCopyLeft: () => void;
  onCopyRight: () => void;
  onTransformLeft: () => void;
  onTransformRight: () => void;
  onToggleDiff: () => void;
  onPrevDiff: () => void;
  onNextDiff: () => void;
}

export function PanelActions({
  hasLeftDoc,
  hasRightDoc,
  showDiff,
  diffError,
  diffIndex,
  diffCount,
  onCopyLeft,
  onCopyRight,
  onTransformLeft,
  onTransformRight,
  onToggleDiff,
  onPrevDiff,
  onNextDiff
}: PanelActionsProps): ReactElement {
  const t = useT();
  // 窄屏上下布局 (面板改为上下堆叠) 时, 复制/转换的箭头从左右换成上下, 方向与面板排布一致
  const vertical = useIsVerticalLayout();
  const toLeftIcon: IconName = vertical ? "chevronUp" : "chevronLeft";
  const toRightIcon: IconName = vertical ? "chevronDown" : "chevronRight";
  // 差异计数胶囊: 只读展示, 但与其他玻璃件同材质; 仅显示时才需要折射图
  const counterRef = useRef<HTMLDivElement>(null);
  useRefraction(counterRef, { kind: "surface" }, showDiff && diffError === null);
  // Compare 复选框 title 动态标注当前状态
  const compareTitle = `${t("actions.compareToggle")} (currently ${
    showDiff ? t("actions.currentlyEnabled") : t("actions.currentlyDisabled")
  })`;
  // 计数格式: `${index + 1}/${count} difference(s)`, 未导航时仅显示计数
  const diffCounterText = (diffIndex >= 0 ? `${diffIndex + 1}/` : "") + t("actions.diffCount", { count: diffCount });

  return (
    <div className="panel-actions">
      <div className="action-group">
        <div className="action-group-name">{t("actions.copyGroup")}</div>
        <div className="action-buttons">
          <GlassButton
            size="sm"
            variant="glass"
            icon={<Icon name={toLeftIcon} />}
            title={t("actions.copyLeft")}
            aria-label={t("actions.copyLeft")}
            disabled={!hasRightDoc}
            onClick={onCopyLeft}
          />
          <GlassButton
            size="sm"
            variant="glass"
            icon={<Icon name={toRightIcon} />}
            title={t("actions.copyRight")}
            aria-label={t("actions.copyRight")}
            disabled={!hasLeftDoc}
            onClick={onCopyRight}
          />
        </div>
      </div>
      <div className="action-group">
        <div className="action-group-name">{t("actions.transformGroup")}</div>
        <div className="action-buttons">
          <GlassButton
            size="sm"
            variant="glass"
            icon={<Icon name={toLeftIcon} />}
            title={t("actions.transformLeft")}
            aria-label={t("actions.transformLeft")}
            disabled={!hasRightDoc}
            onClick={onTransformLeft}
          />
          <GlassButton
            size="sm"
            variant="glass"
            icon={<Icon name={toRightIcon} />}
            title={t("actions.transformRight")}
            aria-label={t("actions.transformRight")}
            disabled={!hasLeftDoc}
            onClick={onTransformRight}
          />
        </div>
      </div>
      <div className="action-group">
        <GlassButton
          size="sm"
          variant={showDiff ? "tinted-filled" : "glass"}
          icon={<Icon name={showDiff ? "squareCheck" : "square"} />}
          title={compareTitle}
          onClick={onToggleDiff}
          disabled={!hasLeftDoc || !hasRightDoc}
        >
          {t("actions.compare")}
        </GlassButton>
      </div>
      {/* 常驻第 4 组: 空组占位, showDiff 时填充计数与导航 */}
      <div className="action-group">
        {showDiff ? (
          diffError !== null ? (
            <div className="diff-error" title={diffError}>
              {t("actions.diffError")}
            </div>
          ) : (
            <>
              <div ref={counterRef} className="diff-counter lg-glass">
                {diffCounterText}
              </div>
              <div className="action-buttons">
                <GlassButton
                  size="sm"
                  variant="glass"
                  icon={<Icon name="chevronUp" />}
                  title={t("actions.diffPrevious")}
                  aria-label={t("actions.diffPrevious")}
                  disabled={diffIndex <= 0}
                  onClick={onPrevDiff}
                />
                <GlassButton
                  size="sm"
                  variant="glass"
                  icon={<Icon name="chevronDown" />}
                  title={t("actions.diffNext")}
                  aria-label={t("actions.diffNext")}
                  disabled={diffIndex >= diffCount - 1}
                  onClick={onNextDiff}
                />
              </div>
            </>
          )
        ) : null}
      </div>
    </div>
  );
}
