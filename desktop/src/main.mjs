import { app, BrowserWindow, ipcMain, net, protocol, shell } from "electron";
import { appendFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ffprobe from "@ffprobe-installer/ffprobe";
import ffmpegStatic from "ffmpeg-static";
import { startCasting } from "./cast.mjs";
import { startMediaServer } from "./media-server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

// Installed app: keep a log (~/Library/Logs/AetherIO/main.log) to diagnose
// casting/network issues — there's no terminal to read it from.
if (app.isPackaged) {
  const dir = app.getPath("logs");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "main.log");
  for (const level of ["info", "warn", "error", "log"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      try {
        const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
        appendFileSync(file, `${new Date().toISOString()} [${level}] ${text}\n`);
      } catch {
        // logging must never break the app
      }
    };
  }
}
// Binaries can't run from inside the asar archive; the build unpacks them.
const unpacked = (p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

// The packaged UI is served from app://ui/ (a "standard" scheme, so the
// SPA's client-side routes and fetch() behave like on a website).
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const DEV_URL = process.env.DEV_URL ?? "http://localhost:5173";
const SCHEME = "aetherio";
let media;
let caster;
/** What's being cast: replayed on seek when the Mac re-packages it. */
let castSession = null;
let mainWindow = null;
let pendingAuth = null;

// aetherio:// links come back from the system browser after Google login.
if (process.defaultApp) {
  // Dev (`electron .`): register this Electron binary + our app folder.
  app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(SCHEME);
}

/** aetherio://auth/callback#token=… → hand the token (or error) to the UI. */
function handleDeepLink(url) {
  if (!url?.startsWith(`${SCHEME}://`)) return;
  const fragment = new URLSearchParams(url.split("#")[1] ?? "");
  const payload = { token: fragment.get("token"), error: fragment.get("error") };
  if (mainWindow) {
    mainWindow.webContents.send("desktop:auth", payload);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else {
    pendingAuth = payload;
  }
}

// macOS delivers the link as an event (also when it launches the app).
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

// Windows/Linux deliver it as an argument to a second instance.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    handleDeepLink(argv.find((a) => a.startsWith(`${SCHEME}://`)));
  });
}

function serveUi() {
  const uiDir = path.join(here, "..", "ui");
  protocol.handle("app", (request) => {
    const { pathname } = new URL(request.url);
    let file = path.normalize(path.join(uiDir, decodeURIComponent(pathname)));
    if (!file.startsWith(uiDir)) return new Response("Forbidden", { status: 403 });
    // Unknown paths are client-side routes: hand them the SPA.
    if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(uiDir, "index.html");
    return net.fetch(pathToFileURL(file).toString());
  });
}

function createWindow() {
  const win = (mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#15141c",
    title: "AetherIO",
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  }));
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.webContents.on("did-finish-load", () => {
    if (pendingAuth) {
      win.webContents.send("desktop:auth", pendingAuth);
      pendingAuth = null;
    }
  });
  // Links meant for a new tab (Real-Debrid, addon config pages, YouTube)
  // open in the user's browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.loadURL(app.isPackaged ? "app://ui/" : DEV_URL);
}

app.whenReady().then(async () => {
  media = await startMediaServer({
    ffmpegPath: unpacked(ffmpegStatic),
    ffprobePath: unpacked(ffprobe.path),
  });
  console.info("[desktop] media server on", media.base);
  // Opens a link in the user's browser (Google login can't run inside an
  // embedded browser window). Only web links.
  ipcMain.handle("desktop:open-external", (_event, url) => {
    if (typeof url === "string" && /^https?:\/\//.test(url)) return shell.openExternal(url);
  });
  // macOS → Privacy & Security → Local Network (where casting is allowed).
  ipcMain.handle("desktop:open-local-network-settings", () =>
    shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork"),
  );
  ipcMain.on("desktop:info", (event) => {
    event.returnValue = {
      mediaBase: media.base,
      mediaToken: media.token,
      platform: process.platform,
      version: app.getVersion(),
    };
  });
  // --- casting (Chromecast / DLNA), driven by the UI over IPC ---
  caster = startCasting({
    onDevices: (devices) => mainWindow?.webContents.send("cast:devices", devices),
    onStatus: (status) =>
      mainWindow?.webContents.send("cast:status", {
        ...status,
        // Re-packaged streams start at the seek point: report file time.
        currentTime: status.currentTime + (castSession?.offset ?? 0),
        duration: castSession?.media.duration ?? status.duration,
      }),
  });
  caster.refresh();

  /** Start (or restart at `start`) the cast described by the UI. */
  async function castPlay(deviceId, m, start) {
    const device = caster.list().find((d) => d.id === deviceId);
    if (!device) throw new Error("Ese dispositivo ya no está disponible");
    if (m.direct) {
      // The TV fetches the original link itself (simple MP4/AAC).
      const subs = m.vtt ? media.registerCast({ url: m.url, vtt: m.vtt }) : null;
      castSession = { deviceId, media: m, offset: 0 };
      return caster.play(deviceId, { url: m.url, title: m.title, type: m.contentType, startTime: start, subtitlesUrl: subs?.subtitlesUrl });
    }
    // The Mac re-packages it (MKV, AC3/DTS, chosen audio track, headers) and
    // the TV reads it over the LAN. Copied video starts on a keyframe.
    const offset = m.videoMode === "h264" ? start : await media.seekpoint(m.url, m.headers, start);
    const reg = media.registerCast({
      url: m.url,
      headers: m.headers,
      audio: m.audio ?? 0,
      start: offset,
      videoMode: m.videoMode ?? "copy",
      videoCodec: m.videoCodec,
      format: device.kind === "dlna" ? "mpegts" : "mp4",
      vtt: m.vtt,
    });
    castSession = { deviceId, media: m, offset };
    return caster.play(deviceId, { url: reg.url, title: m.title, type: reg.contentType, startTime: 0, subtitlesUrl: reg.subtitlesUrl });
  }

  ipcMain.handle("cast:list", () => caster.list());
  ipcMain.handle("cast:refresh", () => caster.refresh());
  ipcMain.handle("cast:play", (_e, deviceId, m) => castPlay(deviceId, m, m.start ?? 0));
  ipcMain.handle("cast:pause", () => caster.pause());
  ipcMain.handle("cast:resume", () => caster.resume());
  ipcMain.handle("cast:seek", async (_e, t) => {
    if (!castSession) return;
    if (castSession.media.direct) return caster.seek(t);
    return castPlay(castSession.deviceId, castSession.media, t);
  });
  ipcMain.handle("cast:stop", async () => {
    castSession = null;
    media.clearCasts();
    await caster.stop();
  });

  if (app.isPackaged) serveUi();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  caster?.stop().catch(() => {});
  caster?.destroy();
  media?.close();
  if (process.platform !== "darwin") app.quit();
});
