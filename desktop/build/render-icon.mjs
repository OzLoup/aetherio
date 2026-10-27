// Renders build/icon.svg to build/icon.png (1024²) with Electron itself, so
// no image tools are needed. electron-builder turns the PNG into .icns.
// Run: env -u ELECTRON_RUN_AS_NODE npx electron build/render-icon.mjs
import { app, BrowserWindow } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
app.whenReady().then(async () => {
  const svg = readFileSync(path.join(here, "icon.svg"), "utf8");
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  writeFileSync(path.join(here, "icon.png"), image.resize({ width: 1024, height: 1024 }).toPNG());
  console.log("icon.png", image.getSize());
  app.quit();
});
