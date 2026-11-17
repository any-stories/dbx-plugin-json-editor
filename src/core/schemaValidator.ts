/**
 * 纯 JS JSON Schema 校验器 (无 eval / new Function)
 *
 * 背景: Ajv 的 compile() 用 new Function() 动态生成校验函数. 插件宿主 iframe 的 CSP 是
 * `script-src 'unsafe-inline' blob: http://dbx-plugin.localhost`, 不含 unsafe-eval,
 * 因此编译任何 Schema 都会抛 "Evaluating a string as JavaScript violates ... unsafe-eval".
 * 独立浏览器调试没有这条 CSP 所以正常, 这正是"网页调试没问题, 插件内报错"的根因.
 *
 * 本模块用解释执行替代代码生成, 覆盖 draft-07 常用关键字, 输出与 vanilla-jsoneditor 的
 * Validator 契约一致 ({ path, message, severity }), 网页与插件行为完全一致. format 一律
 * 忽略 (与原有 strictSchema:false 的降级策略一致, 不产生告警噪音).
 *
 * 两个入口:
 * - validateSchemaStructure: 配置页试编译, 检查 Schema 自身结构是否合法 (替代 Ajv.compile 的抛错)
 * - createJsonSchemaValidator: 运行时按 Schema 校验文档, 返回 jse 可用的 ValidationError[]
 */

import { ValidationSeverity, type JSONSchema, type ValidationError } from "vanilla-jsoneditor";

type JsonPath = string[];

export type SchemaValidator = (json: unknown) => ValidationError[];

const TYPE_NAMES = new Set(["string", "number", "integer", "boolean", "object", "array", "null"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    return ak.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(b, key) &&
        deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    );
  }
  return false;
}

function makeError(path: JsonPath, message: string): ValidationError {
  return { path, message, severity: ValidationSeverity.warning };
}

function typeMatches(value: unknown, expected: string): boolean {
  const actual = jsonType(value);
  if (expected === "number") {
    return actual === "number" || actual === "integer";
  }
  return actual === expected;
}

/** 解析本地 $ref (#/definitions/foo), 返回目标 Schema; 非本地或无法解析返回 null */
function resolveLocalRef(ref: string, root: JSONSchema): JSONSchema | null {
  if (!ref.startsWith("#/")) return null;
  const segments = ref
    .slice(2)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
  let node: unknown = root;
  for (const segment of segments) {
    if (!isPlainObject(node) || !Object.prototype.hasOwnProperty.call(node, segment)) return null;
    node = node[segment];
  }
  return isPlainObject(node) ? (node as JSONSchema) : null;
}

const MAX_DEPTH = 64;

