/**
 * vanilla-jsoneditor 的 React 封装
 *
 * 内容双向同步 + 内置主菜单/导航条/状态栏
 * 原生菜单条由 CSS 隐藏 (.jse-menu), 可见的工具栏改为 EditorToolbar, 动作按类名点击原生按钮委托
 * 外部内容更新仅在非编辑来源时写回, 避免 onChange 反馈环
 * parser / tabSize / flattenColumns 均为编辑器原生 props; schema 不属于编辑器 props,
 * 经纯 JS 校验器转换为 validator prop 注入 (由 Configuration 与 Document properties 弹框驱动).
 * 不用 vanilla-jsoneditor 的 createAjvValidator: 它内部 new Function 会被插件沙箱 CSP 拦下.
 */

import { forwardRef, useEffect, useId, useImperativeHandle, useRef } from "react";
import type { CSSProperties } from "react";
import {
  createJSONEditor,
  isTextContent,
  Mode,
  renderJSONSchemaEnum,
  renderValue,
  type Content,
  type JSONEditorPropsOptional,
  type JSONParser,
  type JSONSchema,
  type OnRenderValue,
  type QueryLanguage
} from "vanilla-jsoneditor";
import "vanilla-jsoneditor/themes/jse-theme-dark.css";
import type { JSONPath } from "../core/diff";
import type { ViewMode } from "../core/document";
import type { EditorConfig } from "../core/editorConfig";
import { createJsonSchemaValidator } from "../core/schemaValidator";
import { openContextMenu, openSelectionContextMenu, takeMenuAnchor, type MenuAnchor } from "../core/jseContextMenu";
import { EditorContextMenu } from "./EditorContextMenu";

type EditorInstance = ReturnType<typeof createJSONEditor>;
// 编辑器运行时接受 (string | number)[] 路径, 类型层为 string[] (immutable-json-patch), 调用点显式收窄
type EditorPath = Parameters<EditorInstance["scrollTo"]>[0];

const MODE_MAP: Record<ViewMode, Mode> = {
  tree: Mode.tree,
  table: Mode.table,
  text: Mode.text
};

function modeToViewMode(mode: Mode): ViewMode {
  if (mode === Mode.table) {
    return "table";
  }
  if (mode === Mode.text) {
    return "text";
  }
  return "tree";
}

// json 内容 -> 文本: 必须走配置的解析器 (lossless), 否则原生 JSON.stringify 会把
// LosslessNumber 展开成 { value, isLosslessNumber } 对象, 文档被写坏且对比出现假差异
function toText(value: Content, parser: JSONParser | undefined, indentation: EditorConfig["indentation"]): string {
  if (isTextContent(value)) {
    return value.text;
  }
  const json = value.json ?? null;
  if (parser !== undefined) {
    const text = parser.stringify(json, null, indentation);
    if (text !== undefined) {
      return text;
    }
  }
  return JSON.stringify(json, null, indentation) ?? "";
}

// 未配置 Schema 时走编辑器内置渲染;
// 配置后先按路径解析 Schema 的 enum, 命中则把该字段渲染为下拉选择器, 否则回退内置渲染
function createSchemaValueRenderer(schema: JSONSchema | null): OnRenderValue {
  if (schema === null) {
    return renderValue;
  }
  return (props) => renderJSONSchemaEnum(props, schema) ?? renderValue(props);
}

// 命令式句柄: runMenuAction 委托原生菜单按钮 (工具栏用), scrollTo/findElement 用于差异导航
export interface JsonEditorHandle {
  /** 按类名点击编辑器原生菜单按钮 (search / undo / format ...), 返回是否存在该按钮 */
  runMenuAction: (action: string) => boolean;
  /** 打开当前选中内容的上下文菜单, 浮层从 anchor 展开; 没有选中内容时返回 false */
  openContextMenu: (anchor: MenuAnchor | null) => boolean;
  scrollTo: (path: JSONPath) => Promise<void>;
  findElement: (path: JSONPath) => Element | undefined;
}

