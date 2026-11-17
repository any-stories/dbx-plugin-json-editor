/**
 * 差异计算
 *
 * changes 遍历 + JSON Pointer 映射 (diffLeft/diffRight), 供编辑器 onClassName 输出
 * diff-create / diff-update / diff-delete / diff-child-update 高亮类
 * 数组差异: diff-sequences 包 (Myers 算法), 对象差异按键集并集遍历
 */

// diff-sequences 包 (Myers 线性空间 LCS)
import * as diffSequencesNs from "diff-sequences";

type DiffSequenceFn = (
  aLength: number,
  bLength: number,
  isCommon: (aIndex: number, bIndex: number) => boolean,
  foundSubsequence: (nCommon: number, aCommon: number, bCommon: number) => void
) => void;

// 双级回退取默认导出 (兼容 CJS __esModule 与原生 ESM 两种包装)
function resolveDiffSequence(): DiffSequenceFn {
  const ns = diffSequencesNs as unknown as Record<string, unknown>;
  const candidates: unknown[] = [ns.default, ns];
  for (const candidate of candidates) {
    if (typeof candidate === "function") {
      return candidate as DiffSequenceFn;
    }
    const nested = (candidate as { default?: unknown } | null)?.default;
    if (typeof nested === "function") {
      return nested as DiffSequenceFn;
    }
  }
  throw new Error("diff-sequences: default export not found");
}

const diffSequences = resolveDiffSequence();

export type JSONPath = Array<string | number>;
export type DiffChangeType = "create" | "update" | "delete";

export interface DiffChange {
  change: DiffChangeType;
  pathLeft?: JSONPath;
  pathRight?: JSONPath;
  valueLeft?: unknown;
  valueRight?: unknown;
}

// svelte-jsoneditor diff 高亮所消费的内容差异结构
export interface ContentDiff {
  diffLeft: Record<string, DiffChangeType | "child-update">;
  diffRight: Record<string, DiffChangeType | "child-update">;
  changes: DiffChange[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// truthy 值经 valueOf 归一后比较
// 原始值得值等值语义 (1 与 2 判异), 容器为引用比较 (必然判异, 由前置分支递归消费)
function toComparable(value: unknown): unknown {
  const candidate = value as { valueOf?: unknown } | null | undefined;
  return value && typeof candidate?.valueOf === "function" ? (candidate.valueOf as () => unknown).call(value) : value;
}

function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => isDeepEqual(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    return (
      keysA.length === Object.keys(b).length &&
      keysA.every((key) => Object.prototype.hasOwnProperty.call(b, key) && isDeepEqual(a[key], b[key]))
    );
  }
  return false;
}

// 数组差异: 借助 diff-sequences 求最长公共子序列, 缝隙间两两配对为 update
function diffArrays(
  left: unknown[],
  right: unknown[],
  emit: (change: DiffChangeType, indexLeft: number, indexRight: number) => void
): void {
  let indexLeft = 0;
  let indexRight = 0;
  const isCommon = (aIndex: number, bIndex: number) => isDeepEqual(left[aIndex], right[bIndex]);

  function onGap(aEnd: number, bEnd: number): void {
    const paired = Math.min(aEnd - indexLeft, bEnd - indexRight);
    for (let index = 0; index < paired; index += 1) {
      emit("update", indexLeft, indexRight);
      indexLeft += 1;
      indexRight += 1;
    }
    while (indexLeft < aEnd) {
      emit("delete", indexLeft, indexRight);
      indexLeft += 1;
    }
    while (indexRight < bEnd) {
      emit("create", indexLeft, indexRight);
      indexRight += 1;
    }
  }

  diffSequences(left.length, right.length, isCommon, (nCommon, aCommon, bCommon) => {
    onGap(aCommon, bCommon);
    indexLeft += nCommon;
    indexRight += nCommon;
  });
  onGap(left.length, right.length);
}

// changes 遍历
function collectChanges(
  left: unknown,
  right: unknown,
  pathLeft: JSONPath,
  pathRight: JSONPath,
  changes: DiffChange[]
): void {
  if (Array.isArray(left) && Array.isArray(right)) {
    diffArrays(left, right, (change, indexLeft, indexRight) => {
      const subPathLeft = pathLeft.concat([indexLeft]);
      const subPathRight = pathRight.concat([indexRight]);
      if (change === "create") {
        changes.push({ change, pathRight: subPathRight, valueRight: right[indexRight] });
      } else if (change === "update") {
        collectChanges(left[indexLeft], right[indexRight], subPathLeft, subPathRight, changes);
      } else {
        changes.push({ change, pathLeft: subPathLeft, valueLeft: left[indexLeft] });
      }
    });
    return;
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    new Set(Object.keys(left).concat(Object.keys(right))).forEach((key) => {
      collectChanges(left[key], right[key], pathLeft.concat([key]), pathRight.concat([key]), changes);
    });
    return;
  }
  // truthy 值经 valueOf 归一后比较 (原始值等值语义, 容器为引用比较)
  if (toComparable(left) !== toComparable(right)) {
    const involvesContainer =
      Array.isArray(left) || isPlainObject(left) || Array.isArray(right) || isPlainObject(right);
    if (left !== undefined && right !== undefined && !involvesContainer) {
      changes.push({ change: "update", pathLeft, pathRight, valueLeft: left, valueRight: right });
    } else {
      if (left !== undefined) {
        changes.push({ change: "delete", pathLeft, valueLeft: left });
      }
      if (right !== undefined) {
        changes.push({ change: "create", pathRight, valueRight: right });
      }
    }
  }
}

// 父路径依次回调
function forEachParentPath(path: JSONPath, callback: (parentPath: JSONPath) => void): void {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    callback(path.slice(0, index));
  }
}

