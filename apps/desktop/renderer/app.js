const state = {
  workspace: "",
  projects: [],
  project: null,
  take: null,
  deviceId: "",
  recorder: null,
  stream: null,
  chunks: [],
  review: null,
  drag: null,
  tree: [],
  open: new Set(),
  node: null,
  audio: null,
  doc: null,
  docMode: "view",
  docTimer: 0,
  creating: null,
  arrangement: null,
  waves: new Map(),
};

const treeEl = document.querySelector("#tree");
const takeView = document.querySelector("#take-view");
const empty = document.querySelector("#empty");
const statusEl = document.querySelector("#status");
const canvas = document.querySelector("#wave");
const ruler = document.querySelector("#ruler");
const context = canvas.getContext("2d");
const rulerContext = ruler.getContext("2d");
const player = { source: null, offset: 0, end: 0, startedAt: 0, raf: 0, gain: null };
const preview = { ctx: null, gain: null, source: null, mix: [], clock: "file", buffer: null, file: "", offset: 0, startedAt: 0, raf: 0, token: 0, cursor: 0 };
let audioCtx = null;
let playToken = 0;

function setStatus(message) {
  statusEl.textContent = message;
}

function selectedTake(projects) {
  if (!state.project) return null;
  const project = projects.find((item) => item.path === state.project.path);
  if (!project) return null;
  state.project = project;
  if (!state.take) return null;
  return project.takes.find((take) => take.path === state.take.path) || null;
}

function parentDir(filePath) {
  return filePath.replace(/[/\\][^/\\]+$/, "");
}

function renderTree() {
  const name = state.workspace.replace(/[/\\]+$/, "").split(/[/\\]/).pop();
  document.querySelector("#workspace-name").textContent = name || "Projetos";
  const scroll = treeEl.scrollTop;
  treeEl.innerHTML = "";
  drawNodes(state.tree, 0);
  treeEl.scrollTop = scroll;
}

function treeStamp(nodes, names = []) {
  for (const node of nodes) {
    names.push(node.path);
    if (node.children && node.children.length) treeStamp(node.children, names);
  }
  return names.join("\n");
}

function drawNodes(nodes, depth) {
  for (const node of nodes) {
    const row = document.createElement("div");
    row.className = "tree-row";
    row.dataset.path = node.path;
    row.style.paddingLeft = `${8 + depth * 14}px`;
    const hasChildren = (node.children || []).length > 0;
    const expandable = node.type === "dir" || hasChildren;
    const open = expandable && state.open.has(node.path) && (hasChildren || state.creating === node.path);
    if (state.node && state.node.path === node.path) row.classList.add("active");
    else if ((state.audio && state.audio.path === node.path) || (state.doc && state.doc.path === node.path)) row.classList.add("kept");

    const mark = document.createElement("span");
    mark.className = node.type === "dir" ? "chevron" : "file-mark";
    if (node.type === "file" && isAudioName(node.name)) mark.classList.add("audio");
    if (node.type === "file" && isTextName(node.name)) mark.classList.add("text");
    mark.textContent = node.type === "dir" ? (open ? "▾" : "▸") : fileMark(node.name);
    if (node.type === "file" && hasChildren) {
      const nested = document.createElement("span");
      nested.className = "chevron";
      nested.textContent = open ? "▾" : "▸";
      nested.addEventListener("click", (event) => {
        event.stopPropagation();
        if (state.open.has(node.path)) state.open.delete(node.path);
        else state.open.add(node.path);
        renderTree();
      });
      row.append(nested);
    }
    if (node.type === "dir") {
      mark.addEventListener("click", (event) => {
        event.stopPropagation();
        if (state.open.has(node.path)) state.open.delete(node.path);
        else state.open.add(node.path);
        renderTree();
      });
    }

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = node.name;
    label.addEventListener("click", (event) => {
      if (state.node && state.node.path === node.path) {
        event.stopPropagation();
        startInlineRename(node);
      }
    });
    row.append(mark, label);
    if (node.type === "file" && isAudioName(node.name)) {
      row.draggable = true;
      row.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/plain", node.path);
        event.dataTransfer.effectAllowed = "copy";
      });
    }
    row.addEventListener("click", () => {
      if (row.querySelector(".rename-input")) return;
      selectNode(node);
    });
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      selectNode(node, false);
      openTreeMenu(event.clientX, event.clientY);
    });
    treeEl.append(row);
    if (node.type === "dir" && state.creating === node.path) appendCreateRow(node.path, depth + 1);
    if (open) drawNodes(node.children || [], depth + 1);
  }
}

function selectNode(node, toggle = true) {
  state.node = node;
  if (node.type === "dir") {
    if (toggle) {
      if (state.open.has(node.path)) state.open.delete(node.path);
      else state.open.add(node.path);
    }
    state.project = { name: node.name, path: node.path, takes: [] };
    state.audio = null;
    state.take = null;
    renderTree();
    renderTake();
    return;
  }
  if (isTextName(node.name)) {
    openDocument(node);
    renderTree();
    renderTake();
    return;
  }
  if (!isAudioName(node.name)) {
    renderTree();
    renderTake();
    return;
  }
  state.audio = node;
  const take = node.take;
  state.project = take
    ? { name: parentDir(take.path).split(/[/\\]/).pop(), path: parentDir(take.path), takes: [] }
    : { name: parentDir(node.path).split(/[/\\]/).pop(), path: parentDir(node.path), takes: [] };
  state.take = take || null;
  if (take) state.open.add(parentDir(take.path));
  renderTree();
  renderTake();
}

function findNode(nodes, filePath) {
  for (const node of nodes) {
    if (node.path === filePath) return node;
    if (node.children) {
      const found = findNode(node.children, filePath);
      if (found) return found;
    }
  }
  return null;
}

function expandAncestors(nodes, filePath, stack = []) {
  for (const node of nodes) {
    if (node.path === filePath) {
      for (const ancestor of stack) state.open.add(ancestor.path);
      return true;
    }
    if (node.children && expandAncestors(node.children, filePath, stack.concat(node))) return true;
  }
  return false;
}

function isAudioName(name) {
  return /\.(wav|mp3|m4a|webm)$/i.test(name);
}

function isTextName(name) {
  return /\.(md|markdown|txt)$/i.test(name);
}

function fileMark(name) {
  if (/\.json$/i.test(name)) return "{}";
  if (isTextName(name)) return "≡";
  return "♪";
}

function selectedAudio() {
  const node = state.audio;
  if (!node || node.type !== "file" || !isAudioName(node.name)) return null;
  return node;
}

function audioKind(file) {
  const take = file.take;
  if (!take) return "Áudio";
  if (file.path === take.path) return "Bruto";
  if (file.path === take.pace) return "Acelerado";
  if (file.path === take.clean) return "Cortado";
  if (file.path === take.mp3) return "Mp3";
  return "Áudio";
}

function renderTake() {
  const file = selectedAudio();
  const docOpen = Boolean(state.doc);
  takeView.hidden = !file;
  document.querySelector("#doc-view").hidden = !docOpen;
  document.querySelector("#stage").classList.toggle("both", Boolean(file) && docOpen);
  document.querySelector("#take-tools").hidden = !state.take;
  empty.hidden = Boolean(file) || docOpen || !state.project;
  if (!state.project && !docOpen) empty.textContent = "Escolha a pasta dos projetos e grave a narração.";
  else if (!file && !docOpen) empty.textContent = "Escolha um áudio ou um texto na pasta.";
  renderDoc();
  if (!file) {
    stopPreview(true);
    preview.file = "";
    preview.buffer = null;
    return;
  }
  document.querySelector("#take-name").textContent = file.name;
  document.querySelector("#take-kind").textContent = audioKind(file);
  if (preview.file && preview.file !== file.path) {
    stopPreview(true);
    preview.file = "";
    preview.buffer = null;
    paintPreviewTime();
  }
  syncArrangement(file);
}

async function openDocument(node) {
  if (state.doc && state.doc.path === node.path) return;
  await flushDoc();
  state.doc = { path: node.path, name: node.name, text: "", saved: "" };
  renderDoc();
  try {
    const text = (await window.desktop.readText(node.path)) || "";
    if (!state.doc || state.doc.path !== node.path) return;
    state.doc.text = text;
    state.doc.saved = text;
    renderDoc();
  } catch (error) {
    setStatus(error.message);
  }
}

function renderDoc() {
  if (!state.doc) return;
  document.querySelector("#doc-name").textContent = state.doc.name;
  document.querySelector("#doc-status").textContent = state.doc.text === state.doc.saved ? "Salvo" : "Alterado";
  const editor = document.querySelector("#doc-editor");
  const rendered = document.querySelector("#doc-rendered");
  if (document.activeElement !== editor) editor.value = state.doc.text;
  rendered.innerHTML = renderMarkdown(state.doc.text);
  const viewing = state.docMode !== "edit";
  rendered.hidden = !viewing;
  editor.hidden = viewing;
  document.querySelector("#doc-mode-view").classList.toggle("on", viewing);
  document.querySelector("#doc-mode-edit").classList.toggle("on", !viewing);
}

async function flushDoc() {
  if (!state.doc || state.doc.text === state.doc.saved) return;
  await window.desktop.writeText(state.doc.path, state.doc.text);
  state.doc.saved = state.doc.text;
}

function scheduleDocSave() {
  clearTimeout(state.docTimer);
  state.docTimer = setTimeout(() => {
    flushDoc()
      .then(() => {
        if (state.doc) document.querySelector("#doc-status").textContent = "Salvo";
      })
      .catch((error) => setStatus(error.message));
  }, 400);
}

let shownTree = "";

async function refresh(payload) {
  state.projects = payload.projects;
  state.tree = payload.tree;
  if (payload.workspace) state.workspace = payload.workspace;
  if (state.project && !findNode(state.tree, state.project.path)) state.project = null;
  state.take = selectedTake(state.projects) || state.take;
  if (state.take && !findNode(state.tree, state.take.path)) state.take = null;
  if (state.audio) {
    const audio = findNode(state.tree, state.audio.path);
    state.audio = audio && isAudioName(audio.name) ? audio : null;
    if (state.audio && state.audio.take) state.take = state.audio.take;
  }
  if (state.node && !findNode(state.tree, state.node.path)) state.node = null;
  if (state.doc) {
    const doc = findNode(state.tree, state.doc.path);
    if (doc) state.doc.name = doc.name;
    else state.doc = null;
  }
  if (state.take) state.open.add(parentDir(state.take.path));
  const stamp = treeStamp(state.tree);
  if (stamp !== shownTree) {
    shownTree = stamp;
    renderTree();
  }
  renderTake();
}

function reloadWorkspace() {
  if (state.creating || treeEl.querySelector(".rename-input")) return;
  window.desktop.getState().then((payload) => refresh(payload)).catch((error) => setStatus(error.message));
}