interface JsonEditorProps {
  content: string;
  mode: ViewMode;
  dark: boolean;
  /** Configuration 弹框的配置 (缩进/转义/解析器/table 列展开为编辑器 props) */
  config: EditorConfig;
  /** 生效的 JSON 解析器 (选项解析结果) */
  parser?: JSONParser;
  /** Document properties 弹框配置的 JSON Schema (经纯 JS 校验器生成编辑器校验器) */
  schema?: JSONSchema | null;
  /** 只读模式 (弹框预览列使用) */
  readOnly?: boolean;
  /** 编辑器内置主菜单 (Format/Compact/Transform/Sort/Find/Repair) */
  mainMenuBar?: boolean;
  /** 编辑器内置导航条 (路径面包屑) */
  navigationBar?: boolean;
  /** 编辑器内置状态栏 (行号列号与校验) */
  statusBar?: boolean;
  /** diff 高亮回调: 按路径返回 diff-* 类名 */
  onClassName?: (path: JSONPath, value: unknown) => string | undefined;
  /** Transform 弹框的查询语言集合 (多于一种时头部渲染语言切换按钮) */
  queryLanguages?: QueryLanguage[];
  /** Transform 弹框当前查询语言 */
  queryLanguageId?: string;
  onChange?: (content: string) => void;
  /** 内置模式下拉切换 Tree/Code/Table 时回传, 由调用方同步文档状态 */
  onModeChange?: (mode: ViewMode) => void;
}

