/**
 * JSON 解析器选择
 *
 * native = 浏览器内建 JSON 解析器, 快速但不支持超长数字
 * lossless = lossless-json 解析器, 保留长数字的原始格式
 * auto = 文档不超过体量阈值时使用 lossless, 超过后使用 native
 */

import { parse as parseLossless, stringify as stringifyLossless } from "lossless-json";
import type { JSONParser } from "vanilla-jsoneditor";
import type { ParserId } from "./editorConfig";

// auto 档的体量阈值 (字符数): 超过即切换 native 解析器
export const AUTO_PARSER_SIZE_LIMIT = 1_000_000;

const nativeParser: JSONParser = JSON;

const losslessParser: JSONParser = {
  parse: (text) => parseLossless(text),
  // 缩进档位必须透传: 编辑器的格式化 / 表格单元格 / 状态栏都通过 parser.stringify 的第三参指定缩进,
  // 丢参会退化成压缩输出 (表现为"格式化后反而变一行")
  stringify: (value, _replacer, indentation) => stringifyLossless(value, null, indentation) ?? undefined
};

export function getParser(parserId: ParserId, contentLength: number): JSONParser {
  if (parserId === "native") {
    return nativeParser;
  }
  if (parserId === "lossless") {
    return losslessParser;
  }
  return contentLength <= AUTO_PARSER_SIZE_LIMIT ? losslessParser : nativeParser;
}
