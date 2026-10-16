const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "../..");
const BOLTJZ = path.join(REPO_ROOT, "tools/cli/boltjz");

function settingsFile() {
  return path.join(app.getPath("userData"), "settings.json");
}

process.env.PATH = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  path.join(os.homedir(), ".local/bin"),
  process.env.PATH || "",
].join(":");

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  const file = settingsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
}

function workspaceDir() {
  const settings = readSettings();
  return settings.workspace || path.join(os.homedir(), "Documents", "video-bolt");
}

function audioFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.(wav|mp3|m4a|webm)$/i.test(name));
}

function isDerived(name) {
  return /\.pace\.|\.clean\.|\.export\./i.test(name);
}

function existing(file) {
  return fs.existsSync(file) ? file : null;
}

function listTakes(projectDir) {
  return audioFiles(projectDir)
    .filter((name) => !isDerived(name))
    .map((name) => {
      const stem = name.replace(/\.[^.]+$/, "");
      const file = path.join(projectDir, name);
      const mp3 = path.join(projectDir, `${stem}.mp3`);
      return {
        name,
        path: file,
        pace: existing(path.join(projectDir, `${stem}.pace.mp3`)),
        clean: existing(path.join(projectDir, `${stem}.pace.clean.wav`)) || existing(path.join(projectDir, `${stem}.clean.wav`)),
        cuts: existing(path.join(projectDir, `${stem}.pace.cuts.json`)) || existing(path.join(projectDir, `${stem}.cuts.json`)),
        mp3: mp3 !== file ? existing(mp3) : existing(path.join(projectDir, `${stem}.export.mp3`)),
      };
    });
}

function listTree(dir, depth = 0) {
  if (depth > 8 || !fs.existsSync(dir)) return [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  entries.sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
    return left.name.localeCompare(right.name, "pt");
  });
  const takes = listTakes(dir);
  const takeBySource = new Map(takes.map((take) => [take.path, take]));
  const generated = new Set();
  for (const take of takes) {
    for (const file of [take.pace, take.clean, take.cuts, take.mp3]) {
      if (file) generated.add(file);
    }
  }
  const nodes = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "timeline.json") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      nodes.push({ type: "dir", name: entry.name, path: full, children: listTree(full, depth + 1) });
      continue;
    }
    if (!/\.(wav|mp3|m4a|webm|json|md|markdown|txt)$/i.test(entry.name) || generated.has(full)) continue;
    const take = takeBySource.get(full) || null;
    const children = [];
    if (take) {
      for (const file of [take.pace, take.clean, take.cuts, take.mp3]) {
        if (!file) continue;
        children.push({ type: "file", name: path.basename(file), path: file, take, children: [] });
      }
    }
    nodes.push({ type: "file", name: entry.name, path: full, take, children });
  }
  return nodes;
}

function assertInsideWorkspace(target, allowRoot = false) {
  const root = path.resolve(workspaceDir());
  const resolved = path.resolve(target);
  if (resolved === root) {
    if (allowRoot) return resolved;
    throw new Error("Só dá para alterar itens dentro da pasta de projetos");
  }
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error("Só dá para alterar itens dentro da pasta de projetos");
  }
  return resolved;
}

function catalog() {
  const root = workspaceDir();
  fs.mkdirSync(root, { recursive: true });
  return { workspace: root, projects: listProjects(), tree: listTree(root) };
}

function listProjects() {
  const root = workspaceDir();
  fs.mkdirSync(root, { recursive: true });
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => {
      const dir = path.join(root, entry.name);
      return { name: entry.name, path: dir, takes: listTakes(dir) };
    });
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        const detail = stderr.trim() || stdout.trim() || `saiu com código ${code}`;
        reject(new Error(detail));
        return;
      }
      resolve(stdout);
    });
  });
}

function outputLines(stdout) {
  const lines = Object.fromEntries(
    stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
  return lines;
}

let mainWindow = null;
let workspaceWatcher = null;
let watchTimer = null;

function publishWorkspace() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("workspace-changed", catalog());
}

