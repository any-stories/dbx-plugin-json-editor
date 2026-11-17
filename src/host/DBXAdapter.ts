/**
 * DBX Host Adapter
 *
 * 宿主桥接的唯一直接访问点, 业务层禁止依赖 window.dbxPlugin
 * 覆盖 Host API: ready / context / locale / theme / onContext / storage / setTitle
 *              + fileTransfer (beginSave/write/finish) / clipboard / copy
 * 独立浏览器调试(无宿主注入)时全部降级为本地默认实现, 不自造宿主接口
 *
 * 沙箱是 opaque origin: localStorage/IndexedDB/navigator.clipboard 均不可用,
 * 文件落盘必须走宿主 fileTransfer, 剪贴板写入必须走宿主桥接 (见官方文档
 * File Transfer and OS Drops / System Clipboard).
 */

export type Appearance = "light" | "dark";

interface DbxStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

/** 文件传输写句柄: beginSave 返回的句柄用 write 分块写, finish 落盘, cancel 丢弃 */
interface DbxSaveTarget {
  handleId: string;
  chunkBytes?: number;
}

interface DbxFileTransfer {
  beginSave?: (options: { name: string; contentType?: string; size?: number }) => Promise<DbxSaveTarget | null>;
  write?: (
    handleId: string,
    offset: number,
    data: Uint8Array | string
  ) => Promise<{ written: number; nextOffset: number }>;
  finish?: (handleId: string) => Promise<void>;
  cancel?: (handleId: string) => Promise<void>;
}

interface DbxClipboard {
  writeText?: (text: string) => Promise<void>;
}

interface DbxPluginApi {
  ready?: Promise<void>;
  locale?: string;
  theme?: { appearance?: Appearance; tokens?: Record<string, string> };
  capabilities?: Record<string, unknown>;
  onContext?: (listener: () => void) => () => void;
  setTitle?: (title: string | null) => Promise<void>;
  storage?: DbxStorage;
  fileTransfer?: DbxFileTransfer;
  clipboard?: DbxClipboard;
  copy?: (text: string) => Promise<void>;
}

/** 保存结果: host=宿主原生保存成功 / browser=浏览器下载触发 / canceled=用户取消 / unavailable=通道不可用 */
export type SaveOutcome = "host" | "browser" | "canceled" | "unavailable";

type ContextListener = () => void;

const STORAGE_KEY = "workspace";

// 无宿主时的内存存储, 生命周期与页面一致
const memoryStore = new Map<string, unknown>();

let host: DbxPluginApi | null = null;
let hostLocale = "en";
let hostAppearance: Appearance = "light";
let storageChannel: "host.storage" | "memory" = "memory";
/** 宿主 fileTransfer.beginSave 可用性: capabilities.fileTransfer.beginSave === true 且方法齐全 */
let canHostSave = false;
/** 宿主剪贴板写入可用性: 桥接的 copy() 或 clipboard.writeText() 任一存在即可 */
let canHostClipboard = false;
const contextListeners = new Set<ContextListener>();

/** capabilities.fileTransfer 是新增的能力对象 (pick/beginSave/read/drop/folderExpansion),
    旧宿主可能缺字段, 统一走可选链读取 */
function fileTransferCapability(host: DbxPluginApi | null, key: string): boolean {
  const ft = host?.capabilities?.fileTransfer;
  return typeof ft === "object" && ft !== null && (ft as Record<string, unknown>)[key] === true;
}

