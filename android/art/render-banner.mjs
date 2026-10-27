// Renders the Android TV banner (640x360 = 320x180dp at xhdpi) with Electron,
// reusing desktop/build/icon.svg. Run from desktop/:
//   env -u ELECTRON_RUN_AS_NODE npx electron ../android/art/render-banner.mjs
import { app, BrowserWindow } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(path.join(here, "../../desktop/build/icon.svg"), "utf8").replace('width="1024" height="1024"', 'width="250" height="250"');
const html = `<html><body style="margin:0;width:640px;height:360px;display:flex;align-items:center;justify-content:center;gap:8px;
  background:linear-gradient(135deg,#2a1f52,#0b0918);font-family:-apple-system,Helvetica,sans-serif">
  ${svg}<span style="font-size:84px;font-weight:700;letter-spacing:-2px;color:#fff">Aether<span style="color:#b39aff">IO</span></span></body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 640, height: 360, show: false, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 640, height: 360 });
  const out = path.join(here, "../app/src/main/res/drawable-xhdpi/banner_art.png");
  writeFileSync(out, image.resize({ width: 640, height: 360 }).toPNG());
  console.log("banner", image.getSize());
  app.quit();
});
