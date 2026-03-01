const STORAGE_KEY = "grok_media_studio_settings_v1";
const GALLERY_LIMIT = 200;
const VIDEO_REASONING_EFFORT = "low";
const T2I_WS_OPEN_TIMEOUT_MS = 1800;

const videoState = {
  sourceController: null,
  currentTaskId: "",
  isRunning: false,
  progressBuffer: "",
  contentBuffer: "",
  collectingContent: false,
  startAt: 0,
  fileDataUrl: "",
  elapsedTimer: null,
  lastProgress: 0,
  currentPreviewItem: null,
  previewCount: 0,
};

const t2iState = {
  isRunning: false,
  taskIds: [],
  controllers: [],
  imageCount: 0,
  streamCards: new Map(),
  savedIds: new Set(),
  sequence: 0,
  totalLatency: 0,
  latencyCount: 0,
  wsOpenedCount: 0,
  mode: "auto",
  fallbackTimer: null,
  finalMinBytes: 100000,
  isFallbackSwitching: false,
};

const i2iState = {
  file: null,
};

const T2I_SIZE_TO_RATIO = {
  "1024x1024": "1:1",
  "1280x720": "16:9",
  "720x1280": "9:16",
  "1792x1024": "3:2",
  "1024x1792": "2:3",
};

function byId(id) {
  return document.getElementById(id);
}

function getSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || "{}";
    const parsed = JSON.parse(raw);
    return {
      apiUrl: String(parsed.apiUrl || "").trim(),
      apiKey: String(parsed.apiKey || "").trim(),
    };
  } catch (_) {
    return { apiUrl: "", apiKey: "" };
  }
}

function setSettings(apiUrl, apiKey) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      apiUrl: String(apiUrl || "").trim(),
      apiKey: String(apiKey || "").trim(),
    })
  );
}

function normalizeBaseUrl(input) {
  const value = String(input || "").trim();
  if (!value) return "";
  return value.replace(/\/+$/, "");
}

function setStatus(target, message, type = "") {
  if (!target) return;
  target.textContent = message || "";
  target.classList.remove("ok", "error");
  if (type) target.classList.add(type);
}

function setStatusChip(targetId, state, text) {
  const node = byId(targetId);
  if (!node) return;
  node.textContent = text || "";
  node.classList.remove("connected", "connecting", "error");
  if (state) {
    node.classList.add(state);
  }
}

function buildHeaders(isJson = true) {
  const apiKey = getApiKeyValue();
  const headers = {};
  if (isJson) {
    headers["Content-Type"] = "application/json";
  }
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  return headers;
}

async function parseResponsePayload(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => null);
  }
  const text = await response.text().catch(() => "");
  return text ? { raw: text } : null;
}

async function requestApi(path, options = {}) {
  const baseUrl = normalizeBaseUrl(byId("apiUrl").value);
  if (!baseUrl) {
    throw new Error("请先填写 API URL");
  }
  const url = `${baseUrl}${path}`;
  const response = await fetch(url, options);
  const payload = await parseResponsePayload(response);

  if (!response.ok) {
    const msg =
      payload?.error?.message ||
      payload?.message ||
      payload?.raw ||
      `HTTP ${response.status}`;
    throw new Error(msg);
  }
  return payload;
}

