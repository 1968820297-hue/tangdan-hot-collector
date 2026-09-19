const DEFAULT_TARGET_BASE = {
  appToken: "",
  tableId: "",
  viewId: "",
  title: "热点宝-主页",
};

const DEFAULT_WORKS_TABLE_NAME = "竞品达人视频数据";
const MONITOR_URL = "https://www.douyin.com/jingxuan?dycollector=tangdan";
const MONITOR_QUEUE_KEY = "douhotMonitorQueueV1";
const MONITOR_STATUS_KEY = "douhotMonitorStatusV1";
const MONITOR_RETRY_ALARM = "douhotMonitorRetryV1";
const TRANSCRIPTION_JOBS_KEY = "douhotTranscriptionJobsV1";
const TRANSCRIPTION_ALARM = "douhotTranscriptionPollV1";
const BASE_TRANSCRIPTION_REQUEST_ALARM = "douhotBaseTranscriptionRequestV1";
const BASE_TRANSCRIPTION_REQUEST_FIELD = "转逐字稿";
const DASHSCOPE_API_BASE = "https://dashscope.aliyuncs.com/api/v1";
const DOUYIN_SOURCE_STRATEGY = "play-uri-v1";
const DEFAULT_MONITOR_SETTINGS = {
  enabled: false,
  targetConversation: "AI相关入库",
  selfSenderName: "汤淡",
  scanIntervalMs: 300,
  resolveTimeoutMs: 8000,
  openOnStartup: false,
};

const DEFAULT_FEISHU_SETTINGS = {
  enabled: true,
  collectorName: "汤淡",
  authMode: "personalBaseToken",
  personalBaseToken: "",
  appId: "",
  appSecret: "",
  appToken: DEFAULT_TARGET_BASE.appToken,
  tableId: DEFAULT_TARGET_BASE.tableId,
  autoCreateFields: true,
  upsertByCreatorId: true,
};

const DEFAULT_TRANSCRIPTION_SETTINGS = {
  enabled: false,
  apiKey: "",
  model: "paraformer-v2",
};

let commentReaderTabId = 0;
let commentReaderCloseTimer = 0;
let monitorDraining = false;
let monitorDrainRequested = false;
let transcriptionProcessing = false;
let baseTranscriptionRequestProcessing = false;

const FIELD_TYPE = {
  text: 1,
  number: 2,
  singleSelect: 3,
  multiSelect: 4,
  dateTime: 5,
  checkbox: 7,
};

const FIELD_DEFINITIONS = [
  { name: "采集时间", type: FIELD_TYPE.text, pick: (result) => formatDateTime(result.extractedAt) },
  { name: "热点宝链接", type: FIELD_TYPE.text, pick: (result) => result.sourceUrl },
  { name: "抖音主页", type: FIELD_TYPE.text, pick: (result) => result.profile?.douyinProfileUrl },
  { name: "博主名称", type: FIELD_TYPE.text, pick: (result) => result.profile?.name },
  { name: "抖音号", type: FIELD_TYPE.text, pick: (result) => result.profile?.douyinId },
  { name: "总粉丝量", type: FIELD_TYPE.number, pick: (result) => integerValue(result.profile?.followerCount) },
  { name: "总获赞量", type: FIELD_TYPE.number, pick: (result) => integerValue(result.profile?.totalLiked) },
  { name: "总作品数", type: FIELD_TYPE.number, pick: (result) => integerValue(result.profile?.workCount) },
  { name: "签名", type: FIELD_TYPE.text, pick: (result) => result.profile?.signature },
  {
    name: "标签",
    type: FIELD_TYPE.multiSelect,
    uiType: "MultiSelect",
    property: (result) => ({ options: getTags(result).map((name) => ({ name })) }),
    pick: getTags,
  },
  { name: "近30天平均点赞量", type: FIELD_TYPE.number, pick: (result) => result.product30d?.averageLikes },
  { name: "近30天平均分享量", type: FIELD_TYPE.number, pick: (result) => result.product30d?.averageShares },
  { name: "近30天平均评论量", type: FIELD_TYPE.number, pick: (result) => result.product30d?.averageComments },
  { name: "粉丝男占比", type: FIELD_TYPE.number, pick: (result) => portraitPercent(result, "男") },
  { name: "粉丝女占比", type: FIELD_TYPE.number, pick: (result) => portraitPercent(result, "女") },
  { name: "男性TGI", type: FIELD_TYPE.number, pick: (result) => portraitTgi(result, "男") },
  { name: "女性TGI", type: FIELD_TYPE.number, pick: (result) => portraitTgi(result, "女") },
  { name: "城市占比TOP10", type: FIELD_TYPE.text, pick: (result) => formatRows(result.fanPortrait?.city, 10) },
  { name: "省份占比TOP10", type: FIELD_TYPE.text, pick: (result) => formatRows(result.fanPortrait?.province, 10) },
  { name: "年龄占比", type: FIELD_TYPE.text, pick: (result) => formatRows(result.fanPortrait?.age) },
  { name: "城市等级占比", type: FIELD_TYPE.text, pick: (result) => formatRows(result.fanPortrait?.cityLevel) },
  { name: "设备价格占比", type: FIELD_TYPE.text, pick: (result) => formatRows(result.fanPortrait?.devicePrice) },
  { name: "设备品牌占比", type: FIELD_TYPE.text, pick: (result) => formatRows(result.fanPortrait?.deviceBrand) },
  { name: "达人ID", type: FIELD_TYPE.text, pick: (result) => result.creatorId },
];

const WORK_FIELD_DEFINITIONS = [
  { name: "标题", type: FIELD_TYPE.text, pick: ({ work }) => work.title },
  {
    name: "标签",
    type: FIELD_TYPE.multiSelect,
    uiType: "MultiSelect",
    property: (result) => ({ options: uniqueStrings((result.works || []).flatMap((work) => work.tags || [])).map((name) => ({ name })) }),
    options: (result) => uniqueStrings((result.works || []).flatMap((work) => work.tags || [])),
    pick: ({ work }) => work.tags || [],
  },
  {
    name: "博主名称",
    type: FIELD_TYPE.singleSelect,
    uiType: "SingleSelect",
    property: (result) => ({ options: uniqueStrings((result.works || []).map((work) => work.authorName || result.creatorName || "未知博主")).map((name) => ({ name })) }),
    options: (result) => uniqueStrings((result.works || []).map((work) => work.authorName || result.creatorName || "未知博主")),
    pick: ({ result, work }) => work.authorName || result.creatorName || "未知博主",
  },
  {
    name: "收集人",
    type: FIELD_TYPE.text,
    pick: ({ result, work }) => String(work.collectorName || result.collectorName || "").trim() || undefined,
  },
  { name: "封面", type: FIELD_TYPE.text, pick: ({ work }) => work.coverUrl },
  { name: "点赞", type: FIELD_TYPE.number, pick: ({ work }) => integerValue(work.likeCount) },
  { name: "评论", type: FIELD_TYPE.number, pick: ({ work }) => integerValue(work.commentCount) },
  { name: "前3条热评", type: FIELD_TYPE.text, pick: ({ work }) => work.hotCommentsText },
  { name: "收藏", type: FIELD_TYPE.number, pick: ({ work }) => integerValue(work.collectCount) },
  { name: "分享", type: FIELD_TYPE.number, pick: ({ work }) => integerValue(work.shareCount) },
  { name: "作品时长", type: FIELD_TYPE.number, pick: ({ work }) => integerValue(work.durationSeconds) },
  { name: "发布日期", type: FIELD_TYPE.dateTime, uiType: "DateTime", pick: ({ work }) => work.publishTimestamp || work.publishDate },
  { name: "视频链接", type: FIELD_TYPE.text, pick: ({ work }) => work.videoLink },
  { name: "视频源网址", type: FIELD_TYPE.text, pick: ({ work }) => preferredTranscriptionMediaUrl(work) || work.videoLink },
  { name: "作品网址", type: FIELD_TYPE.text, pick: ({ work }) => work.videoLink },
  { name: BASE_TRANSCRIPTION_REQUEST_FIELD, type: FIELD_TYPE.checkbox, pick: () => undefined },
  { name: "直接转逐字稿", type: FIELD_TYPE.text, pick: ({ work }) => work.transcriptText || undefined },
  { name: "逐字稿状态", type: FIELD_TYPE.text, pick: ({ work }) => work.transcriptStatus || undefined },
];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) return false;
  Promise.resolve()
    .then(async () => {
      if (message.type === "douhot:getSettings") {
        return { ok: true, data: await getFeishuSettings() };
      }
      if (message.type === "douhot:saveSettings") {
        await saveFeishuSettings(message.payload || {});
        void drainMonitorQueue().catch(() => undefined);
        void processBaseTranscriptionRequests().catch(() => undefined);
        return { ok: true };
      }
      if (message.type === "douhot:getCollectorName") {
        const settings = await getFeishuSettings();
        return { ok: true, data: { collectorName: settings.collectorName || "" } };
      }
      if (message.type === "douhot:saveCollectorName") {
        const current = await getFeishuSettings();
        const collectorName = String(message.payload?.collectorName || "").trim();
        await saveFeishuSettings({ ...current, collectorName });
        return { ok: true, data: { collectorName } };
      }
      if (message.type === "douhot:getTranscriptionSettings") {
        const data = await getTranscriptionSettings();
        return { ok: true, data: { ...data, apiKeyConfigured: Boolean(data.apiKey) } };
      }
      if (message.type === "douhot:saveTranscriptionSettings") {
        const data = await saveTranscriptionSettings(message.payload || {});
        void processTranscriptionJobs().catch(() => undefined);
        void processBaseTranscriptionRequests().catch(() => undefined);
        return { ok: true, data: { ...data, apiKeyConfigured: Boolean(data.apiKey) } };
      }
      if (message.type === "douhot:setTranscriptionEnabled") {
        const current = await getTranscriptionSettings();
        const data = await saveTranscriptionSettings({
          ...current,
          enabled: message.payload?.enabled === true,
        });
        if (data.enabled) void processTranscriptionJobs().catch(() => undefined);
        void processBaseTranscriptionRequests().catch(() => undefined);
        return { ok: true, data: { ...data, apiKeyConfigured: Boolean(data.apiKey) } };
      }
      if (message.type === "douhot:getMonitorSettings") {
        return { ok: true, data: await getMonitorSettings() };
      }
      if (message.type === "douhot:saveMonitorSettings") {
        const data = await saveMonitorSettings(message.payload || {});
        if (data.enabled) {
          const monitorTab = await ensureMonitorTab({ active: false });
          if (monitorTab.tabId) await chrome.tabs.reload(monitorTab.tabId);
        } else {
          await reloadMonitorTabs();
          await setMonitorStatus({ state: "off", message: "监控已关闭", pageStatus: "off" });
          await setMonitorBadge("off");
        }
        return { ok: true, data };
      }
      if (message.type === "douhot:setMonitorEnabled") {
        const current = await getMonitorSettings();
        const data = await saveMonitorSettings({
          ...current,
          enabled: message.payload?.enabled === true,
        });
        if (data.enabled) {
          await setMonitorStatus({ state: "starting", message: "正在开启监控", pageStatus: "starting" });
          const monitorTab = await ensureMonitorTab({ active: true, force: true });
          if (monitorTab.existing && monitorTab.tabId) await chrome.tabs.reload(monitorTab.tabId);
        } else {
          await reloadMonitorTabs();
          await setMonitorStatus({ state: "off", message: "监控已关闭", pageStatus: "off" });
          await setMonitorBadge("off");
        }
        return { ok: true, data };
      }
      if (message.type === "douhot:getMonitorStatus") {
        return { ok: true, data: await getMonitorStatus() };
      }
      if (message.type === "douhot:openMonitor") {
        const data = await ensureMonitorTab({ active: true, force: true });
        return { ok: true, data };
      }
      if (message.type === "douhot:monitorTrustedClick") {
        await trustedClick(sender?.tab?.id || 0, message.point);
        return { ok: true };
      }
      if (message.type === "douhot:monitorTrustedKey") {
        await trustedKeypress(sender?.tab?.id || 0, message.key);
        return { ok: true };
      }
      if (message.type === "douhot:monitorSyncWork") {
        const data = await enqueueMonitorResult(message.payload);
        return { ok: true, data };
      }
      if (message.type === "douhot:monitorHeartbeat") {
        const payload = message.payload || {};
        const state = ["error", "waiting-for-chat", "waiting-for-target"].includes(payload.status) ? "error" : payload.status === "written" ? "ok" : "watching";
        const data = await setMonitorStatus({
          state,
          message: payload.detail || (state === "watching" ? "正在监控抖音私聊" : "监控状态已更新"),
          pageStatus: payload.status || "",
        });
        return { ok: true, data };
      }
      if (message.type === "douhot:testFeishu") {
        const data = await testFeishu(message.payload);
        return { ok: true, data };
      }
      if (message.type === "douhot:syncFeishu") {
        const data = await syncFeishu(message.payload);
        return { ok: true, data };
      }
      if (message.type === "douhot:syncWorksFeishu") {
        const data = await syncWorksFeishuWithTranscription(message.payload);
        return { ok: true, data };
      }
      if (message.type === "douhot:fetchTopComments") {
        const data = await fetchDouyinTopComments(message.payload?.awemeId, message.payload?.videoLink, message.payload?.creatorName, sender?.tab?.id || 0);
        return { ok: true, data };
      }
      if (message.type === "douhot:resolveCreatorId") {
        const data = await resolveDouyinCreatorId(message.payload?.input);
        return { ok: true, data };
      }
      return { ok: false, error: `未知消息类型：${message.type}` };
    })
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

