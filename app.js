const STORAGE_KEY = "grok_media_studio_settings_v2";
const GALLERY_SAVE_BATCH = 20;

const RATIO_TO_SIZE = {
  "2:3": "1024x1792",
  "1:1": "1024x1024",
  "3:2": "1792x1024",
  "16:9": "1280x720",
  "9:16": "720x1280",
};

const t2iState = {
  isRunning: false,
  controllers: new Set(),
  imageCount: 0,
  totalLatency: 0,
  latencyCount: 0,
  sequence: 0,
};

const i2iState = {
  file: null,
};

const i2vState = {
  isRunning: false,
  controller: null,
  startAt: 0,
  elapsedTimer: null,
  fileDataUrl: "",
  previewCount: 0,
  currentPreviewItem: null,
};

function byId(id) {
  return document.getElementById(id);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  return String(input || "").trim().replace(/\/+$/, "");
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
  if (state) node.classList.add(state);
}

function getApiKey() {
  return String(byId("apiKey")?.value || "").trim();
}

function buildAuthHeaders() {
  const headers = {};
  const apiKey = getApiKey();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
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

function extractErrorMessage(payload, fallback = "请求失败") {
  if (!payload) return fallback;
  if (typeof payload === "string") return payload;
  return payload?.error?.message || payload?.message || payload?.detail || payload?.raw || fallback;
}

async function requestOpenApi(path, { method = "GET", json = null, form = null, signal = null } = {}) {
  const baseUrl = normalizeBaseUrl(byId("apiUrl")?.value);
  if (!baseUrl) {
    throw new Error("请先填写 API URL");
  }

  const url = `${baseUrl}${path}`;
  const headers = { ...buildAuthHeaders() };
  const init = { method, headers, signal };

  if (form) {
    init.body = form;
  } else if (json !== null) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(json);
  }

  const response = await fetch(url, init);
  const payload = await parseResponsePayload(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload, `HTTP ${response.status}`));
  }
  return payload;
}

async function requestStudioApi(path, { method = "GET", json = null } = {}) {
  const init = { method, headers: {} };
  if (json !== null) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(json);
  }
  const response = await fetch(path, init);
  const payload = await parseResponsePayload(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload, `HTTP ${response.status}`));
  }
  return payload;
}

function inferMimeByBase64(base64) {
  const raw = String(base64 || "");
  if (raw.startsWith("iVBOR")) return "image/png";
  if (raw.startsWith("R0lGOD")) return "image/gif";
  if (raw.startsWith("/9j/")) return "image/jpeg";
  return "image/jpeg";
}

function estimateBase64Bytes(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value) || value.startsWith("/")) return null;

  let base64 = value;
  if (value.startsWith("data:")) {
    const comma = value.indexOf(",");
    base64 = comma >= 0 ? value.slice(comma + 1) : "";
  }
  base64 = base64.replace(/\s/g, "");
  if (!base64) return 0;

  let padding = 0;
  if (base64.endsWith("==")) padding = 2;
  else if (base64.endsWith("=")) padding = 1;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function normalizeImageItem(item) {
  if (!item) return null;
  if (item.url) {
    return {
      src: String(item.url),
      record: { url: String(item.url) },
      bytes: null,
    };
  }
  if (item.b64_json) {
    const b64 = String(item.b64_json);
    const mime = inferMimeByBase64(b64);
    return {
      src: `data:${mime};base64,${b64}`,
      record: { b64_json: b64 },
      bytes: estimateBase64Bytes(b64),
    };
  }
  if (item.base64) {
    const b64 = String(item.base64);
    const mime = inferMimeByBase64(b64);
    return {
      src: `data:${mime};base64,${b64}`,
      record: { b64_json: b64 },
      bytes: estimateBase64Bytes(b64),
    };
  }
  return null;
}

