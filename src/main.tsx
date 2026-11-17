/**
 * 应用入口
 *
 * 液态玻璃组件库明暗由 body[data-theme] 强制 (库默认跟 prefers-color-scheme, 插件外观是独立状态)
 */

import { createRoot } from "react-dom/client";
import "@zakisheriff/liquid-glass/styles.css";
import "./styles/app.css";
import App from "./App";

const container = document.getElementById("root");
if (container !== null) {
  createRoot(container).render(<App />);
}