function buildAbsoluteApiUrl(path, query = null) {
  const baseUrl = normalizeBaseUrl(byId("apiUrl").value);
  if (!baseUrl) {
    throw new Error("请先填写 API URL");
  }
  const url = new URL(`${baseUrl}${path}`);
  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function getApiKeyValue() {
  return String(byId("apiKey").value || "").trim();
}

function buildAbsoluteWsUrl(path, query = null) {
  const baseUrl = normalizeBaseUrl(byId("apiUrl").value);
  if (!baseUrl) {
    throw new Error("请先填写 API URL");
  }
  const url = new URL(`${baseUrl}${path}`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function extractErrorMessage(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload === "string") return payload;
  return (
    payload?.error?.message ||
    payload?.error ||
    payload?.detail ||
    payload?.message ||
    payload?.raw ||
    fallback
  );
}

function inferImageMimeFromRaw(raw) {
  const value = String(raw || "");
  if (value.startsWith("iVBOR")) return "image/png";
  if (value.startsWith("R0lGOD")) return "image/gif";
  if (value.startsWith("/9j/")) return "image/jpeg";
  return "image/jpeg";
}

function estimateBase64Bytes(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value) || value.startsWith("/")) return null;

  let base64 = value;
  if (value.startsWith("data:")) {
    const commaIndex = value.indexOf(",");
    base64 = commaIndex >= 0 ? value.slice(commaIndex + 1) : "";
  }
  base64 = base64.replace(/\s/g, "");
  if (!base64) return 0;

  let padding = 0;
  if (base64.endsWith("==")) padding = 2;
  else if (base64.endsWith("=")) padding = 1;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

async function downloadFileFromSrc(src, filename) {
  const safeSrc = String(src || "").trim();
  if (!safeSrc) return;

  const link = document.createElement("a");
  link.style.display = "none";

  if (safeSrc.startsWith("data:")) {
    link.href = safeSrc;
  } else {
    const response = await fetch(safeSrc, { mode: "cors" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const blob = await response.blob();
    link.href = URL.createObjectURL(blob);
  }

  link.download = filename || "image";
  document.body.appendChild(link);
  link.click();
  link.remove();

  if (link.href.startsWith("blob:")) {
    URL.revokeObjectURL(link.href);
  }
}

function parseSseEvent(rawEvent) {
  const lines = String(rawEvent || "").split(/\r?\n/);
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) {
    return "";
  }
  return dataLines.join("\n");
}

async function consumeSseStream(response, onData) {
  if (!response.body) {
    throw new Error("流式响应为空");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");
    let splitAt = buffer.indexOf("\n\n");
    while (splitAt !== -1) {
      const rawEvent = buffer.slice(0, splitAt);
      buffer = buffer.slice(splitAt + 2);
      const data = parseSseEvent(rawEvent);
      if (data) {
        onData(data);
      }
      splitAt = buffer.indexOf("\n\n");
    }
  }

  buffer += decoder.decode();
  buffer = buffer.replace(/\r\n/g, "\n");
  const tailData = parseSseEvent(buffer);
  if (tailData) {
    onData(tailData);
  }
}

async function requestStudioApi(path, options = {}) {
  const init = { ...options };
  const hasBody = Object.prototype.hasOwnProperty.call(init, "body");
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;

  init.headers = { ...(init.headers || {}) };
  if (hasBody && !isForm && !init.headers["Content-Type"]) {
    init.headers["Content-Type"] = "application/json";
  }

  const response = await fetch(path, init);
  const payload = await parseResponsePayload(response);
  if (!response.ok) {
    const msg = payload?.detail || payload?.message || payload?.raw || `HTTP ${response.status}`;
    throw new Error(msg);
  }
  return payload;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

function renderImages(target, dataList = []) {
  target.innerHTML = "";
  if (!Array.isArray(dataList) || dataList.length === 0) {
    target.innerHTML = `<div class="text-block">未返回图片结果。</div>`;
    return;
  }
  for (const item of dataList) {
    const card = document.createElement("div");
    card.className = "result-card";

    const image = document.createElement("img");
    let src = "";
    if (item?.url) {
      src = item.url;
    } else if (item?.b64_json) {
      src = `data:image/png;base64,${item.b64_json}`;
    }

    if (src) {
      image.src = src;
      image.alt = "result";
      card.appendChild(image);
      if (item?.url) {
        const link = document.createElement("a");
        link.href = item.url;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = item.url;
        card.appendChild(link);
      }
    } else {
      const block = document.createElement("div");
      block.className = "text-block";
      block.textContent = JSON.stringify(item || {}, null, 2);
      card.appendChild(block);
    }
    target.appendChild(card);
  }
}

function setVideoStatusChip(state, text) {
  const node = byId("i2vStatusText");
  if (!node) return;
  node.textContent = text || "未连接";
  node.classList.remove("connected", "connecting", "error");
  if (state) {
    node.classList.add(state);
  }
}

function setVideoButtons(running) {
  const startBtn = byId("i2vStartBtn");
  const stopBtn = byId("i2vStopBtn");
  if (!startBtn || !stopBtn) return;
  if (running) {
    startBtn.classList.add("hidden");
    stopBtn.classList.remove("hidden");
  } else {
    stopBtn.classList.add("hidden");
    startBtn.classList.remove("hidden");
    startBtn.disabled = false;
  }
}

function setVideoIndeterminate(active) {
  const progressBar = byId("i2vProgressBar");
  if (!progressBar) return;
  if (active) {
    progressBar.classList.add("indeterminate");
  } else {
    progressBar.classList.remove("indeterminate");
  }
}

function updateVideoProgress(value) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  videoState.lastProgress = safe;

  const fill = byId("i2vProgressFill");
  const text = byId("i2vProgressText");
  if (fill) fill.style.width = `${safe}%`;
  if (text) text.textContent = `${safe}%`;
}

function updateVideoMeta() {
  const ratio = byId("i2vRatio");
  const length = byId("i2vLength");
  const resolution = byId("i2vResolution");
  const preset = byId("i2vPreset");

  const aspectValue = byId("i2vMetaAspect");
  const lengthValue = byId("i2vMetaLength");
  const resolutionValue = byId("i2vMetaResolution");
  const presetValue = byId("i2vMetaPreset");

  if (aspectValue && ratio) aspectValue.textContent = ratio.value || "-";
  if (lengthValue && length) lengthValue.textContent = `${length.value || "-"}s`;
  if (resolutionValue && resolution) resolutionValue.textContent = resolution.value || "-";
  if (presetValue && preset) presetValue.textContent = preset.value || "-";
}

function startVideoElapsedTimer() {
  stopVideoElapsedTimer();
  const durationNode = byId("i2vDuration");
  if (!durationNode) return;
  videoState.elapsedTimer = setInterval(() => {
    if (!videoState.startAt) return;
    const seconds = Math.max(0, Math.round((Date.now() - videoState.startAt) / 1000));
    durationNode.textContent = `耗时 ${seconds}s`;
  }, 1000);
}

function stopVideoElapsedTimer() {
  if (videoState.elapsedTimer) {
    clearInterval(videoState.elapsedTimer);
    videoState.elapsedTimer = null;
  }
}

function clearVideoFileSelection() {
  videoState.fileDataUrl = "";
  const input = byId("i2vImageFile");
  const name = byId("i2vImageFileName");
  if (input) input.value = "";
  if (name) name.textContent = "未选择文件";
}

function resetVideoOutput(keepPreview = false) {
  videoState.progressBuffer = "";
  videoState.contentBuffer = "";
  videoState.collectingContent = false;
  videoState.lastProgress = 0;
  videoState.currentPreviewItem = null;

  updateVideoProgress(0);
  setVideoIndeterminate(false);

  const durationNode = byId("i2vDuration");
  if (durationNode) durationNode.textContent = "耗时 -";

  if (!keepPreview) {
    const stage = byId("i2vStage");
    const empty = byId("i2vEmpty");
    if (stage) {
      stage.innerHTML = "";
      stage.classList.add("hidden");
    }
    if (empty) {
      empty.classList.remove("hidden");
    }
    videoState.previewCount = 0;
  }
}

function initVideoPreviewSlot() {
  const stage = byId("i2vStage");
  const empty = byId("i2vEmpty");
  if (!stage) return;

  videoState.previewCount += 1;
  const item = document.createElement("div");
  item.className = "video-item is-pending";
  item.dataset.index = String(videoState.previewCount);

  const bar = document.createElement("div");
  bar.className = "video-item-bar";

  const title = document.createElement("div");
  title.className = "video-item-title";
  title.textContent = `视频 ${videoState.previewCount}`;

  const actions = document.createElement("div");
  actions.className = "video-item-actions";

  const openBtn = document.createElement("a");
  openBtn.className = "btn btn-outline hidden video-open";
  openBtn.target = "_blank";
  openBtn.rel = "noopener";
  openBtn.textContent = "打开";

  const downloadBtn = document.createElement("button");
  downloadBtn.className = "btn btn-outline video-download";
  downloadBtn.type = "button";
  downloadBtn.textContent = "下载";
  downloadBtn.disabled = true;

  actions.appendChild(openBtn);
  actions.appendChild(downloadBtn);
  bar.appendChild(title);
  bar.appendChild(actions);

  const body = document.createElement("div");
  body.className = "video-item-body";
  body.innerHTML = '<div class="video-item-placeholder">生成中...</div>';

  const link = document.createElement("div");
  link.className = "video-item-link";

  item.appendChild(bar);
  item.appendChild(body);
  item.appendChild(link);

  stage.appendChild(item);
  stage.classList.remove("hidden");
  if (empty) empty.classList.add("hidden");

  videoState.currentPreviewItem = item;
}

function ensureVideoPreviewSlot() {
  if (!videoState.currentPreviewItem) {
    initVideoPreviewSlot();
  }
  return videoState.currentPreviewItem;
}

function updateVideoItemLinks(item, url) {
  if (!item) return;
  const safeUrl = String(url || "").trim();
  const openBtn = item.querySelector(".video-open");
  const downloadBtn = item.querySelector(".video-download");
  const link = item.querySelector(".video-item-link");

  item.dataset.url = safeUrl;
  if (link) {
    link.textContent = safeUrl;
    link.classList.toggle("has-url", Boolean(safeUrl));
  }
  if (openBtn) {
    if (safeUrl) {
      openBtn.href = safeUrl;
      openBtn.classList.remove("hidden");
    } else {
      openBtn.classList.add("hidden");
      openBtn.removeAttribute("href");
    }
  }
  if (downloadBtn) {
    downloadBtn.dataset.url = safeUrl;
    downloadBtn.disabled = !safeUrl;
  }
  if (safeUrl) {
    item.classList.remove("is-pending");
  }
}

function extractVideoInfo(buffer) {
  if (!buffer) return null;
  if (buffer.includes("<video")) {
    const matches = buffer.match(/<video[\s\S]*?<\/video>/gi);
    if (matches && matches.length > 0) {
      return { html: matches[matches.length - 1] };
    }
  }
  const mdMatches = buffer.match(/\[video\]\(([^)]+)\)/g);
  if (mdMatches && mdMatches.length > 0) {
    const last = mdMatches[mdMatches.length - 1];
    const urlMatch = last.match(/\[video\]\(([^)]+)\)/);
    if (urlMatch && urlMatch[1]) {
      return { url: urlMatch[1] };
    }
  }
  const urlMatches = buffer.match(/https?:\/\/[^\s<)"']+/g);
  if (urlMatches && urlMatches.length > 0) {
    return { url: urlMatches[urlMatches.length - 1] };
  }
  return null;
}

function extractVideoUrlFromHtml(html) {
  if (!html) return "";
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const video = doc.querySelector("video");
  if (!video) return "";
  const source = video.querySelector("source");
  if (source && source.getAttribute("src")) {
    return source.getAttribute("src");
  }
  return video.getAttribute("src") || "";
}

function renderVideoFromUrl(url) {
  const container = ensureVideoPreviewSlot();
  if (!container) return;
  const body = container.querySelector(".video-item-body");
  if (!body) return;

  const safeUrl = String(url || "").trim();
  body.innerHTML = "";
  const video = document.createElement("video");
  video.controls = true;
  video.preload = "metadata";
  video.src = safeUrl;
  body.appendChild(video);

  updateVideoItemLinks(container, safeUrl);
}

function renderVideoFromHtml(html) {
  const videoUrl = extractVideoUrlFromHtml(html);
  if (videoUrl) {
    renderVideoFromUrl(videoUrl);
    return;
  }

  const container = ensureVideoPreviewSlot();
  if (!container) return;
  const body = container.querySelector(".video-item-body");
  if (!body) return;

  body.innerHTML = "";
  const block = document.createElement("div");
  block.className = "text-block";
  block.textContent = html;
  body.appendChild(block);
  updateVideoItemLinks(container, "");
}

function renderVideoCompatPayload(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  const raw = typeof content === "string" ? content : JSON.stringify(content || payload || {}, null, 2);
  videoState.contentBuffer += raw;
  const info = extractVideoInfo(videoState.contentBuffer);
  if (info?.html) {
    renderVideoFromHtml(info.html);
    return;
  }
  if (info?.url) {
    renderVideoFromUrl(info.url);
    return;
  }

  const container = ensureVideoPreviewSlot();
  if (!container) return;
  const body = container.querySelector(".video-item-body");
  if (!body) return;
  body.innerHTML = "";
  const block = document.createElement("div");
  block.className = "text-block";
  block.textContent = raw || "未返回视频地址。";
  body.appendChild(block);
  updateVideoItemLinks(container, "");
}

function handleVideoDelta(text) {
  if (!text) return;
  if (text.includes("<think>") || text.includes("</think>")) return;

  if (text.includes("超分辨率")) {
    setVideoStatusChip("connecting", "超分辨率中");
    setVideoIndeterminate(true);
    const progressText = byId("i2vProgressText");
    if (progressText) progressText.textContent = "超分辨率中";
    return;
  }

  if (!videoState.collectingContent) {
    const maybeVideo =
      text.includes("<video") || text.includes("[video](") || text.includes("http://") || text.includes("https://");
    if (maybeVideo) {
      videoState.collectingContent = true;
    }
  }

  if (videoState.collectingContent) {
    videoState.contentBuffer += text;
    const info = extractVideoInfo(videoState.contentBuffer);
    if (info?.html) {
      renderVideoFromHtml(info.html);
    } else if (info?.url) {
      renderVideoFromUrl(info.url);
    }
    return;
  }

  videoState.progressBuffer += text;
  const matches = [...videoState.progressBuffer.matchAll(/进度\s*(\d+)%/g)];
  if (matches.length > 0) {
    const value = Number(matches[matches.length - 1][1]);
    setVideoIndeterminate(false);
    updateVideoProgress(value);
    videoState.progressBuffer = videoState.progressBuffer.slice(Math.max(0, videoState.progressBuffer.length - 200));
  }
}

function formatLocalTime(isoText) {
  if (!isoText) return "-";
  const date = new Date(isoText);
  if (Number.isNaN(date.getTime())) return isoText;
  return date.toLocaleString();
}

function renderGallery(target, items = []) {
  target.innerHTML = "";
  if (!Array.isArray(items) || items.length === 0) {
    target.innerHTML = `<div class="text-block">作品库为空，先去生图试试。</div>`;
    return;
  }

  for (const item of items) {
    const card = document.createElement("div");
    card.className = "result-card";

    const image = document.createElement("img");
    image.src = item.source_url;
    image.alt = `media-${item.id}`;
    card.appendChild(image);

    const link = document.createElement("a");
    link.href = item.source_url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = item.source_url;
    card.appendChild(link);

    const meta = document.createElement("div");
    meta.className = "result-meta";
    const left = document.createElement("span");
    left.innerHTML = `<strong>#${item.id}</strong> ${item.task_type || "image"} · ${formatLocalTime(item.created_at)}`;

    const delBtn = document.createElement("button");
    delBtn.className = "btn btn-danger";
    delBtn.textContent = "删除";
    delBtn.addEventListener("click", async () => {
      await deleteGalleryItem(item.id, delBtn);
    });

    meta.appendChild(left);
    meta.appendChild(delBtn);
    card.appendChild(meta);
    target.appendChild(card);
  }
}

async function saveImageRecords(dataList = [], meta = {}) {
  const items = [];
  for (const item of dataList) {
    let sourceUrl = "";
    if (item?.url) {
      sourceUrl = String(item.url).trim();
    } else if (item?.b64_json) {
      sourceUrl = `data:image/png;base64,${item.b64_json}`;
    }
    if (!sourceUrl) continue;
    items.push({
      media_type: "image",
      task_type: meta.taskType || "image",
      model: meta.model || "",
      prompt: meta.prompt || "",
      source_url: sourceUrl,
    });
  }

  if (items.length === 0) return 0;
  const payload = await requestStudioApi("/api/media/batch", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
  return Number(payload?.saved || 0);
}

async function loadGallery(showMessage = true) {
  const statusNode = byId("galleryStatus");
  const resultNode = byId("galleryResult");
  if (showMessage) {
    setStatus(statusNode, "作品库加载中...");
  }
  try {
    const payload = await requestStudioApi(
      `/api/media?media_type=image&limit=${GALLERY_LIMIT}`
    );
    const items = Array.isArray(payload?.items) ? payload.items : [];
    renderGallery(resultNode, items);
    if (showMessage) {
      setStatus(statusNode, `已加载 ${items.length} 条记录。`, "ok");
    }
    return items.length;
  } catch (error) {
    setStatus(statusNode, `加载失败：${error.message}`, "error");
    resultNode.innerHTML = `<div class="text-block">读取数据库失败。</div>`;
    return 0;
  }
}

async function deleteGalleryItem(mediaId, triggerBtn) {
  const statusNode = byId("galleryStatus");
  const ok = window.confirm(`确认删除图片 #${mediaId} 吗？`);
  if (!ok) return;

  if (triggerBtn) triggerBtn.disabled = true;
  try {
    await requestStudioApi(`/api/media/${mediaId}`, { method: "DELETE" });
    setStatus(statusNode, `已删除图片 #${mediaId}。`, "ok");
    await loadGallery(false);
  } catch (error) {
    setStatus(statusNode, `删除失败：${error.message}`, "error");
  } finally {
    if (triggerBtn) triggerBtn.disabled = false;
  }
}

function setupTabs() {
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const panels = Array.from(document.querySelectorAll(".tab-panel"));
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const key = tab.dataset.tab;
      tabs.forEach((node) => node.classList.remove("active"));
      panels.forEach((node) => node.classList.remove("active"));
      tab.classList.add("active");
      byId(`tab-${key}`).classList.add("active");
    });
  });
}