// 子树遍历
function forEachDeepPath(value: unknown, path: JSONPath, callback: (item: unknown, itemPath: JSONPath) => void): void {
  callback(value, path);
  if (Array.isArray(value)) {
    value.forEach((item, index) => forEachDeepPath(item, path.concat([index]), callback));
  } else if (isPlainObject(value)) {
    Object.keys(value).forEach((key) => forEachDeepPath(value[key], path.concat([key]), callback));
  }
}

// JSON Pointer; onClassName 的路径映射也使用它
export function toPointer(path: JSONPath): string {
  return path.map((segment) => `/${String(segment).replace(/~/g, "~0").replace(/\//g, "~1")}`).join("");
}

function buildDiffLeft(changes: DiffChange[]): ContentDiff["diffLeft"] {
  const diffLeft: ContentDiff["diffLeft"] = {};
  for (const change of changes) {
    if (change.change === "delete" || change.change === "update") {
      const pathLeft = change.pathLeft ?? [];
      diffLeft[toPointer(pathLeft)] = change.change;
      forEachParentPath(pathLeft, (parentPath) => {
        const pointer = toPointer(parentPath);
        if (diffLeft[pointer] === undefined) {
          diffLeft[pointer] = "child-update";
        }
      });
      // 被删除容器的整个子树标记为 delete
      if (change.change === "delete" && (Array.isArray(change.valueLeft) || isPlainObject(change.valueLeft))) {
        forEachDeepPath(change.valueLeft, pathLeft, (_item, itemPath) => {
          diffLeft[toPointer(itemPath)] = change.change;
        });
      }
    }
  }
  return diffLeft;
}

function buildDiffRight(changes: DiffChange[]): ContentDiff["diffRight"] {
  const diffRight: ContentDiff["diffRight"] = {};
  for (const change of changes) {
    if (change.change === "create" || change.change === "update") {
      const pathRight = change.pathRight ?? [];
      diffRight[toPointer(pathRight)] = change.change;
      forEachParentPath(pathRight, (parentPath) => {
        const pointer = toPointer(parentPath);
        if (diffRight[pointer] === undefined) {
          diffRight[pointer] = "child-update";
        }
      });
      // 新建容器的整个子树标记为 create
      if (change.change === "create" && (Array.isArray(change.valueRight) || isPlainObject(change.valueRight))) {
        forEachDeepPath(change.valueRight, pathRight, (_item, itemPath) => {
          diffRight[toPointer(itemPath)] = change.change;
        });
      }
    }
  }
  return diffRight;
}

export function calculateDiff(left: unknown, right: unknown): ContentDiff {
  const changes: DiffChange[] = [];
  collectChanges(left, right, [], [], changes);
  return {
    diffLeft: buildDiffLeft(changes),
    diffRight: buildDiffRight(changes),
    changes
  };
}
