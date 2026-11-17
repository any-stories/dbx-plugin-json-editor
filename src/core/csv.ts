/**
 * CSV 转换核心
 *
 * RFC4180 解析与 JSON 互转
 * Import 选项: delimiter (auto / comma / semicolon / tab / space), header, nested (点号字段展开为嵌套对象)
 * Export 选项: delimiter, header, flattenObject (嵌套对象展开为独立列), flattenArray (依赖 flattenObject)
 * 单元格值推断类型: 数字 / true / false / null / JSON 子文档, 其余保留字符串
 * 嵌套值在未展开时序列化为 JSON 字符串
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export type CsvDelimiter = "," | ";" | "\t" | " ";

export interface CsvExportOptions {
  header: boolean;
  delimiter: CsvDelimiter;
  flattenObject: boolean;
  flattenArray: boolean;
}

export interface CsvImportOptions {
  header: boolean;
  delimiter: CsvDelimiter | "auto";
  nested: boolean;
}

// 默认选项 (localStorage 键 csvExportOptions / csvImportOptions 的初始值)
export const DEFAULT_CSV_EXPORT_OPTIONS: CsvExportOptions = {
  header: true,
  delimiter: ",",
  flattenObject: true,
  flattenArray: false
};

export const DEFAULT_CSV_IMPORT_OPTIONS: CsvImportOptions = {
  header: true,
  delimiter: "auto",
  nested: true
};

// delimiter 下拉选项
export const EXPORT_DELIMITERS: Array<{ value: CsvDelimiter; label: string }> = [
  { value: ",", label: "comma" },
  { value: ";", label: "semicolon" },
  { value: "\t", label: "tab" },
  { value: " ", label: "space" }
];

export const IMPORT_DELIMITERS: Array<{ value: CsvImportOptions["delimiter"]; label: string }> = [
  { value: "auto", label: "auto" },
  ...EXPORT_DELIMITERS
];

// CSV 文件名转文档名: 去掉 .csv 后缀
export function csvFileNameToDocumentName(fileName: string): string {
  const stripped = fileName.replace(/\.csv$/i, "");
  return stripped === "" ? fileName : stripped;
}

// 文档名转 CSV 导出文件名: 去掉 .json/.csv 后缀后追加 .csv
export function csvExportFileName(documentName: string): string {
  const stripped = documentName.replace(/\.(json|csv)$/i, "");
  return `${stripped === "" ? documentName : stripped}.csv`;
}

// delimiter 自动探测: 取各候选字符在行内出现频次的加权得分
function detectDelimiter(content: string): CsvDelimiter {
  const sample = content.slice(0, 5000);
  const candidates: CsvDelimiter[] = [",", ";", "\t", " "];
  let best: CsvDelimiter = ",";
  let bestScore = -1;
  for (const candidate of candidates) {
    const count = sample.split(candidate).length - 1;
    if (count > bestScore) {
      bestScore = count;
      best = candidate;
    }
  }
  return best;
}

// 解析 CSV 为二维单元格表 (支持引号字段与 "" 转义, 按指定 delimiter 切分)
export function parseCsv(content: string, delimiter: CsvDelimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let index = 0;
  while (index < content.length) {
    const char = content[index];
    if (inQuotes) {
      if (char === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = "";
      index += 1;
      continue;
    }
    if (char === "\r" || char === "\n") {
      index = char === "\r" && content[index + 1] === "\n" ? index + 2 : index + 1;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      continue;
    }
    field += char;
    index += 1;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// 单元格值类型推断: 数字 / true / false / null / JSON 子文档
function convertCellValue(cell: string): unknown {
  if (cell === "") {
    return "";
  }
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(cell)) {
    return Number(cell);
  }
  if (cell === "true") {
    return true;
  }
  if (cell === "false") {
    return false;
  }
  if (cell === "null") {
    return null;
  }
  const first = cell[0];
  if (first === "{" || first === "[") {
    try {
      return JSON.parse(cell) as unknown;
    } catch {
      // 非 JSON 子文档时保留原始字符串
    }
  }
  return cell;
}

// 点号路径写入嵌套对象
function setNestedPath(target: Record<string, unknown>, path: string[], value: unknown): void {
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    const existing = cursor[key];
    if (!isRecord(existing)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[path[path.length - 1]] = value;
}

// CSV 转 JSON: header 开启时首行为表头, 其余行转对象数组; 关闭时每行转为数组
export function csvToJson(content: string, options: CsvImportOptions = DEFAULT_CSV_IMPORT_OPTIONS): unknown[] {
  const delimiter = options.delimiter === "auto" ? detectDelimiter(content) : options.delimiter;
  const rows = parseCsv(content, delimiter).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (rows.length === 0) {
    return [];
  }
  if (options.header) {
    const [header, ...dataRows] = rows;
    if (header === undefined) {
      return [];
    }
    return dataRows.map((row) => {
      const record: Record<string, unknown> = {};
      header.forEach((key, column) => {
        const value = convertCellValue(row[column] ?? "");
        if (options.nested && key.includes(".")) {
          setNestedPath(record, key.split("."), value);
        } else {
          record[key] = value;
        }
      });
      return record;
    });
  }
  return rows.map((row) => row.map((cell) => convertCellValue(cell)));
}

// 展开嵌套值: flattenObject 将对象路径展平为点号键; flattenArray 将数组索引并入路径
function flattenRecord(
  value: unknown,
  prefix: string,
  flattenObject: boolean,
  flattenArray: boolean,
  output: Record<string, unknown>
): void {
  if (Array.isArray(value)) {
    if (!flattenObject || !flattenArray) {
      output[prefix] = value;
      return;
    }
    if (value.length === 0) {
      output[prefix] = "";
      return;
    }
    value.forEach((item, index) => {
      flattenRecord(item, `${prefix}.${index}`, flattenObject, flattenArray, output);
    });
    return;
  }
  if (isRecord(value)) {
    if (!flattenObject) {
      output[prefix] = value;
      return;
    }
    const entries = Object.entries(value);
    if (entries.length === 0) {
      output[prefix] = "";
      return;
    }
    for (const [key, item] of entries) {
      flattenRecord(item, prefix === "" ? key : `${prefix}.${key}`, flattenObject, flattenArray, output);
    }
    return;
  }
  output[prefix] = value ?? "";
}

// 记录展平为单层键值行 (export 列推导)
function flattenRecordRow(record: unknown, options: CsvExportOptions): Record<string, unknown> {
  if (!options.flattenObject) {
    return isRecord(record) ? { ...record } : { "": record ?? "" };
  }
  const output: Record<string, unknown> = {};
  if (isRecord(record)) {
    for (const [key, item] of Object.entries(record)) {
      flattenRecord(item, key, options.flattenObject, options.flattenArray, output);
    }
  } else if (Array.isArray(record)) {
    flattenRecord(record, "", options.flattenObject, options.flattenArray, output);
  } else {
    output[""] = record ?? "";
  }
  return output;
}

function escapeCsvField(text: string, delimiter: CsvDelimiter): string {
  if (text.includes('"') || text.includes("\r") || text.includes("\n") || text.includes(delimiter)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function valueToCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value) ?? "";
  }
  return String(value);
}

// JSON 转 CSV: 对象数组 (或对象集合) 每条记录一行, 列取全部键的并集 (保持首条键序)
// header 关闭时仅输出数据行
export function jsonToCsv(value: unknown, options: CsvExportOptions = DEFAULT_CSV_EXPORT_OPTIONS): string {
  const records: unknown[] = Array.isArray(value) ? value : isRecord(value) ? Object.values(value) : [];
  if (records.length === 0) {
    throw new Error("the document must be an array of objects or an object of objects");
  }
  const rows = records.map((record) => flattenRecordRow(record, options));
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  const lines: string[] = [];
  if (options.header) {
    lines.push(columns.map((key) => escapeCsvField(key, options.delimiter)).join(options.delimiter));
  }
  for (const row of rows) {
    lines.push(columns.map((key) => escapeCsvField(valueToCell(row[key]), options.delimiter)).join(options.delimiter));
  }
  return lines.join("\r\n");
}