async function loadMics() {
  let inputs = (await navigator.mediaDevices.enumerateDevices()).filter((item) => item.kind === "audioinput");
  if (!inputs.length || inputs.some((item) => !item.label)) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    inputs = (await navigator.mediaDevices.enumerateDevices()).filter((item) => item.kind === "audioinput");
  }
  const select = document.querySelector("#mics");
  const previous = state.deviceId || select.value;
  select.innerHTML = "";
  for (const device of inputs) {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || "Microfone";
    select.append(option);
  }
  if (previous && [...select.options].some((option) => option.value === previous)) {
    select.value = previous;
  }
  state.deviceId = select.value;
  await window.desktop.setDevice(state.deviceId);
}

let micReload = 0;
function reloadMicsSoon() {
  clearTimeout(micReload);
  micReload = setTimeout(() => {
    if (document.activeElement === document.querySelector("#mics")) return;
    loadMics().catch((error) => setStatus(error.message));
  }, 400);
}

navigator.mediaDevices.addEventListener("devicechange", reloadMicsSoon);
window.addEventListener("focus", () => {
  reloadMicsSoon();
  reloadWorkspace();
});
window.desktop.onWorkspaceChanged((payload) => {
  if (state.creating || treeEl.querySelector(".rename-input")) return;
  refresh(payload);
});

const treeMenu = document.querySelector("#tree-menu");

function closeTreeMenu() {
  treeMenu.hidden = true;
}

function openTreeMenu(x, y) {
  treeMenu.querySelector("[data-action=create]").hidden = !state.node || state.node.type !== "dir";
  treeMenu.hidden = false;
  treeMenu.style.left = "0px";
  treeMenu.style.top = "0px";
  const width = treeMenu.offsetWidth;
  const height = treeMenu.offsetHeight;
  const left = Math.min(x, window.innerWidth - width - 8);
  const top = Math.min(y, window.innerHeight - height - 8);
  treeMenu.style.left = `${Math.max(8, left)}px`;
  treeMenu.style.top = `${Math.max(8, top)}px`;
}

function appendCreateRow(dirPath, depth) {
  const row = document.createElement("div");
  row.className = "tree-row";
  row.style.paddingLeft = `${8 + depth * 14}px`;
  const input = document.createElement("input");
  input.className = "rename-input";
  input.placeholder = "roteiro.md";
  input.spellcheck = false;
  row.append(input);
  treeEl.append(row);
  requestAnimationFrame(() => input.focus());

  let closed = false;
  const cancel = () => {
    if (closed) return;
    closed = true;
    state.creating = null;
    renderTree();
  };
  const commit = async () => {
    if (closed) return;
    let nextName = input.value.trim();
    if (!nextName) {
      cancel();
      return;
    }
    if (!/\.[^.]+$/.test(nextName)) nextName += ".md";
    closed = true;
    try {
      const result = await window.desktop.createFile(dirPath, nextName);
      state.creating = null;
      state.open.add(dirPath);
      await refresh(result);
      const created = findNode(state.tree, result.path);
      state.node = created;
      if (created && isTextName(created.name)) await openDocument(created);
      renderTree();
      renderTake();
    } catch (error) {
      closed = false;
      setStatus(error.message);
      input.focus();
    }
  };
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  });
  input.addEventListener("blur", () => commit());
  input.addEventListener("click", (event) => event.stopPropagation());
}

function startCreateFile(node) {
  if (!node || node.type !== "dir") return;
  closeTreeMenu();
  state.open.add(node.path);
  state.creating = node.path;
  renderTree();
}

function startInlineRename(node) {
  if (!node) return;
  closeTreeMenu();
  const row = [...treeEl.querySelectorAll(".tree-row")].find((item) => item.dataset.path === node.path);
  if (!row || row.querySelector(".rename-input")) return;
  const label = row.querySelector(".label");
  const input = document.createElement("input");
  input.className = "rename-input";
  input.value = node.name;
  input.spellcheck = false;
  label.replaceWith(input);
  const dot = node.type === "file" ? node.name.lastIndexOf(".") : -1;
  requestAnimationFrame(() => {
    input.focus();
    if (dot > 0) input.setSelectionRange(0, dot);
    else input.select();
  });

  let closed = false;
  const cancel = () => {
    if (closed) return;
    closed = true;
    renderTree();
  };
  const commit = async () => {
    if (closed) return;
    const nextName = input.value.trim();
    if (!nextName || nextName === node.name) {
      cancel();
      return;
    }
    closed = true;
    try {
      const result = await window.desktop.renamePath(node.path, nextName);
      state.take = null;
      state.open.add(parentDir(result.path));
      await refresh(result);
      const renamed = findNode(state.tree, result.path);
      state.node = renamed;
      if (state.doc && state.doc.path === node.path && renamed) {
        state.doc.path = renamed.path;
        state.doc.name = renamed.name;
      }
      if (state.audio && state.audio.path === node.path) state.audio = renamed;
      if (renamed && renamed.take) state.take = renamed.take;
      if (renamed && renamed.type === "dir") state.project = { name: renamed.name, path: renamed.path, takes: [] };
      renderTree();
      renderTake();
    } catch (error) {
      closed = false;
      setStatus(error.message);
      input.focus();
    }
  };
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  });
  input.addEventListener("blur", () => {
    commit();
  });
  input.addEventListener("click", (event) => event.stopPropagation());
}

async function removeSelected() {
  if (!state.node) return;
  try {
    const result = await window.desktop.removePath(state.node.path);
    if (!result) return;
    state.node = null;
    state.take = null;
    await refresh(result);
  } catch (error) {
    setStatus(error.message);
  }
}

treeMenu.addEventListener("click", (event) => {
  const action = event.target.closest("button")?.dataset.action;
  closeTreeMenu();
  if (!state.node) return;
  if (action === "create") startCreateFile(state.node);
  if (action === "show") window.desktop.showInFolder(state.node.path);
  if (action === "rename") startInlineRename(state.node);
  if (action === "remove") removeSelected();
});

window.addEventListener("click", (event) => {
  if (!treeMenu.contains(event.target)) closeTreeMenu();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeTreeMenu();
});

treeEl.addEventListener("scroll", closeTreeMenu);

document.querySelector("#mics").addEventListener("change", async (event) => {
  state.deviceId = event.target.value;
  await window.desktop.setDevice(state.deviceId);
});

document.querySelector("#workspace").addEventListener("click", async () => {
  const next = await window.desktop.chooseWorkspace();
  if (!next) return;
  state.workspace = next.workspace;
  state.project = null;
  state.take = null;
  state.open = new Set(next.tree.map((node) => node.path));
  await refresh(next);
});

document.querySelector("#new-project").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#project-name");
  const name = input.value.trim();
  const created = await window.desktop.createProject(name);
  input.value = "";
  state.project = { name, path: `${created.workspace}/${name}`, takes: [] };
  state.take = null;
  state.open.add(state.project.path);
  await refresh(created);
});

function recordingFolder() {
  if (state.project && state.project.path) return state.project.path;
  if (state.doc) return parentDir(state.doc.path);
  if (state.node) return state.node.type === "dir" ? state.node.path : parentDir(state.node.path);
  return state.workspace || null;
}

const recordMeter = { ctx: null, analyser: null, raf: 0, started: 0, peaks: [] };

function formatRecordTime(seconds) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  const whole = Math.floor(rest);
  const cents = Math.floor((rest - whole) * 100);
  return `${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")},${String(cents).padStart(2, "0")}`;
}

function drawRecordMeter() {
  const canvas = document.querySelector("#record-wave");
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  if (canvas.width !== Math.floor(width * ratio) || canvas.height !== Math.floor(height * ratio)) {
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
  }
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.fillStyle = "#1c1c1e";
  context.fillRect(0, 0, width, height);
  if (recordMeter.analyser) {
    const data = new Uint8Array(recordMeter.analyser.fftSize);
    recordMeter.analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const value of data) peak = Math.max(peak, Math.abs(value - 128) / 128);
    recordMeter.peaks.push(peak);
  }
  const bars = recordMeter.peaks;
  const gap = 3;
  const visible = Math.floor(width / gap);
  const start = Math.max(0, bars.length - visible);
  context.fillStyle = "#ff453a";
  for (let index = start; index < bars.length; index += 1) {
    const bar = Math.max(2, bars[index] * (height - 16));
    const x = (index - start) * gap;
    context.fillRect(x, (height - bar) / 2, 2, bar);
  }
  const head = Math.min(width - 1, (bars.length - start) * gap);
  context.fillRect(head, 0, 2, height);
  document.querySelector("#record-time").textContent = formatRecordTime((performance.now() - recordMeter.started) / 1000);
  recordMeter.raf = requestAnimationFrame(drawRecordMeter);
}

function startRecordMeter(stream) {
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  recordMeter.ctx = ctx;
  recordMeter.analyser = analyser;
  recordMeter.started = performance.now();
  recordMeter.peaks = [];
  document.querySelector("#record-meter").hidden = false;
  cancelAnimationFrame(recordMeter.raf);
  drawRecordMeter();
}

function stopRecordMeter() {
  cancelAnimationFrame(recordMeter.raf);
  recordMeter.analyser = null;
  if (recordMeter.ctx) {
    recordMeter.ctx.close().catch(() => {});
    recordMeter.ctx = null;
  }
  document.querySelector("#record-meter").hidden = true;
}

document.querySelector("#record").addEventListener("click", async () => {
  const folder = recordingFolder();
  const button = document.querySelector("#record");
  if (!folder) {
    setStatus("Escolha a pasta onde a gravação vai ficar.");
    return;
  }
  state.project = state.project && state.project.path === folder
    ? state.project
    : { name: folder.split(/[/\\]/).pop(), path: folder, takes: state.project ? state.project.takes : [] };
  if (state.recorder) {
    const recorder = state.recorder;
    state.recorder = null;
    button.textContent = "Gravar";
    button.classList.remove("live");
    document.querySelector("#record-state").textContent = "Salvando…";
    recorder.stop();
    return;
  }
  stopPreview(true);
  try {
    const audio = state.deviceId ? { deviceId: { exact: state.deviceId } } : true;
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({ audio });
    } catch (error) {
      if (!state.deviceId) throw error;
      state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    state.chunks = [];
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
    state.recorder = mime ? new MediaRecorder(state.stream, { mimeType: mime }) : new MediaRecorder(state.stream);
    state.recorder.ondataavailable = (event) => {
      if (event.data.size) state.chunks.push(event.data);
    };
    state.recorder.onstop = async () => {
      stopRecordMeter();
      try {
        const blob = new Blob(state.chunks, { type: "audio/webm" });
        state.stream.getTracks().forEach((track) => track.stop());
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const saved = await window.desktop.saveRecording(folder, bytes);
        document.querySelector("#record-state").textContent = "";
        await refresh(saved);
        let dir = parentDir(saved.path);
        const root = (state.workspace || "").replace(/[/\\]+$/, "");
        while (dir && dir !== root && dir.startsWith(root)) {
          state.open.add(dir);
          const next = parentDir(dir);
          if (next === dir) break;
          dir = next;
        }
        const recorded = findNode(state.tree, saved.path);
        if (recorded) {
          state.node = recorded;
          state.audio = recorded;
          state.take = recorded.take || null;
          state.project = { name: parentDir(recorded.path).split(/[/\\]/).pop(), path: parentDir(recorded.path), takes: [] };
        }
        renderTree();
        renderTake();
        setStatus("Gravação salva.");
      } catch (error) {
        document.querySelector("#record-state").textContent = "";
        setStatus(error.message);
      }
    };
    state.recorder.start(250);
    startRecordMeter(state.stream);
    button.textContent = "Parar";
    button.classList.add("live");
    document.querySelector("#record-state").textContent = "";
  } catch (error) {
    state.recorder = null;
    button.textContent = "Gravar";
    button.classList.remove("live");
    setStatus(error.message);
  }
});