/** Uint8Array -> base64 字符串: 分块转, 不一次性展开大数组到字符串参数栈 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function resolveHost(): DbxPluginApi | null {
  const candidate = (globalThis as { dbxPlugin?: DbxPluginApi }).dbxPlugin;
  return candidate ?? null;
}

function memoryGet(key: string): Promise<unknown> {
  return Promise.resolve(memoryStore.get(key) ?? null);
}

function memorySet(key: string, value: unknown): Promise<void> {
  memoryStore.set(key, value);
  return Promise.resolve();
}

function memoryDelete(key: string): Promise<void> {
  memoryStore.delete(key);
  return Promise.resolve();
}

function normalizeAppearance(value: unknown): Appearance {
  return value === "dark" ? "dark" : "light";
}

function dispatchContextChange(): void {
  hostAppearance = normalizeAppearance(host?.theme?.appearance);
  contextListeners.forEach((listener) => listener());
}

export const dbx = {
  // 初始化: 等待宿主桥接就绪, 缓存环境信息并订阅上下文变更
  async init(): Promise<void> {
    host = resolveHost();
    if (host?.ready) {
      try {
        await host.ready;
      } catch {
        // 宿主就绪信号失败不阻断插件启动, 各自的后续调用在调用点做可用性守卫
      }
    }
    hostLocale = typeof host?.locale === "string" && host.locale ? host.locale : navigator.language || "en";
    hostAppearance = normalizeAppearance(host?.theme?.appearance);
    storageChannel = host?.capabilities?.storage === true && host.storage ? "host.storage" : "memory";
    // 门控遵循官方文档: 用 capabilities 的附加能力位, 不靠探测调用
    canHostSave =
      fileTransferCapability(host, "beginSave") &&
      typeof host?.fileTransfer?.beginSave === "function" &&
      typeof host?.fileTransfer?.write === "function" &&
      typeof host?.fileTransfer?.finish === "function";
    canHostClipboard = typeof host?.copy === "function" || typeof host?.clipboard?.writeText === "function";
    host?.onContext?.(dispatchContextChange);
  },

  locale(): string {
    return hostLocale;
  },

  appearance(): Appearance {
    return hostAppearance;
  },

  storageChannel(): "host.storage" | "memory" {
    return storageChannel;
  },

  // 窗口标题: 仅在宿主提供 setTitle 时调用, 对应 host.workbench 权限
  async setTitle(title: string): Promise<void> {
    if (typeof host?.setTitle !== "function") {
      return;
    }
    try {
      await host.setTitle(title);
    } catch {
      // 标题失败不影响编辑主流程
    }
  },

  getStorageValue(key: string): Promise<unknown> {
    const hostStorage = host?.storage;
    if (storageChannel === "host.storage" && hostStorage) {
      return hostStorage.get(key);
    }
    return memoryGet(key);
  },

  async setStorageValue(key: string, value: unknown): Promise<void> {
    const hostStorage = host?.storage;
    if (storageChannel === "host.storage" && hostStorage) {
      await hostStorage.set(key, value);
      return;
    }
    await memorySet(key, value);
  },

  async deleteStorageValue(key: string): Promise<void> {
    const hostStorage = host?.storage;
    if (storageChannel === "host.storage" && hostStorage) {
      await hostStorage.delete(key);
      return;
    }
    await memoryDelete(key);
  },

  // 工作区持久化键, 供 App 层读写
  workspaceKey(): string {
    return STORAGE_KEY;
  },

  /**
   * 宿主原生保存: fileTransfer.beginSave 弹原生对话框 -> write 分块写 -> finish 落盘.
   * 沙箱内 <a download> 静默失败, 落盘必须走这条通道. 用户取消返回 "canceled";
   * 通道不可用或写入抛错返回 "unavailable", 由调用方降级到剪贴板.
   */
  async saveFileViaHost(fileName: string, content: string, mimeType: string): Promise<SaveOutcome> {
    if (!canHostSave || !host?.fileTransfer) return "unavailable";
    const ft = host.fileTransfer;
    let openedHandle: string | null = null;
    try {
      const bytes = new TextEncoder().encode(content);
      const target = await ft.beginSave!({ name: fileName, contentType: mimeType, size: bytes.byteLength });
      if (target === null || !target?.handleId) return "canceled";
      openedHandle = target.handleId;
      const chunkSize = target.chunkBytes && target.chunkBytes > 0 ? target.chunkBytes : 256 * 1024;
      let offset = 0;
      while (offset < bytes.byteLength) {
        const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength));
        // base64 走普通 JSON-RPC, 不依赖 host.binary 二进制通道 (旧宿主未声明也不会安装失败).
        // offset 仍是原始文件字节偏移, 与 chunkBytes 语义一致.
        const base64 = bytesToBase64(chunk);
        const result = await ft.write!(target.handleId, offset, base64);
        // 用宿主返回的 nextOffset 推进, 避免宿主对分块大小另有约束时空转
        const next =
          typeof result?.nextOffset === "number" && result.nextOffset > offset
            ? result.nextOffset
            : offset + chunk.byteLength;
        if (next <= offset) break;
        offset = next;
      }
      await ft.finish!(target.handleId);
      openedHandle = null;
      return "host";
    } catch {
      // 打开后写入失败: 丢弃句柄, 避免宿主侧残留半成品文件
      if (openedHandle !== null && typeof ft.cancel === "function") {
        try {
          await ft.cancel(openedHandle);
        } catch {
          // 清理失败不影响降级
        }
      }
      return "unavailable";
    }
  },

  /**
   * 剪贴板写入统一入口: 沙箱内 navigator.clipboard 不可用, 优先走宿主桥接
   * (copy() 或 clipboard.writeText()); 独立浏览器调试无宿主时才用 navigator.clipboard.
   * 全部失败返回 false, 由调用方给出失败提示.
   */
  async copyText(text: string): Promise<boolean> {
    if (host && canHostClipboard) {
      try {
        if (typeof host.copy === "function") {
          await host.copy(text);
          return true;
        }
        if (typeof host.clipboard?.writeText === "function") {
          await host.clipboard.writeText(text);
          return true;
        }
      } catch {
        // 宿主桥接失败继续尝试浏览器通道
      }
    }
    if (!host) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // 浏览器通道失败交由调用方提示
      }
    }
    return false;
  },

  /** 是否运行在宿主沙箱内 (有 dbxPlugin 注入). 用于决定是否尝试 <a download> */
  inHost(): boolean {
    return host !== null;
  },

  onContextChange(listener: ContextListener): () => void {
    contextListeners.add(listener);
    return () => contextListeners.delete(listener);
  }
};
