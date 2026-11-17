/**
 * useT
 *
 * i18n React Hook (单独成文件, 保证 fast refresh 与组件导出规则)
 */

import { createContext, useContext, useMemo } from "react";
import { createTranslator, type Locale, type Translator } from "./index";

export const LocaleContext = createContext<Locale>("en");

export function useT(): Translator {
  const locale = useContext(LocaleContext);
  return useMemo(() => createTranslator(locale), [locale]);
}