function bindSliderField(rangeId, fieldId) {
  const range = document.querySelector(rangeId);
  const field = document.querySelector(fieldId);
  range.addEventListener("input", () => {
    field.value = range.value;
  });
  field.addEventListener("change", () => {
    const value = Number(field.value);
    if (Number.isNaN(value)) {
      field.value = range.value;
      return;
    }
    const clamped = Math.min(Number(range.max), Math.max(Number(range.min), value));
    const places = String(range.step).includes(".") ? String(range.step).split(".")[1].length : 0;
    const shown = clamped.toFixed(places);
    range.value = shown;
    field.value = shown;
  });
}

bindSliderField("#speed-range", "#speed");
bindSliderField("#volume-range", "#volume");

let paceTimer = 0;
let paceToken = 0;
let paceRunning = false;
let paceQueued = false;
let lastPace = "";

function paceValues() {
  return {
    speed: document.querySelector("#speed").value,
    volume: document.querySelector("#volume").value,
  };
}

function pacePreviewPath(filePath) {
  if (!filePath || /\.pace\./i.test(filePath)) return false;
  if (state.take && filePath === state.take.path) return true;
  return /\.clean\.wav$/i.test(filePath);
}

function applyLivePace() {
  if (!preview.source) return;
  const timeline = preview.clock === "timeline";
  const clips = state.arrangement ? state.arrangement.tracks.flatMap((track) => track.clips) : [];
  const timelinePace = timeline && clips.length > 0 && clips.every((clip) => pacePreviewPath(clip.file));
  if (timeline ? !timelinePace : !pacePreviewPath(state.audio && state.audio.path)) return;
  const { speed, volume } = paceValues();
  if (preview.paceGain) preview.paceGain.gain.value = Number(volume);
  const rate = Number(speed);
  const current = timeline ? preview.rate || 1 : preview.source.playbackRate.value;
  if (current === rate && preview.paceGain) return;
  const cursor = previewNow();
  stopPreview(false);
  preview.cursor = cursor;
  if (state.arrangement) state.arrangement.cursor = cursor;
  if (timeline) playArrangement().catch((error) => setStatus(error.message));
  else if (preview.buffer) playPreview();
}

function schedulePace() {
  applyLivePace();
  if (!state.take) return;
  if (paceRunning) {
    paceQueued = true;
    return;
  }
  clearTimeout(paceTimer);
  paceTimer = setTimeout(() => {
    runPace().catch((error) => setStatus(error.message));
  }, 400);
}

async function runPace() {
  if (!state.take) return;
  const { speed, volume } = paceValues();
  const key = `${state.take.path}|${speed}|${volume}`;
  if (key === lastPace) {
    document.querySelector("#pace-status").hidden = true;
    return;
  }
  if (paceRunning) {
    paceQueued = true;
    return;
  }
  const token = ++paceToken;
  paceRunning = true;
  paceQueued = false;
  document.querySelector("#pace-status").hidden = false;
  try {
    const resume = Boolean(preview.source);
    const ratio = preview.buffer && preview.buffer.duration ? preview.cursor / preview.buffer.duration : 0;
    const result = await window.desktop.narration({
      file: state.take.path,
      speed,
      volume,
    });
    if (token !== paceToken) return;
    lastPace = key;
    if (result.OUTPUT) state.waves.delete(result.OUTPUT);
    await refresh(result);
    const output = result.OUTPUT;
    const node = output ? findNode(state.tree, output) : null;
    if (node) {
      expandAncestors(state.tree, output);
      selectNode(node, false);
      await usePacePreview(node, ratio);
      if (resume && token === paceToken) playPreview();
    }
  } catch (error) {
    if (token === paceToken) setStatus(error.message);
  } finally {
    paceRunning = false;
    if (paceQueued && token === paceToken) {
      paceQueued = false;
      runPace().catch((error) => setStatus(error.message));
    } else if (token === paceToken) {
      document.querySelector("#pace-status").hidden = true;
    }
  }
}

for (const id of ["#speed-range", "#volume-range"]) {
  document.querySelector(id).addEventListener("input", schedulePace);
}
for (const id of ["#speed", "#volume"]) {
  document.querySelector(id).addEventListener("change", schedulePace);
}

function editorAudio() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
  if (!player.gain) {
    player.gain = audioCtx.createGain();
    player.gain.gain.value = Number(document.querySelector("#level").value);
    player.gain.connect(audioCtx.destination);
  }
  return audioCtx;
}

function previewAudio() {
  if (!preview.ctx) preview.ctx = new AudioContext();
  if (preview.ctx.state === "suspended") preview.ctx.resume();
  if (!preview.gain) {
    preview.gain = preview.ctx.createGain();
    preview.gain.gain.value = Number(document.querySelector("#preview-level").value);
    preview.gain.connect(preview.ctx.destination);
  }
  return preview.ctx;
}

function setPreviewPlaying(active) {
  const play = document.querySelector("#preview-play");
  play.classList.toggle("playing", active);
  play.title = active ? "Pausar" : "Reproduzir";
}

function selectedFileDuration() {
  if (state.audio && preview.buffer && preview.file === state.audio.path) return preview.buffer.duration;
  if (!state.audio || !state.arrangement) return 0;
  for (const track of state.arrangement.tracks) {
    for (const clip of track.clips) {
      if (clip.file === state.audio.path) return Math.max(0, clip.out - clip.in);
    }
  }
  return 0;
}

function shownDuration() {
  const own = selectedFileDuration();
  if (own) return own;
  if (state.arrangement) return arrangementDuration();
  return preview.buffer ? preview.buffer.duration : 0;
}

function paintPreviewTime() {
  const duration = shownDuration();
  document.querySelector("#preview-time").textContent = `${formatTime(preview.cursor)} / ${formatTime(duration)}`;
  const seek = document.querySelector("#preview-seek");
  if (document.activeElement !== seek) {
    seek.max = String(Math.max(duration, 0.01));
    seek.value = String(Math.min(preview.cursor, duration));
  }
}

function previewNow() {
  if (!preview.source || !preview.ctx) return preview.cursor;
  const rate = preview.clock === "timeline" ? preview.rate || 1 : preview.source.playbackRate.value || 1;
  const end = preview.clock === "timeline" ? Math.max(arrangementDuration(), preview.cursor) : preview.buffer.duration;
  return Math.min(end, preview.offset + (preview.ctx.currentTime - preview.startedAt) * rate);
}

function stopPreview(reset) {
  preview.token += 1;
  cancelAnimationFrame(preview.raf);
  const sources = new Set(preview.mix || []);
  if (preview.source) sources.add(preview.source);
  if (sources.size) preview.cursor = previewNow();
  for (const source of sources) {
    source.onended = null;
    try {
      source.stop();
    } catch {
      /* already stopped */
    }
  }
  preview.mix = [];
  preview.source = null;
  preview.clock = "file";
  if (state.arrangement && sources.size) state.arrangement.cursor = preview.cursor;
  if (reset) {
    preview.cursor = 0;
    if (state.arrangement && !state.arrangement.edited) state.arrangement.cursor = 0;
  }
  setPreviewPlaying(false);
  paintPreviewTime();
  drawArrangement();
}

async function ensurePreview() {
  const file = selectedAudio();
  if (!file) return null;
  if (preview.buffer && preview.file === file.path) return preview.buffer;
  stopPreview(true);
  const bytes = await window.desktop.readAudio(file.path);
  const audio = await previewAudio().decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  preview.buffer = audio;
  preview.file = file.path;
  preview.cursor = 0;
  paintPreviewTime();
  return audio;
}

function playPreview() {
  const ctx = previewAudio();
  const duration = preview.buffer.duration;
  const start = Math.min(preview.cursor, Math.max(0, duration - 0.05));
  const source = ctx.createBufferSource();
  source.buffer = preview.buffer;
  if (pacePreviewPath(state.audio && state.audio.path)) {
    source.playbackRate.value = Number(document.querySelector("#speed").value);
    if (!preview.paceGain) {
      preview.paceGain = ctx.createGain();
      preview.paceGain.connect(preview.gain);
    }
    preview.paceGain.gain.value = Number(document.querySelector("#volume").value);
    source.connect(preview.paceGain);
  } else {
    source.connect(preview.gain);
  }
  const token = preview.token;
  preview.mix = [source];
  preview.clock = "file";
  preview.source = source;
  preview.offset = start;
  preview.startedAt = ctx.currentTime;
  source.onended = () => {
    if (token !== preview.token) return;
    preview.source = null;
    preview.mix = [];
    preview.cursor = 0;
    if (state.arrangement && !state.arrangement.edited) state.arrangement.cursor = 0;
    setPreviewPlaying(false);
    paintPreviewTime();
    drawArrangement();
  };
  source.start(0, start);
  setPreviewPlaying(true);
  const tick = () => {
    if (token !== preview.token) return;
    preview.cursor = previewNow();
    if (state.arrangement && !state.arrangement.edited) state.arrangement.cursor = preview.cursor;
    paintPreviewTime();
    drawArrangement();
    preview.raf = requestAnimationFrame(tick);
  };
  tick();
}

function setPlaying(active) {
  const play = document.querySelector("#play");
  if (!play) return;
  play.classList.toggle("playing", active);
  play.title = active ? "Pausar" : "Reproduzir";
}

function editorStatus(message) {
  document.querySelector("#editor-status").textContent = message;
}

function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  const whole = Math.floor(rest);
  const tenth = Math.floor((rest - whole) * 10);
  return `${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${tenth}`;
}

function sourceForCut() {
  return state.take.pace || state.take.path;
}

function cutsPathFor(file) {
  return file.replace(/\.(wav|mp3|m4a|webm)$/i, ".cuts.json");
}

function resizeCanvas(node, ctx) {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, node.clientWidth);
  const height = Math.max(1, node.clientHeight);
  if (node.width !== Math.floor(width * ratio) || node.height !== Math.floor(height * ratio)) {
    node.width = Math.floor(width * ratio);
    node.height = Math.floor(height * ratio);
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width, height };
}

function removedAt(time) {
  return state.review.cuts.some((cut) => cut.action !== "keep" && time >= cut.start && time < cut.end);
}

