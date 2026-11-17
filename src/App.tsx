/**
 * 工作区主控
 *
 * 顶栏 (品牌 + 汉堡菜单 + Settings) + 双面板 (各自 panel-menu: 名称/New/Open/Save/Copy/全屏)
 * 面板之间: panel-actions (左右互拷 + Transform + Compare) + draggable-splitter
 * splitter: 拖拽期间两侧面板常驻并随指针连续收窄 (不跟手的跳变交给 CSS 过渡补完),
 * 是否收起在松手时按 0.15/0.85 阈值判定; 点击 splitter 无拖动则按 at=0.2 恢复被收起的一侧
 * text|tree|table 模式为 per-pane 独立状态 (两面板互不联动), 不随文档存储
 * diff 高亮 onClassName (diff-create/update/delete/child-update), 全屏为 CSS class 方案
 * 弹框链路: Configuration / Document properties / JSON schema / CSV Import / CSV Export
 * 文件拖放语义: .csv 后缀进入 CSV Import 弹框, 其余文件按 JSON 文档载入
 * 所有宿主访问均经由 src/host/DBXAdapter.ts, 本文件不直接触碰 window.dbxPlugin
 * 状态分层: 本组件持有全局工作区状态; 持久化为服务端状态, 由 core/workspace.ts 统一读写
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { dbx } from "./host/DBXAdapter";
import { createTranslator, normalizeLocale, type Locale } from "./i18n";
import {
  createDocument,
  formatJson,
  minifyJson,
  newDocumentName,
  refreshParse,
  smartFormatJson,
  sortJsonKeys,
  type JsonDocument
} from "./core/document";
import { calculateDiff, toPointer, type ContentDiff, type JSONPath } from "./core/diff";
import type { CsvExportOptions, CsvImportOptions } from "./core/csv";
import { getParser } from "./core/parser";
import { installJseContextMenuGuard } from "./core/jseContextMenu";
import { installJseTooltipBounds } from "./core/jseTooltipBounds";
import { DEFAULT_QUERY_LANGUAGE_ID, QUERY_LANGUAGES } from "./core/queryLanguages";
import { NONE_SCHEMA, resolveSchema, type SchemaConfig } from "./core/schema";
import { downloadTextFile } from "./core/download";
import type { EditorConfig } from "./core/editorConfig";
import { I18nProvider } from "./i18n/provider";
import {
  forgetDocumentChunk,
  loadWorkspace,
  persistWorkspace,
  snapshotSignature,
  type AppearanceMode,
  type Notice,
  type PaneKey,
  type PaneModes
} from "./core/workspace";
import {
  AUTOSAVE_DELAY_MS,
  CSV_FILE_EXTENSION,
  CSV_MIME_TYPE,
  DEFAULT_DOCUMENT_NAME,
  DIFF_BLINK_MS,
  JSON_MIME_TYPE,
  MAX_DOCUMENTS,
  MENU_CHROME_PX,
  MENU_NAME_MIN_PX,
  MENU_NAME_RESERVE_PX,
  MENU_RESTORE_SLACK_PX,
  MESSAGE_ACTION_CLOSE_MS,
  MESSAGE_AUTO_CLOSE_MS,
  SPLITTER_EDGE_RATIO,
  SPLITTER_RESTORE_RATIO
} from "./config/constants";
import { ApplicationMenu } from "./components/ApplicationMenu";
import { ConfigurationModal } from "./components/ConfigurationModal";
import { ConfirmModal } from "./components/ConfirmModal";
import { DocumentPropertiesModal } from "./components/DocumentPropertiesModal";
import { JsonSchemaModal } from "./components/JsonSchemaModal";
import { CsvExportModal, CsvImportModal } from "./components/CsvModal";
import { JsonEditor, type JsonEditorHandle } from "./components/JsonEditor";
import { EditorToolbar } from "./components/EditorToolbar";
import { TransformModal } from "./components/TransformModal";
import { Panel } from "./components/Panel";
import { PanelMenu, type CopyVariant } from "./components/PanelMenu";
import { PanelActions } from "./components/PanelActions";
import { Splitter } from "./components/Splitter";
import { Toast } from "./components/Toast";
import { NiceDayCard } from "./components/NiceDayCard";

// 松手后的落点比例: 越过阈值收到端点 (收起), 单击 splitter 未拖动则恢复到刚好排满菜单按钮的宽度
// 收起/展开的最后一段由 CSS 过渡补完, 松手时不直接跳变. 阈值与恢复尺寸均由菜单实际宽度动态换算
function settleRatio(ratio: number, dragged: boolean, opts: { edgeRatio: number; restoreRatio: number }): number {
  const { edgeRatio, restoreRatio } = opts;
  if (!dragged) {
    if (ratio < edgeRatio) {
      return restoreRatio;
    }
    if (ratio > 1 - edgeRatio) {
      return 1 - restoreRatio;
    }
    return ratio;
  }
  if (ratio < edgeRatio) {
    return 0;
  }
  if (ratio > 1 - edgeRatio) {
    return 1;
  }
  return ratio;
}

export default function App() {
  // locale 状态: 默认 en, dbx.init 后与上下文变更时取宿主值
  const [locale, setLocale] = useState<Locale>("en");
  const [ready, setReady] = useState(false);
  // 外观三态: auto = 跟随宿主
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>("auto");
  const [hostAppearance, setHostAppearance] = useState<"light" | "dark">("light");
  // Configuration 弹框配置, 持久化在工作区快照内
  const [editorConfig, setEditorConfig] = useState<EditorConfig | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  // 打开时才挂载整层 (含内置爱心粒子 canvas), 关闭即从 DOM 移除
  const [niceDayOpen, setNiceDayOpen] = useState(false);
  // Document properties / JSON schema 弹框所属面板
  const [propertiesPane, setPropertiesPane] = useState<PaneKey | null>(null);
  const [schemaPane, setSchemaPane] = useState<PaneKey | null>(null);
  // New 确认弹框: 当前文档有内容时先确认, 避免关闭文档时内容被静默丢弃
  const [newDocumentPane, setNewDocumentPane] = useState<PaneKey | null>(null);
  // CSV 通道弹框状态: 导入弹框持有源文本, 导出弹框持有源 JSON 文本与文件名
  const [csvImport, setCsvImport] = useState<{ pane: PaneKey; fileName: string; text: string } | null>(null);
  const [csvExport, setCsvExport] = useState<{ fileName: string; jsonText: string } | null>(null);
  // CSV 弹框选项 (localStorage 键 csvExportOptions / csvImportOptions 同语义)
  const [csvExportOptions, setCsvExportOptions] = useState<CsvExportOptions | null>(null);
  const [csvImportOptions, setCsvImportOptions] = useState<CsvImportOptions | null>(null);
  const [documents, setDocuments] = useState<JsonDocument[]>([]);
  const [leftId, setLeftId] = useState<string | null>(null);
  const [rightId, setRightId] = useState<string | null>(null);
  // 已分配的 "New document N" 最大编号
  const [nameSequence, setNameSequence] = useState(0);
  // 模式 per-pane: 默认左 text / 右 tree (两面板不联动)
  const [paneModes, setPaneModes] = useState<PaneModes>({ left: "text", right: "tree" });
  const [focusedPane, setFocusedPane] = useState<PaneKey>("left");
  // splitter: 比例恒落在 [0, 1] (作为 flex-grow, 比值即面板宽度), 是否收起的判定见 settleRatio
  const [splitRatio, setSplitRatio] = useState(0.5);
  // 拖拽进行中: 期间关闭宽度过渡, 比例逐帧跟手; 松手后由过渡补完收起/展开的最后一段
  const [resizing, setResizing] = useState(false);
  // 面板菜单按钮的自然宽度: 由 PanelMenu 量取 (排满含文案 / 仅图标); 用于把"收起阈值"与"恢复尺寸"
  // 绑定到菜单实际能展示的宽度, 而不是固定的 0.15 比例, 这样所有按钮都展示得下时才收起, 且
  // 松手恢复时默认回到刚好排满全部按钮 (含文案) 的宽度
  const [menuFit, setMenuFit] = useState<{ full: number; compact: number } | null>(null);
  const menuFitRef = useRef<{ full: number; compact: number } | null>(null);
  // 面板区域 (contents-panel) 的实测宽度: 与 menuFit 一起换算成"收起/恢复"所需的比例
  const [areaWidth, setAreaWidth] = useState(0);
  const [showDiff, setShowDiff] = useState(false);
  // 差异导航索引: 内容变化后由 boundedDiffIndex 自动钳制
  const [diffIndex, setDiffIndex] = useState(-1);
  // 全屏: CSS class 方案 (panel-contents.full-screen), 同一时间至多一个面板全屏
  const [fullscreenPane, setFullscreenPane] = useState<PaneKey | null>(null);
  // Transform 弹框: from 为源面板 (取 JSON), to 为目标面板 (写回); from === to 即就地转换
  const [transformRequest, setTransformRequest] = useState<{ from: PaneKey; to: PaneKey; json: unknown } | null>(null);
  // file-drop 拖拽悬停: file-drop-dragging-over-frame/target 遮罩
  const [dragPane, setDragPane] = useState<PaneKey | null>(null);
  const [message, setMessage] = useState<Notice | null>(null);

  const paneAreaRef = useRef<HTMLDivElement>(null);
  const splitterRef = useRef<HTMLDivElement>(null);
  const editorRefs = useRef<Partial<Record<PaneKey, JsonEditorHandle | null>>>({});
  const lastSignatureRef = useRef<string>("");

  const leftDoc = documents.find((doc) => doc.id === leftId) ?? null;
  const rightDoc = documents.find((doc) => doc.id === rightId) ?? null;
  const activeDoc = focusedPane === "left" ? leftDoc : rightDoc;
  const appearance = appearanceMode === "auto" ? hostAppearance : appearanceMode;
  const t = useMemo(() => createTranslator(locale), [locale]);

  // #region 通知条 (notification: 自动关闭, 带动作时延长)

  const flashMessage = useCallback((text: string) => {
    setMessage({ text });
  }, []);

  const flashNotice = useCallback((text: string, action: Notice["action"]) => {
    setMessage({ text, action });
  }, []);

  // 行内上下文菜单的原生交互: 触发按钮走右键定位链路, 菜单打开时先关闭再放行点击
  useEffect(() => installJseContextMenuGuard(), []);

  // jse tooltip 只按 viewport 定位, 长文案 (timestamp) 会被顶出 panel 并被 overflow 裁掉, 插入后钳回面板内
  useEffect(() => installJseTooltipBounds(), []);

  // 通知自动关闭: 新通知替换旧通知并重置定时 (计时由 effect 管理, 回调内不触碰 timer)
  useEffect(() => {
    if (message === null) {
      return undefined;
    }
    const delay = message.action ? MESSAGE_ACTION_CLOSE_MS : MESSAGE_AUTO_CLOSE_MS;
    const timer = window.setTimeout(() => setMessage(null), delay);
    return () => window.clearTimeout(timer);
  }, [message]);

  const updateDocument = useCallback((docId: string, patch: Partial<JsonDocument>) => {
    setDocuments((prev) => prev.map((doc) => (doc.id === docId ? { ...doc, ...patch, updatedAt: Date.now() } : doc)));
  }, []);
  // #endregion

  // #region 工作区持久化: 元数据进快照, 文档内容按 doc:<id> 分片

  // 保存语义 (docstore Ke): 文档在保存时创建, 未命名的已变更文档分配
  // "New document N" (基于本地库取号, 插件以名称序列取号保证编号不回退);
  // 未变更的未命名文档保持未命名 (不触发命名)
  const assignNamesOnSave = (
    docs: JsonDocument[],
    sequence: number
  ): { documents: JsonDocument[]; nameSequence: number } => {
    let next = sequence;
    let changed = false;
    const result = docs.map((doc) => {
      if (doc.name !== null || !doc.isDirty) {
        return doc;
      }
      next += 1;
      changed = true;
      return { ...doc, name: newDocumentName(next - 1), updatedAt: Date.now() };
    });
    return changed ? { documents: result, nameSequence: next } : { documents: docs, nameSequence: sequence };
  };

  // 返回是否写入成功 (New 的 $() 守卫依赖保存结果决定是否经 confirm 确认)
  const persist = useCallback(async (): Promise<boolean> => {
    if (editorConfig === null || csvExportOptions === null || csvImportOptions === null) {
      return true;
    }
    const saved = assignNamesOnSave(documents, nameSequence);
    const state = {
      documents: saved.documents,
      nameSequence: saved.nameSequence,
      leftId,
      rightId,
      paneModes,
      appearanceMode,
      editorConfig,
      csvExportOptions,
      csvImportOptions
    };
    const signature = snapshotSignature(state);
    if (signature === lastSignatureRef.current) {
      return true;
    }
    const ok = await persistWorkspace(state);
    if (!ok) {
      flashMessage(t("message.persistFailed"));
      return false;
    }
    lastSignatureRef.current = signature;
    // 命名与清除变更标记合并为一次状态提交 (保存后清除 changed 指示)
    // persist 是异步流程: await 写库期间编辑器可能又回传了新内容 (经 updateDocument 写入 prev),
    // saved.documents 是保存时刻的快照, content 一律保留 prev 最新值, 只合并保存流程拥有的
    // 字段 (name/isDirty); 否则快照里的旧 content 会滚回状态, 并经 content prop 触发编辑器
    // set() 全文替换, 把保存窗口内的输入整个吞掉 (表现为"快速键入的内容偶发丢失/回滚")
    setDocuments((prev) =>
      prev.map((doc) => {
        const target = saved.documents.find((item) => item.id === doc.id);
        if (target === undefined) {
          return doc;
        }
        // 内容相对快照有推进 (保存期间仍在输入) 时保持 isDirty, 由下一次自动保存补写
        const changedSinceSave = doc.content !== target.content;
        if (doc.name === target.name && (!doc.isDirty || changedSinceSave)) {
          return doc;
        }
        return { ...doc, name: target.name, isDirty: changedSinceSave };
      })
    );
    setNameSequence(saved.nameSequence);
    const active = saved.documents.find((doc) => doc.id === (focusedPane === "left" ? leftId : rightId));
    void dbx.setTitle(`${active?.name ?? "JSON"} - JSON Editor`);
    return true;
  }, [
    documents,
    nameSequence,
    leftId,
    rightId,
    paneModes,
    appearanceMode,
    editorConfig,
    csvExportOptions,
    csvImportOptions,
    focusedPane,
    flashMessage,
    t
  ]);
  // #endregion

  // #region 初始化与宿主环境跟随

  const didInitRef = useRef(false);
  useEffect(() => {
    if (didInitRef.current) {
      return;
    }
    didInitRef.current = true;
    void (async () => {
      await dbx.init();
      setLocale(normalizeLocale(dbx.locale()));
      setHostAppearance(dbx.appearance());
      const state = await loadWorkspace();
      setDocuments(state.documents);
      setLeftId(state.leftId);
      setRightId(state.rightId);
      setPaneModes(state.paneModes);
      setAppearanceMode(state.appearanceMode);
      setEditorConfig(state.editorConfig);
      setCsvExportOptions(state.csvExportOptions);
      setCsvImportOptions(state.csvImportOptions);
      setNameSequence(state.nameSequence);
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    const unsubscribe = dbx.onContextChange(() => {
      setLocale(normalizeLocale(dbx.locale()));
      setHostAppearance(dbx.appearance());
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // body class: jse-theme-light|dark
  // data-theme 同步给液态玻璃库: 库的令牌默认跟 prefers-color-scheme, 插件外观是独立状态必须强制
  useEffect(() => {
    if (ready) {
      document.body.className = `jse-theme-${appearance}`;
      document.body.dataset.theme = appearance;
    }
  }, [appearance, ready]);

  // 自动保存: 编辑后延迟写入
  useEffect(() => {
    if (!ready) {
      return undefined;
    }
    const timer = window.setTimeout(() => void persist(), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [ready, persist]);
  // #endregion

  // #region 差异计算: ot 记忆化同构 (纯计算, 渲染期间派生, 输入变化自动重算)

  const diff = useMemo<{ content: ContentDiff | null; error: string | null }>(() => {
    if (!showDiff || leftDoc === null || rightDoc === null) {
      return { content: null, error: null };
    }
    try {
      const left = JSON.parse(leftDoc.content) as unknown;
      const right = JSON.parse(rightDoc.content) as unknown;
      return { content: calculateDiff(left, right), error: null };
    } catch (cause) {
      // 不要求两侧均为合法 JSON: 解析失败走 diff-error 展示
      return { content: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [showDiff, leftDoc, rightDoc]);

  // onClassName: 按路径查 diffLeft/diffRight 映射返回 diff-* 类名
  // 回调必须随 diff 内容换新引用: jse 只在 onClassName 这个 prop 变化时才重算节点类名,
  // 稳定引用会让开关比较后已渲染的行仍保留旧类名 (高亮不出现 / 关掉后残留)
  const diffClassNames = useMemo(() => {
    const make = (map: ContentDiff["diffLeft"] | undefined) => {
      if (map === undefined) {
        return undefined;
      }
      return (path: JSONPath) => {
        const type = map[toPointer(path)];
        return type === undefined ? undefined : `diff-${type}`;
      };
    };
    return {
      left: make(diff.content?.diffLeft),
      right: make(diff.content?.diffRight)
    };
  }, [diff.content]);

  // 差异导航: scrollTo 定位 + findElement 加 blink-diff-value 类闪烁
  const blinkAt = (pane: PaneKey, path: JSONPath) => {
    const handle = editorRefs.current[pane];
    if (handle == null) {
      return;
    }
    void handle.scrollTo(path).then(() => {
      const element = handle.findElement(path);
      if (element !== undefined) {
        element.classList.add("blink-diff-value");
        window.setTimeout(() => element.classList.remove("blink-diff-value"), DIFF_BLINK_MS);
      }
    });
  };

  const goToDiff = (step: number) => {
    const changes = diff.content?.changes ?? [];
    if (changes.length === 0) {
      return;
    }
    const bounded = Math.max(0, Math.min(changes.length - 1, boundedDiffIndex + step));
    setDiffIndex(bounded);
    const change = changes[bounded];
    if (change.change !== "create" && change.pathLeft !== undefined) {
      blinkAt("left", change.pathLeft);
    }
    if (change.change !== "delete" && change.pathRight !== undefined) {
      blinkAt("right", change.pathRight);
    }
  };
  // #endregion

  // #region 文档操作

  const guardActiveDoc = (): JsonDocument | null => {
    if (activeDoc === null) {
      flashMessage(t("message.noDocFocused"));
      return null;
    }
    return activeDoc;
  };

  const applyTransform = (action: "formatted" | "minified" | "keysSorted", transform: (content: string) => string) => {
    const doc = guardActiveDoc();
    if (doc === null) {
      return;
    }
    try {
      const next = transform(doc.content);
      updateDocument(doc.id, { content: next, isDirty: true });
      flashMessage(t(`message.${action}`));
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      flashMessage(t("message.transformFailed", { action: t(`message.${action}`), detail }));
    }
  };

  // 守卫通过后执行, 即关闭当前文档回到空文档状态; 名称由保存流程生成 "New document N".
  // 插件无本地文档库重开通道, 关闭文档即丢弃内容, 故当前文档有内容时必须先确认,
  // 确认后立即分配 "New document N" 并渲染名称按钮;
  // 空文档无内容可丢弃, 重复点击保持幂等, 不产生无意义的编号增量.
  const newDocumentFor = (pane: PaneKey) => {
    const current = pane === "left" ? leftDoc : rightDoc;
    const otherId = pane === "left" ? rightId : leftId;
    if (current === null) {
      return;
    }
    // 空文档 (含已命名但无内容) 无内容可丢弃: 直接返回, 重复点击不新增文档
    if (current.content.trim() === "") {
      return;
    }
    // 当前文档被另一侧面板共用时, 新建属于净增文档, 需校验上限;
    // 仅本面板引用时是替换, 文档总数不变
    if (current.id === otherId && documents.length >= MAX_DOCUMENTS) {
      flashMessage(t("message.docLimit", { limit: MAX_DOCUMENTS }));
      return;
    }
    // 有内容时经确认弹框 (守卫仅覆盖未保存变更, 插件关闭文档即丢弃内容)
    setNewDocumentPane(pane);
  };

  // 确认后执行: 替换本面板文档并立即命名, 旧文档连同内容分片一起移除
  const createNewDocument = (pane: PaneKey) => {
    const current = pane === "left" ? leftDoc : rightDoc;
    if (current === null) {
      return;
    }
    const otherId = pane === "left" ? rightId : leftId;
    const doc = refreshParse(createDocument(newDocumentName(nameSequence), ""));
    setDocuments((prev) => {
      const kept = prev.filter((item) => item.id !== current.id || item.id === otherId);
      return [...kept, doc];
    });
    setNameSequence(nameSequence + 1);
    if (pane === "left") {
      setLeftId(doc.id);
    } else {
      setRightId(doc.id);
    }
    // 文档保存在浏览器本地库 (可经 URL 重开); 插件无重开通道,
    // 不再被任何面板引用的旧文档连同内容分片一起移除
    if (current.id !== otherId) {
      void forgetDocumentChunk(current.id);
    }
    setFocusedPane(pane);
  };

  const importFile = async (file: File, pane: PaneKey) => {
    // FileDrop 语义: .csv 后缀进入 CSV Import 弹框
    if (file.name.toLowerCase().endsWith(CSV_FILE_EXTENSION)) {
      await importCsvFile(file, pane);
      return;
    }
    if (documents.length >= MAX_DOCUMENTS) {
      flashMessage(t("message.docLimit", { limit: MAX_DOCUMENTS }));
      return;
    }
    const content = await file.text();
    const doc = refreshParse(createDocument(file.name, content));
    setDocuments((prev) => [...prev, doc]);
    if (pane === "left") {
      setLeftId(doc.id);
    } else {
      setRightId(doc.id);
    }
    setFocusedPane(pane);
    flashMessage(t("message.imported", { name: file.name }));
  };

  /**
   * 统一落盘处理: 宿主原生保存 / 浏览器下载成功各自提示; 用户取消静默返回;
   * 通道不可用则降级到剪贴板 (走宿主桥接, 沙箱内 navigator.clipboard 不可用).
   * @returns 是否真正完成 (取消/失败返回 false, 供 CSV 弹框决定是否关闭)
   */
  const finishDownload = async (
    content: string,
    fileName: string,
    successKey: "message.exported" | "message.csvExported"
  ): Promise<boolean> => {
    const outcome = await downloadTextFile(
      fileName,
      content,
      fileName.endsWith(".csv") ? CSV_MIME_TYPE : JSON_MIME_TYPE
    );
    if (outcome === "host" || outcome === "browser") {
      flashMessage(t(successKey, { name: fileName }));
      return true;
    }
    if (outcome === "canceled") {
      // 用户在原生保存对话框点了取消, 不提示、不关闭弹框
      return false;
    }
    // unavailable: 降级剪贴板
    if (await dbx.copyText(content)) {
      flashMessage(t("message.downloadBlocked"));
    } else {
      flashMessage(t("message.exportFailed"));
    }
    return false;
  };

  // 导出: 宿主原生保存优先, 通道不可用时降级为剪贴板复制
  const saveToDisk = (pane: PaneKey) => {
    const doc = pane === "left" ? leftDoc : rightDoc;
    if (doc === null) {
      flashMessage(t("message.noDocFocused"));
      return;
    }
    // 保存弹框 value: document?.name ?? "New document"
    const baseName = doc.name ?? DEFAULT_DOCUMENT_NAME;
    const fileName = baseName.endsWith(".json") ? baseName : `${baseName}.json`;
    void finishDownload(doc.content, fileName, "message.exported");
  };

  // Import CSV: 读取 CSV 文件后进入导入弹框, 预览确认后转成 JSON 文档
  const importCsvFile = async (file: File, pane: PaneKey) => {
    const text = await file.text();
    setCsvImport({ pane, fileName: file.name, text });
  };

  const confirmCsvImport = (jsonText: string, documentName: string) => {
    const pending = csvImport;
    if (pending === null) {
      return;
    }
    if (documents.length >= MAX_DOCUMENTS) {
      flashMessage(t("message.docLimit", { limit: MAX_DOCUMENTS }));
      return;
    }
    const doc = refreshParse(createDocument(documentName, jsonText));
    setDocuments((prev) => [...prev, doc]);
    if (pending.pane === "left") {
      setLeftId(doc.id);
    } else {
      setRightId(doc.id);
    }
    setFocusedPane(pending.pane);
    // 导入确认回调先切 table 模式再写入文档
    setPaneModes((prev) => ({ ...prev, [pending.pane]: "table" }));
    setCsvImport(null);
    flashMessage(t("message.csvImported", { name: pending.fileName }));
  };

  // Export to CSV: 当前文档进入导出弹框, 预览确认后保存到磁盘
  const exportCsv = (pane: PaneKey) => {
    const doc = pane === "left" ? leftDoc : rightDoc;
    if (doc === null) {
      flashMessage(t("message.noDocFocused"));
      return;
    }
    setCsvExport({ fileName: doc.name ?? DEFAULT_DOCUMENT_NAME, jsonText: doc.content });
  };

  const confirmCsvExport = async (fileName: string, csv: string) => {
    // 仅在真正完成(宿主保存/浏览器下载)时关闭弹框; 取消或降级失败保持弹框
    if (await finishDownload(csv, fileName, "message.csvExported")) {
      setCsvExport(null);
    }
  };

  // Configuration 弹框: 应用后即时作用于两侧编辑器
  const applyEditorConfig = (config: EditorConfig) => {
    setEditorConfig(config);
    setConfigOpen(false);
  };

  // "Save config and reload now": 先持久化新配置再重载页面
  // 重载会丢弃尚未防抖写入的状态, 故此处以新配置构建完整状态同步落盘
  const applyEditorConfigAndReload = (config: EditorConfig) => {
    setEditorConfig(config);
    setConfigOpen(false);
    if (csvExportOptions === null || csvImportOptions === null) {
      window.location.reload();
      return;
    }
    void (async () => {
      await persistWorkspace({
        documents,
        leftId,
        rightId,
        paneModes,
        appearanceMode,
        editorConfig: config,
        csvExportOptions,
        csvImportOptions,
        nameSequence
      });
      window.location.reload();
    })();
  };

  // Copy 变体: formatted / smart / compacted / escaped / as-is
  // formatted 与 smart 的缩进与行宽取当前 Configuration 配置
  const copyVariant = async (pane: PaneKey, variant: CopyVariant) => {
    const doc = pane === "left" ? leftDoc : rightDoc;
    if (doc === null || editorConfig === null) {
      flashMessage(t("message.noDocFocused"));
      return;
    }
    let text: string;
    try {
      if (variant === "formatted") {
        text = formatJson(doc.content, editorConfig.indentation);
      } else if (variant === "smart") {
        text = smartFormatJson(doc.content, editorConfig.maxLineLength);
      } else if (variant === "compacted") {
        text = minifyJson(doc.content);
      } else if (variant === "escaped") {
        text = JSON.stringify(doc.content) ?? '""';
      } else {
        text = doc.content;
      }
    } catch {
      flashMessage(t("message.copyInvalid"));
      return;
    }
    if (await dbx.copyText(text)) {
      flashMessage(t("message.copied"));
    } else {
      flashMessage(t("message.exportFailed"));
    }
  };

  // 共享写入: 目标面板无文档时创建未命名文档 (保存时命名)
  // 返回是否真的写入 (文档数量达上限时中止, 由调用方决定是否再给提示)
  const writeIntoPane = (pane: PaneKey, text: string): boolean => {
    const targetId = pane === "left" ? leftId : rightId;
    if (targetId !== null) {
      updateDocument(targetId, { content: text, isDirty: true });
      return true;
    }
    if (documents.length >= MAX_DOCUMENTS) {
      flashMessage(t("message.docLimit", { limit: MAX_DOCUMENTS }));
      return false;
    }
    const doc = refreshParse(createDocument(null, text));
    setDocuments((prev) => [...prev, doc]);
    if (pane === "left") {
      setLeftId(doc.id);
    } else {
      setRightId(doc.id);
    }
    return true;
  };

  // Copy 组: 按箭头方向整篇搬运源面板内容
  const copyBetween = (from: PaneKey, to: PaneKey) => {
    const source = from === "left" ? leftDoc : rightDoc;
    if (source === null) {
      flashMessage(t("message.noDocFocused"));
      return;
    }
    if (!writeIntoPane(to, source.content)) {
      return;
    }
    // 复制完成无其他视觉反馈 (两侧内容相同时尤为明显),
    // 补一条轻提示确认内容已写入目标面板
    flashMessage(t("message.copiedTo", { pane: t(to === "left" ? "message.paneLeft" : "message.paneRight") }));
  };

  // Transform 组: 以源面板文档为输入打开本插件的 Transform 弹框,
  // Apply 后将结果写入目标面板; 源文档不是合法 JSON 时给出通知并中止
  const openTransform = (from: PaneKey, to: PaneKey) => {
    const source = from === "left" ? leftDoc : rightDoc;
    if (source === null) {
      flashMessage(t("message.noDocFocused"));
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(source.content) as unknown;
    } catch {
      flashMessage(t("message.transformInvalid"));
      return;
    }
    setTransformRequest({ from, to, json });
  };

  const transformBetween = (from: PaneKey, to: PaneKey) => {
    openTransform(from, to);
  };

  // Compare, 开启时不强制 tree 模式而是给出可切换 tree 的通知
  const toggleDifferences = () => {
    if (showDiff) {
      setShowDiff(false);
      setDiffIndex(-1);
      return;
    }
    setShowDiff(true);
    setDiffIndex(-1);
    if (paneModes.left !== "tree" || paneModes.right !== "tree") {
      flashNotice(t("message.diffNeedsTree"), {
        label: t("message.switchToTree"),
        onClick: () => {
          setPaneModes({ left: "tree", right: "tree" });
        }
      });
    }
  };

  const saveNow = () => {
    void persist();
  };

  const toggleFullScreen = (pane: PaneKey) => {
    setFullscreenPane((prev) => (prev === pane ? null : pane));
  };
  // #endregion

  // #region 面板分隔拖拽

  // 面板可用宽度随窗口 / 布局变化: 用 PanelMenu 量取的菜单宽度反推"收起 / 恢复"所需的比例.
  // 收起阈值 = 仅图标 + 最小文档名 + 左右内边距都放不下时的宽度占比 (即图标真的挤不下了才收起);
  // 恢复尺寸 = 排满全部按钮 (含文案) + 文档名预留 + 内边距 的宽度占比 (松手回到名称不被截断的宽度).
  // 二者都先回退到固定常量, 等测量就绪后再动态生效
  const edgeRatio = useMemo(() => {
    if (menuFit === null || areaWidth <= 0) {
      return SPLITTER_EDGE_RATIO;
    }
    // 图标宽 + 最小文档名 + 内边距 都展示不下时才收起; 夹紧到 [0.12, 0.5] 避免过度限制
    const need = menuFit.compact + MENU_NAME_MIN_PX + MENU_CHROME_PX;
    return Math.min(0.5, Math.max(0.12, need / areaWidth));
  }, [menuFit, areaWidth]);
  const restoreRatio = useMemo(() => {
    if (menuFit === null || areaWidth <= 0) {
      return SPLITTER_RESTORE_RATIO;
    }
    // 松手恢复: 回到"按钮含文案 + 文档名预留 + 内边距 + 余量"都能放下的宽度,
    // 名称不再被截断且稳定退出 compact (余量抵消过渡/换算舍入); 不越过收起阈值或中点
    const need = menuFit.full + MENU_NAME_RESERVE_PX + MENU_CHROME_PX + MENU_RESTORE_SLACK_PX;
    return Math.min(0.5, Math.max(edgeRatio, need / areaWidth));
  }, [menuFit, areaWidth, edgeRatio]);
  // PanelMenu 的 compact 阈值: 面板宽度低于"按钮全宽 + 文档名预留 + 内边距"时提前退为图标,
  // 把空间让给文档名 (与 restoreRatio 同一把尺子, 避免恢复后立刻又退出 compact 抖动)
  const menuFitWidth = useMemo(() => {
    if (menuFit === null) {
      return undefined;
    }
    return menuFit.full + MENU_NAME_RESERVE_PX + MENU_CHROME_PX;
  }, [menuFit]);

  // 拖拽期间两侧恒为可见: 面板不中途卸载, 比例逐帧跟手, 是否收起留到松手时判定,
  // 因此拖动过程中不会出现面板突然消失 / 另一侧瞬间撑满的跳变
  const leftVisible = resizing || splitRatio >= edgeRatio;
  const rightVisible = resizing || splitRatio <= 1 - edgeRatio;
  const bothVisible = leftVisible && rightVisible;
  // pointerup 闭包经 ref 读取最新比例; 比例变化统一走 applySplitRatio, 在事件回调内同步 ref, 不在 render 期间写入
  const ratioRef = useRef(splitRatio);
  const applySplitRatio = useCallback((ratio: number) => {
    // 面板常驻挂载, flex 必须落在 [0, 1]: 越界即完全收起 / 撑满
    const clamped = Math.min(1, Math.max(0, ratio));
    ratioRef.current = clamped;
    setSplitRatio(clamped);
  }, []);

  // PanelMenu 量取按钮排满 / 仅图标两种自然宽度后回传; 同时存入 ref 供拖拽闭包读取最新值
  // 顺带量取面板区域 (contents-panel) 的实测宽度: 此时整棵工作区树已挂载, paneAreaRef 必然存在,
  // 比单独的 ResizeObserver effect 更可靠, 保证 edgeRatio / restoreRatio 一旦 menuFit 就绪即生效
  const handleMeasureMenu = useCallback((full: number, compact: number) => {
    menuFitRef.current = { full, compact };
    setMenuFit({ full, compact });
    const area = paneAreaRef.current;
    if (area !== null) {
      // 扣除 splitter 宽度: splitRatio 换算面板实际宽度时用的是两块面板的可分宽度, 不含分隔条
      const splitterW = splitterRef.current?.getBoundingClientRect().width ?? 0;
      const width = Math.max(1, area.getBoundingClientRect().width - splitterW);
      setAreaWidth(width);
      (window as unknown as { __areaWidth?: number }).__areaWidth = width;
    }
    (window as unknown as { __menuFit?: unknown }).__menuFit = { full, compact };
  }, []);

  // 监听面板区域宽度变化 (窗口缩放 / 全屏等)
  // 依赖 ready: 组件在 ready 之前整体 return null, paneAreaRef 尚未挂载, 若用空依赖数组
  // 会在首次 (空) 提交后跑一次并提前 return, 之后再也不会重新挂载 observer. 加入 ready 后,
  // ready 翻转为 true 的那次提交已渲染出 contents-panel, effect 重新执行时 ref 才真正存在
  useEffect(() => {
    if (!ready) {
      return undefined;
    }
    const el = paneAreaRef.current;
    if (el === null) {
      return undefined;
    }
    const update = () => {
      const splitterW = splitterRef.current?.getBoundingClientRect().width ?? 0;
      const width = Math.max(1, el.getBoundingClientRect().width - splitterW);
      setAreaWidth(width);
      (window as unknown as { __areaWidth?: number }).__areaWidth = width;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ready]);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const area = paneAreaRef.current;
    const splitter = splitterRef.current;
    if (area === null || splitter === null) {
      return;
    }
    event.preventDefault();
    const areaRect = area.getBoundingClientRect();
    const splitterRect = splitter.getBoundingClientRect();
    // 以 splitter 左缘为锚点, pointermove 挂在 document.body 上
    const offsetX = splitterRect.left - event.clientX;
    let moved = false;
    const onMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      if (!moved) {
        // 首次移动才进入拖拽态: 单击 splitter 不引起操作条/布局的任何跳动;
        // 关闭宽度过渡与改比例同帧生效, 拖拽必须 1:1 跟手
        moved = true;
        setResizing(true);
      }
      const x = moveEvent.clientX + offsetX;
      const available = areaRect.width - splitterRect.width;
      // 比例不设下限, 面板随指针连续收窄到 0
      const ratio = available > 0 ? (x - areaRect.left) / available : 0.5;
      applySplitRatio(ratio);
    };
    const onUp = () => {
      document.body.removeEventListener("pointermove", onMove);
      document.body.removeEventListener("pointerup", onUp);
      document.body.removeEventListener("pointercancel", onUp);
      const ratio = ratioRef.current;
      const next = settleRatio(ratio, moved, { edgeRatio, restoreRatio });
      // 先恢复过渡, 下一帧再改比例: 收起/展开的最后一段才会被动画补完
      setResizing(false);
      if (next !== ratio) {
        requestAnimationFrame(() => applySplitRatio(next));
      }
    };
    document.body.addEventListener("pointermove", onMove);
    document.body.addEventListener("pointerup", onUp);
    document.body.addEventListener("pointercancel", onUp);
  };
  // #endregion

  // #region 快捷键: 监听器只注册一次, 动作经 shortcutsRef 读取最新态

  const shortcutsRef = useRef({
    newDocumentFor,
    applyTransform,
    focusedPane,
    saveNow,
    indentation: 2 as number | "\t",
    modalOpen: false
  });
  // ref 写入仅在 effect 中进行 (render 期间禁止触碰 ref)
  useEffect(() => {
    shortcutsRef.current = {
      newDocumentFor,
      applyTransform: (action, transform) => applyTransform(action, transform),
      focusedPane,
      saveNow,
      indentation: editorConfig?.indentation ?? 2,
      modalOpen:
        configOpen ||
        propertiesPane !== null ||
        schemaPane !== null ||
        newDocumentPane !== null ||
        csvImport !== null ||
        csvExport !== null
    };
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // 弹框打开时 ESC 交由弹框自身处理 (关闭弹框), 不再退出全屏
        if (shortcutsRef.current.modalOpen) {
          return;
        }
        // 全屏 CSS class 方案, ESC 直接退出
        setFullscreenPane(null);
        return;
      }
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) {
        return;
      }
      const handlers = shortcutsRef.current;
      const key = event.key.toLowerCase();
      if (key === "s" && !event.shiftKey) {
        // Ctrl+S: 强制立即保存
        event.preventDefault();
        handlers.saveNow();
        return;
      }
      if (key === "n" && !event.shiftKey) {
        event.preventDefault();
        handlers.newDocumentFor(handlers.focusedPane);
        return;
      }
      if (event.shiftKey && key === "f") {
        event.preventDefault();
        handlers.applyTransform("formatted", (content) => formatJson(content, handlers.indentation));
        return;
      }
      if (event.shiftKey && key === "m") {
        event.preventDefault();
        handlers.applyTransform("minified", (content) => minifyJson(content));
        return;
      }
      if (event.shiftKey && key === "k") {
        event.preventDefault();
        handlers.applyTransform("keysSorted", (content) => sortJsonKeys(content, handlers.indentation));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  // #endregion

  // #region Schema 解析: 每面板按 Document properties 配置解析为编辑器 Schema
  // 结果按 "文档 schema 配置 + 对面面板内容" 缓存: panel 类型实时跟随对面, 本面板输入
  // 不触发重算, 避免每次按键都重建 Ajv 校验器 (schema 对象引用变化会重跑校验器 effect)

  const leftSchema = useMemo(
    () => resolveSchema(leftDoc?.schema, rightDoc?.content ?? ""),
    [leftDoc?.schema, rightDoc?.content]
  );
  const rightSchema = useMemo(
    () => resolveSchema(rightDoc?.schema, leftDoc?.content ?? ""),
    [rightDoc?.schema, leftDoc?.content]
  );
  // #endregion

  // #region 渲染

  if (!ready || editorConfig === null || csvExportOptions === null || csvImportOptions === null) {
    return null;
  }

  const propertiesDoc = propertiesPane === "left" ? leftDoc : propertiesPane === "right" ? rightDoc : null;
  const schemaDoc = schemaPane === "left" ? leftDoc : schemaPane === "right" ? rightDoc : null;

  // 空面板首次产生内容时创建未命名文档 (编辑器内容变更触发 changed + 防抖保存, 文档在保存时命名)
  const ensurePaneDocument = (pane: PaneKey, content: string) => {
    if (documents.length >= MAX_DOCUMENTS) {
      flashMessage(t("message.docLimit", { limit: MAX_DOCUMENTS }));
      return;
    }
    // 空面板首次输入即视为已变更, 由保存流程分配 "New document N"
    const doc = { ...refreshParse(createDocument(null, content)), isDirty: true };
    setDocuments((prev) => [...prev, doc]);
    if (pane === "left") {
      setLeftId(doc.id);
    } else {
      setRightId(doc.id);
    }
    setFocusedPane(pane);
  };

  const renderPanel = (pane: PaneKey) => {
    const doc = pane === "left" ? leftDoc : rightDoc;
    // 本面板的 Schema 解析结果: 校验器与面板菜单入口共用同一份缓存结果
    const paneSchema = pane === "left" ? leftSchema : rightSchema;
    const focused = focusedPane === pane;
    const isFullScreen = fullscreenPane === pane;
    // 面板宽度恒由比例表达 (一侧收起时该侧比例为 0, 另一侧为 1 撑满):
    // 收起/展开的几何变化交给 CSS 过渡, 面板不再卸载, 编辑器实例与滚动位置因此得以保留
    // 窄视口 (<=980px) 下由 CSS 的 flex: unset !important 覆盖为固定 600px 高度
    const ratio = pane === "left" ? splitRatio : 1 - splitRatio;
    const flex = `${ratio} 1 0%`;
    // 比例逼近端点时淡出: 极窄面板不留被压扁的菜单条, 收起过程呈现为一次完整的让位动画
    const opacity = Math.min(1, ratio / edgeRatio);
    // 无文档面板仍渲染编辑器 (空内容, tree 模式显示内置欢迎屏), 名称按钮不渲染
    const editorContent = doc?.content ?? "";
    return (
      <Panel
        pane={pane}
        flex={flex}
        opacity={opacity}
        collapsed={pane === "left" ? !leftVisible : !rightVisible}
        focused={focused}
        dragging={dragPane === pane}
        resizing={resizing}
        onFocusPane={() => setFocusedPane(pane)}
        onDragEnter={() => setDragPane(pane)}
        onDragLeave={() => setDragPane((prev) => (prev === pane ? null : prev))}
        onDropFile={(file) => {
          setDragPane(null);
          void importFile(file, pane);
        }}
        menu={
          <PanelMenu
            side={pane}
            doc={doc}
            schemaStatus={{
              active: doc?.schema !== undefined && doc.schema.type !== "none",
              error: paneSchema.error
            }}
            onOpenSchema={() => setSchemaPane(pane)}
            onOpenProperties={() => {
              if (doc !== null && doc.name !== null) {
                setPropertiesPane(pane);
              }
            }}
            onNew={
              // New 仅经 onClick 事件回调执行
              () => newDocumentFor(pane)
            }
            onImportFile={(file) => void importFile(file, pane)}
            onImportCsv={(file) => void importCsvFile(file, pane)}
            onSaveDisk={() => saveToDisk(pane)}
            onExportCsv={() => exportCsv(pane)}
            onCopy={(variant) => void copyVariant(pane, variant)}
            onSaveNow={saveNow}
            onToggleFullScreen={() => toggleFullScreen(pane)}
            fitWidth={menuFitWidth}
            onMeasureMenu={handleMeasureMenu}
          />
        }
      >
        <div className={`panel-contents${isFullScreen ? " full-screen" : ""}`}>
          <EditorToolbar
            mode={paneModes[pane]}
            onMode={(mode) => {
              // 模式 per-pane 独立: 切换只影响本面板 (两面板不联动)
              setPaneModes((prev) => ({ ...prev, [pane]: mode }));
            }}
            onAction={(action, anchor) => {
              // 上下文菜单: 取 "当前选中内容" 的菜单项给工具栏那颗常驻 GlassMenu
              if (action === "context-menu") {
                if (editorRefs.current[pane]?.openContextMenu(anchor) !== true) {
                  flashMessage(t("message.noSelection"));
                  return false;
                }
                return true;
              }
              // 其余动作委托编辑器原生菜单按钮 (搜索 / 撤销 / 格式化 ...), 行为与原生菜单一致
              return editorRefs.current[pane]?.runMenuAction(action) ?? false;
            }}
            onTransform={() => openTransform(pane, pane)}
            fullScreen={isFullScreen}
            onExitFullScreen={() => setFullscreenPane(null)}
          />
          <JsonEditor
            ref={(handle) => {
              editorRefs.current[pane] = handle;
            }}
            content={editorContent}
            mode={paneModes[pane]}
            dark={appearance === "dark"}
            config={editorConfig}
            parser={getParser(editorConfig.parserId, editorContent.length)}
            schema={paneSchema.schema}
            queryLanguages={QUERY_LANGUAGES}
            queryLanguageId={DEFAULT_QUERY_LANGUAGE_ID}
            onClassName={diffClassNames[pane]}
            onChange={(content) => {
              if (doc !== null) {
                updateDocument(doc.id, { content, isDirty: true });
              } else {
                ensurePaneDocument(pane, content);
              }
            }}
            onModeChange={(mode) => {
              // 模式 per-pane 独立: 切换只影响本面板 (两面板不联动)
              setPaneModes((prev) => ({ ...prev, [pane]: mode }));
            }}
          />
        </div>
      </Panel>
    );
  };

  // 差异导航索引: 内容变化后 diff 重算, 索引自动钳制到新范围
  const diffCount = diff.content?.changes.length ?? 0;
  const boundedDiffIndex = Math.min(diffIndex, diffCount - 1);

  return (
    <I18nProvider locale={locale}>
      <div className="app">
        <ApplicationMenu
          appearanceMode={appearanceMode}
          onAppearanceMode={setAppearanceMode}
          onOpenConfiguration={() => setConfigOpen(true)}
          onOpenNiceDay={() => setNiceDayOpen(true)}
        />

        <div className="body">
          <div ref={paneAreaRef} className={`contents-panel${resizing ? " is-resizing" : ""}`}>
            {renderPanel("left")}

            <div className="center-panel">
              {/* center-panel 的 actions 仅在两侧均可见时渲染 */}
              {bothVisible ? (
                <>
                  <div className="empty-space-top" />
                  <PanelActions
                    hasLeftDoc={leftDoc !== null}
                    hasRightDoc={rightDoc !== null}
                    showDiff={showDiff}
                    diffError={diff.error}
                    diffIndex={boundedDiffIndex}
                    diffCount={diffCount}
                    onCopyLeft={() => copyBetween("right", "left")}
                    onCopyRight={() => copyBetween("left", "right")}
                    onTransformLeft={() => transformBetween("right", "left")}
                    onTransformRight={() => transformBetween("left", "right")}
                    onToggleDiff={toggleDifferences}
                    onPrevDiff={() => goToDiff(-1)}
                    onNextDiff={() => goToDiff(1)}
                  />
                </>
              ) : null}

              <Splitter
                innerRef={splitterRef}
                bothVisible={bothVisible}
                leftVisible={leftVisible}
                onDragStart={startResize}
              />
            </div>

            {renderPanel("right")}
          </div>
        </div>

        <Toast message={message} />

        {configOpen ? (
          <ConfigurationModal
            config={editorConfig}
            dark={appearance === "dark"}
            onApply={applyEditorConfig}
            onApplyAndReload={applyEditorConfigAndReload}
            onCancel={() => setConfigOpen(false)}
          />
        ) : null}

        {transformRequest !== null ? (
          <TransformModal
            json={transformRequest.json}
            languages={QUERY_LANGUAGES}
            initialLanguageId={DEFAULT_QUERY_LANGUAGE_ID}
            parser={getParser(editorConfig.parserId, JSON.stringify(transformRequest.json).length)}
            onApply={(transformed) => {
              const text = JSON.stringify(transformed, null, 2) ?? "";
              writeIntoPane(transformRequest.to, text);
              setTransformRequest(null);
            }}
            onClose={() => setTransformRequest(null)}
            onNotify={flashMessage}
          />
        ) : null}

        {propertiesPane !== null && propertiesDoc !== null ? (
          <DocumentPropertiesModal
            doc={propertiesDoc}
            schemaConfig={propertiesDoc.schema ?? NONE_SCHEMA}
            schemaError={propertiesPane === "left" ? leftSchema.error : rightSchema.error}
            onRename={(name) => {
              updateDocument(propertiesDoc.id, { name });
            }}
            onConfigureSchema={() => {
              setSchemaPane(propertiesPane);
              setPropertiesPane(null);
            }}
            onClose={() => setPropertiesPane(null)}
          />
        ) : null}

        {schemaPane !== null && schemaDoc !== null ? (
          <JsonSchemaModal
            pane={schemaPane}
            initialSchema={schemaDoc.schema ?? NONE_SCHEMA}
            otherPanelContent={(schemaPane === "left" ? rightDoc : leftDoc)?.content ?? "{}"}
            otherPanelLabel={t(schemaPane === "left" ? "schema.rightPanel" : "schema.leftPanel")}
            config={editorConfig}
            dark={appearance === "dark"}
            onOk={(schema: SchemaConfig) => {
              updateDocument(schemaDoc.id, { schema });
            }}
            onClose={() => setSchemaPane(null)}
          />
        ) : null}

        {newDocumentPane !== null ? (
          <ConfirmModal
            title={t("confirm.newDocumentTitle")}
            message={t("message.newDocumentConfirm")}
            confirmLabel={t("confirm.newDocument")}
            onConfirm={() => {
              const pane = newDocumentPane;
              setNewDocumentPane(null);
              createNewDocument(pane);
            }}
            onClose={() => setNewDocumentPane(null)}
          />
        ) : null}

        {csvImport !== null ? (
          <CsvImportModal
            fileName={csvImport.fileName}
            csvText={csvImport.text}
            options={csvImportOptions}
            onOptionsChange={setCsvImportOptions}
            onImport={confirmCsvImport}
            config={editorConfig}
            dark={appearance === "dark"}
            onClose={() => setCsvImport(null)}
          />
        ) : null}

        {csvExport !== null ? (
          <CsvExportModal
            fileName={csvExport.fileName}
            jsonText={csvExport.jsonText}
            options={csvExportOptions}
            onOptionsChange={setCsvExportOptions}
            onSave={confirmCsvExport}
            onNotify={flashMessage}
            onClose={() => setCsvExport(null)}
          />
        ) : null}

        {niceDayOpen ? <NiceDayCard onClose={() => setNiceDayOpen(false)} /> : null}
      </div>
    </I18nProvider>
  );
}
// #endregion
