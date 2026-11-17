/**
 * i18n 取词器
 *
 * DBX 官方入口为 window.dbxPlugin.locale (当前语言), 插件 UI 文案由自带字典提供
 * en.ts / zh-CN.ts 为字典本体; React 绑定 (Provider/useT) 在 provider.tsx, 便于 fast refresh
 */

import en from "./en";
import zhCN from "./zh-CN";

export const SUPPORTED_LOCALES = ["en", "zh-CN"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export type Translator = (key: string, params?: Record<string, unknown>) => string;

const MESSAGES: Record<Locale, Record<string, unknown>> = {
  en: en as Record<string, unknown>,
  "zh-CN": zhCN as Record<string, unknown>
};

// 语言归一化: DBX locale 命中 zh 前缀即回退 zh-CN, 其余回退 en
export function normalizeLocale(locale: string): Locale {
  if (locale.toLowerCase().startsWith("zh")) {
    return "zh-CN";
  }
  return "en";
}

function resolveKey(dict: Record<string, unknown>, key: string): string | undefined {
  const value = key.split(".").reduce<unknown>((acc, part) => {
    if (acc !== null && typeof acc === "object") {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, dict);
  return typeof value === "string" ? value : undefined;
}

function interpolate(template: string, params: Record<string, unknown> | undefined): string {
  if (params === undefined) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

// 缺失键回退顺序: 当前字典 -> en 字典 -> 键名本身
export function createTranslator(locale: Locale): Translator {
  return (key, params) => {
    const text = resolveKey(MESSAGES[locale], key) ?? resolveKey(MESSAGES.en, key);
    if (text === undefined) {
      return key;
    }
    return interpolate(text, params);
  };
}