async function getFeishuSettings() {
  const stored = await chrome.storage.local.get({ feishu: DEFAULT_FEISHU_SETTINGS });
  const settings = { ...DEFAULT_FEISHU_SETTINGS, ...(stored.feishu || {}) };
  if (!settings.appToken) settings.appToken = DEFAULT_TARGET_BASE.appToken;
  if (!settings.tableId) settings.tableId = DEFAULT_TARGET_BASE.tableId;
  return settings;
}

async function getTranscriptionSettings() {
  const stored = await chrome.storage.local.get({ transcription: DEFAULT_TRANSCRIPTION_SETTINGS });
  return { ...DEFAULT_TRANSCRIPTION_SETTINGS, ...(stored.transcription || {}) };
}

async function saveTranscriptionSettings(input) {
  const settings = {
    enabled: input.enabled === true,
    apiKey: String(input.apiKey || "").trim(),
    model: "paraformer-v2",
  };
  await chrome.storage.local.set({ transcription: settings });
  return settings;
}

async function getMonitorSettings() {
  const stored = await chrome.storage.local.get({ douhotMonitor: DEFAULT_MONITOR_SETTINGS });
  return { ...DEFAULT_MONITOR_SETTINGS, ...(stored.douhotMonitor || {}) };
}

async function saveMonitorSettings(input) {
  const settings = {
    enabled: input.enabled !== false,
    targetConversation: String(input.targetConversation || DEFAULT_MONITOR_SETTINGS.targetConversation).trim(),
    selfSenderName: String(input.selfSenderName || DEFAULT_MONITOR_SETTINGS.selfSenderName).trim(),
    scanIntervalMs: DEFAULT_MONITOR_SETTINGS.scanIntervalMs,
    resolveTimeoutMs: DEFAULT_MONITOR_SETTINGS.resolveTimeoutMs,
    openOnStartup: input.openOnStartup !== false,
  };
  if (!settings.targetConversation) throw new Error("目标私聊名称不能为空");
  if (!settings.selfSenderName) throw new Error("自己的抖音昵称不能为空");
  await chrome.storage.local.set({ douhotMonitor: settings });
  return settings;
}

async function getMonitorStatus() {
  const stored = await chrome.storage.local.get({
    [MONITOR_STATUS_KEY]: {
      state: "idle",
      message: "等待监控启动",
      updatedAt: "",
      lastSuccessAt: "",
      lastError: "",
    },
  });
  return stored[MONITOR_STATUS_KEY];
}

async function setMonitorStatus(patch) {
  const current = await getMonitorStatus();
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [MONITOR_STATUS_KEY]: next });
  return next;
}

function isMonitorUrl(value) {
  try {
    const url = new URL(value || "");
    return (url.hostname === "www.douyin.com" || url.hostname === "douyin.com")
      && url.searchParams.get("dycollector") === "tangdan";
  } catch (_error) {
    return false;
  }
}

async function ensureMonitorTab(options = {}) {
  const settings = await getMonitorSettings();
  if (!settings.enabled && !options.force) return { opened: false, reason: "disabled" };
  const tabs = await chrome.tabs.query({ url: ["https://www.douyin.com/*", "https://douyin.com/*"] });
  const existing = tabs.find((tab) => tab.id && isMonitorUrl(tab.url));
  if (existing?.id) {
    if (options.active) await chrome.tabs.update(existing.id, { active: true });
    return { opened: true, existing: true, tabId: existing.id };
  }
  const created = await chrome.tabs.create({ url: MONITOR_URL, active: options.active === true });
  return { opened: true, existing: false, tabId: created.id || 0 };
}

async function reloadMonitorTabs() {
  const tabs = await chrome.tabs.query({ url: ["https://www.douyin.com/*", "https://douyin.com/*"] });
  const monitorTabs = tabs.filter((tab) => tab.id && isMonitorUrl(tab.url));
  await Promise.all(monitorTabs.map((tab) => chrome.tabs.reload(tab.id).catch(() => undefined)));
  return monitorTabs.length;
}

async function trustedClick(tabId, point) {
  if (!tabId || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error("可信点击参数无效");
  }
  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseMoved", x: point.x, y: point.y,
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1,
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1,
    });
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
  }
}

async function trustedKeypress(tabId, key) {
  if (!tabId || key !== "Escape") throw new Error("可信按键参数无效");
  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
    const params = {
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    };
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
      ...params,
      type: "rawKeyDown",
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
      ...params,
      type: "keyUp",
    });
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
  }
}

async function readMonitorQueue() {
  const stored = await chrome.storage.local.get({ [MONITOR_QUEUE_KEY]: [] });
  return Array.isArray(stored[MONITOR_QUEUE_KEY]) ? stored[MONITOR_QUEUE_KEY] : [];
}

async function writeMonitorQueue(queue) {
  await chrome.storage.local.set({ [MONITOR_QUEUE_KEY]: queue.slice(-300) });
}

function monitorResultKey(result) {
  return result?.works?.[0]?.videoLink || result?.works?.[0]?.awemeId || "";
}

async function setMonitorBadge(state) {
  const text = state === "ok" ? "✓" : state === "error" ? "!" : "";
  await chrome.action.setBadgeText({ text });
  if (text) {
    await chrome.action.setBadgeBackgroundColor({ color: state === "ok" ? "#16a34a" : "#dc2626" });
  }
}

async function enqueueMonitorResult(result) {
  const feishuSettings = await getFeishuSettings();
  result = attachCollectorName(result, feishuSettings.collectorName);
  const transcription = await getTranscriptionSettings();
  if (transcription.enabled && result?.works?.length) {
    result.transcriptionRequested = true;
    result.works = result.works.map((work) => ({
      ...work,
      transcriptionRequested: true,
      transcriptStatus: work.mediaUrl ? "等待转写" : "无法转写：缺少视频文件地址",
    }));
  }
  const key = monitorResultKey(result);
  if (!key) throw new Error("监控事件缺少视频链接");
  const queue = await readMonitorQueue();
  if (!queue.some((item) => item.key === key)) {
    queue.push({ key, result, queuedAt: new Date().toISOString() });
    await writeMonitorQueue(queue);
  }
  await setMonitorStatus({ state: "syncing", message: `正在同步：${result?.works?.[0]?.authorName || key}` });
  // Return as soon as the item is durably queued. The page can close the video
  // and process the next chat message while Feishu writes in the background.
  monitorDrainRequested = true;
  void drainMonitorQueue().catch(() => undefined);
  return { queued: true, pendingCount: queue.length };
}

