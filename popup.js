const statusNode = document.getElementById("status");
const includeCommentsNode = document.getElementById("include-comments");
const monitorStatusNode = document.getElementById("monitor-status");
const monitorToggleNode = document.getElementById("monitor-toggle");
const openMonitorNode = document.getElementById("open-monitor");
const autoTranscribeNode = document.getElementById("auto-transcribe");
const transcriptionNoteNode = document.getElementById("transcription-note");
const collectorNameNode = document.getElementById("collector-name");
const saveCollectorNode = document.getElementById("save-collector");
const collectorNoteNode = document.getElementById("collector-note");
const manualTranscribeNode = document.getElementById("manual-transcribe");
let monitorEnabled = false;
let monitorReady = false;
let monitorBusy = false;
let collectorReady = false;
let collectorSaving = false;
let collectionBusy = false;
let transcriptionReady = false;
let transcriptionSaving = false;
const collectionButtons = ["sync", "export", "works", "single-work", "works-filter"]
  .map((id) => document.getElementById(id));
collectorNameNode.disabled = true;
saveCollectorNode.disabled = true;
openMonitorNode.disabled = true;

void refreshMonitorPanel();
void refreshTranscriptionOption();
void refreshCollectorName();

saveCollectorNode.addEventListener("click", saveCollectorName);
collectorNameNode.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  void saveCollectorName();
});

autoTranscribeNode.addEventListener("change", async () => {
  if (!transcriptionReady || transcriptionSaving) return;
  transcriptionSaving = true;
  const previous = !autoTranscribeNode.checked;
  autoTranscribeNode.disabled = true;
  try {
    const response = await sendRuntimeMessage({
      type: "douhot:setTranscriptionEnabled",
      payload: { enabled: autoTranscribeNode.checked },
    });
    const data = response.data || {};
    autoTranscribeNode.checked = data.enabled === true;
    renderTranscriptionNote(data);
  } catch (error) {
    autoTranscribeNode.checked = previous;
    transcriptionNoteNode.textContent = error.message;
    transcriptionNoteNode.classList.add("error");
  } finally {
    transcriptionSaving = false;
    autoTranscribeNode.disabled = false;
  }
});

monitorToggleNode.addEventListener("click", async () => {
  if (!monitorReady || monitorBusy) return;
  monitorBusy = true;
  openMonitorNode.disabled = true;
  const nextEnabled = !monitorEnabled;
  monitorToggleNode.disabled = true;
  monitorToggleNode.textContent = nextEnabled ? "正在开启…" : "正在关闭…";
  try {
    const response = await sendRuntimeMessage({
      type: "douhot:setMonitorEnabled",
      payload: { enabled: nextEnabled },
    });
    renderMonitorToggle(response.data?.enabled === true);
    monitorStatusNode.textContent = nextEnabled ? "监控已开启，正在连接已配置的目标会话" : "监控已关闭";
    monitorStatusNode.classList.remove("error");
  } catch (error) {
    renderMonitorToggle(monitorEnabled);
    monitorStatusNode.textContent = error.message;
    monitorStatusNode.classList.add("error");
  } finally {
    monitorBusy = false;
    renderMonitorToggle(monitorEnabled);
  }
});

document.getElementById("open-monitor").addEventListener("click", async () => {
  if (!monitorReady || !monitorEnabled || monitorBusy) return;
  monitorBusy = true;
  openMonitorNode.disabled = true;
  monitorToggleNode.disabled = true;
  try {
    await sendRuntimeMessage({ type: "douhot:openMonitor" });
    monitorStatusNode.textContent = "监控页已打开，正在建立历史基线。";
    monitorStatusNode.classList.remove("error");
  } catch (error) {
    monitorStatusNode.textContent = error.message;
    monitorStatusNode.classList.add("error");
  } finally {
    monitorBusy = false;
    renderMonitorToggle(monitorEnabled);
  }
});

document.getElementById("sync").addEventListener("click", () => {
  runOnCurrentTab({ download: false, copy: true, sync: true });
});

document.getElementById("export").addEventListener("click", () => {
  runOnCurrentTab({ download: true, copy: true, sync: false });
});