async function testConnection() {
  const statusNode = byId("settingsStatus");
  setStatus(statusNode, "连接测试中...");
  try {
    const payload = await requestApi("/v1/models", {
      method: "GET",
      headers: buildHeaders(false),
    });
    const count = Array.isArray(payload?.data) ? payload.data.length : 0;
    await loadT2iDefaults();
    setStatus(statusNode, `连接成功，可用模型 ${count} 个。`, "ok");
  } catch (error) {
    setStatus(statusNode, `连接失败：${error.message}`, "error");
  }
}

function setT2iButtons(running) {
  const startBtn = byId("t2iStartBtn");
  const stopBtn = byId("t2iStopBtn");
  if (!startBtn || !stopBtn) return;
  if (running) {
    startBtn.classList.add("hidden");
    stopBtn.classList.remove("hidden");
  } else {
    stopBtn.classList.add("hidden");
    startBtn.classList.remove("hidden");
    startBtn.disabled = false;
  }
}

function getT2iActiveCount() {
  let active = 0;
  for (const item of t2iState.controllers) {
    if (!item) continue;
    if (item.kind === "ws") {
      if (item.socket && item.socket.readyState === WebSocket.OPEN) {
        active += 1;
      }
      continue;
    }
    if (item.kind === "sse") {
      if (item.controller && !item.controller.signal.aborted) {
        active += 1;
      }
    }
  }
  return active;
}

function updateT2iLatencyText() {
  const node = byId("t2iLatencyText");
  if (!node) return;
  if (t2iState.latencyCount > 0) {
    const avg = Math.round(t2iState.totalLatency / t2iState.latencyCount);
    node.textContent = `平均耗时 ${avg}ms`;
  } else {
    node.textContent = "平均耗时 -";
  }
}

function updateT2iCountText() {
  const node = byId("t2iCountText");
  if (!node) return;
  const active = getT2iActiveCount();
  const modeLabel = t2iState.mode ? ` · ${String(t2iState.mode).toUpperCase()}` : "";
  node.textContent = `图片 ${t2iState.imageCount} 张 · 活跃 ${active} 任务${modeLabel}`;
  updateT2iLatencyText();
}

function updateT2iLatency(value) {
  const safe = Number(value);
  if (!Number.isFinite(safe) || safe <= 0) return;
  t2iState.totalLatency += safe;
  t2iState.latencyCount += 1;
  updateT2iLatencyText();
}

