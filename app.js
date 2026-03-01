const STORAGE_KEY = "grok_media_studio_settings_v1";
const GALLERY_LIMIT = 200;

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

function buildHeaders(isJson = true) {
  const apiKey = String(byId("apiKey").value || "").trim();
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

function renderVideoResult(target, payload) {
  target.innerHTML = "";
  const text = payload?.choices?.[0]?.message?.content ?? "";
  const raw =
    typeof text === "string" ? text : JSON.stringify(text || payload, null, 2);

  const textBlock = document.createElement("div");
  textBlock.className = "text-block";
  textBlock.textContent = raw || "未返回内容。";
  target.appendChild(textBlock);

  const urls = new Set();
  const regex = /(https?:\/\/[^\s<>"']+)/g;
  for (const match of raw.matchAll(regex)) {
    urls.add(match[1]);
  }

  for (const url of urls) {
    const lower = url.toLowerCase();
    const item = document.createElement("div");
    item.className = "result-card";
    if (lower.includes(".mp4") || lower.includes("video")) {
      const video = document.createElement("video");
      video.controls = true;
      video.src = url;
      item.appendChild(video);
    }
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = url;
    item.appendChild(link);
    target.appendChild(item);
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
    setStatus(statusNode, `连接成功，可用模型 ${count} 个。`, "ok");
  } catch (error) {
    setStatus(statusNode, `连接失败：${error.message}`, "error");
  }
}

async function runTextToImage() {
  const statusNode = byId("t2iStatus");
  const resultNode = byId("t2iResult");
  const runBtn = byId("t2iRunBtn");
  const model = byId("t2iModel").value.trim() || "grok-imagine-1.0";
  const size = byId("t2iSize").value;
  const prompt = byId("t2iPrompt").value.trim();

  if (!prompt) {
    setStatus(statusNode, "请填写提示词。", "error");
    return;
  }

  runBtn.disabled = true;
  setStatus(statusNode, "生图请求发送中...");
  resultNode.innerHTML = "";

  try {
    const payload = await requestApi("/v1/images/generations", {
      method: "POST",
      headers: buildHeaders(true),
      body: JSON.stringify({
        model,
        prompt,
        size,
        n: 1,
        response_format: "url",
      }),
    });
    const list = payload?.data || [];
    renderImages(resultNode, list);

    const saved = await saveImageRecords(list, {
      taskType: "t2i",
      model,
      prompt,
    });
    if (saved > 0) {
      setStatus(statusNode, `生图完成，已入库 ${saved} 张。`, "ok");
      await loadGallery(false);
    } else {
      setStatus(statusNode, "生图完成。", "ok");
    }
  } catch (error) {
    setStatus(statusNode, `生图失败：${error.message}`, "error");
  } finally {
    runBtn.disabled = false;
  }
}

async function runImageToImage() {
  const statusNode = byId("i2iStatus");
  const resultNode = byId("i2iResult");
  const runBtn = byId("i2iRunBtn");
  const model = byId("i2iModel").value.trim() || "grok-imagine-1.0-edit";
  const prompt = byId("i2iPrompt").value.trim();
  const file = byId("i2iImage").files?.[0];

  if (!file) {
    setStatus(statusNode, "请先选择一张图片。", "error");
    return;
  }
  if (!prompt) {
    setStatus(statusNode, "请填写提示词。", "error");
    return;
  }

  runBtn.disabled = true;
  setStatus(statusNode, "图生图请求发送中...");
  resultNode.innerHTML = "";

  try {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    form.append("response_format", "url");
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
  } catch (error) {
    setStatus(statusNode, `图生图失败：${error.message}`, "error");
  } finally {
    runBtn.disabled = false;
  }
}

async function runImageToVideo() {
  const statusNode = byId("i2vStatus");
  const resultNode = byId("i2vResult");
  const runBtn = byId("i2vRunBtn");
  const model = byId("i2vModel").value.trim() || "grok-imagine-1.0-video";
  const prompt = byId("i2vPrompt").value.trim();
  const ratio = byId("i2vRatio").value;
  const videoLength = Number(byId("i2vLength").value || "6");
  const resolution = byId("i2vResolution").value;
  const file = byId("i2vImage").files?.[0];

  if (!prompt && !file) {
    setStatus(statusNode, "请至少填写提示词或上传参考图。", "error");
    return;
  }

  runBtn.disabled = true;
  setStatus(statusNode, "图转视频请求发送中...");
  resultNode.innerHTML = "";

  try {
    const contentBlocks = [];
    if (prompt) {
      contentBlocks.push({ type: "text", text: prompt });
    }
    if (file) {
      const dataUrl = await readAsDataUrl(file);
      contentBlocks.push({ type: "image_url", image_url: { url: dataUrl } });
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
          preset: "custom",
        },
      }),
    });
    setStatus(statusNode, "图转视频完成。", "ok");
    renderVideoResult(resultNode, payload);
  } catch (error) {
    setStatus(statusNode, `图转视频失败：${error.message}`, "error");
  } finally {
    runBtn.disabled = false;
  }
}

function initSettings() {
  const settings = getSettings();
  byId("apiUrl").value = settings.apiUrl;
  byId("apiKey").value = settings.apiKey;
}

function bindEvents() {
  byId("saveSettingsBtn").addEventListener("click", () => {
    setSettings(byId("apiUrl").value, byId("apiKey").value);
    setStatus(byId("settingsStatus"), "配置已保存。", "ok");
  });
  byId("testSettingsBtn").addEventListener("click", testConnection);
  byId("t2iRunBtn").addEventListener("click", runTextToImage);
  byId("i2iRunBtn").addEventListener("click", runImageToImage);
  byId("i2vRunBtn").addEventListener("click", runImageToVideo);
  byId("galleryRefreshBtn").addEventListener("click", () => loadGallery(true));
}

function boot() {
  setupTabs();
  initSettings();
  bindEvents();
  loadGallery(true);
}

boot();