async function drainMonitorQueue() {
  if (monitorDraining) return { queued: true };
  monitorDraining = true;
  try {
    let lastResult = null;
    while (true) {
      monitorDrainRequested = false;
      const queue = await readMonitorQueue();
      if (!queue.length) break;
      const item = queue[0];
      try {
        lastResult = await syncWorksFeishu(item.result);
        if (item.result?.transcriptionRequested) {
          await enqueueTranscriptionForResult(item.result).catch(() => undefined);
        }
        // Re-read after the network request. New monitor events may have been
        // appended while this item was syncing; removing from the latest queue
        // preserves those events instead of overwriting them with a stale copy.
        const latestQueue = await readMonitorQueue();
        const remainingQueue = latestQueue.filter((queued) => queued.key !== item.key);
        await writeMonitorQueue(remainingQueue);
        const work = item.result?.works?.[0] || {};
        await setMonitorStatus({
          state: "ok",
          message: `已同步：${work.authorName || "未知博主"}`,
          lastSuccessAt: new Date().toISOString(),
          lastVideoLink: work.videoLink || item.key,
          lastTitle: work.title || "",
          lastError: "",
          pendingCount: remainingQueue.length,
        });
        await setMonitorBadge("ok");
      } catch (error) {
        const message = error?.message || String(error);
        await setMonitorStatus({
          state: "error",
          message: `同步失败：${message}`,
          lastError: message,
          pendingCount: queue.length,
        });
        await setMonitorBadge("error");
        throw error;
      }
    }
    return { queued: false, sync: lastResult };
  } finally {
    monitorDraining = false;
    // Covers an enqueue that lands after the final empty-queue read but before
    // this drain releases its lock. Failed items are otherwise left for alarms.
    if (monitorDrainRequested) void drainMonitorQueue().catch(() => undefined);
  }
}

async function readTranscriptionJobs() {
  const stored = await chrome.storage.local.get({ [TRANSCRIPTION_JOBS_KEY]: [] });
  return Array.isArray(stored[TRANSCRIPTION_JOBS_KEY]) ? stored[TRANSCRIPTION_JOBS_KEY] : [];
}

async function writeTranscriptionJobs(jobs) {
  await chrome.storage.local.set({ [TRANSCRIPTION_JOBS_KEY]: jobs.slice(-100) });
}

async function upsertTranscriptionJob(job) {
  const jobs = await readTranscriptionJobs();
  const index = jobs.findIndex((item) => item.key === job.key);
  if (index >= 0) jobs[index] = job;
  else jobs.push(job);
  await writeTranscriptionJobs(jobs);
}

async function removeTranscriptionJob(key) {
  const jobs = await readTranscriptionJobs();
  await writeTranscriptionJobs(jobs.filter((item) => item.key !== key));
}

function normalizeHttpUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  return url.replace(/^http:\/\//i, "https://");
}

function buildDouyinSourceUrl(playUri) {
  const uri = String(playUri || "").trim();
  if (!uri) return "";
  if (/^https?:\/\//i.test(uri) || uri.startsWith("//")) {
    const normalized = normalizeHttpUrl(uri);
    try {
      const url = new URL(normalized);
      const videoId = url.searchParams.get("video_id") || "";
      if (url.pathname.includes("/aweme/v1/playwm/") && videoId) {
        return buildDouyinSourceUrl(videoId);
      }
      return url.toString();
    } catch (_error) {
      return normalized;
    }
  }
  return `https://aweme.snssdk.com/aweme/v1/play/?video_id=${encodeURIComponent(uri)}&ratio=720p&line=0`;
}

function preferredTranscriptionMediaUrl(work) {
  return buildDouyinSourceUrl(work?.sourcePlayUri)
    || buildDouyinSourceUrl(work?.mediaUrl)
    || normalizeHttpUrl(work?.mediaUrl)
    || normalizeHttpUrl(work?.mediaFallbackUrl);
}

async function migrateForbiddenTranscriptionJobs() {
  const jobs = await readTranscriptionJobs();
  let changed = false;
  const migrated = jobs.map((original) => {
    if (original.status !== "failed"
      || original.sourceUrlStrategy === DOUYIN_SOURCE_STRATEGY
      || !/FILE_403_FORBIDDEN|403[ _-]?FORBIDDEN/i.test(String(original.lastError || ""))) {
      return original;
    }
    const work = original.result?.works?.[0] || {};
    const sourceUrl = preferredTranscriptionMediaUrl({ ...work, mediaUrl: original.mediaUrl });
    if (!sourceUrl || sourceUrl === original.mediaUrl || !sourceUrl.includes("/aweme/v1/play/")) return original;
    changed = true;
    return {
      ...original,
      mediaUrl: sourceUrl,
      status: "queued",
      taskId: "",
      attempts: 0,
      nextPollAt: 0,
      sourceUrlStrategy: DOUYIN_SOURCE_STRATEGY,
      updatedAt: new Date().toISOString(),
      lastError: "",
    };
  });
  if (changed) await writeTranscriptionJobs(migrated);
  return { migrated: changed };
}

async function enqueueTranscriptionForResult(result) {
  let queued = 0;
  let existingCount = 0;
  let skipped = 0;
  for (const work of result?.works || []) {
    if (!work.transcriptionRequested) continue;
    const mediaUrl = preferredTranscriptionMediaUrl(work);
    if (!mediaUrl || !work.videoLink) {
      skipped += 1;
      continue;
    }
    const jobs = await readTranscriptionJobs();
    const existing = jobs.find((item) => item.key === work.videoLink);
    if (existing) {
      if (existing.status === "failed" && mediaUrl) {
        await upsertTranscriptionJob({
          ...existing,
          mediaUrl,
          result: { ...result, works: [{ ...work, mediaUrl }] },
          status: "queued",
          taskId: "",
          attempts: 0,
          nextPollAt: 0,
          sourceUrlStrategy: DOUYIN_SOURCE_STRATEGY,
          updatedAt: new Date().toISOString(),
          lastError: "",
        });
        queued += 1;
      } else {
        existingCount += 1;
      }
      continue;
    }
    await upsertTranscriptionJob({
      key: work.videoLink,
      mediaUrl,
      result: { ...result, works: [{ ...work, mediaUrl }] },
      status: "queued",
      taskId: "",
      attempts: 0,
      nextPollAt: 0,
      sourceUrlStrategy: DOUYIN_SOURCE_STRATEGY,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastError: "",
    });
    queued += 1;
  }
  if (queued) void processTranscriptionJobs().catch(() => undefined);
  return { queued, existing: existingCount, skipped };
}

async function processTranscriptionJobs() {
  if (transcriptionProcessing) return { running: true };
  transcriptionProcessing = true;
  try {
    const settings = await getTranscriptionSettings();
    if (!settings.apiKey) return { blocked: true, reason: "missing-api-key" };

    const jobs = await readTranscriptionJobs();
    const pending = jobs.filter((job) =>
      (job.status === "queued" || job.status === "submitted")
      && Number(job.nextPollAt || 0) <= Date.now());

    for (const originalJob of pending) {
      let job = { ...originalJob };
      try {
        if (job.status === "queued") {
          const submitted = await submitDashScopeTranscription(settings, job.mediaUrl);
          job = {
            ...job,
            status: "submitted",
            taskId: submitted.taskId,
            nextPollAt: Date.now() + 30000,
            updatedAt: new Date().toISOString(),
            lastError: "",
          };
          await upsertTranscriptionJob(job);
          await updateTranscriptionRecord(job, "转写中");
          continue;
        }

        const polled = await pollDashScopeTranscription(settings, job.taskId);
        if (polled.status === "PENDING" || polled.status === "RUNNING") {
          job.nextPollAt = Date.now() + 30000;
          job.updatedAt = new Date().toISOString();
          await upsertTranscriptionJob(job);
          continue;
        }
        if (polled.status !== "SUCCEEDED" || !polled.transcriptionUrl) {
          throw new Error(polled.error || `阿里云转写任务状态：${polled.status || "未知"}`);
        }

        const transcriptText = await fetchDashScopeTranscript(polled.transcriptionUrl);
        const limit = 90000;
        const finalText = transcriptText.length > limit ? `${transcriptText.slice(0, limit)}\n\n[逐字稿过长，已截断]` : transcriptText;
        const finalStatus = transcriptText.length > limit ? "已完成（内容过长已截断）" : "已完成";
        await updateTranscriptionRecord(job, finalStatus, finalText);
        await removeTranscriptionJob(job.key);
      } catch (error) {
        const attempts = Number(job.attempts || 0) + 1;
        const message = error?.message || String(error);
        const failed = attempts >= 3;
        job = {
          ...job,
          status: failed ? "failed" : job.status,
          attempts,
          nextPollAt: Date.now() + (failed ? 0 : 60000),
          updatedAt: new Date().toISOString(),
          lastError: message,
        };
        await upsertTranscriptionJob(job);
        if (failed) await updateTranscriptionRecord(job, `转写失败：${message.slice(0, 120)}`).catch(() => undefined);
      }
    }
    return { processed: pending.length };
  } finally {
    transcriptionProcessing = false;
  }
}

async function submitDashScopeTranscription(settings, mediaUrl) {
  if (!/^https?:\/\//i.test(mediaUrl || "")) throw new Error("视频文件地址不是公网 HTTP/HTTPS URL");
  const response = await fetch(`${DASHSCOPE_API_BASE}/services/audio/asr/transcription`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify({
      model: settings.model || "paraformer-v2",
      input: { file_urls: [mediaUrl] },
      parameters: {
        channel_id: [0],
        language_hints: ["zh", "en"],
      },
    }),
  });
  const json = await readJsonResponse(response, "阿里云转写任务提交失败");
  const taskId = json?.output?.task_id || "";
  if (!taskId) throw new Error(json?.message || json?.code || "阿里云没有返回 task_id");
  return { taskId };
}