export const JsonEditor = forwardRef<JsonEditorHandle, JsonEditorProps>(function JsonEditor(
  {
    content,
    mode,
    dark,
    config,
    parser,
    schema = null,
    readOnly = false,
    mainMenuBar = true,
    navigationBar = true,
    statusBar = true,
    onClassName,
    queryLanguages,
    queryLanguageId,
    onChange,
    onModeChange
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorInstance | null>(null);
  // 上下文菜单宿主按实例区分: 两面板各挂一份, 只有打开菜单的那个渲染浮层
  const owner = useId();
  // 记录最近一次由编辑器回传的文本, 用于区分外部写入
  const emittedRef = useRef<string>(content);
  const changeRef = useRef<((content: string) => void) | undefined>(onChange);
  changeRef.current = onChange;
  const modeChangeRef = useRef(onModeChange);
  modeChangeRef.current = onModeChange;
  const classNameRef = useRef(onClassName);
  classNameRef.current = onClassName;
  // json -> text 的序列化必须跟随当前解析器与缩进 (编辑器实例只建一次, 这里用 ref 取最新值)
  const parserRef = useRef(parser);
  parserRef.current = parser;
  const indentationRef = useRef(config.indentation);
  indentationRef.current = config.indentation;

  // 委托原生菜单按钮: 工具栏的搜索/撤销/格式化等都走这条通道, 行为与编辑器自带菜单完全一致
  useImperativeHandle(
    ref,
    () => ({
      runMenuAction: (action: string) => {
        const button = containerRef.current?.querySelector<HTMLButtonElement>(`.jse-menu .jse-${action}`);
        if (button === null || button === undefined) {
          return false;
        }
        button.click();
        return true;
      },
      // 工具栏 "上下文菜单": 菜单项由 jse 按当前选中内容生成, 浮层由玻璃菜单接管
      openContextMenu: (anchor: MenuAnchor | null) => openSelectionContextMenu(containerRef.current, anchor),
      scrollTo: (path: JSONPath) => editorRef.current?.scrollTo(path as EditorPath) ?? Promise.resolve(),
      findElement: (path: JSONPath) => editorRef.current?.findElement(path as EditorPath)
    }),
    []
  );

  useEffect(() => {
    const target = containerRef.current;
    if (!target) {
      return undefined;
    }
    let disposed = false;
    emittedRef.current = content;
    const editor = createJSONEditor({
      target,
      props: {
        content: { text: content },
        mode: MODE_MAP[mode],
        mainMenuBar,
        navigationBar,
        statusBar,
        readOnly,
        // Configuration 弹框: 缩进与转义为编辑器原生 props
        indentation: config.indentation,
        tabSize: config.tabSize,
        escapeControlCharacters: config.escapeControlCharacters,
        escapeUnicodeCharacters: config.escapeUnicodeCharacters,
        flattenColumns: config.flattenColumns,
        // Transform 弹框: 查询语言多于一种时头部渲染语言切换按钮
        queryLanguages,
        queryLanguageId,
        onClassName: (path, value) => classNameRef.current?.(path, value),
        // 上下文菜单: 预约过锚点的菜单交给玻璃菜单 (返回 false 让 jse 不画自己的浮层).
        // mount=true 由编辑器宿主挂浮层; mount=false 只存菜单项, 工具栏那颗常驻 GlassMenu 自己展开
        onRenderContextMenu: (items) => {
          const armed = takeMenuAnchor();
          if (armed === null) {
            return undefined;
          }
          openContextMenu({ owner, items, anchor: armed.anchor, mount: armed.mount });
          return false;
        },
        onRenderValue: createSchemaValueRenderer(schema),
        onChange: (updated: Content) => {
          const text = toText(updated, parserRef.current, indentationRef.current);
          emittedRef.current = text;
          changeRef.current?.(text);
        },
        onChangeMode: (next: Mode) => {
          modeChangeRef.current?.(modeToViewMode(next));
        }
      } satisfies JSONEditorPropsOptional
    });
    if (disposed) {
      void editor.destroy();
      return undefined;
    }
    editorRef.current = editor;
    return () => {
      disposed = true;
      void editor.destroy();
      editorRef.current = null;
    };
    // 编辑器实例只挂载一次, 模式与主题变更走 updateProps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // diff 高亮: jse 只在 onClassName 这个 prop 换引用时才重算节点类名, 因此这里按引用推一次
  // (实例只建一次, 建时那版回调读 ref; 若不再推, 开关比较后已渲染的行不会拿到 diff-* 类)
  useEffect(() => {
    editorRef.current?.updateProps({
      onClassName: (path, value) => classNameRef.current?.(path, value)
    });
  }, [onClassName]);

  useEffect(() => {
    editorRef.current?.updateProps({ mode: MODE_MAP[mode] });
  }, [mode]);

  // Configuration 弹框: 缩进/制表位/转义/table 列展开即时生效
  useEffect(() => {
    editorRef.current?.updateProps({
      indentation: config.indentation,
      tabSize: config.tabSize,
      escapeControlCharacters: config.escapeControlCharacters,
      escapeUnicodeCharacters: config.escapeUnicodeCharacters,
      flattenColumns: config.flattenColumns
    });
  }, [
    config.indentation,
    config.tabSize,
    config.escapeControlCharacters,
    config.escapeUnicodeCharacters,
    config.flattenColumns
  ]);

  // Document properties 弹框: JSON Schema 校验与 enum 下拉即时生效
  // schema 经纯 JS 校验器转为 validator; 调用方按文档配置缓存解析结果, 本层再按
  // Schema 内容签名去重, 内容等价时跳过重建, 避免重复构造校验函数
  const schemaSignature = schema === null ? "" : JSON.stringify(schema);
  const appliedSchemaRef = useRef<string | null>(null);
  useEffect(() => {
    if (appliedSchemaRef.current === schemaSignature) {
      return;
    }
    appliedSchemaRef.current = schemaSignature;
    // 纯 JS 校验器不会因 CSP (unsafe-eval) 抛错, 无需以 try/catch 防御渲染崩溃:
    // 非法 Schema 已在 core/schema.resolveSchema 用同一套结构校验拦下 (schema=null).
    // 这里仅在有 Schema 时生成校验函数, 未知 format 一律忽略, 与配置页一致.
    const validator = schema === null ? undefined : createJsonSchemaValidator(schema);
    editorRef.current?.updateProps({
      validator,
      onRenderValue: createSchemaValueRenderer(schema)
    });
  }, [schema, schemaSignature]);

  // 解析器切换即时生效 (Configuration > Parser)
  useEffect(() => {
    if (parser !== undefined) {
      editorRef.current?.updateProps({ parser });
    }
  }, [parser]);

  useEffect(() => {
    if (content === emittedRef.current) {
      return;
    }
    emittedRef.current = content;
    editorRef.current?.set({ text: content });
  }, [content]);

  // 字号不属于编辑器 props, 通过 CSS 变量覆盖 (普通文本与等宽文本同值)
  const fontSizeStyle = {
    "--jse-font-size": config.fontSize,
    "--jse-font-size-mono": config.fontSize
  } as CSSProperties;

  return (
    <>
      <div ref={containerRef} className={`jse-host ${dark ? "jse-theme-dark" : ""}`} style={fontSizeStyle} />
      <EditorContextMenu owner={owner} />
    </>
  );
});
