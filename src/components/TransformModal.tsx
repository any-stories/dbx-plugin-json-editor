/**
 * Transform 弹框
 *
 * 取代 vanilla-jsoneditor 自带 transform 弹框: 原生弹框是 svelte 内部 modal, 无法套用本插件的窗口样式
 * 查询执行仍复用编辑器的 QueryLanguage 实现 (JSON Query / JMESPath / JSONPath / JavaScript),
 * 语义与原生弹框一致; 左侧写查询, 右侧实时预览结果, 应用后由调用方写回目标面板
 */

import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactElement } from "react";
import { GlassButton } from "@zakisheriff/liquid-glass";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
import { GlassMenu, type GlassMenuEntry } from "./GlassMenu";
import { useT } from "../i18n/useT";
import { dbx } from "../host/DBXAdapter";
import type { JSONParser, QueryLanguage } from "vanilla-jsoneditor";

interface TransformModalProps {
  /** 源面板文档的 JSON 值 */
  json: unknown;
  languages: QueryLanguage[];
  initialLanguageId: string;
  /** 与编辑器一致的 JSON 解析器 (查询结果序列化用) */
  parser: JSONParser;
  onApply: (transformed: unknown) => void;
  onClose: () => void;
  /** 通知条反馈 (复制链接的结果提示) */
  onNotify: (message: string) => void;
}

/** 按语言生成默认查询; 内容不适合该语言时退化为空查询 */
function createDefaultQuery(language: QueryLanguage, json: unknown): string {
  try {
    return language.createQuery(json, {});
  } catch {
    return "";
  }
}

function stringifyResult(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  const text = JSON.stringify(value, null, 2);
  return text === undefined ? String(value) : text;
}

// 语言的 description 是带 <p> / <a> / <code> 的 HTML 片段
// 插件内 (sandbox iframe, opaque origin, 无 allow-popups) 外链无法打开, 点击改为复制链接地址;
// 插件外 (独立浏览器) 放行默认跳转, 并注入 target=_blank 新标签打开, 避免把插件页面导航走
// linkTitle 为 null 时不注入 title (插件外悬浮显示浏览器默认的链接地址)
function decorateLinks(html: string, linkTitle: string | null): string {
  return html.replace(/<a\b([^>]*)>/gi, (match, attrs: string) => {
    const additions: string[] = [];
    if (linkTitle !== null && !/\btitle=/.test(attrs)) {
      const safeTitle = linkTitle.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      additions.push(`title="${safeTitle}"`);
    }
    if (!/\btarget=/.test(attrs)) {
      additions.push('target="_blank"');
    }
    if (!/\brel=/.test(attrs)) {
      additions.push('rel="noopener noreferrer"');
    }
    return additions.length === 0 ? match : `<a${attrs} ${additions.join(" ")}>`;
  });
}

// 菜单 title 只能放纯文本, 否则悬浮会原样显示标签
function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