async function downloadFromSrc(src, filename) {
  const safeSrc = String(src || "").trim();
  if (!safeSrc) return;

  const link = document.createElement("a");
  link.style.display = "none";
  if (safeSrc.startsWith("data:")) {
    link.href = safeSrc;
  } else {
    const res = await fetch(safeSrc, { mode: "cors" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const blob = await res.blob();
    link.href = URL.createObjectURL(blob);
  }

  link.download = filename || `media_${Date.now()}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  if (link.href.startsWith("blob:")) {
    URL.revokeObjectURL(link.href);
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
      byId(`tab-${key}`)?.classList.add("active");
    });
  });
}

function initSettings() {
  const { apiUrl, apiKey } = getSettings();
  byId("apiUrl").value = apiUrl;
  byId("apiKey").value = apiKey;
}

async function testConnection() {
  const statusNode = byId("settingsStatus");
  setStatus(statusNode, "连接测试中...");
  try {
    const payload = await requestOpenApi("/v1/models", { method: "GET" });
    const count = Array.isArray(payload?.data) ? payload.data.length : 0;
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

function updateT2iStats() {
  const countNode = byId("t2iCountValue");
  const activeNode = byId("t2iActiveValue");
  const latencyNode = byId("t2iLatencyValue");
  if (countNode) countNode.textContent = `图片 ${t2iState.imageCount}`;
  if (activeNode) activeNode.textContent = `活跃任务 ${t2iState.controllers.size}`;

  if (latencyNode) {
    if (t2iState.latencyCount > 0) {
      const avg = Math.round(t2iState.totalLatency / t2iState.latencyCount);
      latencyNode.textContent = `平均耗时 ${avg}ms`;
    } else {
      latencyNode.textContent = "平均耗时 -";
    }
  }
}

function resetT2iStats() {
  t2iState.imageCount = 0;
  t2iState.totalLatency = 0;
  t2iState.latencyCount = 0;
  t2iState.sequence = 0;
  updateT2iStats();
}

function clearT2iResults() {
  const container = byId("t2iResult");
  if (container) container.innerHTML = "";
  byId("t2iEmpty")?.classList.remove("hidden");
  resetT2iStats();
}

function shouldFilterT2i(normalized) {
  if (!byId("t2iAutoFilter")?.checked) return false;
  const minBytes = Math.max(0, Number(byId("t2iFinalMinBytes")?.value || "0"));
  if (normalized.bytes === null) return false;
  return normalized.bytes < minBytes;
}

function appendT2iImage(item, elapsedMs) {
  const normalized = normalizeImageItem(item);
  if (!normalized) return null;
  if (shouldFilterT2i(normalized)) return null;

  const container = byId("t2iResult");
  if (!container) return null;

  const seq = ++t2iState.sequence;
  const card = document.createElement("div");
  card.className = "result-card";
  card.dataset.source = normalized.src;
  card.dataset.seq = String(seq);

  const img = document.createElement("img");
  img.src = normalized.src;
  img.alt = `image-${seq}`;
  card.appendChild(img);

  if (item?.url) {
    const link = document.createElement("a");
    link.href = String(item.url);
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = String(item.url);
    card.appendChild(link);
  }

  const meta = document.createElement("div");
  meta.className = "image-meta";

  const left = document.createElement("span");
  left.textContent = `#${seq}`;

  const right = document.createElement("span");
  right.className = "image-status";
  right.textContent = Number.isFinite(elapsedMs) ? `完成 · ${Math.round(elapsedMs)}ms` : "完成";

  meta.appendChild(left);
  meta.appendChild(right);
  card.appendChild(meta);

  if (byId("t2iReverseInsert")?.checked) {
    container.prepend(card);
  } else {
    container.appendChild(card);
  }

  const empty = byId("t2iEmpty");
  if (empty) empty.classList.add("hidden");

  t2iState.imageCount += 1;
  updateT2iStats();

  if (byId("t2iAutoScroll")?.checked) {
    if (byId("t2iReverseInsert")?.checked) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    }
  }

  return { seq, src: normalized.src };
}

async function saveImageRecords(dataList = [], meta = {}) {
  const items = [];
  for (const item of dataList) {
    const normalized = normalizeImageItem(item);
    if (!normalized) continue;
    items.push({
      media_type: "image",
      task_type: meta.taskType || "image",
      model: meta.model || "",
      prompt: meta.prompt || "",
      source_url: normalized.src,
    });
  }
  if (items.length === 0) return;

  for (let i = 0; i < items.length; i += GALLERY_SAVE_BATCH) {
    const slice = items.slice(i, i + GALLERY_SAVE_BATCH);
    try {
      await requestStudioApi("/api/media/batch", {
        method: "POST",
        json: { items: slice },
      });
    } catch (_) {
      // 忽略作品库写入失败，不影响主流程
    }
  }
}

async function runT2iWorker(workerId) {
  while (t2iState.isRunning) {
    const prompt = String(byId("t2iPrompt")?.value || "").trim();
    const model = String(byId("t2iModel")?.value || "").trim() || "grok-imagine-1.0";
    const ratio = String(byId("t2iRatio")?.value || "1:1");
    const size = RATIO_TO_SIZE[ratio] || "1024x1024";
    const responseFormat = String(byId("t2iResponseFormat")?.value || "url");

    const controller = new AbortController();
    t2iState.controllers.add(controller);
    updateT2iStats();

    const startAt = performance.now();
    try {
      const payload = await requestOpenApi("/v1/images/generations", {
        method: "POST",
        json: {
          model,
          prompt,
          n: 1,
          size,
          response_format: responseFormat,
        },
        signal: controller.signal,
      });

      const elapsed = performance.now() - startAt;
      const list = Array.isArray(payload?.data) ? payload.data : [];
      const saved = [];
      for (const item of list) {
        const rendered = appendT2iImage(item, elapsed);
        if (rendered) {
          saved.push(item);
          if (byId("t2iAutoDownload")?.checked) {
            const filename = `imagine_${rendered.seq}_${Date.now()}.png`;
            void downloadFromSrc(rendered.src, filename).catch(() => {
              setStatus(byId("t2iStatus"), "自动下载失败，可能是跨域限制。", "error");
            });
          }
        }
      }

      t2iState.totalLatency += elapsed;
      t2iState.latencyCount += 1;
      updateT2iStats();

      if (saved.length > 0) {
        void saveImageRecords(saved, {
          taskType: "t2i",
          model,
          prompt,
        });
      }
      if (t2iState.isRunning) {
        setStatus(byId("t2iStatus"), `任务 ${workerId + 1} 运行中...`, "ok");
      }
    } catch (error) {
      if (error?.name !== "AbortError" && t2iState.isRunning) {
        setStatus(byId("t2iStatus"), `任务 ${workerId + 1} 失败：${error.message}`, "error");
        setStatusChip("t2iStatusText", "error", "请求异常");
        await sleep(600);
      }
    } finally {
      t2iState.controllers.delete(controller);
      updateT2iStats();
    }

    if (!t2iState.isRunning) break;
    await sleep(120);
  }
}

async function startTextToImage() {
  const prompt = String(byId("t2iPrompt")?.value || "").trim();
  if (!prompt) {
    setStatus(byId("t2iStatus"), "请填写提示词。", "error");
    setStatusChip("t2iStatusText", "error", "参数错误");
    return;
  }
  if (t2iState.isRunning) {
    setStatus(byId("t2iStatus"), "任务正在运行中。", "error");
    return;
  }

  clearT2iResults();
  t2iState.isRunning = true;
  setT2iButtons(true);
  setStatusChip("t2iStatusText", "connected", "Open 持续生成中");
  setStatus(byId("t2iStatus"), "已启动生成任务。", "ok");

  const concurrent = Math.max(1, Math.min(3, Number(byId("t2iConcurrent")?.value || "1")));
  for (let i = 0; i < concurrent; i += 1) {
    void runT2iWorker(i);
  }
}

async function stopTextToImage() {
  if (!t2iState.isRunning) return;
  t2iState.isRunning = false;
  for (const controller of t2iState.controllers) {
    try {
      controller.abort();
    } catch (_) {
      // ignore
    }
  }
  t2iState.controllers.clear();
  updateT2iStats();
  setT2iButtons(false);
  setStatusChip("t2iStatusText", "", "已停止");
  setStatus(byId("t2iStatus"), "生成任务已停止。", "ok");
}

async function downloadAllT2iImages() {
  const cards = Array.from(byId("t2iResult")?.querySelectorAll(".result-card") || []);
  if (cards.length === 0) {
    setStatus(byId("t2iStatus"), "没有可下载图片。", "error");
    return;
  }

  let success = 0;
  for (const card of cards) {
    const src = String(card.dataset.source || "").trim();
    if (!src) continue;
    const seq = card.dataset.seq || "image";
    try {
      await downloadFromSrc(src, `imagine_${seq}_${Date.now()}.png`);
      success += 1;
    } catch (_) {
      // ignore single failure
    }
    await sleep(80);
  }
  setStatus(byId("t2iStatus"), `已触发下载 ${success} 张。`, "ok");
}
function clearI2iFileSelection() {
  i2iState.file = null;
  const input = byId("i2iImageFile");
  const label = byId("i2iImageFileName");
  if (input) input.value = "";
  if (label) label.textContent = "未选择文件";
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
  const url = String(byId("i2iImageUrl")?.value || "").trim();
  if (i2iState.file) return i2iState.file;
  if (url) return pickI2iFileFromUrl(url);
  return null;
}

function renderImageList(target, list = []) {
  if (!target) return;
  target.innerHTML = "";
  if (!Array.isArray(list) || list.length === 0) {
    target.innerHTML = '<div class="empty">未返回图片结果。</div>';
    return;
  }

  for (const item of list) {
    const normalized = normalizeImageItem(item);
    if (!normalized) continue;

    const card = document.createElement("div");
    card.className = "result-card";

    const image = document.createElement("img");
    image.src = normalized.src;
    image.alt = "result";
    card.appendChild(image);

    if (item?.url) {
      const link = document.createElement("a");
      link.href = String(item.url);
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = String(item.url);
      card.appendChild(link);
    }

    target.appendChild(card);
  }
}

async function startImageToImage() {
  const statusNode = byId("i2iStatus");
  const resultNode = byId("i2iResult");
  const startBtn = byId("i2iStartBtn");

  const model = String(byId("i2iModel")?.value || "").trim() || "grok-imagine-1.0-edit";
  const prompt = String(byId("i2iPrompt")?.value || "").trim();
  const size = String(byId("i2iSize")?.value || "1024x1024");
  const count = Math.max(1, Math.min(10, Number(byId("i2iCount")?.value || "1")));
  const responseFormat = String(byId("i2iResponseFormat")?.value || "url");

  if (!prompt) {
    setStatus(statusNode, "请填写提示词。", "error");
    setStatusChip("i2iStatusText", "error", "参数错误");
    return;
  }

  let file = null;
  try {
    file = await resolveI2iInputFile();
  } catch (error) {
    setStatus(statusNode, error.message, "error");
    setStatusChip("i2iStatusText", "error", "读取失败");
    return;
  }

  if (!file) {
    setStatus(statusNode, "请先上传参考图或填写可访问 URL。", "error");
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

    const payload = await requestOpenApi("/v1/images/edits", {
      method: "POST",
      form,
    });

    const list = Array.isArray(payload?.data) ? payload.data : [];
    renderImageList(resultNode, list);

    void saveImageRecords(list, {
      taskType: "i2i",
      model,
      prompt,
    });

    setStatus(statusNode, `图生图完成，共 ${list.length} 张。`, "ok");
    setStatusChip("i2iStatusText", "connected", "完成");
  } catch (error) {
    setStatus(statusNode, `图生图失败：${error.message}`, "error");
    setStatusChip("i2iStatusText", "error", "失败");
  } finally {
    startBtn.disabled = false;
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
  const track = byId("i2vProgressBar");
  if (!track) return;
  if (active) track.classList.add("indeterminate");
  else track.classList.remove("indeterminate");
}

function updateVideoProgress(value, text = "") {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  const fill = byId("i2vProgressFill");
  const label = byId("i2vProgressText");
  if (fill) fill.style.width = `${safe}%`;
  if (label) label.textContent = text || `${safe}%`;
}

function updateVideoMeta() {
  const ratio = byId("i2vRatio")?.value || "-";
  const length = byId("i2vLength")?.value || "-";
  const resolution = byId("i2vResolution")?.value || "-";
  const preset = byId("i2vPreset")?.value || "-";

  byId("i2vMetaAspect").textContent = ratio;
  byId("i2vMetaLength").textContent = `${length}s`;
  byId("i2vMetaResolution").textContent = resolution;
  byId("i2vMetaPreset").textContent = preset;
}

function startVideoElapsedTimer() {
  stopVideoElapsedTimer();
  const node = byId("i2vDuration");
  if (!node) return;

  i2vState.elapsedTimer = setInterval(() => {
    if (!i2vState.startAt) return;
    const seconds = Math.max(0, Math.round((Date.now() - i2vState.startAt) / 1000));
    node.textContent = `耗时 ${seconds}s`;
  }, 1000);
}

function stopVideoElapsedTimer() {
  if (i2vState.elapsedTimer) {
    clearInterval(i2vState.elapsedTimer);
    i2vState.elapsedTimer = null;
  }
}

function clearVideoFileSelection() {
  i2vState.fileDataUrl = "";
  const fileInput = byId("i2vImageFile");
  const fileName = byId("i2vImageFileName");
  if (fileInput) fileInput.value = "";
  if (fileName) fileName.textContent = "未选择文件";
}

function resetVideoOutput(clearPreview = true) {
  updateVideoProgress(0);
  setVideoIndeterminate(false);
  byId("i2vDuration").textContent = "耗时 -";

  if (!clearPreview) return;
  const stage = byId("i2vStage");
  const empty = byId("i2vEmpty");
  if (stage) {
    stage.innerHTML = "";
    stage.classList.add("hidden");
  }
  if (empty) empty.classList.remove("hidden");
  i2vState.currentPreviewItem = null;
  i2vState.previewCount = 0;
}

function ensureVideoPreviewSlot() {
  if (i2vState.currentPreviewItem) return i2vState.currentPreviewItem;

  const stage = byId("i2vStage");
  const empty = byId("i2vEmpty");
  if (!stage) return null;

  i2vState.previewCount += 1;
  const item = document.createElement("div");
  item.className = "video-item is-pending";
  item.dataset.index = String(i2vState.previewCount);

  const bar = document.createElement("div");
  bar.className = "video-item-bar";

  const title = document.createElement("div");
  title.className = "video-item-title";
  title.textContent = `视频 ${i2vState.previewCount}`;

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

  i2vState.currentPreviewItem = item;
  return item;
}

function updateVideoItemLinks(item, url) {
  if (!item) return;
  const safeUrl = String(url || "").trim();
  item.dataset.url = safeUrl;

  const openBtn = item.querySelector(".video-open");
  const downloadBtn = item.querySelector(".video-download");
  const link = item.querySelector(".video-item-link");

  if (link) {
    link.textContent = safeUrl;
    link.classList.toggle("has-url", Boolean(safeUrl));
  }

  if (openBtn) {
    if (safeUrl) {
      openBtn.href = safeUrl;
      openBtn.classList.remove("hidden");
    } else {
      openBtn.removeAttribute("href");
      openBtn.classList.add("hidden");
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
  const item = ensureVideoPreviewSlot();
  if (!item) return;

  const body = item.querySelector(".video-item-body");
  if (!body) return;

  const safeUrl = String(url || "").trim();
  body.innerHTML = "";

  const video = document.createElement("video");
  video.controls = true;
  video.preload = "metadata";
  video.src = safeUrl;
  body.appendChild(video);

  updateVideoItemLinks(item, safeUrl);
}

function renderVideoFromHtml(html) {
  const videoUrl = extractVideoUrlFromHtml(html);
  if (videoUrl) {
    renderVideoFromUrl(videoUrl);
    return;
  }

  const item = ensureVideoPreviewSlot();
  if (!item) return;

  const body = item.querySelector(".video-item-body");
  if (!body) return;

  body.innerHTML = `<div class="video-item-placeholder">${String(html || "")}</div>`;
  updateVideoItemLinks(item, "");
}

function renderVideoText(text) {
  const info = extractVideoInfo(text);
  if (info?.html) {
    renderVideoFromHtml(info.html);
    return;
  }
  if (info?.url) {
    renderVideoFromUrl(info.url);
    return;
  }

  const item = ensureVideoPreviewSlot();
  if (!item) return;

  const body = item.querySelector(".video-item-body");
  if (!body) return;

  body.innerHTML = `<div class="video-item-placeholder">${String(text || "未返回视频地址。")}</div>`;
  updateVideoItemLinks(item, "");
}
async function startImageToVideo() {
  const statusNode = byId("i2vStatus");
  const prompt = String(byId("i2vPrompt")?.value || "").trim();
  if (!prompt) {
    setStatus(statusNode, "请填写提示词。", "error");
    setStatusChip("i2vStatusText", "error", "参数错误");
    return;
  }
  if (i2vState.isRunning) {
    setStatus(statusNode, "任务正在运行中。", "error");
    return;
  }

  const model = String(byId("i2vModel")?.value || "").trim() || "grok-imagine-1.0-video";
  const ratio = String(byId("i2vRatio")?.value || "3:2");
  const videoLength = Number(byId("i2vLength")?.value || "6");
  const resolution = String(byId("i2vResolution")?.value || "480p");
  const preset = String(byId("i2vPreset")?.value || "normal");

  const inputUrl = String(byId("i2vImageUrl")?.value || "").trim();
  if (i2vState.fileDataUrl && inputUrl) {
    setStatus(statusNode, "参考图只能二选一：URL/Data URL 或上传文件。", "error");
    setStatusChip("i2vStatusText", "error", "参数错误");
    return;
  }
  const imageUrl = i2vState.fileDataUrl || inputUrl;

  i2vState.isRunning = true;
  i2vState.startAt = Date.now();
  i2vState.controller = new AbortController();

  setVideoButtons(true);
  updateVideoMeta();
  resetVideoOutput(true);
  ensureVideoPreviewSlot();
  setVideoIndeterminate(true);
  updateVideoProgress(12, "生成中...");
  startVideoElapsedTimer();
  setStatusChip("i2vStatusText", "connecting", "请求中");
  setStatus(statusNode, "正在调用 OpenAI 兼容接口...");

  const content = [{ type: "text", text: prompt }];
  if (imageUrl) {
    content.push({ type: "image_url", image_url: { url: imageUrl } });
  }

  try {
    const payload = await requestOpenApi("/v1/chat/completions", {
      method: "POST",
      signal: i2vState.controller.signal,
      json: {
        model,
        stream: false,
        messages: [{ role: "user", content }],
        video_config: {
          aspect_ratio: ratio,
          video_length: videoLength,
          resolution_name: resolution,
          preset,
        },
      },
    });

    const contentText = payload?.choices?.[0]?.message?.content;
    if (typeof contentText === "string") {
      renderVideoText(contentText);
    } else {
      renderVideoText(JSON.stringify(contentText || payload || {}, null, 2));
    }

    updateVideoProgress(100);
    setVideoIndeterminate(false);
    setStatusChip("i2vStatusText", "connected", "完成");
    setStatus(statusNode, "视频生成完成。", "ok");
  } catch (error) {
    if (error?.name === "AbortError") {
      setStatus(statusNode, "任务已停止。", "ok");
      setStatusChip("i2vStatusText", "", "已停止");
    } else {
      setStatus(statusNode, `视频生成失败：${error.message}`, "error");
      setStatusChip("i2vStatusText", "error", "失败");
    }
  } finally {
    i2vState.isRunning = false;
    i2vState.controller = null;
    setVideoButtons(false);
    setVideoIndeterminate(false);
    stopVideoElapsedTimer();

    if (i2vState.startAt) {
      const sec = Math.max(0, Math.round((Date.now() - i2vState.startAt) / 1000));
      byId("i2vDuration").textContent = `耗时 ${sec}s`;
    }
  }
}

function stopImageToVideo() {
  if (!i2vState.isRunning) return;
  try {
    i2vState.controller?.abort();
  } catch (_) {
    // ignore
  }
}

async function handleVideoFileChange() {
  const input = byId("i2vImageFile");
  const file = input?.files?.[0];
  if (!file) {
    clearVideoFileSelection();
    return;
  }

  if (String(byId("i2vImageUrl")?.value || "").trim()) {
    byId("i2vImageUrl").value = "";
  }
  byId("i2vImageFileName").textContent = file.name;

  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("文件读取失败"));
      reader.readAsDataURL(file);
    });
    i2vState.fileDataUrl = String(dataUrl || "");
  } catch (error) {
    i2vState.fileDataUrl = "";
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

function bindEvents() {
  byId("saveSettingsBtn")?.addEventListener("click", () => {
    setSettings(byId("apiUrl")?.value, byId("apiKey")?.value);
    setStatus(byId("settingsStatus"), "配置已保存。", "ok");
  });

  byId("testSettingsBtn")?.addEventListener("click", () => {
    void testConnection();
  });

  byId("t2iStartBtn")?.addEventListener("click", () => {
    void startTextToImage();
  });
  byId("t2iStopBtn")?.addEventListener("click", () => {
    void stopTextToImage();
  });
  byId("t2iClearBtn")?.addEventListener("click", () => {
    clearT2iResults();
    setStatusChip("t2iStatusText", "", "未连接");
    setStatus(byId("t2iStatus"), "已清空结果。", "ok");
  });
  byId("t2iDownloadAllBtn")?.addEventListener("click", () => {
    void downloadAllT2iImages();
  });
  byId("t2iPrompt")?.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void startTextToImage();
    }
  });

  byId("i2iStartBtn")?.addEventListener("click", () => {
    void startImageToImage();
  });
  byId("i2iClearBtn")?.addEventListener("click", () => {
    byId("i2iResult").innerHTML = "";
    setStatus(byId("i2iStatus"), "已清空结果。", "ok");
    setStatusChip("i2iStatusText", "", "未开始");
  });

  byId("i2iSelectImageBtn")?.addEventListener("click", () => {
    byId("i2iImageFile")?.click();
  });
  byId("i2iClearImageBtn")?.addEventListener("click", () => {
    clearI2iFileSelection();
    setStatus(byId("i2iStatus"), "已清除参考图。", "ok");
  });
  byId("i2iImageFile")?.addEventListener("change", () => {
    const file = byId("i2iImageFile")?.files?.[0] || null;
    if (!file) {
      clearI2iFileSelection();
      return;
    }
    i2iState.file = file;
    byId("i2iImageFileName").textContent = file.name || "已选择文件";
    if (String(byId("i2iImageUrl")?.value || "").trim()) {
      byId("i2iImageUrl").value = "";
    }
  });
  byId("i2iImageUrl")?.addEventListener("input", () => {
    if (String(byId("i2iImageUrl")?.value || "").trim() && i2iState.file) {
      clearI2iFileSelection();
    }
  });
  byId("i2iPrompt")?.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void startImageToImage();
    }
  });

  byId("i2vStartBtn")?.addEventListener("click", () => {
    void startImageToVideo();
  });
  byId("i2vStopBtn")?.addEventListener("click", () => {
    stopImageToVideo();
  });
  byId("i2vClearBtn")?.addEventListener("click", () => {
    resetVideoOutput(true);
    setStatus(byId("i2vStatus"), "已清空预览。", "ok");
  });

  byId("i2vSelectImageBtn")?.addEventListener("click", () => {
    byId("i2vImageFile")?.click();
  });
  byId("i2vClearImageBtn")?.addEventListener("click", () => {
    clearVideoFileSelection();
    setStatus(byId("i2vStatus"), "已清除上传参考图。", "ok");
  });
  byId("i2vImageFile")?.addEventListener("change", () => {
    void handleVideoFileChange();
  });
  byId("i2vImageUrl")?.addEventListener("input", () => {
    if (String(byId("i2vImageUrl")?.value || "").trim() && i2vState.fileDataUrl) {
      clearVideoFileSelection();
    }
  });
  byId("i2vPrompt")?.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void startImageToVideo();
    }
  });

  byId("i2vStage")?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.classList.contains("video-download")) return;
    event.preventDefault();
    void downloadVideoFromButton(target);
  });

  for (const id of ["i2vRatio", "i2vLength", "i2vResolution", "i2vPreset"]) {
    byId(id)?.addEventListener("change", updateVideoMeta);
  }
}

function boot() {
  setupTabs();
  initSettings();

  setT2iButtons(false);
  resetT2iStats();
  setStatusChip("t2iStatusText", "", "未连接");

  clearI2iFileSelection();
  setStatusChip("i2iStatusText", "", "未开始");

  updateVideoMeta();
  setVideoButtons(false);
  setStatusChip("i2vStatusText", "", "未连接");

  bindEvents();
}

boot();