function drawReview() {
  if (!state.review) return;
  const { width, height } = resizeCanvas(canvas, context);
  const rulerSize = resizeCanvas(ruler, rulerContext);
  const { peaksMin, peaksMax, duration, viewStart, viewDuration, cuts, selection } = state.review;
  const cursor = playbackTime();

  context.fillStyle = "#07111c";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "rgba(78, 168, 255, 0.22)";
  context.fillRect(0, height / 2, width, 1);

  const count = peaksMax.length;
  for (let x = 0; x < width; x += 1) {
    const t0 = viewStart + (x / width) * viewDuration;
    const t1 = viewStart + ((x + 1) / width) * viewDuration;
    const i0 = Math.max(0, Math.floor((t0 / duration) * count));
    const i1 = Math.min(count, Math.max(i0 + 1, Math.ceil((t1 / duration) * count)));
    let min = 0;
    let max = 0;
    for (let index = i0; index < i1; index += 1) {
      min = Math.min(min, peaksMin[index]);
      max = Math.max(max, peaksMax[index]);
    }
    const removed = removedAt(t0);
    context.fillStyle = removed ? "#1a3d66" : "#5eb6ff";
    const top = (0.5 - max * 0.46) * height;
    const bottom = (0.5 - min * 0.46) * height;
    context.fillRect(x, top, 1, Math.max(1, bottom - top));
  }

  for (const cut of cuts) {
    if (cut.action === "keep" || cut.end < viewStart || cut.start > viewStart + viewDuration) continue;
    const x = ((cut.start - viewStart) / viewDuration) * width;
    const cutWidth = ((cut.end - cut.start) / viewDuration) * width;
    context.fillStyle = "rgba(3, 8, 16, 0.58)";
    context.fillRect(x, 0, cutWidth, height);
  }

  if (selection) {
    const x = ((selection.start - viewStart) / viewDuration) * width;
    const selectionWidth = ((selection.end - selection.start) / viewDuration) * width;
    context.fillStyle = "rgba(255, 255, 255, 0.12)";
    context.fillRect(x, 0, selectionWidth, height);
    context.strokeStyle = "#ffffff";
    context.lineWidth = 2;
    context.strokeRect(x + 1, 1, Math.max(0, selectionWidth - 2), height - 2);
  }

  const hover = state.review.hoverEdge;
  for (let index = 0; index < cuts.length; index += 1) {
    const cut = cuts[index];
    if (cut.action === "keep") continue;
    for (const side of ["start", "end"]) {
      const x = ((cut[side] - viewStart) / viewDuration) * width;
      if (x < -8 || x > width + 8) continue;
      const active = hover && hover.index === index && hover.side === side;
      context.fillStyle = active ? "#ffffff" : "rgba(255, 255, 255, 0.7)";
      context.fillRect(x - (active ? 2 : 1), 0, active ? 4 : 2, height);
      if (!active) continue;
      const direction = state.review.dragDirection || 0;
      const mid = height / 2;
      context.fillStyle = "#ffffff";
      context.beginPath();
      context.arc(x, mid, 12, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#041018";
      context.beginPath();
      if (direction < 0) {
        context.moveTo(x - 6, mid);
        context.lineTo(x + 3, mid - 6);
        context.lineTo(x + 3, mid + 6);
      } else if (direction > 0) {
        context.moveTo(x + 6, mid);
        context.lineTo(x - 3, mid - 6);
        context.lineTo(x - 3, mid + 6);
      } else {
        context.moveTo(x - 7, mid);
        context.lineTo(x - 1, mid - 5);
        context.lineTo(x - 1, mid + 5);
        context.moveTo(x + 7, mid);
        context.lineTo(x + 1, mid - 5);
        context.lineTo(x + 1, mid + 5);
      }
      context.closePath();
      context.fill();
    }
  }

  drawRuler(rulerContext, rulerSize.width, rulerSize.height, viewStart, viewDuration);
  drawNeedle(((cursor - viewStart) / viewDuration) * width, context, height, rulerContext, rulerSize.height);
  document.querySelector("#timecode").textContent = `${formatTime(cursor)} / ${formatTime(duration)}`;
}

function drawRuler(rulerContext, width, height, viewStart, viewDuration, gutter = 0) {
  rulerContext.fillStyle = "#07111c";
  rulerContext.fillRect(0, 0, width, height);
  rulerContext.fillStyle = "#d5e9ff";
  rulerContext.font = "11px Segoe UI, sans-serif";
  const plot = Math.max(1, width - gutter);
  const step = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((item) => item >= viewDuration / (plot / 90)) || 600;
  const first = Math.ceil(viewStart / step) * step;
  for (let time = first; time < viewStart + viewDuration; time += step) {
    const x = gutter + ((time - viewStart) / viewDuration) * plot;
    rulerContext.fillRect(x, 18, 1, 10);
    rulerContext.fillText(formatTime(time), x + 4, 14);
  }
}

function drawNeedle(x, waveContext, waveHeight, rulerContext, rulerHeight) {
  const color = "#ff4d6a";
  waveContext.fillStyle = color;
  waveContext.fillRect(x - 1, 0, 2, waveHeight);
  if (!rulerContext) return;
  rulerContext.fillStyle = color;
  rulerContext.beginPath();
  rulerContext.arc(x, 7, 5, 0, Math.PI * 2);
  rulerContext.moveTo(x - 4.2, 9);
  rulerContext.lineTo(x + 4.2, 9);
  rulerContext.lineTo(x, 16);
  rulerContext.closePath();
  rulerContext.fill();
  rulerContext.fillRect(x - 1, 15, 2, Math.max(0, rulerHeight - 15));
}

async function loadWave(file, ctx = editorAudio()) {
  const bytes = await window.desktop.readAudio(file);
  const audio = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const channel = audio.getChannelData(0);
  const columns = Math.min(48000, Math.max(2400, Math.ceil(audio.duration * 100)));
  const size = Math.max(1, Math.floor(channel.length / columns));
  const peaksMin = new Float32Array(columns);
  const peaksMax = new Float32Array(columns);
  for (let index = 0; index < columns; index += 1) {
    let min = 0;
    let max = 0;
    const start = index * size;
    for (let sample = 0; sample < size; sample += 1) {
      const value = channel[start + sample] || 0;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    peaksMin[index] = min;
    peaksMax[index] = max;
  }
  return { buffer: audio, peaksMin, peaksMax, duration: audio.duration };
}

function syncPan() {
  const pan = document.querySelector("#pan");
  const { duration, viewStart, viewDuration } = state.review;
  const span = Math.max(0.001, duration - viewDuration);
  pan.max = "1000";
  pan.value = String(Math.round((viewStart / span) * 1000));
  pan.disabled = viewDuration >= duration - 0.05;
}

function setZoom(zoom, anchorTime) {
  const next = Math.min(40, Math.max(1, zoom));
  const duration = state.review.duration;
  const viewDuration = duration / next;
  const anchor = anchorTime == null ? state.review.viewStart + state.review.viewDuration / 2 : anchorTime;
  const ratio = state.review.viewDuration ? (anchor - state.review.viewStart) / state.review.viewDuration : 0.5;
  state.review.zoom = next;
  state.review.viewDuration = viewDuration;
  state.review.viewStart = Math.min(duration - viewDuration, Math.max(0, anchor - ratio * viewDuration));
  document.querySelector("#zoom").value = String(next);
  syncPan();
}

function ensureVisible(time) {
  const { viewStart, viewDuration, duration } = state.review;
  if (time >= viewStart && time <= viewStart + viewDuration) return;
  state.review.viewStart = Math.min(duration - viewDuration, Math.max(0, time - viewDuration * 0.25));
  syncPan();
}

function timeAt(event) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  return state.review.viewStart + ratio * state.review.viewDuration;
}

function edgeAt(event) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  let best = null;
  for (let index = 0; index < state.review.cuts.length; index += 1) {
    const cut = state.review.cuts[index];
    if (cut.action === "keep") continue;
    for (const side of ["start", "end"]) {
      const edge = ((cut[side] - state.review.viewStart) / state.review.viewDuration) * rect.width;
      const distance = Math.abs(x - edge);
      if (distance <= 8 && (!best || distance < best.distance)) best = { index, side, distance };
    }
  }
  return best;
}

function playbackTime() {
  if (!player.source || !audioCtx) return state.review ? state.review.cursor : 0;
  return Math.min(player.end, player.offset + (audioCtx.currentTime - player.startedAt));
}

function stopPlayback() {
  playToken += 1;
  cancelAnimationFrame(player.raf);
  if (player.source) {
    const time = playbackTime();
    player.source.onended = null;
    try {
      player.source.stop();
    } catch {
      /* already stopped */
    }
    player.source = null;
    if (state.review) state.review.cursor = time;
  }
  setPlaying(false);
}

function tick(token) {
  if (token !== playToken || !state.review) return;
  state.review.cursor = playbackTime();
  ensureVisible(state.review.cursor);
  drawReview();
  player.raf = requestAnimationFrame(() => tick(token));
}

function keepRanges(from, to) {
  const cuts = state.review.cuts
    .filter((cut) => cut.action !== "keep")
    .sort((a, b) => a.start - b.start);
  const ranges = [];
  let cursor = from;
  for (const cut of cuts) {
    if (cut.end <= cursor) continue;
    if (cut.start >= to) break;
    if (cut.start > cursor) ranges.push([cursor, Math.min(cut.start, to)]);
    cursor = Math.max(cursor, cut.end);
  }
  if (cursor < to) ranges.push([cursor, to]);
  return ranges.filter(([start, end]) => end - start > 0.01);
}

function startSegment(ranges, index, token) {
  if (token !== playToken || !state.review) return;
  if (index >= ranges.length) {
    player.source = null;
    state.review.cursor = ranges.length ? ranges[ranges.length - 1][1] : state.review.cursor;
    setPlaying(false);
    drawReview();
    return;
  }
  const [start, end] = ranges[index];
  const ctx = editorAudio();
  const duration = state.review.buffer.duration;
  const safeStart = Math.min(Math.max(0, start), Math.max(0, duration - 0.02));
  const safeEnd = Math.min(duration, Math.max(safeStart + 0.02, end));
  const source = ctx.createBufferSource();
  source.buffer = state.review.buffer;
  source.connect(player.gain);
  player.source = source;
  player.offset = safeStart;
  player.end = safeEnd;
  player.startedAt = ctx.currentTime;
  source.onended = () => {
    if (token !== playToken) return;
    startSegment(ranges, index + 1, token);
  };
  source.start(0, safeStart, safeEnd - safeStart);
  setPlaying(true);
  cancelAnimationFrame(player.raf);
  tick(token);
}

function playRanges(ranges) {
  stopPlayback();
  if (!ranges.length) {
    editorStatus("Nada para ouvir nesse trecho.");
    return;
  }
  state.review.cursor = ranges[0][0];
  startSegment(ranges, 0, playToken);
}

function selectedRange() {
  if (!state.review.selection) return null;
  const { start, end } = state.review.selection;
  return end - start > 0.03 ? [start, end] : null;
}