export function TransformModal({
  json,
  languages,
  initialLanguageId,
  parser,
  onApply,
  onClose,
  onNotify
}: TransformModalProps): ReactElement {
  const t = useT();
  const [languageId, setLanguageId] = useState(initialLanguageId);
  const language = useMemo(
    () => languages.find((entry) => entry.id === languageId) ?? languages[0],
    [languages, languageId]
  );
  const [query, setQuery] = useState(() => createDefaultQuery(language, json));
  const [result, setResult] = useState("");
  const [error, setError] = useState<string | null>(null);
  // 语言切换时重置查询, 但初次挂载不覆盖用户可能已输入的默认查询
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    setQuery(createDefaultQuery(language, json));
  }, [language, json]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      // 空查询即恒等变换 (JSON Query 的默认查询就是空串), 预览直接呈现源文档
      if (query.trim() === "") {
        setResult(stringifyResult(json));
        setError(null);
        return;
      }
      try {
        const transformed = language.executeQuery(json, query, parser);
        setResult(stringifyResult(transformed));
        setError(null);
      } catch (err) {
        setResult("");
        setError(err instanceof Error ? err.message : String(err));
      }
    }, 160);
    return () => window.clearTimeout(timer);
  }, [query, language, json, parser]);

  const languageItems: GlassMenuEntry[] = languages.map((entry) => ({
    key: entry.id,
    icon: <Icon name="code" />,
    label: entry.name,
    // 悬浮提示用纯文本简介 (去掉 description 里的 HTML 标签)
    title: plainText(entry.description),
    checked: entry.id === language.id,
    onSelect: () => setLanguageId(entry.id)
  }));

  const apply = () => {
    try {
      onApply(language.executeQuery(json, query, parser));
    } catch {
      // 错误已在预览中呈现, 应用按钮此时为禁用态
    }
  };

  // 说明里的链接属性按环境注入: 插件内悬浮提示"点击复制链接", 插件外不注入 (浏览器默认悬浮显示地址)
  const descriptionHtml = useMemo(
    () => decorateLinks(language.description, dbx.inHost() ? t("transform.copyLinkTitle") : null),
    [language, t]
  );

  // 插件内: 点击外链不导航 (沙箱内也打不开), 复制链接地址到剪贴板, 由通知条反馈结果;
  // 沙箱无 navigator.clipboard, dbx.copyText 优先走宿主剪贴板桥接.
  // 插件外 (独立浏览器): 不拦截, 走默认跳转 (target=_blank 新标签打开)
  const onDescriptionClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!dbx.inHost()) {
      return;
    }
    const anchor = (event.target as HTMLElement).closest("a");
    if (anchor === null) {
      return;
    }
    event.preventDefault();
    // getAttribute 读取说明中书写的原始 href (jse 内置说明均为绝对地址), 属性缺失时回退到解析后的 href
    const url = anchor.getAttribute("href") ?? anchor.href;
    dbx
      .copyText(url)
      .then((copied) => {
        onNotify(t(copied ? "transform.linkCopied" : "transform.linkCopyFailed"));
      })
      .catch(() => {
        onNotify(t("transform.linkCopyFailed"));
      });
  };

  return (
    <Modal title={t("transform.title")} variant="transform" onClose={onClose}>
      <div className="transform-toolbar">
        <span className="transform-toolbar-label">{t("transform.language")}</span>
        <GlassMenu
          trigger={
            <>
              <Icon name="code" /> {language.name} <Icon name="caretDown" />
            </>
          }
          triggerClassName="modal-select"
          triggerTitle={t("transform.languageTitle")}
          entries={languageItems}
          align="start"
          minWidth={220}
        />
        <div className="transform-toolbar-space" />
        <GlassButton
          size="sm"
          variant="glass"
          title={t("transform.resetTitle")}
          onClick={() => setQuery(createDefaultQuery(language, json))}
        >
          {t("transform.reset")}
        </GlassButton>
      </div>
      {/* 当前查询语言的用法说明 (换语言即时跟随); 插件内点击外链复制链接, 插件外新标签打开 */}
      <div
        className="transform-description"
        onClick={onDescriptionClick}
        dangerouslySetInnerHTML={{ __html: descriptionHtml }}
      />
      <div className="transform-columns">
        <div className="transform-pane">
          <div className="transform-pane-header">{t("transform.query")}</div>
          <textarea
            className="transform-query"
            value={query}
            spellCheck={false}
            aria-label={t("transform.query")}
            placeholder={t("transform.queryPlaceholder")}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="transform-pane">
          <div className="transform-pane-header">{t("transform.result")}</div>
          {error === null ? (
            <pre className="transform-result">
              {result === "" ? <span className="transform-empty">{t("transform.noResult")}</span> : result}
            </pre>
          ) : (
            <pre className="transform-result error">{t("transform.errorPrefix", { message: error })}</pre>
          )}
        </div>
      </div>
      <div className="modal-action-menu">
        <GlassButton size="sm" variant="glass" onClick={onClose}>
          {t("transform.cancel")}
        </GlassButton>
        <GlassButton size="sm" variant="filled" disabled={error !== null} onClick={apply}>
          {t("transform.apply")}
        </GlassButton>
      </div>
    </Modal>
  );
}
