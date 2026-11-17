/**
 * Transform 弹框的查询语言集合
 *
 * 顺序与命名: JSON Query / JMESPath / JSONPath / JavaScript
 * 语言数量大于 1 时, 编辑器在 Transform 弹框头部的右上角渲染查询语言切换按钮 (jse-config)
 */

import {
  jmespathQueryLanguage,
  jsonQueryLanguage,
  jsonpathQueryLanguage,
  lodashQueryLanguage,
  type QueryLanguage
} from "vanilla-jsoneditor";

export const QUERY_LANGUAGES: QueryLanguage[] = [
  { ...jsonQueryLanguage, name: "JSON Query" },
  jmespathQueryLanguage,
  jsonpathQueryLanguage,
  { ...lodashQueryLanguage, name: "JavaScript" }
];

// 默认查询语言 (面板 queryLanguageId 初值)
export const DEFAULT_QUERY_LANGUAGE_ID = jsonQueryLanguage.id;