async function pollDashScopeTranscription(settings, taskId) {
  if (!taskId) throw new Error("阿里云转写任务缺少 task_id");
  const response = await fetch(`${DASHSCOPE_API_BASE}/tasks/${encodeURIComponent(taskId)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "enable",
    },
  });
  const json = await readJsonResponse(response, "查询阿里云转写任务失败");
  const output = json?.output || {};
  const result = Array.isArray(output.results) ? output.results[0] || {} : {};
  return {
    status: output.task_status || "",
    transcriptionUrl: result.transcription_url || "",
    error: result.message || output.message || json?.message || json?.code || "",
  };
}

async function fetchDashScopeTranscript(url) {
  const response = await fetch(url, { method: "GET" });
  const json = await readJsonResponse(response, "下载阿里云逐字稿失败");
  const transcripts = Array.isArray(json?.transcripts)
    ? json.transcripts
    : Array.isArray(json?.output?.transcripts) ? json.output.transcripts : [];
  const paragraphs = transcripts.map((transcript) => {
    if (String(transcript?.text || "").trim()) return String(transcript.text).trim();
    return (transcript?.sentences || []).map((sentence) => String(sentence?.text || "").trim()).filter(Boolean).join("\n");
  }).filter(Boolean);
  if (!paragraphs.length) throw new Error("阿里云返回的转写结果中没有文字");
  return paragraphs.join("\n\n");
}

async function readJsonResponse(response, fallback) {
  let json = null;
  try {
    json = await response.json();
  } catch (_error) {
    throw new Error(`${fallback}：HTTP ${response.status}`);
  }
  if (!response.ok || json?.code) {
    throw new Error(`${fallback}：${json?.message || json?.code || response.status}`);
  }
  return json;
}

async function updateTranscriptionRecord(job, status, transcriptText) {
  const result = {
    ...job.result,
    works: (job.result?.works || []).map((work) => ({
      ...work,
      transcriptStatus: status,
      transcriptText: transcriptText === undefined ? work.transcriptText : transcriptText,
    })),
  };
  return syncWorksFeishu(result);
}

async function resolveDouyinCreatorId(input) {
  const direct = parseCreatorIdFromText(input);
  if (direct) return { creatorId: direct, source: "direct" };

  let url = extractFirstUrl(input);
  let lastError = "";
  for (let attempt = 0; attempt < 3 && url; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        credentials: "include",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      const finalUrl = response.url || url;
      const fromFinalUrl = parseCreatorIdFromText(finalUrl);
      if (fromFinalUrl) return { creatorId: fromFinalUrl, source: "redirect", url: finalUrl };

      const text = await response.text();
      const fromHtml = parseCreatorIdFromText(text) || extractCreatorIdFromDouyinHtml(text);
      if (fromHtml) return { creatorId: fromHtml, source: "html", url: finalUrl };

      const nextUrl = extractRedirectUrl(text, finalUrl);
      if (!nextUrl || nextUrl === url) break;
      url = nextUrl;
    } catch (error) {
      lastError = error.message || String(error);
      break;
    }
  }
  return { creatorId: "", error: lastError };
}

async function saveFeishuSettings(input) {
  const settings = {
    enabled: Boolean(input.enabled),
    collectorName: String(input.collectorName || "").trim(),
    authMode: input.authMode === "openApi" ? "openApi" : "personalBaseToken",
    personalBaseToken: String(input.personalBaseToken || "").trim(),
    appId: String(input.appId || "").trim(),
    appSecret: String(input.appSecret || "").trim(),
    appToken: String(input.appToken || "").trim(),
    tableId: String(input.tableId || "").trim(),
    autoCreateFields: input.autoCreateFields !== false,
    upsertByCreatorId: input.upsertByCreatorId !== false,
  };
  await chrome.storage.local.set({ feishu: settings });
}

async function testFeishu(inputSettings) {
  const settings = normalizeSettings(inputSettings || (await getFeishuSettings()));
  const auth = await getFeishuAuth(settings);
  const fields = await listFields(settings, auth);
  return {
    fieldCount: fields.length,
    tableId: settings.tableId,
    appToken: settings.appToken,
    authMode: settings.authMode,
  };
}

async function syncFeishu(result) {
  if (!result) throw new Error("没有收到达人数据。");
  const settings = normalizeSettings(await getFeishuSettings());

  const auth = await getFeishuAuth(settings);
  const defs = FIELD_DEFINITIONS;
  const ensureResult = await ensureFields(settings, auth, defs, result);
  const fieldsPayload = buildRecordFields(result, defs, ensureResult.fieldByName, ensureResult.fieldOrder);

  if (Object.keys(fieldsPayload).length === 0) {
    throw new Error("没有可写入的字段，请检查表格字段配置。");
  }

  const existingRecordId = settings.upsertByCreatorId
    ? await findRecordIdByCreatorId(settings, auth, ensureResult.fieldByName, result.creatorId)
    : "";

  const endpoint = `/bitable/v1/apps/${encodeURIComponent(settings.appToken)}/tables/${encodeURIComponent(settings.tableId)}/records`;
  const saved = existingRecordId
    ? await feishuApi("PUT", `${endpoint}/${encodeURIComponent(existingRecordId)}`, auth, { fields: fieldsPayload })
    : await feishuApi("POST", endpoint, auth, { fields: fieldsPayload });

  return {
    recordId: saved?.record?.record_id || saved?.record_id || existingRecordId || "",
    operation: existingRecordId ? "updated" : "created",
    createdFields: ensureResult.createdFields,
    skippedFields: ensureResult.skippedFields,
  };
}

async function syncWorksFeishu(result) {
  if (!result?.works?.length) throw new Error("没有收到作品数据。");
  const settings = normalizeSettings(await getFeishuSettings());
  result = attachCollectorName(result, settings.collectorName);
  const auth = await getFeishuAuth(settings);
  const table = await getOrCreateWorksTable(settings, auth, result);
  const tableId = table.table_id || table.tableId;
  if (!tableId) throw new Error("没有拿到「竞品达人视频数据」的数据表 ID。");

  const ensureResult = await ensureFields(settings, auth, WORK_FIELD_DEFINITIONS, result, tableId);
  await ensureDynamicOptions(settings, auth, tableId, ensureResult.fieldByName, WORK_FIELD_DEFINITIONS, result);

  const fieldsPayloads = result.works
    .map((work) => buildWorkRecordFields(result, work, WORK_FIELD_DEFINITIONS, ensureResult.fieldByName, ensureResult.fieldOrder))
    .filter((fields) => fields["视频链接"] || fields["标题"]);
  if (!fieldsPayloads.length) {
    throw new Error("没有可写入的作品字段，请检查采集结果。");
  }

  const existingByLink = await listRecordIdsByFieldValue(settings, auth, tableId, ensureResult.fieldByName, "视频链接");
  let created = 0;
  let updated = 0;
  const endpoint = `/bitable/v1/apps/${encodeURIComponent(settings.appToken)}/tables/${encodeURIComponent(tableId)}/records`;

  for (const fields of fieldsPayloads) {
    const link = normalizeReadValue(fields["视频链接"]);
    const existingRecordId = link ? existingByLink.get(link) : "";
    if (existingRecordId) {
      await feishuApi("PUT", `${endpoint}/${encodeURIComponent(existingRecordId)}`, auth, { fields });
      updated += 1;
    } else {
      const saved = await feishuApi("POST", endpoint, auth, { fields });
      const recordId = saved?.record?.record_id || saved?.record_id || "";
      if (link && recordId) existingByLink.set(link, recordId);
      created += 1;
    }
  }

  return {
    tableId,
    tableName: DEFAULT_WORKS_TABLE_NAME,
    created,
    updated,
    total: fieldsPayloads.length,
    createdFields: ensureResult.createdFields,
    skippedFields: ensureResult.skippedFields,
  };
}

async function syncWorksFeishuWithTranscription(result) {
  if (!result?.transcriptionRequested) {
    return syncWorksFeishu(result);
  }

  const transcriptionSettings = await getTranscriptionSettings();
  const feishuSettings = await getFeishuSettings();
  const apiKeyConfigured = Boolean(transcriptionSettings.apiKey);
  const attributedResult = attachCollectorName(result, feishuSettings.collectorName);
  const preparedResult = {
    ...attributedResult,
    transcriptionRequested: true,
    works: (attributedResult.works || []).map((work) => {
      const mediaUrl = preferredTranscriptionMediaUrl(work);
      return {
        ...work,
        mediaUrl: mediaUrl || work.mediaUrl || "",
        transcriptionRequested: true,
        transcriptStatus: !apiKeyConfigured
          ? "未转写：请先配置阿里云 API Key"
          : mediaUrl ? "等待转写" : "无法转写：缺少视频文件地址",
      };
    }),
  };

  const syncResult = await syncWorksFeishu(preparedResult);
  if (!apiKeyConfigured) {
    return {
      ...syncResult,
      transcription: {
        requested: true,
        queued: 0,
        existing: 0,
        skipped: preparedResult.works.length,
        missingApiKey: true,
      },
    };
  }

  const queueResult = await enqueueTranscriptionForResult(preparedResult);
  return {
    ...syncResult,
    transcription: {
      requested: true,
      missingApiKey: false,
      ...queueResult,
    },
  };
}

async function processBaseTranscriptionRequests() {
  if (baseTranscriptionRequestProcessing) return { running: true };
  baseTranscriptionRequestProcessing = true;
  try {
    const transcriptionSettings = await getTranscriptionSettings();
    if (!transcriptionSettings.apiKey) {
      return { blocked: true, reason: "missing-api-key" };
    }

    const settings = normalizeSettings(await getFeishuSettings());
    const auth = await getFeishuAuth(settings);
    const table = await getOrCreateWorksTable(settings, auth, { works: [] });
    const tableId = table.table_id || table.tableId;
    if (!tableId) throw new Error("没有拿到视频数据表 ID");

    const requestFieldDefinition = WORK_FIELD_DEFINITIONS.find((def) => def.name === BASE_TRANSCRIPTION_REQUEST_FIELD);
    const ensured = await ensureFields(settings, auth, [requestFieldDefinition], { works: [] }, tableId);
    const fieldByName = ensured.fieldByName;
    const records = await listWorksTableRecords(settings, auth, tableId);
    const requestedRecords = records.filter((record) =>
      isCheckedCell(readBaseRecordField(record, fieldByName, BASE_TRANSCRIPTION_REQUEST_FIELD)));

    let accepted = 0;
    let failed = 0;
    for (const record of requestedRecords.slice(0, 50)) {
      try {
        const result = await processBaseTranscriptionRequestRecord(settings, auth, tableId, fieldByName, record);
        if (result.accepted) accepted += 1;
        else if (result.failed) failed += 1;
      } catch (error) {
        failed += 1;
        const message = error?.message || String(error);
        await updateWorksTableRecord(settings, auth, tableId, record.record_id, {
          "逐字稿状态": `补转准备失败：${message.slice(0, 120)}`,
        }).catch(() => undefined);
      }
    }
    return { scanned: records.length, requested: requestedRecords.length, accepted, failed };
  } finally {
    baseTranscriptionRequestProcessing = false;
  }
}

async function processBaseTranscriptionRequestRecord(settings, auth, tableId, fieldByName, record) {
  const videoLink = normalizeReadValue(
    readBaseRecordField(record, fieldByName, "视频链接")
      || readBaseRecordField(record, fieldByName, "作品网址"),
  ).trim();
  if (!videoLink) {
    await updateWorksTableRecord(settings, auth, tableId, record.record_id, {
      "逐字稿状态": "无法补转：缺少视频链接",
    });
    return { accepted: false, failed: true };
  }

  const storedSourceUrl = normalizeReadValue(readBaseRecordField(record, fieldByName, "视频源网址")).trim();
  const collectorName = normalizeReadValue(readBaseRecordField(record, fieldByName, "收集人")).trim();
  let work = {
    id: extractAwemeIdFromVideoLink(videoLink),
    awemeId: extractAwemeIdFromVideoLink(videoLink),
    title: normalizeReadValue(readBaseRecordField(record, fieldByName, "标题")).trim(),
    authorName: normalizeReadValue(readBaseRecordField(record, fieldByName, "博主名称")).trim(),
    collectorName,
    videoLink,
    mediaUrl: isUsableTranscriptionMediaUrl(storedSourceUrl) ? storedSourceUrl : "",
    transcriptText: normalizeReadValue(
      readBaseRecordField(record, fieldByName, "直接转逐字稿")
        || readBaseRecordField(record, fieldByName, "逐字稿"),
    ),
    transcriptionRequested: true,
    transcriptStatus: "等待转写",
  };

  if (!isUsableTranscriptionMediaUrl(preferredTranscriptionMediaUrl(work))) {
    const resolved = await resolveDouyinWorkForTranscription(work.awemeId, videoLink);
    work = {
      ...work,
      ...resolved,
      id: work.id || resolved.id || resolved.awemeId,
      awemeId: work.awemeId || resolved.awemeId || resolved.id,
      title: work.title || resolved.title || "",
      authorName: work.authorName || resolved.authorName || "",
      collectorName,
      videoLink,
      transcriptionRequested: true,
      transcriptStatus: "等待转写",
    };
  }

  const mediaUrl = preferredTranscriptionMediaUrl(work);
  if (!isUsableTranscriptionMediaUrl(mediaUrl)) {
    await updateWorksTableRecord(settings, auth, tableId, record.record_id, {
      "逐字稿状态": "无法补转：没有读取到可用视频源",
    });
    return { accepted: false, failed: true };
  }

  work.mediaUrl = mediaUrl;
  const result = {
    sourceUrl: videoLink,
    extractedAt: new Date().toISOString(),
    creatorId: "",
    creatorName: work.authorName,
    collectorName,
    sort: "base-request",
    sortText: "飞书勾选补转",
    filters: {},
    limit: 1,
    count: 1,
    transcriptionRequested: true,
    works: [work],
  };
  const queued = await enqueueTranscriptionForResult(result);
  if (!queued.queued && !queued.existing) {
    await updateWorksTableRecord(settings, auth, tableId, record.record_id, {
      "逐字稿状态": "无法补转：转写任务未能入队",
    });
    return { accepted: false, failed: true };
  }

  await updateWorksTableRecord(settings, auth, tableId, record.record_id, {
    [BASE_TRANSCRIPTION_REQUEST_FIELD]: false,
    "逐字稿状态": queued.existing ? "转写任务已在处理中" : "等待转写",
    "视频源网址": mediaUrl,
  });
  return { accepted: true, queued };
}

async function listWorksTableRecords(settings, auth, tableId) {
  const records = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({ page_size: "500" });
    if (pageToken) query.set("page_token", pageToken);
    const data = await feishuApi(
      "GET",
      `/bitable/v1/apps/${encodeURIComponent(settings.appToken)}/tables/${encodeURIComponent(tableId)}/records?${query.toString()}`,
      auth,
    );
    records.push(...(data?.items || []));
    pageToken = data?.has_more ? data?.page_token || "" : "";
  } while (pageToken);
  return records;
}

function readBaseRecordField(record, fieldByName, fieldName) {
  const fields = record?.fields || {};
  const field = fieldByName.get(fieldName);
  return fields[field?.field_id] ?? fields[fieldName];
}

function isCheckedCell(value) {
  if (value === true || value === 1) return true;
  if (value && typeof value === "object") {
    if ("value" in value) return isCheckedCell(value.value);
    if ("checked" in value) return isCheckedCell(value.checked);
  }
  return String(value || "").toLowerCase() === "true";
}

async function updateWorksTableRecord(settings, auth, tableId, recordId, fields) {
  if (!recordId) throw new Error("缺少飞书记录 ID");
  return feishuApi(
    "PUT",
    `/bitable/v1/apps/${encodeURIComponent(settings.appToken)}/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`,
    auth,
    { fields },
  );
}

function extractAwemeIdFromVideoLink(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    const direct = url.searchParams.get("modal_id") || url.searchParams.get("aweme_id") || "";
    if (/^\d{8,}$/.test(direct)) return direct;
    const match = url.pathname.match(/\/(?:share\/)?(?:video|note)\/(\d{8,})/);
    return match ? match[1] : "";
  } catch (_error) {
    const match = text.match(/\/(?:share\/)?(?:video|note)\/(\d{8,})/);
    return match ? match[1] : "";
  }
}

function isUsableTranscriptionMediaUrl(value) {
  const source = normalizeHttpUrl(value);
  if (!/^https?:\/\//i.test(source)) return false;
  try {
    const url = new URL(source);
    if (url.hostname === "v.douyin.com") return false;
    if ((url.hostname === "douyin.com" || url.hostname.endsWith(".douyin.com"))
      && /\/(?:share\/)?(?:video|note|user)\//.test(url.pathname)) {
      return false;
    }
    return true;
  } catch (_error) {
    return false;
  }
}

async function resolveDouyinWorkForTranscription(awemeId, videoLink) {
  const id = String(awemeId || extractAwemeIdFromVideoLink(videoLink) || "").trim();
  if (!id) throw new Error("视频链接中没有作品 ID");

  try {
    const direct = await fetchDouyinWorkForTranscription(id);
    if (isUsableTranscriptionMediaUrl(preferredTranscriptionMediaUrl(direct))) return direct;
  } catch (_error) {
    // Fall back to the logged-in Douyin page below.
  }

  const monitorTab = await ensureMonitorTab({ active: false, force: true });
  if (!monitorTab.tabId) throw new Error("没有可用的抖音页面");
  await waitForTabLoad(monitorTab.tabId, 15000);
  const response = await sendMessageToTabWithRetry(
    monitorTab.tabId,
    { type: "douhot:resolveWorkForTranscription", awemeId: id },
    8,
    700,
  );
  const work = response?.data?.work || response?.work;
  if (!work) throw new Error(response?.error || "抖音页面没有返回视频源");
  return work;
}

async function fetchDouyinWorkForTranscription(awemeId) {
  const url = new URL("/aweme/v1/web/aweme/detail/", "https://www.douyin.com");
  Object.entries({
    ...douyinWebCommonParams(),
    aweme_id: awemeId,
  }).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json, text/plain, */*" },
  });
  const text = await response.text();
  if (!response.ok || !text) throw new Error(`抖音详情接口没有返回数据：${response.status}`);
  const data = JSON.parse(text);
  const detail = firstPresent([
    data?.aweme_detail,
    data?.awemeDetail,
    data?.item,
    data?.data?.aweme_detail,
    data?.data?.item,
  ]);
  if (!detail) throw new Error("抖音详情接口没有作品数据");
  return normalizeTranscriptionWorkDetail(detail, awemeId);
}

function normalizeTranscriptionWorkDetail(detail, fallbackAwemeId = "") {
  const video = detail?.video || {};
  const playAddress = video?.play_addr || video?.playAddr || {};
  const sourcePlayUri = String(firstPresent([
    playAddress?.uri,
    video?.play_addr_h264?.uri,
    video?.play_addr_265?.uri,
    "",
  ]) || "").trim();
  const mediaFallbackUrl = firstHttpUrl([
    playAddress?.url_list,
    playAddress?.urlList,
    video?.play_addr_h264?.url_list,
    video?.play_addr_265?.url_list,
    video?.download_addr?.url_list,
    video?.downloadAddr?.urlList,
  ]);
  const awemeId = String(firstPresent([
    detail?.aweme_id,
    detail?.awemeId,
    fallbackAwemeId,
  ]) || "").trim();
  const author = detail?.author || {};
  return {
    id: awemeId,
    awemeId,
    title: String(firstPresent([detail?.desc, detail?.title, ""]) || "").trim(),
    authorName: String(firstPresent([author?.nickname, author?.name, ""]) || "").trim(),
    videoLink: awemeId ? `https://www.douyin.com/video/${encodeURIComponent(awemeId)}` : "",
    sourcePlayUri,
    mediaFallbackUrl,
    mediaUrl: buildDouyinSourceUrl(sourcePlayUri) || buildDouyinSourceUrl(mediaFallbackUrl) || normalizeHttpUrl(mediaFallbackUrl),
  };
}