function watchWorkspace() {
  if (workspaceWatcher) {
    workspaceWatcher.close();
    workspaceWatcher = null;
  }
  const root = workspaceDir();
  fs.mkdirSync(root, { recursive: true });
  try {
    workspaceWatcher = fs.watch(root, { recursive: true }, () => {
      clearTimeout(watchTimer);
      watchTimer = setTimeout(publishWorkspace, 300);
    });
    workspaceWatcher.on("error", () => {
      if (workspaceWatcher) workspaceWatcher.close();
      workspaceWatcher = null;
    });
  } catch {
    workspaceWatcher = null;
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    backgroundColor: "#110d1c",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = window;
  window.loadFile(path.join(__dirname, "renderer/index.html"));
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
}

app.whenReady().then(() => {
  ipcMain.handle("get-state", () => ({
    deviceId: readSettings().deviceId || "",
    ...catalog(),
  }));

  ipcMain.handle("choose-workspace", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      defaultPath: workspaceDir(),
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const settings = readSettings();
    settings.workspace = result.filePaths[0];
    writeSettings(settings);
    watchWorkspace();
    return catalog();
  });

  ipcMain.handle("set-device", (_event, deviceId) => {
    const settings = readSettings();
    settings.deviceId = deviceId;
    writeSettings(settings);
    return deviceId;
  });

  ipcMain.handle("create-project", (_event, name) => {
    const safe = String(name || "").trim().replace(/[\\/]/g, "");
    if (!safe) throw new Error("Dê um nome ao projeto");
    const dir = path.join(workspaceDir(), safe);
    fs.mkdirSync(dir, { recursive: true });
    return catalog();
  });

  ipcMain.handle("save-recording", async (_event, projectDir, bytes) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const webm = path.join(os.tmpdir(), `boltjz-${stamp}.webm`);
    const wav = path.join(projectDir, `${stamp}.wav`);
    fs.writeFileSync(webm, Buffer.from(bytes));
    await runCommand("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", webm, "-c:a", "pcm_s16le", wav]);
    fs.rmSync(webm, { force: true });
    return { path: wav, ...catalog() };
  });

  ipcMain.handle("read-audio", (_event, file) => fs.readFileSync(file));

  ipcMain.handle("read-timeline", (_event, dir) => {
    const file = path.join(assertInsideWorkspace(dir, true), "timeline.json");
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file, "utf8");
  });

  ipcMain.handle("write-timeline", (_event, dir, content) => {
    const folder = assertInsideWorkspace(dir, true);
    if (!fs.statSync(folder).isDirectory()) throw new Error("A linha do tempo fica numa pasta");
    const file = path.join(folder, "timeline.json");
    fs.writeFileSync(file, String(content), "utf8");
    return file;
  });

  ipcMain.handle("read-text", (_event, file) => {
    const resolved = assertInsideWorkspace(file);
    if (!fs.existsSync(resolved)) return null;
    return fs.readFileSync(resolved, "utf8");
  });

  ipcMain.handle("write-text", (_event, file, content) => {
    const resolved = assertInsideWorkspace(file);
    if (!/\.(md|markdown|txt)$/i.test(resolved)) throw new Error("Só dá para salvar texto");
    fs.writeFileSync(resolved, String(content), "utf8");
    return true;
  });

  ipcMain.handle("open-external", (_event, url) => {
    if (!/^https?:\/\//i.test(String(url || ""))) return false;
    return shell.openExternal(url);
  });

  ipcMain.handle("narration", async (_event, { file, speed, volume }) => {
    const stdout = await runCommand(BOLTJZ, ["narration", file, "--speed", String(speed), "--volume", String(volume)]);
    return { ...outputLines(stdout), ...catalog() };
  });

  ipcMain.handle("cleanup", async (_event, { file, silenceDb, silenceMin, pad }) => {
    const stdout = await runCommand(BOLTJZ, [
      "silence-detection",
      file,
      "--silence-db",
      String(silenceDb),
      "--silence-min",
      String(silenceMin),
      "--silence-only",
      "--pad",
      String(pad),
    ]);
    const lines = outputLines(stdout);
    const cuts = JSON.parse(fs.readFileSync(lines.CUTS, "utf8"));
    return { ...lines, cuts, ...catalog() };
  });

  ipcMain.handle("apply-cuts", async (_event, { file, cutsPath, cuts }) => {
    const payload = { input: file, output: "", cuts };
    fs.writeFileSync(cutsPath, JSON.stringify(payload, null, 2));
    const stdout = await runCommand(BOLTJZ, ["silence-detection", file, "--apply-cuts", cutsPath]);
    return { ...outputLines(stdout), ...catalog() };
  });

  ipcMain.handle("rename-path", (_event, target, nextName) => {
    const resolved = assertInsideWorkspace(target);
    const base = path.basename(String(nextName || "")).trim();
    if (!base || base === "." || base === ".." || base.includes("/") || base.includes("\\")) {
      throw new Error("Nome inválido");
    }
    const dir = path.dirname(resolved);
    const destination = path.join(dir, base);
    if (destination !== resolved && fs.existsSync(destination)) {
      throw new Error("Já existe um item com esse nome");
    }
    const oldStem = path.basename(resolved).replace(/\.[^.]+$/, "");
    const newStem = base.replace(/\.[^.]+$/, "");
    const take = listTakes(dir).find((item) => item.path === resolved);
    fs.renameSync(resolved, destination);
    if (take && oldStem !== newStem) {
      for (const file of [take.pace, take.clean, take.cuts, take.mp3]) {
        if (!file || !fs.existsSync(file)) continue;
        const name = path.basename(file);
        if (!name.startsWith(oldStem)) continue;
        fs.renameSync(file, path.join(dir, newStem + name.slice(oldStem.length)));
      }
    }
    return { path: destination, ...catalog() };
  });

  ipcMain.handle("create-file", (_event, dir, name) => {
    const folder = assertInsideWorkspace(dir);
    if (!fs.statSync(folder).isDirectory()) throw new Error("Escolha uma pasta");
    const base = path.basename(String(name || "")).trim();
    if (!base || base === "." || base === ".." || /[\\/]/.test(base)) throw new Error("Nome inválido");
    const destination = path.join(folder, base);
    if (fs.existsSync(destination)) throw new Error("Já existe um item com esse nome");
    fs.writeFileSync(destination, "");
    return { path: destination, ...catalog() };
  });

  ipcMain.handle("show-in-folder", (_event, target) => {
    const resolved = assertInsideWorkspace(target);
    if (fs.statSync(resolved).isDirectory()) return shell.openPath(resolved);
    shell.showItemInFolder(resolved);
    return "";
  });

  ipcMain.handle("remove-path", async (event, target) => {
    const resolved = assertInsideWorkspace(target);
    const name = path.basename(resolved);
    const answer = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
      type: "warning",
      buttons: ["Excluir", "Cancelar"],
      defaultId: 1,
      cancelId: 1,
      message: `Remover ${name}?`,
      detail: "Essa ação não pode ser desfeita.",
    });
    if (answer.response !== 0) return null;
    const dir = path.dirname(resolved);
    const take = fs.statSync(resolved).isDirectory() ? null : listTakes(dir).find((item) => item.path === resolved);
    fs.rmSync(resolved, { recursive: true, force: true });
    if (take) {
      for (const file of [take.pace, take.clean, take.cuts, take.mp3]) {
        if (file && fs.existsSync(file)) fs.rmSync(file, { force: true });
      }
    }
    return catalog();
  });

  ipcMain.handle("export-mp3", async (_event, { source, destination }) => {
    await runCommand("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      source,
      "-vn",
      "-c:a",
      "libmp3lame",
      "-q:a",
      "2",
      destination,
    ]);
    return { path: destination, ...catalog() };
  });

  watchWorkspace();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