function rememberCuts() {
  state.review.future = [];
  state.review.history.push(state.review.cuts.map((cut) => ({ ...cut })));
  if (state.review.history.length > 40) state.review.history.shift();
}

function undoCuts() {
  if (!state.review || !state.review.history.length) return;
  state.review.future = state.review.future || [];
  state.review.future.push(state.review.cuts.map((cut) => ({ ...cut })));
  state.review.cuts = state.review.history.pop();
  drawReview();
}

function redoCuts() {
  if (!state.review || !state.review.future || !state.review.future.length) return;
  state.review.history.push(state.review.cuts.map((cut) => ({ ...cut })));
  state.review.cuts = state.review.future.pop();
  drawReview();
}

function addCut(start, end) {
  let from = start;
  let to = end;
  const kept = [];
  for (const cut of state.review.cuts) {
    if (cut.end < from || cut.start > to) kept.push(cut);
    else {
      from = Math.min(from, cut.start);
      to = Math.max(to, cut.end);
    }
  }
  kept.push({ kind: "silence", start: from, end: to, action: "remove" });
  kept.sort((a, b) => a.start - b.start);
  state.review.cuts = kept;
}

function restoreRange(start, end) {
  const next = [];
  for (const cut of state.review.cuts) {
    if (cut.end <= start || cut.start >= end) {
      next.push(cut);
      continue;
    }
    if (cut.start < start) next.push({ ...cut, end: start });
    if (cut.end > end) next.push({ ...cut, start: end });
  }
  state.review.cuts = next.filter((cut) => cut.end - cut.start > 0.02);
}

async function openEditor() {
  if (!state.take) return;
  stopPreview(false);
  stopPlayback();
  document.querySelector("#modal").hidden = false;
  editorStatus("Carregando áudio…");
  const file = sourceForCut();
  let cuts = [];
  let cutsPath = state.take.cuts || cutsPathFor(file);
  if (state.take.cuts) {
    try {
      const text = await window.desktop.readText(state.take.cuts);
      const parsed = text ? JSON.parse(text) : { cuts: [] };
      cuts = Array.isArray(parsed.cuts) ? parsed.cuts.filter((cut) => cut && cut.action !== "keep") : [];
    } catch {
      cuts = [];
    }
  }
  try {
    const wave = await loadWave(file);
    state.review = {
      file,
      cutsPath,
      cuts,
      ...wave,
      zoom: 1,
      viewStart: 0,
      viewDuration: wave.duration,
      cursor: 0,
      selection: null,
      history: [],
      future: [],
      hoverEdge: null,
      dragDirection: 0,
    };
    document.querySelector("#zoom").value = "1";
    syncPan();
    drawReview();
    editorStatus(cuts.length ? `${cuts.length} cortes. Arraste para selecionar.` : "Arraste na onda para selecionar um trecho.");
  } catch (error) {
    editorStatus(error.message);
  }
}

document.querySelector("#open-cut").addEventListener("click", () => {
  openEditor();
});

document.querySelector("#close-modal").addEventListener("click", () => {
  stopPlayback();
  document.querySelector("#modal").hidden = true;
});

for (const [id, output, suffix] of [
  ["#silence-db", "#silence-db-value", " dB"],
  ["#silence-min", "#silence-min-value", " s"],
  ["#pad", "#pad-value", " s"],
]) {
  const input = document.querySelector(id);
  const label = document.querySelector(output);
  const paint = () => {
    label.textContent = `${Number(input.value).toFixed(id === "#silence-db" ? 0 : 2).replace(".", ",")}${suffix}`;
  };
  input.addEventListener("input", paint);
  paint();
}

document.querySelector("#zoom").addEventListener("input", (event) => {
  if (!state.review) return;
  setZoom(Number(event.target.value), state.review.cursor);
  drawReview();
});

document.querySelector("#zoom-out").addEventListener("click", () => {
  if (!state.review) return;
  setZoom(state.review.zoom / 1.4, state.review.cursor);
  drawReview();
});

document.querySelector("#zoom-in").addEventListener("click", () => {
  if (!state.review) return;
  setZoom(state.review.zoom * 1.4, state.review.cursor);
  drawReview();
});

document.querySelector("#level").addEventListener("input", (event) => {
  if (player.gain) player.gain.gain.value = Number(event.target.value);
});

document.querySelector("#pan").addEventListener("input", (event) => {
  if (!state.review) return;
  const span = state.review.duration - state.review.viewDuration;
  state.review.viewStart = (Number(event.target.value) / 1000) * Math.max(0, span);
  drawReview();
});

document.querySelector(".editor-wave").addEventListener("wheel", (event) => {
  if (!state.review) return;
  event.preventDefault();
  const action = arrange.wheelAction(event);
  if (action.type === "pan") {
    const delta = (action.delta / 400) * state.review.viewDuration;
    state.review.viewStart = Math.min(
      state.review.duration - state.review.viewDuration,
      Math.max(0, state.review.viewStart + delta),
    );
    syncPan();
  } else if (action.delta) {
    const factor = action.delta < 0 ? 1.18 : 1 / 1.18;
    setZoom(state.review.zoom * factor, timeAt(event));
  }
  drawReview();
}, { passive: false });

canvas.addEventListener("pointerdown", (event) => {
  if (!state.review) return;
  canvas.setPointerCapture(event.pointerId);
  const edge = edgeAt(event);
  const playing = Boolean(player.source);
  if (playing) stopPlayback();
  if (edge) {
    const cut = state.review.cuts[edge.index];
    state.review.selection = { start: cut.start, end: cut.end };
    state.drag = { mode: "edge", ...edge, lastX: event.clientX, direction: 0, started: false };
    state.review.hoverEdge = edge;
    state.review.dragDirection = 0;
    drawReview();
    return;
  }
  const time = timeAt(event);
  state.drag = { mode: "select", time, moved: false, parked: playing };
  if (playing) {
    state.review.cursor = time;
    drawReview();
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.review) return;
  if (!state.drag) {
    const edge = edgeAt(event);
    canvas.style.cursor = edge ? "ew-resize" : "text";
    const same = state.review.hoverEdge && edge && state.review.hoverEdge.index === edge.index && state.review.hoverEdge.side === edge.side;
    if (!same || Boolean(state.review.hoverEdge) !== Boolean(edge)) {
      state.review.hoverEdge = edge;
      state.review.dragDirection = 0;
      drawReview();
    }
    return;
  }
  if (state.drag.mode === "edge") {
    const delta = event.clientX - state.drag.lastX;
    if (Math.abs(delta) >= 2) {
      if (!state.drag.started) {
        rememberCuts();
        state.drag.started = true;
      }
      state.drag.direction = delta > 0 ? 1 : -1;
      state.drag.lastX = event.clientX;
    }
    const cut = state.review.cuts[state.drag.index];
    const time = timeAt(event);
    const previous = state.review.cuts.slice(0, state.drag.index).findLast((item) => item.action !== "keep");
    const next = state.review.cuts.slice(state.drag.index + 1).find((item) => item.action !== "keep");
    if (state.drag.side === "start") {
      const floor = previous ? Math.min(previous.end, cut.end - 0.05) : 0;
      cut.start = Math.min(cut.end - 0.05, Math.max(floor, time));
    } else {
      const ceiling = next ? Math.max(next.start, cut.start + 0.05) : state.review.duration;
      cut.end = Math.max(cut.start + 0.05, Math.min(ceiling, time));
    }
    state.review.selection = { start: cut.start, end: cut.end };
    state.review.hoverEdge = { index: state.drag.index, side: state.drag.side };
    state.review.dragDirection = state.drag.direction;
    drawReview();
    return;
  }
  const time = timeAt(event);
  if (Math.abs(time - state.drag.time) > 0.03) state.drag.moved = true;
  if (!state.drag.moved) return;
  state.review.selection = {
    start: Math.min(state.drag.time, time),
    end: Math.max(state.drag.time, time),
  };
  drawReview();
});

canvas.addEventListener("pointerup", (event) => {
  if (!state.review || !state.drag) return;
  const time = timeAt(event);
  if (state.drag.mode === "select" && !state.drag.moved) {
    state.review.cursor = time;
    if (state.drag.parked) {
      editorStatus("Pausado nesse ponto.");
    } else {
      const hit = state.review.cuts.find((cut) => time >= cut.start && time <= cut.end && cut.action !== "keep");
      state.review.selection = hit ? { start: hit.start, end: hit.end } : null;
      editorStatus(hit ? "Arraste a borda para aumentar ou diminuir o corte." : "Cursor posicionado.");
    }
  }
  state.drag = null;
  state.review.dragDirection = 0;
  drawReview();
});

canvas.addEventListener("pointerleave", () => {
  if (!state.review || state.drag) return;
  canvas.style.cursor = "text";
  state.review.hoverEdge = null;
  state.review.dragDirection = 0;
  drawReview();
});

document.querySelector("#play").addEventListener("click", () => {
  if (!state.review) return;
  if (player.source) {
    stopPlayback();
    drawReview();
    return;
  }
  const range = selectedRange();
  const from = range ? range[0] : state.review.cursor;
  const to = range ? range[1] : state.review.duration;
  playRanges(range ? [[from, to]] : keepRanges(from, to));
});

document.querySelector("#play-selection").addEventListener("click", () => {
  if (!state.review) return;
  const range = selectedRange();
  if (!range) {
    editorStatus("Arraste um trecho na onda para ouvir só ele.");
    return;
  }
  playRanges([range]);
});

document.querySelector("#stop").addEventListener("click", () => {
  if (!state.review) return;
  stopPlayback();
  drawReview();
});

document.querySelector("#skip-start").addEventListener("click", () => {
  if (!state.review) return;
  stopPlayback();
  state.review.cursor = 0;
  ensureVisible(0);
  drawReview();
});

document.querySelector("#cut-selection").addEventListener("click", () => {
  const range = state.review && selectedRange();
  if (!range) {
    editorStatus("Selecione o trecho que deve sair.");
    return;
  }
  rememberCuts();
  addCut(range[0], range[1]);
  editorStatus("Trecho marcado para sair.");
  drawReview();
});

document.querySelector("#restore-selection").addEventListener("click", () => {
  const range = state.review && selectedRange();
  if (!range) {
    editorStatus("Selecione o trecho escuro que deve voltar.");
    return;
  }
  rememberCuts();
  restoreRange(range[0], range[1]);
  editorStatus("Trecho devolvido.");
  drawReview();
});

document.querySelector("#undo-cut").addEventListener("click", undoCuts);
document.querySelector("#redo-cut").addEventListener("click", redoCuts);