function validateNode(
  schema: JSONSchema,
  value: unknown,
  path: JsonPath,
  root: JSONSchema,
  errors: ValidationError[],
  depth: number
): void {
  if (depth > MAX_DEPTH || !isPlainObject(schema)) return;

  // $ref: draft-07 中同级关键字应被忽略, 直接校验引用目标
  if (typeof schema.$ref === "string") {
    const target = resolveLocalRef(schema.$ref, root);
    if (target !== null) validateNode(target, value, path, root, errors, depth + 1);
    return;
  }

  // type
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? (schema.type as unknown[]) : [schema.type];
    if (!types.some((type) => typeof type === "string" && typeMatches(value, type))) {
      const label = types.map((type) => String(type)).join(" or ");
      errors.push(makeError(path, `must be ${label}`));
      return;
    }
  }

  // enum / const
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.some((candidate) => deepEqual(candidate, value))) {
      const shown = schema.enum.slice(0, 5).map((item) => JSON.stringify(item));
      if (schema.enum.length > 5) shown.push(`(${schema.enum.length - 5} more...)`);
      errors.push(makeError(path, `should be equal to one of: ${shown.join(", ")}`));
    }
  }
  if (Object.prototype.hasOwnProperty.call(schema, "const") && !deepEqual(schema.const, value)) {
    errors.push(makeError(path, `must be equal to constant ${JSON.stringify(schema.const)}`));
  }

  // 字符串约束
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push(makeError(path, `must NOT have fewer than ${schema.minLength} characters`));
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      errors.push(makeError(path, `must NOT have more than ${schema.maxLength} characters`));
    }
    if (typeof schema.pattern === "string") {
      try {
        if (!new RegExp(schema.pattern).test(value)) {
          errors.push(makeError(path, `must match pattern "${schema.pattern}"`));
        }
      } catch {
        // 非法正则由 validateSchemaStructure 拦截, 这里不重复报错
      }
    }
  }

  // 数值约束
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push(makeError(path, `must be >= ${schema.minimum}`));
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push(makeError(path, `must be <= ${schema.maximum}`));
    }
    // draft-07 数值形式; draft-04 布尔形式 (exclusiveMinimum:true 配合 minimum) 也兼容
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) {
      errors.push(makeError(path, `must be > ${schema.exclusiveMinimum}`));
    } else if (schema.exclusiveMinimum === true && typeof schema.minimum === "number" && value <= schema.minimum) {
      errors.push(makeError(path, `must be > ${schema.minimum}`));
    }
    if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) {
      errors.push(makeError(path, `must be < ${schema.exclusiveMaximum}`));
    } else if (schema.exclusiveMaximum === true && typeof schema.maximum === "number" && value >= schema.maximum) {
      errors.push(makeError(path, `must be < ${schema.maximum}`));
    }
    if (typeof schema.multipleOf === "number" && schema.multipleOf > 0) {
      const quotient = value / schema.multipleOf;
      if (Math.abs(quotient - Math.round(quotient)) > 1e-9) {
        errors.push(makeError(path, `must be multiple of ${schema.multipleOf}`));
      }
    }
  }

  // 对象约束
  if (isPlainObject(value)) {
    const properties = isPlainObject(schema.properties) ? (schema.properties as Record<string, JSONSchema>) : {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === "string" && !Object.prototype.hasOwnProperty.call(value, key)) {
          errors.push(makeError(path, `must have required property '${key}'`));
        }
      }
    }
    for (const key of Object.keys(value)) {
      if (Object.prototype.hasOwnProperty.call(properties, key)) {
        validateNode(properties[key], value[key], [...path, key], root, errors, depth + 1);
      } else if (schema.additionalProperties === false) {
        errors.push(makeError(path, `should NOT have additional property: ${key}`));
      } else if (isPlainObject(schema.additionalProperties)) {
        validateNode(schema.additionalProperties as JSONSchema, value[key], [...path, key], root, errors, depth + 1);
      }
    }
    const keyCount = Object.keys(value).length;
    if (typeof schema.minProperties === "number" && keyCount < schema.minProperties) {
      errors.push(makeError(path, `must NOT have fewer than ${schema.minProperties} properties`));
    }
    if (typeof schema.maxProperties === "number" && keyCount > schema.maxProperties) {
      errors.push(makeError(path, `must NOT have more than ${schema.maxProperties} properties`));
    }
  }

  // 数组约束
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(makeError(path, `must NOT have fewer than ${schema.minItems} items`));
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errors.push(makeError(path, `must NOT have more than ${schema.maxItems} items`));
    }
    if (schema.uniqueItems === true) {
      for (let i = 0; i < value.length; i++) {
        for (let j = i + 1; j < value.length; j++) {
          if (deepEqual(value[i], value[j])) {
            errors.push(makeError(path, `must NOT have duplicate items (items ## ${i} and ${j} are identical)`));
            break;
          }
        }
      }
    }
    if (Array.isArray(schema.items)) {
      schema.items.forEach((itemSchema, index) => {
        if (index < value.length) {
          validateNode(itemSchema as JSONSchema, value[index], [...path, String(index)], root, errors, depth + 1);
        }
      });
    } else if (isPlainObject(schema.items)) {
      value.forEach((item, index) => {
        validateNode(schema.items as JSONSchema, item, [...path, String(index)], root, errors, depth + 1);
      });
    }
  }

  // 组合关键字
  if (Array.isArray(schema.allOf)) {
    schema.allOf.forEach((sub) => validateNode(sub as JSONSchema, value, path, root, errors, depth + 1));
  }
  if (Array.isArray(schema.anyOf)) {
    const ok = schema.anyOf.some((sub) => {
      const subErrors: ValidationError[] = [];
      validateNode(sub as JSONSchema, value, path, root, subErrors, depth + 1);
      return subErrors.length === 0;
    });
    if (!ok) errors.push(makeError(path, "must match some schema in anyOf"));
  }
  if (Array.isArray(schema.oneOf)) {
    const matched = schema.oneOf.filter((sub) => {
      const subErrors: ValidationError[] = [];
      validateNode(sub as JSONSchema, value, path, root, subErrors, depth + 1);
      return subErrors.length === 0;
    }).length;
    if (matched !== 1) errors.push(makeError(path, "must match exactly one schema in oneOf"));
  }
  if (isPlainObject(schema.not)) {
    const subErrors: ValidationError[] = [];
    validateNode(schema.not as JSONSchema, value, path, root, subErrors, depth + 1);
    if (subErrors.length === 0) errors.push(makeError(path, "must NOT be valid according to schema in 'not'"));
  }
}