function firstHttpUrl(value, depth = 0) {
  if (!value || depth > 5) return "";
  if (typeof value === "string") {
    return /^https?:\/\//i.test(value) || value.startsWith("//") ? normalizeHttpUrl(value) : "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = firstHttpUrl(item, depth + 1);
      if (url) return url;
    }
    return "";
  }
  if (typeof value === "object") {
    for (const child of Object.values(value)) {
      const url = firstHttpUrl(child, depth + 1);
      if (url) return url;
    }
  }
  return "";
}

function attachCollectorName(result, fallbackName = "") {
  if (!result || !Array.isArray(result.works)) return result;
  const hasCapturedCollector = Object.prototype.hasOwnProperty.call(result, "collectorName");
  const collectorName = String(hasCapturedCollector ? result.collectorName || "" : fallbackName || "").trim();
  return {
    ...result,
    collectorName,
    works: result.works.map((work) => {
      const hasWorkCollector = Object.prototype.hasOwnProperty.call(work, "collectorName");
      return {
        ...work,
        collectorName: String(hasWorkCollector ? work.collectorName || "" : collectorName || "").trim(),
      };
    }),
  };
}

function normalizeSettings(settings) {
  const normalized = { ...DEFAULT_FEISHU_SETTINGS, ...(settings || {}) };
  const missing = [];
  normalized.authMode = normalized.authMode === "openApi" ? "openApi" : "personalBaseToken";
  if (normalized.authMode === "openApi") {
    if (!normalized.appId) missing.push("App ID");
    if (!normalized.appSecret) missing.push("App Secret");
  } else if (!normalized.personalBaseToken) {
    missing.push("多维表格授权码 personalBaseToken");
  }
  if (!normalized.appToken) missing.push("多维表格 app_token/base_token");
  if (!normalized.tableId) missing.push("table_id");
  if (missing.length) {
    throw new Error(`飞书配置不完整：${missing.join("、")}`);
  }
  return normalized;
}