document.querySelector("#analyze").addEventListener("click", async () => {
  if (!state.take) return;
  const file = state.review ? state.review.file : sourceForCut();
  editorStatus("Detectando silêncio…");
  setStatus("Detectando silêncio…");
  try {
    const result = await window.desktop.cleanup({
      file,
      silenceDb: document.querySelector("#silence-db").value,
      silenceMin: document.querySelector("#silence-min").value,
      pad: document.querySelector("#pad").value,
    });
    const wave = state.review && state.review.file === file ? state.review : await loadWave(file);
    state.review = {
      file,
      cutsPath: result.CUTS,
      cuts: result.cuts.cuts.filter((cut) => cut.action !== "keep"),
      buffer: wave.buffer,
      peaksMin: wave.peaksMin,
      peaksMax: wave.peaksMax,
      duration: wave.duration,
      zoom: state.review ? state.review.zoom : 1,
      viewStart: state.review ? state.review.viewStart : 0,
      viewDuration: state.review ? state.review.viewDuration : wave.duration,
      cursor: 0,
      selection: null,
      history: [],
      future: [],
      hoverEdge: null,
      dragDirection: 0,
    };
    await refresh(result);
    drawReview();
    editorStatus(`${state.review.cuts.length} cortes`);
    setStatus(`${state.review.cuts.length} cortes`);
  } catch (error) {
    editorStatus(error.message);
    setStatus(error.message);
  }
});

document.querySelector("#finish").addEventListener("click", async () => {
  if (!state.review) return;
  stopPlayback();
  editorStatus("Salvando prévia…");
  setStatus("Salvando prévia do corte…");
  try {
    const result = await window.desktop.applyCuts({
      file: state.review.file,
      cutsPath: state.review.cutsPath,
      cuts: state.review.cuts,
    });
    stopPreview(true);
    preview.file = "";
    preview.buffer = null;
    await refresh(result);
    const output = result.OUTPUT;
    const node = output ? findNode(state.tree, output) : null;
    if (node) {
      expandAncestors(state.tree, output);
      selectNode(node, false);
      await useCutPreview(node, state.review.file);
    }
    document.querySelector("#modal").hidden = true;
    setStatus(node ? "Prévia do corte pronta. Ouça antes de exportar o mp3." : "Cortado.");
  } catch (error) {
    editorStatus(error.message);
    setStatus(error.message);
  }
});

window.addEventListener("keydown", (event) => {
  if (event.target.matches("input, select, textarea")) return;
  const modalOpen = !document.querySelector("#modal").hidden;
  const meta = event.metaKey || event.ctrlKey;
  if (meta && event.code === "KeyZ") {
    event.preventDefault();
    if (modalOpen) {
      if (event.shiftKey) redoCuts();
      else undoCuts();
    } else if (event.shiftKey) redoArrangement();
    else undoArrangement();
    return;
  }
  if (meta && event.code === "KeyB") {
    event.preventDefault();
    if (modalOpen) document.querySelector("#cut-selection").click();
    else document.querySelector("#split-clip").click();
    return;
  }
  if (!modalOpen) {
    if (event.code === "Space" && selectedAudio()) {
      event.preventDefault();
      document.querySelector("#preview-play").click();
    }
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    document.querySelector("#play").click();
  } else if (event.key === "Escape") {
    if (state.review) state.review.selection = null;
    drawReview();
  }
});

const arrangeWave = document.querySelector("#arrange-wave");
const arrangeRuler = document.querySelector("#arrange-ruler");
const arrangeWaveContext = arrangeWave.getContext("2d");
const arrangeRulerContext = arrangeRuler.getContext("2d");
const arrangeGutter = 96;
let arrangeToken = 0;
let arrangeSaveTimer = 0;
let arrangeSeq = 1;
let arrangeDrag = null;

function nextArrangeId() {
  arrangeSeq += 1;
  return `c${arrangeSeq.toString(36)}`;
}

function arrangementDuration() {
  if (!state.arrangement) return 0;
  const ends = state.arrangement.tracks.flatMap((track) => track.clips.map((clip) => arrange.clipEnd(clip)));
  return Math.max(1, ...ends, 0);
}

function arrangementActive() {
  return Boolean(state.arrangement && state.arrangement.edited && state.arrangement.tracks.some((track) => track.clips.length));
}

function arrangementSpan() {
  const board = state.arrangement;
  return Math.max(arrangementDuration(), board.reference || 0, 1);
}

function fitArrangement() {
  const board = state.arrangement;
  const duration = arrangementSpan();
  board.duration = duration;
  board.zoom = board.zoom || 1;
  board.viewDuration = duration / board.zoom;
  board.viewStart = Math.min(Math.max(0, board.viewStart || 0), Math.max(0, duration - board.viewDuration));
}

function scheduleArrangementSave() {
  clearTimeout(arrangeSaveTimer);
  arrangeSaveTimer = setTimeout(() => {
    const board = state.arrangement;
    if (!board || !board.edited) return;
    const payload = {
      project: board.project,
      edited: true,
      zoom: board.zoom,
      tracks: board.tracks.map((track) => ({
        id: track.id,
        name: track.name,
        clips: track.clips.map((clip) => ({
          id: clip.id,
          file: clip.file,
          name: clip.name,
          in: clip.in,
          out: clip.out,
          start: clip.start,
          sourceDuration: clip.sourceDuration,
        })),
      })),
    };
    window.desktop.writeTimeline(board.project, JSON.stringify(payload, null, 2)).catch((error) => setStatus(error.message));
  }, 400);
}

function arrangementSnapshot(board) {
  return {
    zoom: board.zoom,
    viewStart: board.viewStart,
    cursor: board.cursor || 0,
    tracks: JSON.parse(JSON.stringify(board.tracks)),
  };
}

function rememberArrangement() {
  const board = state.arrangement;
  if (!board) return;
  board.history = board.history || [];
  board.future = [];
  board.history.push(arrangementSnapshot(board));
  if (board.history.length > 50) board.history.shift();
  paintHistoryButtons();
}

function applyArrangementSnapshot(snapshot) {
  const board = state.arrangement;
  board.zoom = snapshot.zoom;
  board.viewStart = snapshot.viewStart;
  board.cursor = snapshot.cursor;
  board.tracks = snapshot.tracks;
  preview.cursor = snapshot.cursor || 0;
  board.edited = true;
  fitArrangement();
  scheduleArrangementSave();
  paintPreviewTime();
  drawArrangement();
  paintHistoryButtons();
}

function undoArrangement() {
  const board = state.arrangement;
  if (!board || !board.history || !board.history.length) return;
  board.future = board.future || [];
  board.future.push(arrangementSnapshot(board));
  applyArrangementSnapshot(board.history.pop());
}

function redoArrangement() {
  const board = state.arrangement;
  if (!board || !board.future || !board.future.length) return;
  board.history = board.history || [];
  board.history.push(arrangementSnapshot(board));
  applyArrangementSnapshot(board.future.pop());
}

function paintHistoryButtons() {
  const board = state.arrangement;
  const undo = document.querySelector("#undo-arrange");
  const redo = document.querySelector("#redo-arrange");
  if (!undo || !redo) return;
  undo.disabled = !board || !board.history || !board.history.length;
  redo.disabled = !board || !board.future || !board.future.length;
}

function markArrangement() {
  state.arrangement.edited = true;
  fitArrangement();
  scheduleArrangementSave();
  drawArrangement();
  paintHistoryButtons();
}

async function waveFor(file) {
  const cached = state.waves.get(file);
  if (cached) return cached;
  const wave = await loadWave(file, previewAudio());
  state.waves.set(file, wave);
  return wave;
}

function clipFromWave(file, name, wave, start) {
  return {
    id: nextArrangeId(),
    file,
    name,
    in: 0,
    out: wave.duration,
    start,
    sourceDuration: wave.duration,
  };
}

async function referenceFor(file, wave) {
  const rawPath = file.take && file.take.path;
  if (!rawPath || rawPath === file.path) return wave.duration;
  try {
    const raw = await waveFor(rawPath);
    return Math.max(raw.duration, wave.duration);
  } catch {
    return wave.duration;
  }
}

async function seedArrangement(project, file, token) {
  const wave = await waveFor(file.path);
  if (token !== arrangeToken) return;
  const reference = await referenceFor(file, wave);
  if (token !== arrangeToken) return;
  preview.buffer = wave.buffer;
  preview.file = file.path;
  preview.cursor = 0;
  state.arrangement = {
    project,
    edited: false,
    zoom: 1,
    viewStart: 0,
    reference,
    viewDuration: reference,
    duration: reference,
    cursor: 0,
    history: [],
    future: [],
    tracks: [{ id: nextArrangeId(), name: "Faixa 1", clips: [clipFromWave(file.path, file.name, wave, 0)] }],
  };
  paintHistoryButtons();
  paintPreviewTime();
  drawArrangement();
}

async function hydrateArrangement(token) {
  const board = state.arrangement;
  for (const track of board.tracks) {
    const clips = [];
    for (const clip of track.clips || []) {
      try {
        const wave = await waveFor(clip.file);
        if (token !== arrangeToken) return;
        clip.sourceDuration = wave.duration;
        clip.out = Math.min(Number(clip.out), wave.duration);
        clips.push(clip);
      } catch {
        /* arquivo removido da pasta */
      }
    }
    track.clips = clips;
  }
  if (!board.tracks.length) board.tracks.push({ id: nextArrangeId(), name: "Faixa 1", clips: [] });
  fitArrangement();
}

async function syncArrangement(file) {
  const project = parentDir(file.path);
  const board = state.arrangement;
  const complex = board && board.project === project && (board.tracks.length > 1 || board.tracks.some((track) => track.clips.length > 1));
  const contains = complex && board.tracks.some((track) => track.clips.some((clip) => clip.file === file.path));
  if (contains) {
    drawArrangement();
    paintPreviewTime();
    return;
  }
  const sole = board && board.project === project && board.tracks.length === 1 && board.tracks[0].clips.length === 1
    ? board.tracks[0].clips[0]
    : null;
  if (sole && sole.file === file.path && board.reference) {
    drawArrangement();
    paintPreviewTime();
    return;
  }
  const token = ++arrangeToken;
  await seedArrangement(project, file, token);
}

function arrangePlot(width) {
  return Math.max(1, width - arrangeGutter);
}

function arrangeTimeAt(event) {
  const rect = arrangeWave.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left - arrangeGutter) / arrangePlot(rect.width)));
  return state.arrangement.viewStart + ratio * state.arrangement.viewDuration;
}

function arrangeTrackAt(event) {
  const rect = arrangeWave.getBoundingClientRect();
  const lanes = Math.max(1, state.arrangement.tracks.length);
  return Math.min(lanes - 1, Math.max(0, Math.floor(((event.clientY - rect.top) / rect.height) * lanes)));
}

function followArrangement(time) {
  const board = state.arrangement;
  if (time >= board.viewStart && time <= board.viewStart + board.viewDuration) return;
  board.viewStart = Math.min(board.duration - board.viewDuration, Math.max(0, time - board.viewDuration * 0.25));
}

