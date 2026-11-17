/**
 * 顶栏
 *
 * 玻璃工具栏
 */

import type { ReactElement, ReactNode, RefObject } from "react";
import { useRef } from "react";
import { GlassMenu, type GlassMenuItem, useRefraction } from "@zakisheriff/liquid-glass";
import { BrandLogo } from "./BrandLogo";
import { Icon, type IconName } from "./Icon";
import { useT } from "../i18n/useT";
import type { AppearanceMode } from "../core/workspace";

interface ApplicationMenuProps {
  appearanceMode: AppearanceMode;
  onAppearanceMode: (mode: AppearanceMode) => void;
  /** 打开 Configuration 弹框 */
  onOpenConfiguration: () => void;
  /** 点击所有字符后 */
  onOpenNiceDay: () => void;
}

/** 库 GlassMenu 没有 separator 类型: 用一颗禁用的空项承载分隔线 */
const separator: GlassMenuItem = {
  label: <span className="ctx-menu-sep" />,
  disabled: true
};

/** 分组标题同理: disabled 项 + .ctx-menu-header */
const header = (text: string): GlassMenuItem => ({
  label: <span className="ctx-menu-header">{text}</span>,
  disabled: true
});

/** 库的菜单项没有 title 字段, 把悬浮说明挂在文案元素上 */
function labeled(label: string, title: string): ReactNode {
  return <span title={title}>{label}</span>;
}

export function ApplicationMenu({
  appearanceMode,
  onAppearanceMode,
  onOpenConfiguration,
  onOpenNiceDay
}: ApplicationMenuProps): ReactElement {
  const t = useT();
  // 顶栏是一条细长液态玻璃 (.lg-glass + surface 折射), 高度 50px, 默认 bezel/thickness 按短边自适应
  const headerRef = useRef<HTMLElement>(null);
  useRefraction(headerRef as RefObject<HTMLElement | null>, { kind: "surface" });
  // Settings 按钮 title 动态标注当前主题
  const currentThemeLabel =
    appearanceMode === "auto"
      ? t("app.themeBrowserDefault")
      : appearanceMode === "light"
        ? t("app.themeLight")
        : t("app.themeDark");

  const items: GlassMenuItem[] = [
    header(t("app.themeGroup")),
    ...(
      [
        ["auto", "app.themeBrowserDefault", "app.themeBrowserDefaultTitle", "sunMoon"],
        ["light", "app.themeLight", "app.themeLightTitle", "sun"],
        ["dark", "app.themeDark", "app.themeDarkTitle", "moon"]
      ] as Array<[AppearanceMode, string, string, IconName]>
    ).map(([mode, labelKey, titleKey, icon]) => ({
      icon: <Icon name={icon} />,
      label: labeled(t(labelKey), t(titleKey)),
      checked: appearanceMode === mode,
      onSelect: () => onAppearanceMode(mode)
    })),
    separator,
    header(t("app.configurationGroup")),
    {
      icon: <Icon name="settings" />,
      label: labeled(t("app.configuration"), t("app.configurationTitle")),
      onSelect: onOpenConfiguration
    }
  ];

  return (
    <header ref={headerRef} className="lg-glass application-menu">
      <nav className="application-menu__nav">
        {/* Nice day 入口: 点完品牌字标所有可点击字符后触发 */}
        <BrandLogo onAllClicked={onOpenNiceDay} />
        <div className="application-menu__space" />
        {/* label + checkbox 控制 .menu-button-group 展开 */}
        <label className="application-menu__hamburger" htmlFor="hamburger-menu" title={t("app.toggleMainMenu")}>
          <Icon name="menu" />
        </label>
        <input id="hamburger-menu" type="checkbox" className="application-menu__hamburger-input" />
        <div className="application-menu__group">
          <GlassMenu
            icon={
              <span className="settings-menu-trigger" title={t("app.settingsTitle", { theme: currentThemeLabel })}>
                <Icon name="settings" />
                <span className="settings-label">{t("app.settings")}</span>
                <Icon name="caretDown" />
              </span>
            }
            items={items}
            aria-label={t("app.settings")}
            align="end"
            size="sm"
            width={232}
            className="settings-menu-glass"
          />
        </div>
      </nav>
    </header>
  );
}