async function getFeishuAuth(settings) {
  if (settings.authMode === "openApi") {
    return {
      token: await getTenantAccessToken(settings),
      apiBase: "https://open.feishu.cn/open-apis",
    };
  }
  return {
    token: settings.personalBaseToken,
    apiBase: "https://base-api.feishu.cn/open-apis",
  };
}

async function getTenantAccessToken(settings) {
  const cache = await chrome.storage.local.get({ feishuTokenCache: null });
  if (cache.feishuTokenCache?.token && cache.feishuTokenCache.expiresAt > Date.now() + 60000) {
    return cache.feishuTokenCache.token;
  }

  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: settings.appId,
      app_secret: settings.appSecret,
    }),
  });
  const json = await response.json();
  if (!response.ok || json.code !== 0) {
    throw new Error(`获取 tenant_access_token 失败：${json.msg || json.message || response.status}`);
  }

  const token = json.tenant_access_token;
  const expiresAt = Date.now() + Math.max(1, Number(json.expire || 7200) - 120) * 1000;
  await chrome.storage.local.set({ feishuTokenCache: { token, expiresAt } });
  return token;
}

async function listFields(settings, auth, tableId = settings.tableId) {
  const items = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({ page_size: "100" });
    if (pageToken) query.set("page_token", pageToken);
    const data = await feishuApi(
      "GET",
      `/bitable/v1/apps/${encodeURIComponent(settings.appToken)}/tables/${encodeURIComponent(tableId)}/fields?${query.toString()}`,
      auth,
    );
    items.push(...(data?.items || []));
    pageToken = data?.has_more ? data?.page_token || "" : "";
  } while (pageToken);
  return items;
}

async function ensureFields(settings, auth, defs, result, tableId = settings.tableId) {
  let fields = await listFields(settings, auth, tableId);
  let fieldByName = mapFieldsByName(fields);
  const missingDefs = defs.filter((def) => !fieldByName.has(def.name));
  const createdFields = [];

  if (missingDefs.length && settings.autoCreateFields) {
    for (const def of missingDefs) {
      await feishuApi(
        "POST",
        `/bitable/v1/apps/${encodeURIComponent(settings.appToken)}/tables/${encodeURIComponent(tableId)}/fields`,
        auth,
        buildFieldCreatePayload(def, result),
      );
      createdFields.push(def.name);
    }
    fields = await listFields(settings, auth, tableId);
    fieldByName = mapFieldsByName(fields);
  }

  const skippedFields = defs.filter((def) => !fieldByName.has(def.name)).map((def) => def.name);
  return { fieldByName, fieldOrder: mapFieldOrder(fields), createdFields, skippedFields };
}

function buildFieldCreatePayload(def, result) {
  const payload = { field_name: def.name, type: def.type };
  if (def.uiType) payload.ui_type = def.uiType;
  const property = typeof def.property === "function" ? def.property(result) : def.property;
  if (property) payload.property = property;
  return payload;
}

async function listTables(settings, auth) {
  const items = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({ page_size: "100" });
    if (pageToken) query.set("page_token", pageToken);
    const data = await feishuApi(
      "GET",
      `/bitable/v1/apps/${encodeURIComponent(settings.appToken)}/tables?${query.toString()}`,
      auth,
    );
    items.push(...(data?.items || data?.tables || []));
    pageToken = data?.has_more ? data?.page_token || "" : "";
  } while (pageToken);
  return items;
}

async function getOrCreateWorksTable(settings, auth, result) {
  const tables = await listTables(settings, auth);
  const existing = tables.find((table) => (table.name || table.table_name) === DEFAULT_WORKS_TABLE_NAME);
  if (existing) return existing;

  const created = await feishuApi(
    "POST",
    `/bitable/v1/apps/${encodeURIComponent(settings.appToken)}/tables`,
    auth,
    {
      table: {
        name: DEFAULT_WORKS_TABLE_NAME,
        default_view_name: "全部作品",
        fields: WORK_FIELD_DEFINITIONS.map((def) => buildFieldCreatePayload(def, result)),
      },
    },
  );
  return created?.table || created;
}

async function ensureDynamicOptions(settings, auth, tableId, fieldByName, defs, result) {
  for (const def of defs) {
    if (!def.options) continue;
    const field = fieldByName.get(def.name);
    if (!field?.field_id) continue;
    const wanted = uniqueStrings(def.options(result));
    if (!wanted.length) continue;
    const existingOptions = field.property?.options || [];
    const existingNames = new Set(existingOptions.map((option) => option.name).filter(Boolean));
    const missing = wanted.filter((name) => !existingNames.has(name));
    if (!missing.length) continue;

    const property = {
      ...(field.property || {}),
      options: [...existingOptions, ...missing.map((name) => ({ name }))],
    };
    try {
      await feishuApi(
        "PUT",
        `/bitable/v1/apps/${encodeURIComponent(settings.appToken)}/tables/${encodeURIComponent(tableId)}/fields/${encodeURIComponent(field.field_id)}`,
        auth,
        { field_name: field.field_name || field.name || def.name, type: field.type || def.type, property },
      );
    } catch (error) {
      // Some Base endpoints can auto-create option names during record writes. Keep going and let the write surface the real error if not.
    }
  }
}

function buildWorkRecordFields(result, work, defs, fieldByName, fieldOrder) {
  const payload = {};
  const orderedDefs = defs
    .slice()
    .sort((left, right) => (fieldOrder.get(left.name) ?? Number.MAX_SAFE_INTEGER) - (fieldOrder.get(right.name) ?? Number.MAX_SAFE_INTEGER));
  for (const def of orderedDefs) {
    const field = fieldByName.get(def.name);
    if (!field) continue;
    const value = normalizeCellValue(field.type || def.type, def.pick({ result, work }));
    if (value === undefined) continue;
    payload[field.field_name || field.name || def.name] = value;
  }
  return payload;
}

async function listRecordIdsByFieldValue(settings, auth, tableId, fieldByName, fieldName) {
  const field = fieldByName.get(fieldName);
  if (!field) return new Map();

  const map = new Map();
  let pageToken = "";
  do {
    const query = new URLSearchParams({ page_size: "500" });
    if (pageToken) query.set("page_token", pageToken);
    const data = await feishuApi(
      "GET",
      `/bitable/v1/apps/${encodeURIComponent(settings.appToken)}/tables/${encodeURIComponent(tableId)}/records?${query.toString()}`,
      auth,
    );
    const records = data?.items || [];
    records.forEach((record) => {
      const fields = record.fields || {};
      const value = normalizeReadValue(fields[field.field_id] ?? fields[fieldName]);
      if (value && record.record_id) map.set(value, record.record_id);
    });
    pageToken = data?.has_more ? data?.page_token || "" : "";
  } while (pageToken);
  return map;
}

async function findRecordIdByCreatorId(settings, auth, fieldByName, creatorId) {
  if (!creatorId) return "";
  const creatorField = fieldByName.get("达人ID");
  if (!creatorField) return "";

  let pageToken = "";
  do {
    const query = new URLSearchParams({ page_size: "100" });
    if (pageToken) query.set("page_token", pageToken);
    const data = await feishuApi(
      "GET",
      `/bitable/v1/apps/${encodeURIComponent(settings.appToken)}/tables/${encodeURIComponent(settings.tableId)}/records?${query.toString()}`,
      auth,
    );
    const records = data?.items || [];
    const matched = records.find((record) => {
      const fields = record.fields || {};
      const value = fields[creatorField.field_id] ?? fields["达人ID"];
      return normalizeReadValue(value) === creatorId;
    });
    if (matched?.record_id) return matched.record_id;
    pageToken = data?.has_more ? data?.page_token || "" : "";
  } while (pageToken);
  return "";
}

