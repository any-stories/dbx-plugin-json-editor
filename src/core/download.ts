/**
 * 文件下载/落盘通道
 *
 * 宿主沙箱 (sandbox="allow-scripts", opaque origin) 里 <a download> 静默失败
 * (不抛异常也不落盘), 不能单独依赖. 落盘优先走宿主 fileTransfer 原生保存
 * 对话框, 仅独立浏览器调试 (无宿主) 时才用浏览器下载.
 * 仅导出纯函数, 宿主能力统一经 DBXAdapter 访问.
 */

import { dbx } from "../host/DBXAdapter";
import type { SaveOutcome } from "../host/DBXAdapter";

/**
 * 保存文本文件.
 * - 宿主环境: 走 fileTransfer.beginSave/write/finish 弹原生保存对话框 (返回 "host"/"canceled"),
 *   通道不可用时返回 "unavailable", 调用方应降级到剪贴板.
 * - 独立浏览器: 走 <a download> 浏览器下载 (返回 "browser"), 失败返回 "unavailable".
 */
export async function downloadTextFile(fileName: string, content: string, mimeType: string): Promise<SaveOutcome> {
  if (dbx.inHost()) {
    return dbx.saveFileViaHost(fileName, content, mimeType);
  }
  return browserDownload(fileName, content, mimeType) ? "browser" : "unavailable";
}

function browserDownload(fileName: string, content: string, mimeType: string): boolean {
  try {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}