function clearT2iFallbackTimer() {
  if (t2iState.fallbackTimer) {
    clearTimeout(t2iState.fallbackTimer);
    t2iState.fallbackTimer = null;
  }
}

function removeT2iController(taskId, kind) {
  t2iState.controllers = t2iState.controllers.filter(
    (item) => !(item.taskId === taskId && item.kind === kind)
  );
  updateT2iCountText();
}

function resetT2iState() {
  t2iState.taskIds = [];
  t2iState.controllers = [];
  t2iState.streamCards.clear();
  t2iState.savedIds.clear();
  t2iState.sequence = 0;
  t2iState.imageCount = 0;
  t2iState.totalLatency = 0;
  t2iState.latencyCount = 0;
  t2iState.wsOpenedCount = 0;
  t2iState.mode = String(byId("t2iMode")?.value || "auto").toLowerCase();
  t2iState.isFallbackSwitching = false;
  clearT2iFallbackTimer();
  updateT2iCountText();
}

function clearT2iResults() {
  const resultNode = byId("t2iResult");
  if (resultNode) {
    resultNode.innerHTML = "";
  }
  resetT2iState();
}

function normalizeT2iImageData(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  if (value.startsWith("data:")) {
    const commaIndex = value.indexOf(",");
    const base64 = commaIndex >= 0 ? value.slice(commaIndex + 1) : "";
    return {
      src: value,
      record: base64 ? { b64_json: base64 } : null,
      bytes: estimateBase64Bytes(value),
    };
  }
  if (/^https?:\/\//i.test(value) || value.startsWith("/")) {
    return {
      src: value,
      record: { url: value },
      bytes: null,
    };
  }
  const mime = inferImageMimeFromRaw(value);
  return {
    src: `data:${mime};base64,${value}`,
    record: { b64_json: value },
    bytes: estimateBase64Bytes(value),
  };
}

function removeT2iCardByKey(imageKey) {
  const key = String(imageKey || "");
  if (!key) return;
  const card = t2iState.streamCards.get(key);
  if (!card) return;

  card.remove();
  t2iState.streamCards.delete(key);
  if (t2iState.savedIds.has(key)) {
    t2iState.savedIds.delete(key);
  }
  if (t2iState.imageCount > 0) {
    t2iState.imageCount -= 1;
  }
  updateT2iCountText();
}

function createT2iCard(imageKey) {
  const resultNode = byId("t2iResult");
  if (!resultNode) return null;

  const card = document.createElement("div");
  card.className = "result-card";
  card.dataset.imageKey = imageKey;

  const image = document.createElement("img");
  image.alt = imageKey;
  card.appendChild(image);

  const meta = document.createElement("div");
  meta.className = "result-meta";

  const left = document.createElement("span");
  left.className = "t2i-item-label";
  left.innerHTML = `<strong>${imageKey}</strong>`;

  const right = document.createElement("span");
  right.className = "t2i-item-status";
  right.textContent = "生成中";

  meta.appendChild(left);
  meta.appendChild(right);
  card.appendChild(meta);

  if (byId("t2iReverseInsert")?.checked) {
    resultNode.prepend(card);
  } else {
    resultNode.appendChild(card);
  }

  t2iState.imageCount += 1;
  updateT2iCountText();

  if (byId("t2iAutoScroll")?.checked) {
    if (byId("t2iReverseInsert")?.checked) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    }
  }
  return card;
}

function upsertT2iImage(imageId, raw, isFinal, elapsedMs = null) {
  const normalized = normalizeT2iImageData(raw);
  if (!normalized) return null;

  const key = String(imageId || `image-${++t2iState.sequence}`);
  if (isFinal && byId("t2iAutoFilter")?.checked) {
    const minBytes = Math.max(0, Number(byId("t2iFinalMinBytes")?.value || t2iState.finalMinBytes || 0));
    const bytes = normalized.bytes;
    if (bytes !== null && bytes < minBytes) {
      removeT2iCardByKey(key);
      return null;
    }
  }

  let card = t2iState.streamCards.get(key);
  if (!card) {
    card = createT2iCard(key);
    if (!card) return null;
    t2iState.streamCards.set(key, card);
  }

  const image = card.querySelector("img");
  if (image) {
    image.src = normalized.src;
  }
  card.dataset.source = normalized.src;
  if (normalized.record?.url) {
    card.dataset.sourceUrl = normalized.record.url;
  }

  let link = card.querySelector("a");
  if (normalized.record?.url) {
    if (!link) {
      link = document.createElement("a");
      link.target = "_blank";
      link.rel = "noopener";
      card.appendChild(link);
    }
    link.href = normalized.record.url;
    link.textContent = normalized.record.url;
  } else if (link) {
    link.remove();
  }

  const statusNode = card.querySelector(".t2i-item-status");
  if (statusNode) {
    if (isFinal) {
      statusNode.textContent =
        typeof elapsedMs === "number" && elapsedMs > 0 ? `完成 · ${elapsedMs}ms` : "完成";
    } else {
      statusNode.textContent = "生成中";
    }
  }

  return { key, record: normalized.record };
}

async function saveT2iSingleRecord(recordInfo) {
  if (!recordInfo?.record || !recordInfo?.key) return;
  if (t2iState.savedIds.has(recordInfo.key)) return;
  t2iState.savedIds.add(recordInfo.key);

  const model = byId("t2iModel").value.trim() || "grok-imagine-1.0";
  const prompt = byId("t2iPrompt").value.trim();
  try {
    const saved = await saveImageRecords([recordInfo.record], {
      taskType: "t2i",
      model,
      prompt,
    });
    if (saved > 0) {
      await loadGallery(false);
    }
  } catch (_) {
    // ignore save failure to avoid interrupting stream
  }
}

function handleT2iSsePayload(payload) {
  if (!payload || typeof payload !== "object") return;

  const eventType = payload.type || "";
  if (eventType === "image_generation.partial_image" || eventType === "image_generation.completed") {
    const raw = payload.b64_json || payload.url || payload.image || payload.image_url;
    const imageId = payload.image_id || payload.imageId || "";
    if (!raw) return;
    const isFinal = eventType === "image_generation.completed" || payload.stage === "final";
    const recordInfo = upsertT2iImage(imageId, raw, isFinal, payload.elapsed_ms);
    if (isFinal) {
      updateT2iLatency(payload.elapsed_ms);
      saveT2iSingleRecord(recordInfo);
      if (byId("t2iAutoDownload")?.checked && recordInfo?.record) {
        void downloadT2iRecord(recordInfo.record, recordInfo.key);
      }
    }
    return;
  }

  if (eventType === "image") {
    const raw = payload.b64_json || payload.url || payload.image || payload.image_url;
    if (!raw) return;
    const imageId = payload.image_id || payload.imageId || "";
    const recordInfo = upsertT2iImage(imageId, raw, true, payload.elapsed_ms);
    updateT2iLatency(payload.elapsed_ms);
    saveT2iSingleRecord(recordInfo);
    if (byId("t2iAutoDownload")?.checked && recordInfo?.record) {
      void downloadT2iRecord(recordInfo.record, recordInfo.key);
    }
    return;
  }

  if (eventType === "error" || payload.error) {
    const message = extractErrorMessage(payload, "生成失败");
    setStatus(byId("t2iStatus"), `生图失败：${message}`, "error");
    setStatusChip("t2iStatusText", "error", "生成失败");
  }
}

async function createT2iTasks(prompt, aspectRatio, concurrent) {
  const nsfwEnabled = String(byId("t2iNsfw")?.value || "false").toLowerCase() === "true";
  const taskIds = [];
  for (let i = 0; i < concurrent; i += 1) {
    const payload = await requestApi("/v1/public/imagine/start", {
      method: "POST",
      headers: buildHeaders(true),
      body: JSON.stringify({
        prompt,
        aspect_ratio: aspectRatio,
        nsfw: nsfwEnabled,
      }),
    });
    const taskId = String(payload?.task_id || "").trim();
    if (!taskId) {
      throw new Error("创建任务成功，但未返回 task_id");
    }
    taskIds.push(taskId);
  }
  return taskIds;
}