function mapFieldsByName(fields) {
  return new Map(fields.map((field) => [field.field_name || field.name, field]));
}

function mapFieldOrder(fields) {
  return new Map(fields.map((field, index) => [field.field_name || field.name, index]));
}

function buildRecordFields(result, defs, fieldByName, fieldOrder) {
  const payload = {};
  const orderedDefs = defs
    .slice()
    .sort((left, right) => {
      if (left.name === "达人ID") return 1;
      if (right.name === "达人ID") return -1;
      return (fieldOrder.get(left.name) ?? Number.MAX_SAFE_INTEGER) - (fieldOrder.get(right.name) ?? Number.MAX_SAFE_INTEGER);
    });
  for (const def of orderedDefs) {
    const field = fieldByName.get(def.name);
    if (!field) continue;
    const value = normalizeCellValue(field.type || def.type, def.pick(result));
    if (value === undefined) continue;
    payload[field.field_name || field.name || def.name] = value;
  }
  return payload;
}

function normalizeCellValue(type, value) {
  if (value === undefined || value === null) return undefined;
  const typeNumber = Number(type);
  if (typeNumber === FIELD_TYPE.number) {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  if (typeNumber === FIELD_TYPE.dateTime || type === "DateTime") {
    return normalizeDateTimeValue(value);
  }
  if (typeNumber === FIELD_TYPE.checkbox || type === "Checkbox") {
    return value === true || value === 1 || String(value).toLowerCase() === "true";
  }
  if (typeNumber === FIELD_TYPE.multiSelect || type === "MultiSelect") {
    const values = Array.isArray(value) ? value : String(value).split(/[、,，]/);
    const normalized = uniqueStrings(values);
    return normalized.length ? normalized : undefined;
  }
  if (Array.isArray(value)) return value.join("、");
  return String(value);
}

function normalizeDateTimeValue(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    return value > 100000000000 ? Math.round(value) : Math.round(value * 1000);
  }
  const text = String(value).trim();
  if (!text) return undefined;
  if (/^\d+$/.test(text)) {
    const number = Number(text);
    return Number.isFinite(number) ? (number > 100000000000 ? number : number * 1000) : undefined;
  }
  const normalized = text.includes("T") ? text : text.replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date.getTime();
}

function getTags(result) {
  return uniqueStrings(result?.profile?.tags || []);
}

function uniqueStrings(values) {
  const seen = new Set();
  const list = [];
  for (const value of values || []) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    list.push(text);
  }
  return list;
}

function normalizeReadValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeReadValue).join("");
  }
  if (value && typeof value === "object") {
    if ("text" in value) return String(value.text || "");
    if ("value" in value) return String(value.value || "");
    return JSON.stringify(value);
  }
  return value === undefined || value === null ? "" : String(value);
}

async function feishuApi(method, path, auth, body) {
  const response = await fetch(`${auth.apiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${auth.token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let json;
  try {
    json = await response.json();
  } catch (error) {
    throw new Error(`飞书接口没有返回 JSON：${response.status}`);
  }
  if (!response.ok || json.code !== 0) {
    throw new Error(`飞书接口失败：${json.msg || json.message || json.error || response.status}`);
  }
  return json.data;
}

function formatRows(rows = [], limit) {
  const list = limit ? rows.slice(0, limit) : rows;
  return list
    .map((row) => `${row.name || ""} ${row.ratioText || ""}${row.tgiText ? ` / TGI ${row.tgiText}` : ""}`.trim())
    .filter(Boolean)
    .join("，");
}

function portraitPercent(result, name) {
  const row = (result.fanPortrait?.gender || []).find((item) => item.name === name);
  if (!row) return undefined;
  const value = Number(row.ratio);
  if (!Number.isFinite(value)) return undefined;
  return Math.abs(value) <= 1 ? Number((value * 100).toFixed(2)) : value;
}

function portraitTgi(result, name) {
  const row = (result.fanPortrait?.gender || []).find((item) => item.name === name);
  const value = Number(row?.tgi);
  return Number.isFinite(value) ? value : undefined;
}

function integerValue(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : undefined;
}

function formatDateTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return String(value || "");
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function fetchDouyinTopComments(awemeId, videoLink = "", creatorName = "", sourceTabId = 0) {
  const id = String(awemeId || "").trim();
  if (!id) return { comments: [] };

  let lastError = "";
  let collected = [];
  for (const url of buildDouyinCommentUrls(id)) {
    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json, text/plain, */*" },
      });
      const text = await response.text();
      if (!response.ok || !text) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      const data = JSON.parse(text);
      const comments = normalizeDouyinComments(extractDouyinCommentList(data));
      collected = mergeUniqueDouyinComments(collected, comments);
      const code = firstPresent([data?.status_code, data?.statusCode, data?.code, data?.data?.status_code, data?.data?.code]);
      if (code !== undefined && code !== null && Number(code) !== 0) {
        lastError = String(firstPresent([data?.status_msg, data?.statusMsg, data?.msg, data?.message, data?.data?.status_msg]) || code);
      }
    } catch (error) {
      lastError = error.message || String(error);
    }
  }
  if (videoLink) {
    const pageResult = await fetchDouyinTopCommentsFromVideoTab(videoLink, id, creatorName, sourceTabId);
    collected = mergeUniqueDouyinComments(collected, pageResult.comments || []);
    if (collected.length || pageResult.error) return { ...pageResult, comments: collected.slice(0, 3) };
  }
  return { comments: collected.slice(0, 3), error: lastError };
}

async function fetchDouyinTopCommentsFromVideoTab(videoLink, awemeId, creatorName = "", sourceTabId = 0) {
  const url = normalizeVideoPageUrl(videoLink, awemeId);
  if (!url) return { comments: [], error: "没有视频链接" };

  let tabId = 0;
  try {
    tabId = await openOrUpdateCommentReaderTab(url);
    await waitForTabLoad(tabId, 18000);
    await delay(2600);
    const response = await sendMessageToTabWithRetry(tabId, { type: "douhot:extractVideoComments", awemeId, creatorName }, 10, 900);
    const comments = normalizeDouyinComments(response?.data?.comments || response?.comments || []);
    return { comments };
  } catch (error) {
    return { comments: [], error: error.message || String(error) };
  } finally {
    if (sourceTabId && tabId && sourceTabId !== tabId) {
      chrome.tabs.update(sourceTabId, { active: true }, () => {
        chrome.runtime.lastError;
      });
    }
    scheduleCommentReaderClose();
  }
}

function normalizeVideoPageUrl(videoLink, awemeId) {
  const text = String(videoLink || "").trim();
  try {
    const url = new URL(text || `https://www.douyin.com/video/${encodeURIComponent(awemeId)}`);
    if (!/douyin\.com$/.test(url.hostname) && !url.hostname.endsWith(".douyin.com")) return "";
    if (!/\/(?:share\/)?(?:video|note)\//.test(url.pathname)) {
      return awemeId ? `https://www.douyin.com/video/${encodeURIComponent(awemeId)}` : "";
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (error) {
    return awemeId ? `https://www.douyin.com/video/${encodeURIComponent(awemeId)}` : "";
  }
}

async function openOrUpdateCommentReaderTab(url) {
  clearTimeout(commentReaderCloseTimer);
  if (commentReaderTabId) {
    try {
      await chromePromise(chrome.tabs.get, commentReaderTabId);
      await chromePromise(chrome.tabs.update, commentReaderTabId, { url, active: true });
      return commentReaderTabId;
    } catch (error) {
      commentReaderTabId = 0;
    }
  }
  const tab = await chromePromise(chrome.tabs.create, { url, active: true });
  commentReaderTabId = tab.id || 0;
  return commentReaderTabId;
}

function scheduleCommentReaderClose() {
  clearTimeout(commentReaderCloseTimer);
  commentReaderCloseTimer = setTimeout(() => {
    const tabId = commentReaderTabId;
    commentReaderTabId = 0;
    if (tabId) {
      chrome.tabs.remove(tabId, () => {
        chrome.runtime.lastError;
      });
    }
  }, 15000);
}

function waitForTabLoad(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish();
    };
    const timeoutId = setTimeout(finish, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (tab) => {
      if (!chrome.runtime.lastError && tab?.status === "complete") finish();
    });
  });
}

async function sendMessageToTabWithRetry(tabId, message, retries, intervalMs) {
  let lastError = "";
  for (let index = 0; index < retries; index += 1) {
    try {
      const response = await chromePromise(chrome.tabs.sendMessage, tabId, message);
      if (response?.ok) return response;
      if (response) return response;
    } catch (error) {
      lastError = error.message || String(error);
    }
    await delay(intervalMs);
  }
  throw new Error(lastError || "视频详情页没有返回评论数据");
}

function chromePromise(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(result);
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildDouyinCommentUrls(awemeId) {
  return [
    { sort_type: 2 },
    { sort_type: 0 },
  ].map((extraParams) => {
    const url = new URL("https://www.douyin.com/aweme/v1/web/comment/list/");
    Object.entries({
      ...douyinWebCommonParams(),
      aweme_id: awemeId,
      cursor: 0,
      count: 20,
      item_type: 0,
      insert_ids: "",
      ...extraParams,
    }).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    });
    return url;
  });
}

function douyinWebCommonParams() {
  const nav = typeof navigator === "undefined" ? {} : navigator;
  return {
    device_platform: "webapp",
    aid: "6383",
    channel: "channel_pc_web",
    pc_client_type: 1,
    version_code: "170400",
    version_name: "17.4.0",
    cookie_enabled: nav.cookieEnabled === undefined ? true : nav.cookieEnabled,
    browser_language: nav.language || "zh-CN",
    browser_platform: nav.platform || "",
    browser_name: "Chrome",
    browser_version: browserVersion(nav.userAgent || ""),
    browser_online: nav.onLine === undefined ? true : nav.onLine,
    engine_name: "Blink",
    engine_version: browserVersion(nav.userAgent || ""),
    os_name: detectOsName(nav.platform || nav.userAgent || ""),
    os_version: "",
  };
}

