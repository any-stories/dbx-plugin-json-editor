/**
 * 全局常量
 *
 * 禁止魔法值, 所有跨组件复用的数值/文案外的配置统一在此定义
 */

// #region 文档与工作区
// host.storage 单值上限 256KiB, 单文档内容按 200K 字符预检
export const DOC_VALUE_LIMIT = 200_000;
export const MAX_DOCUMENTS = 8;
// 首开左面板示例文档数据
export const SAMPLE_DOCUMENT_DATA = {
  text: "Hello, world!",
  language: "en-US",
  timestamp: 1580572800000,
  color: "#7c6cf0",
  boolean: true,
  email: "hello@example.com"
} as const;
// New 按钮与磁盘保存弹框对未命名文档使用的默认名称
export const DEFAULT_DOCUMENT_NAME = "New document";
// 自动保存延迟
export const AUTOSAVE_DELAY_MS = 1000;
// #endregion

// #region splitter
// it = .15: 比例越过阈值时卸载对应一侧面板
export const SPLITTER_EDGE_RATIO = 0.15;
// at = .2: 点击 splitter 无拖动时恢复被收起一侧的比例
export const SPLITTER_RESTORE_RATIO = 0.2;
// panel-menu 文档名预留宽度: 按钮排满时若面板连"按钮全宽 + 该预留"都放不下, 就提前退为图标,
// 把空间让给 "New document N" 名称, 避免名称被过早截断
export const MENU_NAME_RESERVE_PX = 120;
// 仅图标模式下文档名的最小可见宽度: 面板连"图标宽 + 该宽度"都放不下时即收起整块面板
export const MENU_NAME_MIN_PX = 64;
// panel-menu 左右内边距 (各 8px): 计算收起 / 恢复宽度阈值时计入
export const MENU_CHROME_PX = 16;
// 恢复宽度相对 compact 阈值的余量: 确保单击 splitter 恢复后稳定落在"按钮全文案"完整态,
// 不会因过渡/换算舍入刚好卡在 compact 边界而停在图标态
export const MENU_RESTORE_SLACK_PX = 48;
// #endregion

// #region 差异导航
// blink-diff-value 类挂载时长
export const DIFF_BLINK_MS = 1200;
// #endregion

// #region 通知
export const MESSAGE_AUTO_CLOSE_MS = 3000;
// 带动作按钮的通知给用户更长的阅读窗口
export const MESSAGE_ACTION_CLOSE_MS = 5000;
// #endregion

// #region 文件导入
// Open from disk 输入框接受的类型
export const OPEN_FILE_ACCEPT = ".json,.jsonc,.txt,.har,application/json";
// Import CSV 隐藏 input 的 accept 取值
export const CSV_ACCEPT = "text/csv";
// 导出 MIME 类型
export const JSON_MIME_TYPE = "application/json";
export const CSV_MIME_TYPE = "text/csv";
// FileDrop 语义: .csv 后缀走 CSV Import 弹框, 其余文件按 JSON 文档载入
export const CSV_FILE_EXTENSION = ".csv";
// #endregion

// #region 编辑器配置
// Configuration 弹框预览列的文本/表格示例文档
export const CONFIG_PREVIEW_TEXT_CONTENT = `{
  "text": "Preview configuration settings",
  "boolean": true,
  "color": "red",
  "unicode": "\u{1F600}",
  "multiline": "First line\\nSecond line\\nThird line",
  "tags": ["apple", "banana", "orange"],
  "bigNumber": 9007199254740991,
  "specialChars": "Quote: \\"Hello\\", Backslash: \\\\"
}`;
export interface ConfigPreviewTableContent {
  json: Array<Record<string, unknown>>;
  text?: string;
}

export const CONFIG_PREVIEW_TABLE_CONTENT: ConfigPreviewTableContent = {
  json: [
    {
      id: 1,
      name: "John Doe",
      role: "Frontend Developer",
      experience: 5,
      active: true,
      skills: {
        frontend: ["React", "Vue", "Next.js"],
        backend: ["Node.js", "Express"],
        tools: ["VS Code", "Git", "Docker"]
      },
      contact: {
        email: "john.doe@example.com",
        website: "https://johndoe.dev"
      }
    },
    {
      id: 2,
      name: "Jane Smith",
      role: "Backend Developer",
      experience: 8,
      active: true,
      skills: {
        backend: ["Spring Boot", "Django", "Gin"],
        database: ["MySQL", "PostgreSQL", "Redis"],
        tools: ["IntelliJ IDEA", "Git", "Kubernetes"]
      },
      contact: {
        email: "jane.smith@example.com",
        website: "https://janesmith.dev"
      }
    },
    {
      id: 3,
      name: "Alex Johnson",
      role: "Full Stack Developer",
      experience: 6,
      active: false,
      skills: {
        frontend: ["React", "Angular"],
        backend: ["Spring Boot", "Node.js"],
        database: ["MongoDB", "PostgreSQL"],
        tools: ["VS Code", "Docker", "GitHub Actions"]
      },
      contact: {
        email: "alex.johnson@example.com",
        website: null
      }
    }
  ]
};
// #endregion

// #region CSV 弹框
// 导出预览仅取前 100 条记录并追加省略号, 复制/保存时输出全量
export const CSV_EXPORT_PREVIEW_RECORD_LIMIT = 100;
// CSV Export 预览省略号后缀
export const CSV_EXPORT_PREVIEW_SUFFIX = "...";
// 导入预览的源文本截断长度
export const CSV_IMPORT_PREVIEW_CHAR_LIMIT = 1_000_000;
// 导入预览截断省略号
export const CSV_IMPORT_PREVIEW_SUFFIX = "\n...";
// #endregion

// #region host.storage 附加键
export const CSV_EXPORT_OPTIONS_KEY = "csvExportOptions";
export const CSV_IMPORT_OPTIONS_KEY = "csvImportOptions";
// #endregion