document.getElementById("works").addEventListener("click", () => {
  runWorksOnCurrentTab({
    sort: "default",
    limit: 0,
    sync: true,
    download: false,
    includeComments: includeCommentsOption(),
    transcribe: manualTranscriptionOption(),
  });
});

document.getElementById("single-work").addEventListener("click", () => {
  runSingleWorkOnCurrentTab({
    sync: true,
    download: false,
    includeComments: includeCommentsOption(),
    transcribe: manualTranscriptionOption(),
  });
});

document.getElementById("works-filter").addEventListener("click", () => {
  runWorksOnCurrentTab({
    prompt: true,
    includeComments: includeCommentsOption(),
    transcribe: manualTranscriptionOption(),
  });
});

document.getElementById("options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

async function runOnCurrentTab(options) {
  if (collectionBusy) return;
  setCollectionBusy(true);
  try {
    setStatus("正在发送指令...");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("没有找到当前标签页。");

    const response = await sendTabMessage(tab.id, { type: "douhot:run", options });
    if (!response?.ok) {
      setStatus(response?.error || "执行失败。", true);
      return;
    }
    if (response.data?.routed) {
      setStatus("已打开热点宝详情页，稍后会自动执行。");
      return;
    }
    if (options.sync) {
      const sync = response.data?.feishuSync;
      const action = sync?.operation === "updated" ? "已更新" : "已新增";
      setStatus(sync?.recordId ? `${action}飞书记录：${sync.recordId}` : "已同步到飞书。");
      return;
    }
    setStatus("已导出 JSON。");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setCollectionBusy(false);
  }
}

async function runWorksOnCurrentTab(options) {
  if (collectionBusy) return;
  setCollectionBusy(true);
  try {
    setStatus("正在发送作品采集指令...");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("没有找到当前标签页。");

    const response = await sendTabMessage(tab.id, { type: "douhot:runWorks", options });
    if (!response?.ok) {
      setStatus(response?.error || "作品采集失败。", true);
      return;
    }
    if (response.data?.cancelled) {
      setStatus("已取消。");
      return;
    }
    if (response.data?.routed) {
      setStatus("已打开作品采集页，稍后自动同步。");
      return;
    }
    const sync = response.data?.feishuSync;
    if (sync) {
      setStatus(
        `已同步 ${sync.total || response.data?.count || 0} 条作品：新增 ${sync.created || 0}，更新 ${sync.updated || 0}${transcriptionSummary(sync.transcription)}`,
      );
      return;
    }
    setStatus(`已处理 ${response.data?.count || 0} 条作品。`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setCollectionBusy(false);
  }
}

async function runSingleWorkOnCurrentTab(options) {
  if (collectionBusy) return;
  setCollectionBusy(true);
  try {
    setStatus("正在发送单条作品采集指令...");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("没有找到当前标签页。");

    const response = await sendTabMessage(tab.id, { type: "douhot:runSingleWork", options });
    if (!response?.ok) {
      setStatus(response?.error || "单条作品采集失败。", true);
      return;
    }
    const sync = response.data?.feishuSync;
    if (sync) {
      setStatus(`当前作品已同步：新增 ${sync.created || 0}，更新 ${sync.updated || 0}${transcriptionSummary(sync.transcription)}`);
      return;
    }
    setStatus("当前作品已处理。");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setCollectionBusy(false);
  }
}

function setCollectionBusy(busy) {
  collectionBusy = busy;
  for (const button of collectionButtons) button.disabled = busy;
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error("无法连接当前页面。请打开热点宝或抖音对应页面并刷新后重试。"));
        return;
      }
      resolve(response);
    });
  });
}

function setStatus(message, isError = false) {
  statusNode.textContent = message;
  statusNode.classList.toggle("error", isError);
}

function includeCommentsOption() {
  return includeCommentsNode?.checked === true;
}

function manualTranscriptionOption() {
  return manualTranscribeNode?.checked === true;
}

function transcriptionSummary(transcription) {
  if (!transcription?.requested) return "";
  if (transcription.missingApiKey) return "；未转写：请先配置阿里云 API Key";
  const queued = Number(transcription.queued || 0);
  const existing = Number(transcription.existing || 0);
  const skipped = Number(transcription.skipped || 0);
  return `；逐字稿排队 ${queued} 条${existing ? `，已有任务 ${existing} 条` : ""}${skipped ? `，缺少视频源 ${skipped} 条` : ""}`;
}