function browserVersion(userAgent) {
  const match = String(userAgent || "").match(/(?:Chrome|CriOS)\/([\d.]+)/);
  return match ? match[1] : "";
}

function detectOsName(value) {
  const text = String(value || "");
  if (/Mac/i.test(text)) return "Mac OS";
  if (/Win/i.test(text)) return "Windows";
  if (/Android/i.test(text)) return "Android";
  if (/iPhone|iPad|iOS/i.test(text)) return "iOS";
  if (/Linux/i.test(text)) return "Linux";
  return "";
}

function extractDouyinCommentList(data) {
  const direct = firstArray([
    data?.comments,
    data?.comment_list,
    data?.commentList,
    data?.items,
    data?.data?.comments,
    data?.data?.comment_list,
    data?.data?.commentList,
    data?.data?.items,
  ]);
  if (direct?.length) return direct;

  const queue = [data];
  const visited = new Set();
  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== "object" || visited.has(value)) continue;
    visited.add(value);
    if (Array.isArray(value)) {
      if (value.some(looksLikeDouyinComment)) return value;
      value.forEach((child) => {
        if (child && typeof child === "object") queue.push(child);
      });
      continue;
    }
    Object.values(value).forEach((child) => {
      if (child && typeof child === "object") queue.push(child);
    });
  }
  return [];
}

function looksLikeDouyinComment(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value.text || value.comment_text || value.content || value.reply_comment?.text) &&
      (value.user || value.user_info || value.cid || value.comment_id || value.digg_count !== undefined),
  );
}

function normalizeDouyinComments(comments) {
  return sortCommentsByLikeCount((Array.isArray(comments) ? comments : [])
    .map(normalizeDouyinComment)
    .filter((comment) => comment.text))
    .slice(0, 3);
}

function mergeUniqueDouyinComments(existing, comments) {
  const merged = [];
  const seen = new Set();
  for (const comment of [...(existing || []), ...(comments || [])]) {
    const text = cleanText(comment?.text);
    if (!text) continue;
    const key = `${cleanText(comment?.author)}\n${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...comment, text });
  }
  return sortCommentsByLikeCount(merged);
}

function normalizeDouyinComment(comment) {
  return {
    text: cleanText(commentText(firstPresent([comment?.text, comment?.comment_text, comment?.content, comment?.reply_comment?.text]))),
    author: cleanText(firstPresent([comment?.user?.nickname, comment?.user_info?.nickname, comment?.author?.nickname, comment?.author, comment?.user?.unique_id, comment?.user?.short_id, comment?.nickname])),
    likeCount: integerOrNull(firstPresent([comment?.likeCount, comment?.digg_count, comment?.diggCount, comment?.like_count, comment?.statistics?.digg_count])),
  };
}

function commentText(value) {
  if (Array.isArray(value)) return value.map(commentText).filter(Boolean).join("");
  if (value && typeof value === "object") {
    return firstPresent([value.text, value.content, value.string, value.value]) || "";
  }
  return value;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseCreatorIdFromText(input) {
  const source = String(input || "").trim();
  if (!source) return "";
  const candidates = uniqueStrings([source, ...extractUrls(source)]);
  for (const candidate of candidates) {
    const creatorId = parseCreatorIdCandidate(candidate);
    if (creatorId) return creatorId;
  }
  return "";
}

function parseCreatorIdCandidate(input) {
  const source = String(input || "").trim().replace(/[，。；;、]+$/, "");
  if (!source) return "";
  try {
    const url = new URL(source);
    const direct =
      url.searchParams.get("creator_id") ||
      url.searchParams.get("sec_uid") ||
      url.searchParams.get("secUid") ||
      url.searchParams.get("sec_user_id");
    if (direct) return normalizeCreatorId(direct);

    const userMatch = url.pathname.match(/\/(?:user|share\/user)\/([^/?#]+)/);
    if (userMatch) return normalizeCreatorId(decodeURIComponent(userMatch[1]));
  } catch (error) {
    // Share text often contains a URL plus surrounding copy; regex parsing handles that below.
  }

  const creatorMatch = source.match(/[?&]creator_id=([^&#\s]+)/);
  if (creatorMatch) return normalizeCreatorId(decodeURIComponent(creatorMatch[1]));
  const secUidMatch = source.match(/[?&](?:sec_uid|secUid|sec_user_id)=([^&#\s]+)/);
  if (secUidMatch) return normalizeCreatorId(decodeURIComponent(secUidMatch[1]));
  const userMatch = source.match(/\/(?:user|share\/user)\/([^/?#\s]+)/);
  if (userMatch) return normalizeCreatorId(decodeURIComponent(userMatch[1]));

  if (/^[\w.-]{12,}$/.test(source)) return normalizeCreatorId(source);
  return "";
}

function extractCreatorIdFromDouyinHtml(text) {
  const source = String(text || "");
  const patterns = [
    /"sec_uid"\s*:\s*"([^"]+)"/,
    /"secUid"\s*:\s*"([^"]+)"/,
    /"sec_user_id"\s*:\s*"([^"]+)"/,
    /%22sec_uid%22%3A%22([^"%]+)%22/,
    /%22secUid%22%3A%22([^"%]+)%22/,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return normalizeCreatorId(decodeHtmlJsonValue(match[1]));
  }
  return "";
}

function extractRedirectUrl(text, baseUrl) {
  const source = String(text || "");
  const match =
    source.match(/location\.(?:href|replace)\s*=\s*["']([^"']+)["']/) ||
    source.match(/location\.replace\(["']([^"']+)["']\)/) ||
    source.match(/<a[^>]+href=["']([^"']+)["']/i);
  if (!match) return "";
  try {
    return new URL(decodeHtmlJsonValue(match[1]), baseUrl).toString();
  } catch (error) {
    return "";
  }
}

function extractFirstUrl(text) {
  const urls = extractUrls(text);
  return urls.find((url) => /(^|\.)douyin\.com$/i.test(safeHostname(url))) || urls[0] || "";
}

function extractUrls(text) {
  return (String(text || "").match(/https?:\/\/[^\s"'<>，。；、]+/g) || []).map(normalizeSharedUrl).filter(Boolean);
}

function normalizeSharedUrl(url) {
  return String(url || "").trim().replace(/[，。；;、,.!?！？)）\]】}]+$/, "");
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (error) {
    return "";
  }
}

function normalizeCreatorId(value) {
  const text = decodeHtmlJsonValue(value).trim().replace(/[，。；;、/]+$/, "");
  if (!text || /^(self|me)$/i.test(text)) return "";
  return text;
}

function decodeHtmlJsonValue(value) {
  const text = String(value || "");
  const normalizeEscapes = (source) => source.replace(/\\\//g, "/").replace(/\\u002F/g, "/").replace(/\\u0026/g, "&").replace(/\\u003D/g, "=");
  try {
    return normalizeEscapes(decodeURIComponent(text));
  } catch (error) {
    return normalizeEscapes(text);
  }
}

function firstPresent(values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function firstArray(values) {
  return values.find((value) => Array.isArray(value));
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const text = value.replace(/,/g, "").trim();
    const multiplier = text.includes("亿") ? 100000000 : text.includes("万") || /w$/i.test(text) ? 10000 : /k$/i.test(text) ? 1000 : 1;
    const normalized = text.replace(/[^\d.-]/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed * multiplier : null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberValue(value) {
  const number = numberOrNull(value);
  return number === null ? -Infinity : number;
}

function integerOrNull(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number);
}

function sortCommentsByLikeCount(comments) {
  const list = (comments || []).slice();
  const hasLikeCount = list.some((comment) => comment.likeCount !== undefined && comment.likeCount !== null);
  if (!hasLikeCount) return list;
  return list.sort((left, right) => {
    const leftHas = left.likeCount !== undefined && left.likeCount !== null;
    const rightHas = right.likeCount !== undefined && right.likeCount !== null;
    if (leftHas && rightHas) return numberValue(right.likeCount) - numberValue(left.likeCount);
    if (leftHas) return -1;
    if (rightHas) return 1;
    return 0;
  });
}

chrome.alarms.create(BASE_TRANSCRIPTION_REQUEST_ALARM, { periodInMinutes: 1 });

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(MONITOR_RETRY_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(TRANSCRIPTION_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(BASE_TRANSCRIPTION_REQUEST_ALARM, { periodInMinutes: 1 });
  void ensureMonitorTab({ active: false }).catch(() => undefined);
  void drainMonitorQueue().catch(() => undefined);
  void processBaseTranscriptionRequests().catch(() => undefined);
  void migrateForbiddenTranscriptionJobs()
    .then(() => processTranscriptionJobs())
    .catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(MONITOR_RETRY_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(TRANSCRIPTION_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(BASE_TRANSCRIPTION_REQUEST_ALARM, { periodInMinutes: 1 });
  void getMonitorSettings()
    .then((settings) => settings.openOnStartup && ensureMonitorTab({ active: false }))
    .catch(() => undefined);
  void drainMonitorQueue().catch(() => undefined);
  void processBaseTranscriptionRequests().catch(() => undefined);
  void migrateForbiddenTranscriptionJobs()
    .then(() => processTranscriptionJobs())
    .catch(() => undefined);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === MONITOR_RETRY_ALARM) {
    void ensureMonitorTab({ active: false }).catch(() => undefined);
    void drainMonitorQueue().catch(() => undefined);
    return;
  }
  if (alarm.name === TRANSCRIPTION_ALARM) {
    void migrateForbiddenTranscriptionJobs()
      .then(() => processTranscriptionJobs())
      .catch(() => undefined);
    return;
  }
  if (alarm.name === BASE_TRANSCRIPTION_REQUEST_ALARM) {
    void processBaseTranscriptionRequests().catch(() => undefined);
  }
});