async function loadT2iDefaults() {
  try {
    const payload = await requestApi("/v1/public/imagine/config", {
      method: "GET",
      headers: buildHeaders(false),
    });
    const minBytes = Number(payload?.final_min_bytes);
    if (Number.isFinite(minBytes) && minBytes >= 0) {
      t2iState.finalMinBytes = minBytes;
      const input = byId("t2iFinalMinBytes");
      if (input) input.value = String(minBytes);
    }
    if (typeof payload?.nsfw === "boolean") {
      const nsfwSelect = byId("t2iNsfw");
      if (nsfwSelect) nsfwSelect.value = payload.nsfw ? "true" : "false";
    }
  } catch (_) {
    // ignore: endpoint may not exist on some services
  }
}

async function downloadT2iRecord(record, key) {
  if (!record) return;
  let src = "";
  let ext = "png";
  if (record.url) {
    src = String(record.url).trim();
    const lower = src.toLowerCase();
    if (lower.includes(".webp")) ext = "webp";
    else if (lower.includes(".jpg") || lower.includes(".jpeg")) ext = "jpg";
    else if (lower.includes(".png")) ext = "png";
  } else if (record.b64_json) {
    const mime = inferImageMimeFromRaw(record.b64_json);
    ext = mime.includes("png") ? "png" : mime.includes("gif") ? "gif" : "jpg";
    src = `data:${mime};base64,${record.b64_json}`;
  }
  if (!src) return;

  const safeKey = String(key || "image").replace(/[^\w-]/g, "_");
  const filename = `t2i_${safeKey}_${Date.now()}.${ext}`;
  try {
    await downloadFileFromSrc(src, filename);
  } catch (_) {
    const link = document.createElement("a");
    link.href = src;
    link.target = "_blank";
    link.rel = "noopener";
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
}

async function downloadAllT2iImages() {
  const cards = Array.from(byId("t2iResult")?.querySelectorAll(".result-card") || []);
  if (cards.length === 0) {
    setStatus(byId("t2iStatus"), "没有可下载的图片。", "error");
    return;
  }

  let success = 0;
  for (const card of cards) {
    const src = String(card.dataset.source || "").trim();
    if (!src) continue;
    const key = String(card.dataset.imageKey || "image").replace(/[^\w-]/g, "_");
    const lower = src.toLowerCase();
    let ext = "png";
    if (lower.includes(".webp")) ext = "webp";
    else if (lower.includes(".jpg") || lower.includes(".jpeg")) ext = "jpg";
    else if (lower.includes(".png")) ext = "png";
    const filename = `t2i_${key}_${Date.now()}.${ext}`;

    try {
      await downloadFileFromSrc(src, filename);
      success += 1;
    } catch (_) {
      const link = document.createElement("a");
      link.href = src;
      link.target = "_blank";
      link.rel = "noopener";
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      success += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  setStatus(byId("t2iStatus"), `已触发下载 ${success} 张图片。`, "ok");
}

function closeAllT2iStreams() {
  for (const item of t2iState.controllers) {
    if (!item) continue;
    if (item.kind === "sse") {
      try {
        item.controller.abort();
      } catch (_) {
        // ignore
      }
      continue;
    }
    if (item.kind === "ws") {
      try {
        item.socket.close(1000, "client stop");
      } catch (_) {
        // ignore
      }
    }
  }
}

function onT2iStreamSettled() {
  if (!t2iState.isRunning) return;
  if (t2iState.isFallbackSwitching) return;
  if (t2iState.mode === "auto" && t2iState.wsOpenedCount === 0 && t2iState.fallbackTimer) return;
  const active = getT2iActiveCount();
  if (active > 0) return;
  t2iState.isRunning = false;
  t2iState.taskIds = [];
  setT2iButtons(false);
  setStatusChip("t2iStatusText", "", "连接关闭");
  setStatus(byId("t2iStatus"), "流式连接已关闭。", "error");
}

async function streamT2iTaskSse(taskId) {
  const controller = new AbortController();
  t2iState.controllers.push({ taskId, controller, kind: "sse" });
  updateT2iCountText();

  try {
    const url = buildAbsoluteApiUrl("/v1/public/imagine/sse", {
      task_id: taskId,
      t: Date.now(),
    });
    const headers = buildHeaders(false);
    headers.Accept = "text/event-stream";

    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      const payload = await parseResponsePayload(response);
      throw new Error(extractErrorMessage(payload, `HTTP ${response.status}`));
    }

    await consumeSseStream(response, (data) => {
      if (!t2iState.isRunning) return;
      if (!data) return;
      if (data === "[DONE]") {
        return;
      }
      try {
        const payload = JSON.parse(data);
        handleT2iSsePayload(payload);
      } catch (_) {
        // ignore invalid chunk
      }
    });
  } catch (error) {
    if (error?.name !== "AbortError" && t2iState.isRunning) {
      setStatus(byId("t2iStatus"), `生图流式任务失败：${error.message}`, "error");
      setStatusChip("t2iStatusText", "error", "连接错误");
    }
  } finally {
    removeT2iController(taskId, "sse");
    onT2iStreamSettled();
  }
}

async function streamT2iTaskWs(taskId) {
  let socket = null;
  try {
    const query = { task_id: taskId, t: Date.now() };
    const apiKey = getApiKeyValue();
    if (apiKey) {
      query.public_key = apiKey;
    }
    const wsUrl = buildAbsoluteWsUrl("/v1/public/imagine/ws", query);
    socket = new WebSocket(wsUrl);
  } catch (error) {
    throw new Error(error?.message || "WebSocket 初始化失败");
  }

  const controllerItem = { taskId, socket, kind: "ws" };
  t2iState.controllers.push(controllerItem);
  updateT2iCountText();

  await new Promise((resolve, reject) => {
    let opened = false;
    const openTimeout = setTimeout(() => {
      if (opened) return;
      try {
        socket.close();
      } catch (_) {
        // ignore
      }
      reject(new Error("WebSocket 连接超时"));
    }, T2I_WS_OPEN_TIMEOUT_MS);

    socket.onopen = () => {
      opened = true;
      clearTimeout(openTimeout);
      t2iState.wsOpenedCount += 1;
      clearT2iFallbackTimer();
      updateT2iCountText();
      setStatusChip("t2iStatusText", "connected", "WS 生成中");
    };

    socket.onmessage = (event) => {
      if (!t2iState.isRunning) return;
      const data = String(event?.data || "");
      if (!data || data === "[DONE]") return;
      try {
        const payload = JSON.parse(data);
        handleT2iSsePayload(payload);
      } catch (_) {
        // ignore invalid chunk
      }
    };

    socket.onerror = () => {
      if (!opened) {
        clearTimeout(openTimeout);
        reject(new Error("WebSocket 连接失败"));
        return;
      }
      if (t2iState.isRunning) {
        setStatus(byId("t2iStatus"), "WebSocket 连接异常。", "error");
      }
    };

    socket.onclose = () => {
      clearTimeout(openTimeout);
      resolve();
    };
  }).finally(() => {
    removeT2iController(taskId, "ws");
    onT2iStreamSettled();
  });
}

async function stopT2iRemote(taskIds) {
  if (!Array.isArray(taskIds) || taskIds.length === 0) return;
  try {
    await requestApi("/v1/public/imagine/stop", {
      method: "POST",
      headers: buildHeaders(true),
      body: JSON.stringify({ task_ids: taskIds }),
    });
  } catch (_) {
    // ignore remote stop error
  }
}

async function runTextToImageLegacy() {
  const statusNode = byId("t2iStatus");
  const resultNode = byId("t2iResult");
  const startBtn = byId("t2iStartBtn");
  const model = byId("t2iModel").value.trim() || "grok-imagine-1.0";
  const size = byId("t2iSize").value;
  const concurrent = Number(byId("t2iConcurrent")?.value || "1");
  const prompt = byId("t2iPrompt").value.trim();

  if (!prompt) {
    setStatus(statusNode, "请填写提示词。", "error");
    return;
  }

  startBtn.disabled = true;
  setStatusChip("t2iStatusText", "connecting", "兼容模式");
  setStatus(statusNode, "当前 API 不支持 imagine 流式任务，已切换兼容模式...");

  try {
    const payload = await requestApi("/v1/images/generations", {
      method: "POST",
      headers: buildHeaders(true),
      body: JSON.stringify({
        model,
        prompt,
        size,
        n: Math.max(1, Math.min(10, concurrent)),
        response_format: "url",
      }),
    });
    const list = payload?.data || [];
    renderImages(resultNode, list);
    t2iState.imageCount = Array.isArray(list) ? list.length : 0;
    updateT2iCountText();

    const saved = await saveImageRecords(list, {
      taskType: "t2i",
      model,
      prompt,
    });
    if (saved > 0) {
      await loadGallery(false);
      setStatus(statusNode, `生图完成，已入库 ${saved} 张。`, "ok");
    } else {
      setStatus(statusNode, "生图完成。", "ok");
    }
    setStatusChip("t2iStatusText", "connected", "完成");
  } catch (error) {
    setStatus(statusNode, `生图失败：${error.message}`, "error");
    setStatusChip("t2iStatusText", "error", "失败");
  } finally {
    startBtn.disabled = false;
    setT2iButtons(false);
  }
}

async function startTextToImage() {
  const statusNode = byId("t2iStatus");
  const prompt = byId("t2iPrompt").value.trim();
  const size = byId("t2iSize").value;
  const mode = String(byId("t2iMode")?.value || "auto").toLowerCase();
  const concurrent = Number(byId("t2iConcurrent")?.value || "1");
  const aspectRatio = T2I_SIZE_TO_RATIO[size] || "1:1";

  if (!prompt) {
    setStatus(statusNode, "请填写提示词。", "error");
    setStatusChip("t2iStatusText", "error", "参数错误");
    return;
  }
  if (t2iState.isRunning) {
    setStatus(statusNode, "任务正在运行中。", "error");
    return;
  }

  clearT2iResults();
  t2iState.isRunning = true;
  t2iState.mode = mode;
  t2iState.wsOpenedCount = 0;
  setT2iButtons(true);
  setStatusChip("t2iStatusText", "connecting", "连接中");
  setStatus(statusNode, "正在创建生图任务...");

  let taskIds = [];
  try {
    taskIds = await createT2iTasks(prompt, aspectRatio, Math.max(1, Math.min(3, concurrent)));
  } catch (error) {
    const message = String(error?.message || "");
    const maybeUnsupported = /404|401|403|not\s*found|unsupported|route|invalid_api_key|authentication/i.test(
      message.toLowerCase()
    );
    t2iState.isRunning = false;
    setT2iButtons(false);
    if (maybeUnsupported) {
      await runTextToImageLegacy();
      return;
    }
    setStatus(statusNode, `创建任务失败：${message}`, "error");
    setStatusChip("t2iStatusText", "error", "创建失败");
    return;
  }

  t2iState.taskIds = taskIds;
  updateT2iCountText();

  if (mode === "sse") {
    setStatusChip("t2iStatusText", "connected", "SSE 生成中");
    setStatus(statusNode, `任务已创建，SSE 活跃 ${taskIds.length} 个。`);
    for (const taskId of taskIds) {
      void streamT2iTaskSse(taskId);
    }
    return;
  }

  setStatusChip("t2iStatusText", "connected", "WS 连接中");
  setStatus(statusNode, `任务已创建，WS 活跃 ${taskIds.length} 个。`);
  for (const taskId of taskIds) {
    void streamT2iTaskWs(taskId).catch((error) => {
      if (!t2iState.isRunning) return;
      if (mode === "ws") {
        setStatus(statusNode, `WebSocket 连接失败：${error.message}`, "error");
        setStatusChip("t2iStatusText", "error", "WS 失败");
      }
    });
  }

  if (mode === "auto") {
    clearT2iFallbackTimer();
    t2iState.fallbackTimer = setTimeout(() => {
      if (!t2iState.isRunning) return;
      if (t2iState.wsOpenedCount > 0) return;
      t2iState.isFallbackSwitching = true;
      closeAllT2iStreams();
      t2iState.controllers = [];
      updateT2iCountText();
      t2iState.mode = "sse";
      setStatusChip("t2iStatusText", "connected", "SSE 回退中");
      setStatus(statusNode, "WS 不可用，已自动切换到 SSE。", "ok");
      for (const taskId of taskIds) {
        void streamT2iTaskSse(taskId);
      }
      t2iState.isFallbackSwitching = false;
    }, T2I_WS_OPEN_TIMEOUT_MS);
  }
}

async function stopTextToImage() {
  if (!t2iState.isRunning) return;
  const statusNode = byId("t2iStatus");
  const taskIds = [...t2iState.taskIds];

  t2iState.isRunning = false;
  clearT2iFallbackTimer();
  t2iState.isFallbackSwitching = false;
  closeAllT2iStreams();
  t2iState.controllers = [];
  t2iState.taskIds = [];
  setT2iButtons(false);
  setStatusChip("t2iStatusText", "", "已停止");
  setStatus(statusNode, "生图任务已停止。", "ok");
  updateT2iCountText();
  await stopT2iRemote(taskIds);
}

function clearI2iResults() {
  const resultNode = byId("i2iResult");
  if (resultNode) {
    resultNode.innerHTML = "";
  }
}

function clearI2iFileSelection() {
  i2iState.file = null;
  const input = byId("i2iImageFile");
  const name = byId("i2iImageFileName");
  if (input) input.value = "";
  if (name) name.textContent = "未选择文件";
}

async function pickI2iFileFromUrl(url) {
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) {
    throw new Error(`参考图 URL 读取失败：HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const mime = blob.type || "image/png";
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  return new File([blob], `i2i_input.${ext}`, { type: mime });
}

async function resolveI2iInputFile() {
  const url = String(byId("i2iImageUrl").value || "").trim();
  if (i2iState.file && url) {
    byId("i2iImageUrl").value = "";
    return i2iState.file;
  }
  if (i2iState.file) {
    return i2iState.file;
  }
  if (url) {
    return pickI2iFileFromUrl(url);
  }
  return null;
}

async function handleI2iFileChange() {
  const file = byId("i2iImageFile")?.files?.[0] || null;
  if (!file) {
    clearI2iFileSelection();
    return;
  }
  i2iState.file = file;
  byId("i2iImageFileName").textContent = file.name || "已选择文件";
  if (byId("i2iImageUrl").value.trim()) {
    byId("i2iImageUrl").value = "";
  }
}

async function startImageToImage() {
  const statusNode = byId("i2iStatus");
  const resultNode = byId("i2iResult");
  const startBtn = byId("i2iStartBtn");
  const model = byId("i2iModel").value.trim() || "grok-imagine-1.0-edit";
  const prompt = byId("i2iPrompt").value.trim();
  const size = byId("i2iSize")?.value || "1024x1024";
  const count = Math.max(1, Math.min(10, Number(byId("i2iCount")?.value || "1")));
  const responseFormat = byId("i2iResponseFormat")?.value || "url";

  let file = null;
  try {
    file = await resolveI2iInputFile();
  } catch (error) {
    setStatus(statusNode, error.message, "error");
    setStatusChip("i2iStatusText", "error", "读取失败");
    return;
  }

  if (!file) {
    setStatus(statusNode, "请先上传参考图或填写参考图 URL。", "error");
    setStatusChip("i2iStatusText", "error", "参数错误");
    return;
  }
  if (!prompt) {
    setStatus(statusNode, "请填写提示词。", "error");
    setStatusChip("i2iStatusText", "error", "参数错误");
    return;
  }

  startBtn.disabled = true;
  setStatusChip("i2iStatusText", "connecting", "处理中");
  setStatus(statusNode, "图生图请求发送中...");
  resultNode.innerHTML = "";

  try {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    form.append("size", size);
    form.append("n", String(count));
    form.append("response_format", responseFormat);
    form.append("image", file, file.name || "image.png");

    const payload = await requestApi("/v1/images/edits", {
      method: "POST",
      headers: buildHeaders(false),
      body: form,
    });
    const list = payload?.data || [];
    renderImages(resultNode, list);

    const saved = await saveImageRecords(list, {
      taskType: "i2i",
      model,
      prompt,
    });
    if (saved > 0) {
      setStatus(statusNode, `图生图完成，已入库 ${saved} 张。`, "ok");
      await loadGallery(false);
    } else {
      setStatus(statusNode, "图生图完成。", "ok");
    }
    setStatusChip("i2iStatusText", "connected", "完成");
  } catch (error) {
    setStatus(statusNode, `图生图失败：${error.message}`, "error");
    setStatusChip("i2iStatusText", "error", "失败");
  } finally {
    startBtn.disabled = false;
  }
}

async function createVideoTask() {
  const model = byId("i2vModel").value.trim() || "grok-imagine-1.0-video";
  const prompt = byId("i2vPrompt").value.trim();
  const ratio = byId("i2vRatio").value;
  const videoLength = Number(byId("i2vLength").value || "6");
  const resolution = byId("i2vResolution").value;
  const preset = byId("i2vPreset").value;
  const imageUrlInput = String(byId("i2vImageUrl").value || "").trim();
  const imageUrl = videoState.fileDataUrl || imageUrlInput || null;

  if (videoState.fileDataUrl && imageUrlInput) {
    throw new Error("参考图只能二选一：URL/Data URL 或本地上传");
  }

  const payload = await requestApi("/v1/public/video/start", {
    method: "POST",
    headers: buildHeaders(true),
    body: JSON.stringify({
      model,
      prompt,
      image_url: imageUrl,
      reasoning_effort: VIDEO_REASONING_EFFORT,
      aspect_ratio: ratio,
      video_length: videoLength,
      resolution_name: resolution,
      preset,
    }),
  });

  const taskId = String(payload?.task_id || "").trim();
  if (!taskId) {
    throw new Error("创建任务成功，但未返回 task_id");
  }
  return taskId;
}

async function streamVideoTask(taskId) {
  const url = buildAbsoluteApiUrl("/v1/public/video/sse", { task_id: taskId, t: Date.now() });
  const headers = buildHeaders(false);
  headers.Accept = "text/event-stream";

  const controller = new AbortController();
  videoState.sourceController = controller;
  const response = await fetch(url, {
    method: "GET",
    headers,
    signal: controller.signal,
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = await parseResponsePayload(response);
    throw new Error(extractErrorMessage(payload, `HTTP ${response.status}`));
  }

  await consumeSseStream(response, (data) => {
    if (!videoState.isRunning) return;
    if (data === "[DONE]") {
      finishVideoRun(false);
      return;
    }

    let payload = null;
    try {
      payload = JSON.parse(data);
    } catch (_) {
      return;
    }

    if (payload?.error) {
      setStatus(byId("i2vStatus"), `图转视频失败：${extractErrorMessage(payload, "流式任务失败")}`, "error");
      setVideoStatusChip("error", "生成失败");
      finishVideoRun(true);
      return;
    }

    const delta = payload?.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta) {
      handleVideoDelta(delta);
    }

    const finishReason = payload?.choices?.[0]?.finish_reason;
    if (finishReason === "stop") {
      finishVideoRun(false);
    }
  });
}

async function stopVideoTaskRemote(taskId) {
  if (!taskId) return;
  try {
    await requestApi("/v1/public/video/stop", {
      method: "POST",
      headers: buildHeaders(true),
      body: JSON.stringify({ task_ids: [taskId] }),
    });
  } catch (_) {
    // ignore remote stop error
  }
}

function finishVideoRun(hasError = false) {
  if (!videoState.isRunning) return;
  videoState.isRunning = false;

  if (videoState.sourceController) {
    videoState.sourceController.abort();
    videoState.sourceController = null;
  }

  stopVideoElapsedTimer();
  setVideoButtons(false);
  setVideoIndeterminate(false);

  if (!hasError) {
    setVideoStatusChip("connected", "完成");
    updateVideoProgress(100);
    setStatus(byId("i2vStatus"), "图转视频完成。", "ok");
  }

  const durationNode = byId("i2vDuration");
  if (durationNode && videoState.startAt) {
    const seconds = Math.max(0, Math.round((Date.now() - videoState.startAt) / 1000));
    durationNode.textContent = `耗时 ${seconds}s`;
  }

  videoState.currentTaskId = "";
}

async function runImageToVideoLegacy() {
  const statusNode = byId("i2vStatus");
  const prompt = byId("i2vPrompt").value.trim();
  const ratio = byId("i2vRatio").value;
  const videoLength = Number(byId("i2vLength").value || "6");
  const resolution = byId("i2vResolution").value;
  const preset = byId("i2vPreset").value;
  const model = byId("i2vModel").value.trim() || "grok-imagine-1.0-video";
  const imageUrlInput = String(byId("i2vImageUrl").value || "").trim();
  const imageUrl = videoState.fileDataUrl || imageUrlInput || "";

  if (!prompt) {
    setStatus(statusNode, "请填写提示词。", "error");
    return;
  }

  try {
    setStatus(statusNode, "当前 API 不支持 /v1/public/video/start，已切换兼容模式...", "ok");
    setVideoStatusChip("connecting", "兼容模式");
    setVideoButtons(true);
    videoState.isRunning = true;
    videoState.startAt = Date.now();
    startVideoElapsedTimer();
    updateVideoMeta();
    resetVideoOutput(true);
    initVideoPreviewSlot();

    const contentBlocks = [{ type: "text", text: prompt }];
    if (imageUrl) {
      contentBlocks.push({ type: "image_url", image_url: { url: imageUrl } });
    }

    const payload = await requestApi("/v1/chat/completions", {
      method: "POST",
      headers: buildHeaders(true),
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: "user", content: contentBlocks }],
        video_config: {
          aspect_ratio: ratio,
          video_length: videoLength,
          resolution_name: resolution,
          preset,
        },
      }),
    });

    renderVideoCompatPayload(payload);
    finishVideoRun(false);
  } catch (error) {
    setVideoStatusChip("error", "生成失败");
    setStatus(statusNode, `图转视频失败：${error.message}`, "error");
    finishVideoRun(true);
  }
}

async function startImageToVideo() {
  const statusNode = byId("i2vStatus");
  const prompt = byId("i2vPrompt").value.trim();
  if (!prompt) {
    setStatus(statusNode, "请填写提示词。", "error");
    return;
  }

  if (videoState.isRunning) {
    setStatus(statusNode, "任务正在运行中。", "error");
    return;
  }

  videoState.isRunning = true;
  videoState.startAt = 0;
  setVideoButtons(true);
  updateVideoMeta();
  resetVideoOutput(true);
  initVideoPreviewSlot();
  setVideoStatusChip("connecting", "连接中");
  setStatus(statusNode, "正在创建任务...");

  let taskId = "";
  try {
    taskId = await createVideoTask();
  } catch (error) {
    const message = String(error?.message || "");
    const maybeUnsupported = /404|401|403|not\s*found|unsupported|route|invalid_api_key|authentication/i.test(
      message.toLowerCase()
    );

    videoState.isRunning = false;
    setVideoButtons(false);
    setVideoIndeterminate(false);

    if (maybeUnsupported) {
      await runImageToVideoLegacy();
      return;
    }

    setVideoStatusChip("error", "创建失败");
    setStatus(statusNode, `创建任务失败：${message}`, "error");
    return;
  }

  videoState.currentTaskId = taskId;
  videoState.startAt = Date.now();
  setVideoStatusChip("connected", "生成中");
  setVideoIndeterminate(true);
  startVideoElapsedTimer();
  setStatus(statusNode, "任务已创建，开始生成...");

  try {
    await streamVideoTask(taskId);
    if (videoState.isRunning) {
      finishVideoRun(false);
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      return;
    }
    setVideoStatusChip("error", "连接错误");
    setStatus(statusNode, `图转视频失败：${error.message}`, "error");
    finishVideoRun(true);
  } finally {
    videoState.sourceController = null;
  }
}

async function stopImageToVideo() {
  if (!videoState.isRunning) return;
  const statusNode = byId("i2vStatus");
  const taskId = videoState.currentTaskId;

  videoState.isRunning = false;
  if (videoState.sourceController) {
    videoState.sourceController.abort();
    videoState.sourceController = null;
  }
  stopVideoElapsedTimer();
  setVideoButtons(false);
  setVideoIndeterminate(false);
  setVideoStatusChip("", "已停止");
  setStatus(statusNode, "任务已停止。", "ok");

  videoState.currentTaskId = "";
  await stopVideoTaskRemote(taskId);
}

async function handleVideoFileChange() {
  const input = byId("i2vImageFile");
  const file = input?.files?.[0];
  if (!file) {
    clearVideoFileSelection();
    return;
  }
  if (byId("i2vImageUrl").value.trim()) {
    byId("i2vImageUrl").value = "";
  }
  byId("i2vImageFileName").textContent = file.name;
  try {
    const dataUrl = await readAsDataUrl(file);
    videoState.fileDataUrl = String(dataUrl || "");
  } catch (error) {
    videoState.fileDataUrl = "";
    setStatus(byId("i2vStatus"), `文件读取失败：${error.message}`, "error");
  }
}

async function downloadVideoFromButton(button) {
  const item = button?.closest(".video-item");
  const url = item?.dataset?.url || button?.dataset?.url || "";
  const index = item?.dataset?.index || "";
  if (!url) return;

  try {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = index ? `grok_video_${index}.mp4` : "grok_video.mp4";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);
  } catch (error) {
    setStatus(byId("i2vStatus"), `下载失败：${error.message}`, "error");
  }
}

function initSettings() {
  const settings = getSettings();
  byId("apiUrl").value = settings.apiUrl;
  byId("apiKey").value = settings.apiKey;
}

function bindEvents() {
  const saveBtn = byId("saveSettingsBtn");
  const testBtn = byId("testSettingsBtn");
  const t2iStartBtn = byId("t2iStartBtn");
  const t2iStopBtn = byId("t2iStopBtn");
  const t2iClearBtn = byId("t2iClearBtn");
  const t2iDownloadAllBtn = byId("t2iDownloadAllBtn");
  const t2iPromptInput = byId("t2iPrompt");
  const t2iModeSelect = byId("t2iMode");
  const t2iFinalMinBytesInput = byId("t2iFinalMinBytes");

  const i2iStartBtn = byId("i2iStartBtn");
  const i2iClearBtn = byId("i2iClearBtn");
  const i2iSelectBtn = byId("i2iSelectImageBtn");
  const i2iClearImageBtn = byId("i2iClearImageBtn");
  const i2iFileInput = byId("i2iImageFile");
  const i2iUrlInput = byId("i2iImageUrl");
  const i2iPromptInput = byId("i2iPrompt");

  const galleryBtn = byId("galleryRefreshBtn");

  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      setSettings(byId("apiUrl").value, byId("apiKey").value);
      setStatus(byId("settingsStatus"), "配置已保存。", "ok");
    });
  }
  if (testBtn) testBtn.addEventListener("click", testConnection);
  if (t2iStartBtn) t2iStartBtn.addEventListener("click", startTextToImage);
  if (t2iStopBtn) t2iStopBtn.addEventListener("click", stopTextToImage);
  if (t2iClearBtn) {
    t2iClearBtn.addEventListener("click", () => {
      clearT2iResults();
      setStatus(byId("t2iStatus"), "已清空生图结果。", "ok");
      setStatusChip("t2iStatusText", "", "未连接");
    });
  }
  if (t2iDownloadAllBtn) {
    t2iDownloadAllBtn.addEventListener("click", () => {
      void downloadAllT2iImages();
    });
  }
  if (t2iModeSelect) {
    t2iModeSelect.addEventListener("change", () => {
      t2iState.mode = String(t2iModeSelect.value || "auto").toLowerCase();
      updateT2iCountText();
    });
  }
  if (t2iFinalMinBytesInput) {
    t2iFinalMinBytesInput.addEventListener("change", () => {
      const safe = Math.max(0, Number(t2iFinalMinBytesInput.value || t2iState.finalMinBytes || 0));
      t2iState.finalMinBytes = safe;
      t2iFinalMinBytesInput.value = String(safe);
    });
  }
  if (t2iPromptInput) {
    t2iPromptInput.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        startTextToImage();
      }
    });
  }

  if (i2iStartBtn) i2iStartBtn.addEventListener("click", startImageToImage);
  if (i2iClearBtn) {
    i2iClearBtn.addEventListener("click", () => {
      clearI2iResults();
      setStatus(byId("i2iStatus"), "已清空图生图结果。", "ok");
      setStatusChip("i2iStatusText", "", "未开始");
    });
  }
  if (i2iSelectBtn && i2iFileInput) {
    i2iSelectBtn.addEventListener("click", () => i2iFileInput.click());
  }
  if (i2iClearImageBtn) {
    i2iClearImageBtn.addEventListener("click", () => {
      clearI2iFileSelection();
      setStatus(byId("i2iStatus"), "已清除参考图。", "ok");
    });
  }
  if (i2iFileInput) {
    i2iFileInput.addEventListener("change", () => {
      handleI2iFileChange();
    });
  }
  if (i2iUrlInput) {
    i2iUrlInput.addEventListener("input", () => {
      if (i2iUrlInput.value.trim() && i2iState.file) {
        clearI2iFileSelection();
      }
    });
  }
  if (i2iPromptInput) {
    i2iPromptInput.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        startImageToImage();
      }
    });
  }

  if (galleryBtn) galleryBtn.addEventListener("click", () => loadGallery(true));

  const videoStartBtn = byId("i2vStartBtn");
  const videoStopBtn = byId("i2vStopBtn");
  const videoClearBtn = byId("i2vClearBtn");
  const videoSelectBtn = byId("i2vSelectImageBtn");
  const videoClearImageBtn = byId("i2vClearImageBtn");
  const videoFileInput = byId("i2vImageFile");
  const videoUrlInput = byId("i2vImageUrl");
  const videoPromptInput = byId("i2vPrompt");
  const videoStage = byId("i2vStage");

  if (videoStartBtn) videoStartBtn.addEventListener("click", startImageToVideo);
  if (videoStopBtn) videoStopBtn.addEventListener("click", stopImageToVideo);
  if (videoClearBtn) {
    videoClearBtn.addEventListener("click", () => {
      resetVideoOutput(false);
      setStatus(byId("i2vStatus"), "已清空视频预览。", "ok");
    });
  }

  if (videoSelectBtn && videoFileInput) {
    videoSelectBtn.addEventListener("click", () => videoFileInput.click());
  }
  if (videoClearImageBtn) {
    videoClearImageBtn.addEventListener("click", () => {
      clearVideoFileSelection();
      setStatus(byId("i2vStatus"), "已清除上传参考图。", "ok");
    });
  }
  if (videoFileInput) {
    videoFileInput.addEventListener("change", () => {
      handleVideoFileChange();
    });
  }
  if (videoUrlInput) {
    videoUrlInput.addEventListener("input", () => {
      if (videoUrlInput.value.trim() && videoState.fileDataUrl) {
        clearVideoFileSelection();
      }
    });
  }
  if (videoPromptInput) {
    videoPromptInput.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        startImageToVideo();
      }
    });
  }
  if (videoStage) {
    videoStage.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.classList.contains("video-download")) return;
      event.preventDefault();
      downloadVideoFromButton(target);
    });
  }

  const videoMetaInputs = ["i2vRatio", "i2vLength", "i2vResolution", "i2vPreset"];
  for (const id of videoMetaInputs) {
    const node = byId(id);
    if (node) node.addEventListener("change", updateVideoMeta);
  }
}

function boot() {
  setupTabs();
  initSettings();

  resetT2iState();
  t2iState.mode = String(byId("t2iMode")?.value || "auto").toLowerCase();
  setT2iButtons(false);
  setStatusChip("t2iStatusText", "", "未连接");
  updateT2iLatencyText();

  clearI2iFileSelection();
  setStatusChip("i2iStatusText", "", "未开始");

  updateVideoMeta();
  setVideoButtons(false);
  setVideoStatusChip("", "未连接");

  bindEvents();
  if (normalizeBaseUrl(byId("apiUrl")?.value)) {
    void loadT2iDefaults();
  }
  loadGallery(true);
}

boot();