async function refreshMonitorPanel() {
  try {
    const [settingsResponse, statusResponse] = await Promise.all([
      sendRuntimeMessage({ type: "douhot:getMonitorSettings" }),
      sendRuntimeMessage({ type: "douhot:getMonitorStatus" }),
    ]);
    monitorReady = true;
    renderMonitorToggle(settingsResponse.data?.enabled === true);
    const status = statusResponse.data || {};
    monitorStatusNode.textContent = status.message || "等待监控启动";
    monitorStatusNode.classList.toggle("error", status.state === "error");
  } catch (error) {
    monitorToggleNode.disabled = true;
    monitorToggleNode.textContent = "状态读取失败";
    monitorStatusNode.textContent = `${error.message}。请重新打开插件重试。`;
    monitorStatusNode.classList.add("error");
  }
}

function renderMonitorToggle(enabled) {
  monitorEnabled = enabled;
  monitorToggleNode.disabled = !monitorReady || monitorBusy;
  monitorToggleNode.textContent = enabled ? "关闭监控" : "开启监控";
  monitorToggleNode.classList.toggle("enabled", enabled);
  monitorToggleNode.classList.toggle("disabled", !enabled);
  openMonitorNode.disabled = !monitorReady || monitorBusy || !enabled;
  openMonitorNode.title = enabled ? "打开抖音专用监控页" : "请先开启监控";
}

async function refreshTranscriptionOption() {
  try {
    const response = await sendRuntimeMessage({ type: "douhot:getTranscriptionSettings" });
    const data = response.data || {};
    autoTranscribeNode.checked = data.enabled === true;
    transcriptionReady = true;
    autoTranscribeNode.disabled = false;
    renderTranscriptionNote(data);
  } catch (error) {
    transcriptionNoteNode.textContent = error.message;
    transcriptionNoteNode.classList.add("error");
  }
}

function renderTranscriptionNote(data) {
  const enabled = data.enabled === true;
  const configured = data.apiKeyConfigured === true;
  transcriptionNoteNode.textContent = !enabled
    ? "未开启逐字稿"
    : configured ? "已开启，完成后自动回写飞书" : "已开启，但需要先在设置页填写阿里云 API Key";
  transcriptionNoteNode.classList.toggle("error", enabled && !configured);
}

async function refreshCollectorName() {
  try {
    const response = await sendRuntimeMessage({ type: "douhot:getCollectorName" });
    const collectorName = String(response.data?.collectorName ?? "汤淡").trim();
    collectorReady = true;
    collectorNameNode.disabled = false;
    saveCollectorNode.disabled = false;
    collectorNameNode.value = collectorName;
    renderCollectorNote(collectorName);
  } catch (error) {
    collectorNoteNode.textContent = error.message;
    collectorNoteNode.classList.add("error");
  }
}

async function saveCollectorName() {
  if (!collectorReady || collectorSaving) return;
  collectorSaving = true;
  collectorNameNode.disabled = true;
  const collectorName = collectorNameNode.value.trim();
  saveCollectorNode.disabled = true;
  saveCollectorNode.textContent = "保存中";
  try {
    const response = await sendRuntimeMessage({
      type: "douhot:saveCollectorName",
      payload: { collectorName },
    });
    collectorNameNode.value = response.data?.collectorName || "";
    renderCollectorNote(response.data?.collectorName || "", true);
  } catch (error) {
    collectorNoteNode.textContent = error.message;
    collectorNoteNode.classList.add("error");
  } finally {
    collectorSaving = false;
    collectorNameNode.disabled = false;
    saveCollectorNode.disabled = false;
    saveCollectorNode.textContent = "保存";
  }
}

function renderCollectorNote(collectorName, saved = false) {
  if (collectorName) {
    collectorNoteNode.textContent = saved
      ? `已保存：${collectorName}`
      : `后续入库记录将标记为：${collectorName}`;
    collectorNoteNode.classList.remove("error");
    return;
  }
  collectorNoteNode.textContent = saved
    ? "已清空，后续记录的收集人将留空"
    : "请填写你的名字，后续每条入库记录都会自动带上";
  collectorNoteNode.classList.add("error");
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "操作失败"));
        return;
      }
      resolve(response);
    });
  });
}
