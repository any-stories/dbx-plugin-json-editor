// watch 构建: 每次成功写入产物后输出 DBX_UI_BUILD_SUCCESS, dbx-plugin dev 依据该行触发页面重载
import { build } from "vite";

const watcher = await build({ watch: {} });

watcher.on("event", (event) => {
  if (event.code === "BUNDLE_END") {
    console.log("DBX_UI_BUILD_SUCCESS");
  }
  if (event.code === "ERROR") {
    console.error("[dbx-json-editor] build failed");
  }
});