/** 创建纯 JS 校验函数, 签名与 jse 的 Validator 一致 */
export function createJsonSchemaValidator(schema: JSONSchema): SchemaValidator {
  return (json: unknown): ValidationError[] => {
    const errors: ValidationError[] = [];
    validateNode(schema, json, [], schema, errors, 0);
    return errors;
  };
}

// ---------- Schema 自身的结构校验 (配置页试编译) ----------

function checkSchemaNode(node: unknown, pointer: string, root: JSONSchema): string | null {
  if (!isPlainObject(node)) {
    return `${pointer || "#"} must be an object`;
  }

  if (node.type !== undefined) {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (types.length === 0) return `${pointer}.type must not be empty`;
    for (const type of types) {
      if (typeof type !== "string" || !TYPE_NAMES.has(type)) {
        return `${pointer}.type has unknown type "${String(type)}"`;
      }
    }
  }

  if (node.required !== undefined) {
    if (!Array.isArray(node.required) || node.required.some((key) => typeof key !== "string")) {
      return `${pointer}.required must be an array of strings`;
    }
  }

  if (node.enum !== undefined && (!Array.isArray(node.enum) || node.enum.length === 0)) {
    return `${pointer}.enum must be a non-empty array`;
  }

  if (node.pattern !== undefined) {
    if (typeof node.pattern !== "string") return `${pointer}.pattern must be a string`;
    try {
      new RegExp(node.pattern);
    } catch {
      return `${pointer}.pattern is not a valid regular expression`;
    }
  }

  const numericKeywords = [
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "minProperties",
    "maxProperties"
  ];
  for (const keyword of numericKeywords) {
    if (node[keyword] !== undefined && typeof node[keyword] !== "number") {
      return `${pointer}.${keyword} must be a number`;
    }
  }

  if (node.multipleOf !== undefined && typeof node.multipleOf === "number" && node.multipleOf <= 0) {
    return `${pointer}.multipleOf must be greater than 0`;
  }

  for (const keyword of ["uniqueItems", "additionalProperties"] as const) {
    if (node[keyword] !== undefined && typeof node[keyword] !== "boolean" && !isPlainObject(node[keyword])) {
      return `${pointer}.${keyword} must be a boolean or an object`;
    }
  }

  for (const keyword of ["properties", "patternProperties", "definitions", "$defs"] as const) {
    const group = node[keyword];
    if (group !== undefined) {
      if (!isPlainObject(group)) return `${pointer}.${keyword} must be an object`;
      for (const [key, sub] of Object.entries(group)) {
        const error = checkSchemaNode(sub, `${pointer}.${keyword}.${key}`, root);
        if (error !== null) return error;
      }
    }
  }

  if (node.items !== undefined) {
    if (Array.isArray(node.items)) {
      for (let i = 0; i < node.items.length; i++) {
        const error = checkSchemaNode(node.items[i], `${pointer}.items[${i}]`, root);
        if (error !== null) return error;
      }
    } else if (typeof node.items !== "boolean") {
      const error = checkSchemaNode(node.items, `${pointer}.items`, root);
      if (error !== null) return error;
    }
  }

  for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
    const group = node[keyword];
    if (group !== undefined) {
      if (!Array.isArray(group)) return `${pointer}.${keyword} must be an array`;
      for (let i = 0; i < group.length; i++) {
        const error = checkSchemaNode(group[i], `${pointer}.${keyword}[${i}]`, root);
        if (error !== null) return error;
      }
    }
  }

  if (node.not !== undefined) {
    const error = checkSchemaNode(node.not, `${pointer}.not`, root);
    if (error !== null) return error;
  }

  if (node.$ref !== undefined) {
    if (typeof node.$ref !== "string") return `${pointer}.$ref must be a string`;
    if (node.$ref.startsWith("#/") && resolveLocalRef(node.$ref, root) === null) {
      return `${pointer}.$ref cannot be resolved: ${node.$ref}`;
    }
  }

  // format 一律忽略 (未知 format 不应成为硬错误), 未知关键字同样跳过
  return null;
}

/** 结构校验: 返回 null 表示 Schema 可用, 否则返回人类可读的错误信息 */
export function validateSchemaStructure(schema: JSONSchema): string | null {
  return checkSchemaNode(schema, "#", schema);
}