function drawArrangement() {
  if (!state.arrangement) return;
  const board = state.arrangement;
  fitArrangement();
  const { width, height } = resizeCanvas(arrangeWave, arrangeWaveContext);
  const rulerSize = resizeCanvas(arrangeRuler, arrangeRulerContext);
  const plot = arrangePlot(width);
  const lanes = Math.max(1, board.tracks.length);
  const laneHeight = height / lanes;
  const cursor = preview.source ? previewNow() : board.cursor || 0;
  arrangeWaveContext.clearRect(0, 0, width, height);
  board.tracks.forEach((track, index) => {
    const y = index * laneHeight;
    arrangeWaveContext.fillStyle = index % 2 ? "#0c1c2c" : "#07111c";
    arrangeWaveContext.fillRect(0, y, width, laneHeight);
    arrangeWaveContext.fillStyle = "#8fb4d6";
    arrangeWaveContext.font = "12px Segoe UI, sans-serif";
    arrangeWaveContext.fillText(track.name, 8, y + 18);
    const color = index === 0 ? "#5eb6ff" : "#d2b4ff";
    for (const clip of track.clips) {
      const wave = state.waves.get(clip.file);
      const x0 = arrangeGutter + ((clip.start - board.viewStart) / board.viewDuration) * plot;
      const x1 = arrangeGutter + ((arrange.clipEnd(clip) - board.viewStart) / board.viewDuration) * plot;
      const left = Math.max(arrangeGutter, x0);
      const right = Math.min(arrangeGutter + plot, x1);
      if (right - left < 1) continue;
      arrangeWaveContext.fillStyle = index === 0 ? "rgba(94, 182, 255, 0.08)" : "rgba(210, 180, 255, 0.12)";
      arrangeWaveContext.fillRect(left, y + 4, right - left, laneHeight - 8);
      if (wave) {
        const count = wave.peaksMax.length;
        arrangeWaveContext.fillStyle = color;
        for (let x = Math.floor(left); x < right; x += 1) {
          const timelineTime = board.viewStart + ((x - arrangeGutter) / plot) * board.viewDuration;
          const sourceTime = clip.in + (timelineTime - clip.start);
          const sample = Math.max(0, Math.min(count - 1, Math.floor((sourceTime / wave.duration) * count)));
          const top = y + (0.5 - wave.peaksMax[sample] * 0.42) * laneHeight;
          const bottom = y + (0.5 - wave.peaksMin[sample] * 0.42) * laneHeight;
          arrangeWaveContext.fillRect(x, top, 1, Math.max(1, bottom - top));
        }
      }
      arrangeWaveContext.strokeStyle = "rgba(255,255,255,0.85)";
      arrangeWaveContext.strokeRect(left + 0.5, y + 4.5, Math.max(0, right - left - 1), laneHeight - 9);
    }
  });
  drawRuler(arrangeRulerContext, rulerSize.width, rulerSize.height, board.viewStart, board.viewDuration, arrangeGutter);
  const playhead = arrangeGutter + ((cursor - board.viewStart) / board.viewDuration) * plot;
  drawNeedle(playhead, arrangeWaveContext, height, arrangeRulerContext, rulerSize.height);
  paintPreviewTime();
}

function parkArrangement(time) {
  const playing = Boolean(preview.source);
  if (playing) stopPreview(false);
  const next = Math.max(0, Math.min(arrangementDuration(), time));
  state.arrangement.cursor = next;
  preview.cursor = next;
  paintPreviewTime();
  drawArrangement();
}

async function usePacePreview(file, ratio) {
  const token = ++arrangeToken;
  state.waves.delete(file.path);
  const wave = await waveFor(file.path);
  if (token !== arrangeToken) return;
  const reference = await referenceFor(file, wave);
  if (token !== arrangeToken) return;
  const cursor = Math.min(wave.duration, Math.max(0, (ratio || 0) * wave.duration));
  preview.buffer = wave.buffer;
  preview.file = file.path;
  preview.cursor = cursor;
  const project = parentDir(file.path);
  const rawPath = file.take && file.take.path;
  const board = state.arrangement && state.arrangement.project === project ? state.arrangement : null;
  let replaced = 0;
  if (board) {
    for (const track of board.tracks) {
      for (const clip of track.clips) {
        const narration = clip.file === rawPath || clip.file === file.path;
        if (!narration) continue;
        clip.file = file.path;
        clip.name = file.name;
        clip.in = 0;
        clip.out = wave.duration;
        clip.sourceDuration = wave.duration;
        replaced += 1;
      }
    }
  }
  if (!board || !replaced) {
    state.arrangement = {
      project,
      edited: false,
      zoom: 1,
      viewStart: 0,
      reference,
      viewDuration: reference,
      duration: reference,
      cursor,
      history: [],
      future: [],
      tracks: [{ id: nextArrangeId(), name: "Faixa 1", clips: [clipFromWave(file.path, file.name, wave, 0)] }],
    };
  } else {
    board.reference = Math.max(board.reference || 0, reference);
    board.cursor = cursor;
    const clips = board.tracks.reduce((count, track) => count + track.clips.length, 0);
    board.edited = board.tracks.length > 1 || clips > 1;
    fitArrangement();
    if (board.edited) scheduleArrangementSave();
  }
  if (state.arrangement) state.arrangement.cursor = cursor;
  paintHistoryButtons();
  paintPreviewTime();
  drawArrangement();
}

async function useCutPreview(file, sourcePath) {
  const token = ++arrangeToken;
  state.waves.delete(file.path);
  if (sourcePath) state.waves.delete(sourcePath);
  const wave = await waveFor(file.path);
  if (token !== arrangeToken) return;
  preview.buffer = wave.buffer;
  preview.file = file.path;
  preview.cursor = 0;
  const reference = await referenceFor(file, wave);
  if (token !== arrangeToken) return;
  const project = parentDir(file.path);
  const board = state.arrangement && state.arrangement.project === project ? state.arrangement : null;
  let replaced = 0;
  if (board) {
    rememberArrangement();
    for (const track of board.tracks) {
      for (const clip of track.clips) {
        if (clip.file !== sourcePath && clip.file !== file.path) continue;
        clip.file = file.path;
        clip.name = file.name;
        clip.in = 0;
        clip.out = wave.duration;
        clip.sourceDuration = wave.duration;
        replaced += 1;
      }
    }
  }
  if (!board || !replaced) {
    state.arrangement = {
      project,
      edited: false,
      zoom: 1,
      viewStart: 0,
      viewDuration: wave.duration,
      duration: wave.duration,
      reference,
      cursor: 0,
      history: [],
      future: [],
      tracks: [{ id: nextArrangeId(), name: "Faixa 1", clips: [clipFromWave(file.path, file.name, wave, 0)] }],
    };
  } else {
    board.reference = Math.max(board.reference || 0, reference);
    const clips = board.tracks.reduce((count, track) => count + track.clips.length, 0);
    board.edited = board.tracks.length > 1 || clips > 1;
    board.cursor = 0;
    fitArrangement();
    if (board.edited) scheduleArrangementSave();
  }
  paintHistoryButtons();
  paintPreviewTime();
  drawArrangement();
}

async function playArrangement() {
  stopPreview(false);
  const board = state.arrangement;
  const ctx = previewAudio();
  const origin = Math.max(0, board.cursor || 0);
  const token = preview.token;
  const clipCount = board.tracks.reduce((count, track) => count + track.clips.length, 0);
  const paceAll = clipCount > 0 && board.tracks.every((track) => track.clips.every((clip) => pacePreviewPath(clip.file)));
  const rate = paceAll ? Number(document.querySelector("#speed").value) : 1;
  const volume = Number(document.querySelector("#volume").value);
  const mix = [];
  for (const track of board.tracks) {
    for (const clip of track.clips) {
      const wave = state.waves.get(clip.file);
      if (!wave) continue;
      const end = arrange.clipEnd(clip);
      if (end <= origin + 0.01) continue;
      const skip = Math.max(0, origin - clip.start);
      const offset = Math.min(Math.max(0, wave.duration - 0.02), clip.in + skip);
      const dur = Math.max(0.02, Math.min(wave.duration - offset, clip.out - clip.in - skip));
      const source = ctx.createBufferSource();
      source.buffer = wave.buffer;
      if (pacePreviewPath(clip.file)) {
        source.playbackRate.value = rate;
        if (!preview.paceGain) {
          preview.paceGain = ctx.createGain();
          preview.paceGain.connect(preview.gain);
        }
        preview.paceGain.gain.value = volume;
        source.connect(preview.paceGain);
      } else {
        source.connect(preview.gain);
      }
      source.start(ctx.currentTime + Math.max(0, clip.start - origin) / rate, offset, dur);
      mix.push(source);
    }
  }
  if (!mix.length) {
    setStatus("Nada para ouvir nessa posição.");
    return;
  }
  preview.mix = mix;
  preview.source = mix[0];
  preview.clock = "timeline";
  preview.rate = rate;
  preview.offset = origin;
  preview.startedAt = ctx.currentTime;
  let left = mix.length;
  for (const source of mix) {
    source.onended = () => {
      if (token !== preview.token) return;
      left -= 1;
      if (left > 0) return;
      preview.source = null;
      preview.mix = [];
      preview.cursor = arrangementDuration();
      board.cursor = preview.cursor;
      setPreviewPlaying(false);
      paintPreviewTime();
      drawArrangement();
    };
  }
  setPreviewPlaying(true);
  const tick = () => {
    if (token !== preview.token) return;
    preview.cursor = previewNow();
    board.cursor = preview.cursor;
    followArrangement(preview.cursor);
    paintPreviewTime();
    drawArrangement();
    preview.raf = requestAnimationFrame(tick);
  };
  tick();
}

async function addClipToTrack(trackIndex, filePath, start) {
  const wave = await waveFor(filePath);
  const track = state.arrangement.tracks[trackIndex];
  if (!track) return;
  const name = filePath.split(/[/\\]/).pop();
  rememberArrangement();
  track.clips.push(clipFromWave(filePath, name, wave, Math.max(0, start)));
  markArrangement();
  setStatus(`${name} entrou na ${track.name}.`);
}

function arrangementCursor() {
  return preview.source ? previewNow() : state.arrangement.cursor || 0;
}

function needleX(element) {
  const board = state.arrangement;
  const rect = element.getBoundingClientRect();
  const plot = Math.max(1, rect.width - arrangeGutter);
  return rect.left + arrangeGutter + ((arrangementCursor() - board.viewStart) / board.viewDuration) * plot;
}

function pointerOnNeedle(event, element) {
  return Math.abs(event.clientX - needleX(element)) <= 10;
}

function beginNeedleDrag(event, element) {
  element.setPointerCapture(event.pointerId);
  if (preview.source) stopPreview(false);
  arrangeDrag = { mode: "needle" };
  parkArrangement(arrangeTimeAt(event));
}

arrangeRuler.addEventListener("pointerdown", (event) => {
  if (!state.arrangement) return;
  beginNeedleDrag(event, arrangeRuler);
});

arrangeRuler.addEventListener("pointermove", (event) => {
  if (!state.arrangement) return;
  if (arrangeDrag && arrangeDrag.mode === "needle") {
    parkArrangement(arrangeTimeAt(event));
    return;
  }
  arrangeRuler.style.cursor = pointerOnNeedle(event, arrangeRuler) ? "ew-resize" : "text";
});

