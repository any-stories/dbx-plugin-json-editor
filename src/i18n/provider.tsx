/**
 * I18nProvider
 *
 * i18n React 绑定 (仅导出组件, 保证 fast refresh)
 * locale 变化由 App 层驱动: 默认 en, dbx.init 后与 onContextChange 时取宿主值
 * useT 在 useT.ts 单独导出, 组件按需引用
 */

import type { ReactElement, ReactNode } from "react";
import { LocaleContext } from "./useT";
import type { Locale } from "./index";

interface I18nProviderProps {
  locale: Locale;
  children: ReactNode;
}

export function I18nProvider({ locale, children }: I18nProviderProps): ReactElement {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}