arrangeRuler.addEventListener("pointerup", () => {
  if (arrangeDrag && arrangeDrag.mode === "needle") arrangeDrag = null;
});

arrangeWave.addEventListener("pointerdown", (event) => {
  if (!state.arrangement) return;
  arrangeWave.setPointerCapture(event.pointerId);
  if (pointerOnNeedle(event, arrangeWave)) {
    beginNeedleDrag(event, arrangeWave);
    return;
  }
  if (preview.source) stopPreview(false);
  const rect = arrangeWave.getBoundingClientRect();
  const inGutter = event.clientX - rect.left < arrangeGutter;
  const time = arrangeTimeAt(event);
  const trackIndex = arrangeTrackAt(event);
  const track = state.arrangement.tracks[trackIndex];
  const secondsPerPixel = state.arrangement.viewDuration / arrangePlot(rect.width);
  const hit = inGutter ? null : arrange.hitOnTrack(track.clips, time, secondsPerPixel);
  if (hit && hit.edge) {
    arrangeDrag = { mode: "trim", trackIndex, index: hit.index, edge: hit.edge };
    return;
  }
  if (hit) {
    arrangeDrag = { mode: "move", trackIndex, index: hit.index, origin: time, start: track.clips[hit.index].start, moved: false };
    return;
  }
  arrangeDrag = { mode: "seek" };
  parkArrangement(time);
});

arrangeWave.addEventListener("pointermove", (event) => {
  if (!state.arrangement) return;
  const time = arrangeTimeAt(event);
  if (!arrangeDrag) {
    if (pointerOnNeedle(event, arrangeWave)) {
      arrangeWave.style.cursor = "ew-resize";
      return;
    }
    const track = state.arrangement.tracks[arrangeTrackAt(event)];
    const secondsPerPixel = state.arrangement.viewDuration / arrangePlot(arrangeWave.getBoundingClientRect().width);
    const hit = track ? arrange.hitOnTrack(track.clips, time, secondsPerPixel) : null;
    arrangeWave.style.cursor = hit && hit.edge ? "ew-resize" : "text";
    return;
  }
  if (arrangeDrag.mode === "needle" || arrangeDrag.mode === "seek") {
    parkArrangement(time);
    return;
  }
  const track = state.arrangement.tracks[arrangeDrag.trackIndex];
  if (arrangeDrag.mode === "trim") {
    if (!arrangeDrag.started) {
      rememberArrangement();
      arrangeDrag.started = true;
    }
    track.clips[arrangeDrag.index] = arrange.trimClip(track.clips[arrangeDrag.index], arrangeDrag.edge, time);
    markArrangement();
    return;
  }
  if (arrangeDrag.mode !== "move" || Math.abs(time - arrangeDrag.origin) < 0.03) return;
  if (!arrangeDrag.started) {
    rememberArrangement();
    arrangeDrag.started = true;
  }
  arrangeDrag.moved = true;
  const nextTrack = arrangeTrackAt(event);
  if (nextTrack !== arrangeDrag.trackIndex) {
    const [clip] = track.clips.splice(arrangeDrag.index, 1);
    state.arrangement.tracks[nextTrack].clips.push(clip);
    arrangeDrag.trackIndex = nextTrack;
    arrangeDrag.index = state.arrangement.tracks[nextTrack].clips.length - 1;
  }
  const clips = state.arrangement.tracks[arrangeDrag.trackIndex].clips;
  clips[arrangeDrag.index] = arrange.moveClip(clips[arrangeDrag.index], arrangeDrag.start + (time - arrangeDrag.origin));
  markArrangement();
});

arrangeWave.addEventListener("pointerup", (event) => {
  if (!arrangeDrag || !state.arrangement) return;
  if ((arrangeDrag.mode === "move" && !arrangeDrag.moved) || arrangeDrag.mode === "seek") parkArrangement(arrangeTimeAt(event));
  arrangeDrag = null;
});

document.querySelector(".arrangement-wave").addEventListener("wheel", (event) => {
  if (!state.arrangement) return;
  event.preventDefault();
  const board = state.arrangement;
  const action = arrange.wheelAction(event);
  if (action.type === "pan") {
    const delta = (action.delta / 400) * board.viewDuration;
    board.viewStart = Math.min(Math.max(0, board.duration - board.viewDuration), Math.max(0, board.viewStart + delta));
  } else if (action.delta) {
    const anchor = arrangeTimeAt(event);
    const ratio = board.viewDuration ? (anchor - board.viewStart) / board.viewDuration : 0.5;
    board.zoom = Math.min(40, Math.max(1, board.zoom * (action.delta < 0 ? 1.18 : 1 / 1.18)));
    board.viewDuration = board.duration / board.zoom;
    board.viewStart = Math.min(Math.max(0, board.duration - board.viewDuration), Math.max(0, anchor - ratio * board.viewDuration));
  }
  drawArrangement();
}, { passive: false });

arrangeWave.addEventListener("dragover", (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});

arrangeWave.addEventListener("drop", (event) => {
  event.preventDefault();
  if (!state.arrangement) return;
  const filePath = event.dataTransfer.getData("text/plain");
  if (!isAudioName(filePath)) return;
  addClipToTrack(arrangeTrackAt(event), filePath, arrangeTimeAt(event)).catch((error) => setStatus(error.message));
});

document.querySelector("#undo-arrange").addEventListener("click", undoArrangement);
document.querySelector("#redo-arrange").addEventListener("click", redoArrangement);

document.querySelector("#split-clip").addEventListener("click", () => {
  if (!state.arrangement) return;
  const time = preview.source ? previewNow() : state.arrangement.cursor || 0;
  const result = arrange.splitTracks(state.arrangement.tracks, time, nextArrangeId);
  if (!result.count) {
    setStatus("Posicione a agulha no meio de um clipe para cortar.");
    return;
  }
  rememberArrangement();
  state.arrangement.tracks = result.tracks;
  markArrangement();
  setStatus("Clipe cortado.");
});

document.querySelector("#add-track").addEventListener("click", () => {
  if (!state.arrangement) return;
  const count = state.arrangement.tracks.length + 1;
  rememberArrangement();
  state.arrangement.tracks.push({ id: nextArrangeId(), name: `Faixa ${count}`, clips: [] });
  markArrangement();
  setStatus("Faixa nova. Arraste um áudio da pasta para ela.");
});

document.querySelector("#preview-play").addEventListener("click", async () => {
  if (!selectedAudio()) return;
  if (preview.source) {
    stopPreview(false);
    drawArrangement();
    return;
  }
  const button = document.querySelector("#preview-play");
  button.disabled = true;
  try {
    if (arrangementActive()) await playArrangement();
    else {
      await ensurePreview();
      playPreview();
    }
  } catch (error) {
    setStatus(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#preview-stop").addEventListener("click", () => {
  stopPreview(false);
});

document.querySelector("#preview-skip").addEventListener("click", () => {
  const resume = Boolean(preview.source);
  const timeline = preview.clock === "timeline";
  stopPreview(true);
  if (!resume) return;
  if (timeline && arrangementActive()) playArrangement().catch((error) => setStatus(error.message));
  else if (preview.buffer) playPreview();
});

let seekResume = false;

document.querySelector("#preview-seek").addEventListener("pointerdown", () => {
  seekResume = Boolean(preview.source);
  if (preview.source) stopPreview(false);
});

document.querySelector("#preview-seek").addEventListener("input", (event) => {
  const duration = shownDuration();
  if (!duration) return;
  preview.cursor = Number(event.target.value);
  if (state.arrangement) state.arrangement.cursor = preview.cursor;
  document.querySelector("#preview-time").textContent = `${formatTime(preview.cursor)} / ${formatTime(duration)}`;
  drawArrangement();
});

document.querySelector("#preview-seek").addEventListener("pointerup", () => {
  if (!seekResume) return;
  seekResume = false;
  if (arrangementActive()) playArrangement().catch((error) => setStatus(error.message));
  else if (preview.buffer) playPreview();
});

document.querySelector("#preview-level").addEventListener("input", (event) => {
  if (preview.gain) preview.gain.gain.value = Number(event.target.value);
});

new ResizeObserver(() => {
  if (state.review && !document.querySelector("#modal").hidden) drawReview();
}).observe(document.querySelector(".editor-wave"));

new ResizeObserver(() => {
  if (state.arrangement) drawArrangement();
}).observe(document.querySelector(".arrangement-wave"));

document.querySelector("#export").addEventListener("click", async () => {
  if (!state.take) return;
  const source = state.take.clean || state.take.pace || state.take.path;
  const stem = state.take.name.replace(/\.[^.]+$/, "");
  const destination = state.take.path.toLowerCase().endsWith(".mp3")
    ? state.take.path.replace(/\.mp3$/i, ".export.mp3")
    : state.take.path.replace(/[^/]+$/, `${stem}.mp3`);
  setStatus("Exportando mp3…");
  const result = await window.desktop.exportMp3({ source, destination });
  await refresh(result);
  setStatus("Mp3 exportado.");
});

document.querySelector("#doc-editor").addEventListener("input", (event) => {
  if (!state.doc) return;
  state.doc.text = event.target.value;
  document.querySelector("#doc-rendered").innerHTML = renderMarkdown(state.doc.text);
  document.querySelector("#doc-status").textContent = "Salvando…";
  scheduleDocSave();
});

document.querySelector("#doc-editor").addEventListener("blur", () => {
  flushDoc().catch((error) => setStatus(error.message));
});

document.querySelector("#doc-mode-view").addEventListener("click", () => {
  state.docMode = "view";
  renderDoc();
});

document.querySelector("#doc-mode-edit").addEventListener("click", () => {
  state.docMode = "edit";
  renderDoc();
});

document.querySelector("#doc-rendered").addEventListener("click", (event) => {
  const link = event.target.closest("a");
  if (!link) return;
  event.preventDefault();
  window.desktop.openExternal(link.href);
});

const toggleExplorer = document.querySelector("#toggle-explorer");

function setExplorerCollapsed(collapsed) {
  document.body.classList.toggle("explorer-collapsed", collapsed);
  toggleExplorer.title = collapsed ? "Mostrar pastas" : "Minimizar";
  localStorage.setItem("boltjz-explorer", collapsed ? "closed" : "open");
}

toggleExplorer.addEventListener("click", () => {
  setExplorerCollapsed(!document.body.classList.contains("explorer-collapsed"));
});

if (localStorage.getItem("boltjz-explorer") === "closed") setExplorerCollapsed(true);

async function boot() {
  const initial = await window.desktop.getState();
  state.workspace = initial.workspace;
  state.deviceId = initial.deviceId;
  state.open = new Set(initial.tree.map((node) => node.path));
  await loadMics();
  await refresh(initial);
}

boot().catch((error) => {
  empty.hidden = false;
  empty.textContent = error.message;
});
