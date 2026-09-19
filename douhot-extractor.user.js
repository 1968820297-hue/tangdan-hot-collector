// ==UserScript==
// @name         汤淡采集
// @namespace    https://douhot.douyin.com/
// @version      0.3.9
// @description  一键提取抖音热点宝达人基础信息、近30天互动数据和粉丝画像。
// @author       汤淡
// @match        https://douhot.douyin.com/*
// @match        https://www.douyin.com/*
// @match        https://douyin.com/*
// @match        https://www.iesdouyin.com/*
// @match        https://iesdouyin.com/*
// @match        https://www.douyin.com/user/*
// @match        https://douyin.com/user/*
// @match        https://www.douyin.com/video/*
// @match        https://douyin.com/video/*
// @match        https://www.douyin.com/note/*
// @match        https://douyin.com/note/*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const API_BASE = "https://douhot.douyin.com";
  const AUTO_PARAM = "douhot_auto_extract";
  const SYNC_PARAM = "douhot_auto_sync";
  const WORKS_PARAM = "douhot_auto_works";
  const WORKS_SORT_PARAM = "douhot_works_sort";
  const WORKS_LIMIT_PARAM = "douhot_works_limit";
  const WORKS_SYNC_PARAM = "douhot_works_sync";
  const WORKS_DOWNLOAD_PARAM = "douhot_works_download";
  const WORKS_DATE_START_PARAM = "douhot_works_date_start";
  const WORKS_DATE_END_PARAM = "douhot_works_date_end";
  const WORKS_LIKE_MIN_PARAM = "douhot_works_like_min";
  const WORKS_COMMENTS_PARAM = "douhot_works_comments";
  const WORKS_TRANSCRIBE_PARAM = "douhot_works_transcribe";
  const PANEL_ID = "douhot-creator-extractor-panel";
  const PANEL_BUILD_LABEL = "0.3.9";
  const PANEL_POSITION_STORAGE_KEY = "douhot-extractor-panel-position";
  const PANEL_COLLAPSED_STORAGE_KEY = "douhot-extractor-panel-collapsed";
  const WORKS_FILTER_DIALOG_ID = "douhot-works-filter-dialog";
  const NAME_MAP = {
    male: "男",
    female: "女",
    "-18": "18岁以下",
    "18-23": "18-23岁",
    "24-30": "24-30岁",
    "31-40": "31-40岁",
    "41-50": "41-50岁",
    "50-": "50岁以上",
    "一线": "一线城市",
    "新一线": "新一线城市",
    "二线": "二线城市",
    "三线": "三线城市",
    "四线": "四线城市",
    "五线": "五线城市",
    "六线及以下": "六线及以下城市",
    "特区": "特区",
    "其他": "其他城市",
  };

  const PORTRAIT_OPTIONS = {
    gender: 2,
    age: 3,
    province: 4,
    city: 5,
    cityLevel: 6,
    devicePrice: 1,
    deviceBrand: 7,
  };

  const PRODUCT_30D_KEYS = {
    avg_like_count: "averageLikes",
    avg_share_count: "averageShares",
    avg_comment_count: "averageComments",
  };

  const PRODUCT_30D_LABELS = {
    averageLikes: "近30天平均点赞量",
    averageShares: "近30天平均分享量",
    averageComments: "近30天平均评论量",
  };

  const WORKS_ENDPOINTS = [
    "/douhot/v1/author_analysis/product_analysis/product_list",
    "/douhot/v1/author_analysis/product_analysis/aweme_list",
    "/douhot/v1/author_analysis/product_analysis/item_list",
  ];

  const WORKS_SORT_OPTIONS = {
    default: "主页/接口默认顺序",
    like_desc: "点赞高到低",
    comment_desc: "评论高到低",
  };
  const COMMENT_EMPTY_TEXT = "未读取到热评";
  const COMMENT_FAILED_TEXT = "热评读取失败";
  const COMMENT_DOM_COLLECT_LIMIT = 30;
  const DOUYIN_PLACEHOLDER_TEXTS = new Set([
    "搜索",
    "我的",
    "首页",
    "推荐",
    "关注",
    "朋友",
    "商城",
    "直播",
    "消息",
    "发布视频",
    "抖音",
    "抖音短视频",
  ]);
  const COMMENT_MIN_SCAN_PASSES = 4;
  const COMMENT_MAX_SCAN_PASSES = 8;

  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function parseCreatorId(input) {
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
      const url = new URL(source, location.href);
      const direct =
        url.searchParams.get("creator_id") ||
        url.searchParams.get("sec_uid") ||
        url.searchParams.get("secUid") ||
        url.searchParams.get("sec_user_id");
      if (direct) return normalizeCreatorId(direct);

      const userMatch = url.pathname.match(/\/(?:user|share\/user)\/([^/?#]+)/);
      if (userMatch) return normalizeCreatorId(decodeURIComponent(userMatch[1]));
    } catch (error) {
      // Fall through to regex parsing for share text that contains a URL.
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

  function normalizeCreatorId(value) {
    const text = String(value || "").trim().replace(/[，。；;、/]+$/, "");
    if (!text || /^(self|me)$/i.test(text)) return "";
    return text;
  }

  function extractUrls(text) {
    return (String(text || "").match(/https?:\/\/[^\s"'<>，。；、]+/g) || []).map(normalizeSharedUrl).filter(Boolean);
  }

  function normalizeSharedUrl(url) {
    return String(url || "").trim().replace(/[，。；;、,.!?！？)）\]】}]+$/, "");
  }

  function currentCreatorId(awemeId = "", inferFromPage = false) {
    const direct = parseCreatorId(location.href);
    if (direct || !inferFromPage) return direct;
    return inferCreatorIdFromPage(awemeId);
  }

  function inferCreatorIdFromPage(awemeId = "") {
    const scriptWorks = collectDouyinWorksFromScripts();
    const fromWorks = getCreatorIdFromWorks(scriptWorks, awemeId);
    if (fromWorks) return fromWorks;

    const fromAnchors = getCreatorIdFromAnchors();
    if (fromAnchors) return fromAnchors;

    return getCreatorIdFromScriptText(awemeId);
  }

  function getCreatorIdFromWorks(works, awemeId = "") {
    const matched = findCurrentVideoWork(works || [], awemeId);
    return getCreatorIdFromWork(matched) || firstPresent((works || []).map(getCreatorIdFromWork)) || "";
  }

  function getCreatorIdFromWork(work) {
    return normalizeCreatorId(firstPresent([
      work?.author?.sec_uid,
      work?.author?.secUid,
      work?.author?.sec_user_id,
      work?.author?.secUserId,
      work?.authorInfo?.sec_uid,
      work?.authorInfo?.secUid,
      work?.author_info?.sec_uid,
      work?.author_info?.secUid,
      work?.user?.sec_uid,
      work?.user?.secUid,
      work?.sec_uid,
      work?.secUid,
      work?.sec_user_id,
      work?.secUserId,
      work?.author_user_id,
    ]));
  }

  function getCreatorIdFromAnchors() {
    const preferred = [];
    const fallback = [];
    Array.from(document.querySelectorAll('a[href*="/user/"], a[href*="/share/user/"]')).forEach((link) => {
      const creatorId = parseCreatorId(link.href || link.getAttribute("href") || "");
      if (!creatorId) return;
      const label = cleanAuthorName(firstPresent([link.getAttribute("title"), link.getAttribute("aria-label"), link.textContent]));
      if (label) {
        preferred.push(creatorId);
      } else {
        fallback.push(creatorId);
      }
    });
    const preferredUnique = uniqueStrings(preferred);
    if (preferredUnique[0]) return preferredUnique[0];
    const fallbackUnique = uniqueStrings(fallback);
    return fallbackUnique.length === 1 ? fallbackUnique[0] : "";
  }

  function getCreatorIdFromScriptText(awemeId = "") {
    const preferred = [];
    const fallback = [];
    const patterns = [
      /"(?:sec_uid|secUid|sec_user_id|secUserId)"\s*:\s*"([^"]+)"/g,
      /(?:sec_uid|secUid|sec_user_id)=([^&#"'\s]+)/g,
    ];
    Array.from(document.scripts || []).forEach((script) => {
      const text = script.textContent || "";
      if (!text) return;
      const target = awemeId && text.includes(awemeId) ? preferred : fallback;
      patterns.forEach((pattern) => {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text))) {
          const creatorId = normalizeCreatorId(safeDecodeURIComponent(match[1]));
          if (creatorId) target.push(creatorId);
        }
      });
    });
    return uniqueStrings([...preferred, ...fallback])[0] || "";
  }

  function creatorDetailUrl(creatorId, autoExtract = false, autoSync = false, extraParams = {}) {
    const url = new URL("/creator/detail", API_BASE);
    url.searchParams.set("active_tab", extraParams.activeTab || "creator_trends");
    url.searchParams.set("creator_id", creatorId);
    if (autoExtract) url.searchParams.set(AUTO_PARAM, "1");
    if (autoSync) url.searchParams.set(SYNC_PARAM, "1");
    if (extraParams.autoWorks) url.searchParams.set(WORKS_PARAM, "1");
    if (extraParams.worksSort) url.searchParams.set(WORKS_SORT_PARAM, extraParams.worksSort);
    if (extraParams.worksLimit) url.searchParams.set(WORKS_LIMIT_PARAM, String(extraParams.worksLimit));
    if (extraParams.worksSync !== undefined) url.searchParams.set(WORKS_SYNC_PARAM, extraParams.worksSync ? "1" : "0");
    if (extraParams.worksDownload !== undefined) url.searchParams.set(WORKS_DOWNLOAD_PARAM, extraParams.worksDownload ? "1" : "0");
    if (extraParams.worksDateStart) url.searchParams.set(WORKS_DATE_START_PARAM, extraParams.worksDateStart);
    if (extraParams.worksDateEnd) url.searchParams.set(WORKS_DATE_END_PARAM, extraParams.worksDateEnd);
    if (extraParams.worksLikeMin) url.searchParams.set(WORKS_LIKE_MIN_PARAM, String(extraParams.worksLikeMin));
    if (extraParams.worksIncludeComments !== undefined) url.searchParams.set(WORKS_COMMENTS_PARAM, extraParams.worksIncludeComments ? "1" : "0");
    if (extraParams.worksTranscribe !== undefined) url.searchParams.set(WORKS_TRANSCRIBE_PARAM, extraParams.worksTranscribe ? "1" : "0");
    return url.toString();
  }

  function status(message, kind = "info") {
    const panel = ensurePanel();
    const node = $(".douhot-extractor-status", panel);
    node.textContent = message;
    node.dataset.kind = kind;
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = [
      '<div class="douhot-extractor-header">',
      `<div class="douhot-extractor-title">汤淡采集 ${PANEL_BUILD_LABEL}</div>`,
      '<button class="douhot-extractor-collapse" type="button" title="收起" aria-label="收起">-</button>',
      "</div>",
      '<div class="douhot-extractor-body">',
      '<button class="douhot-extractor-primary" type="button"></button>',
      '<button class="douhot-extractor-sync" type="button">同步到飞书</button>',
      '<button class="douhot-extractor-single-work" type="button">同步当前作品</button>',
      '<button class="douhot-extractor-works" type="button">同步主页作品</button>',
      '<button class="douhot-extractor-works-filter" type="button">筛选作品同步</button>',
      '<label class="douhot-extractor-comment-toggle"><input class="douhot-extractor-include-comments" type="checkbox">抓取前3条热评</label>',
      '<label class="douhot-extractor-transcribe-toggle"><input class="douhot-extractor-transcribe" type="checkbox">同步后转逐字稿</label>',
      '<button class="douhot-extractor-secondary" type="button">输入链接提取</button>',
      '<div class="douhot-extractor-status" data-kind="info">准备好了</div>',
      "</div>",
    ].join("");
    document.documentElement.appendChild(panel);

    const style = document.createElement("style");
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        width: 188px;
        max-width: calc(100vw - 16px);
        box-sizing: border-box;
        padding: 12px;
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 12px 30px rgba(15, 23, 42, 0.18);
        color: #111827;
        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${PANEL_ID}[data-dragging="true"] {
        cursor: grabbing;
      }
      #${PANEL_ID}[data-collapsed="true"] .douhot-extractor-body {
        display: none;
      }
      #${PANEL_ID} .douhot-extractor-header {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: grab;
        touch-action: none;
        user-select: none;
      }
      #${PANEL_ID}[data-dragging="true"] .douhot-extractor-header {
        cursor: grabbing;
      }
      #${PANEL_ID} .douhot-extractor-title {
        flex: 1;
        min-width: 0;
        margin: 0;
        font-weight: 700;
        color: #111827;
      }
      #${PANEL_ID} .douhot-extractor-body {
        margin-top: 8px;
      }
      #${PANEL_ID} button {
        display: block;
        width: 100%;
        min-height: 32px;
        margin: 6px 0 0;
        box-sizing: border-box;
        border-radius: 6px;
        border: 1px solid transparent;
        cursor: pointer;
        font: inherit;
      }
      #${PANEL_ID} .douhot-extractor-collapse {
        width: 28px;
        min-height: 28px;
        margin: 0;
        border-color: rgba(17, 24, 39, 0.14);
        background: #fff;
        color: #111827;
        font-weight: 700;
        line-height: 1;
      }
      #${PANEL_ID} .douhot-extractor-primary {
        background: #111827;
        color: #fff;
      }
      #${PANEL_ID} .douhot-extractor-sync {
        background: #246bfe;
        color: #fff;
      }
      #${PANEL_ID} .douhot-extractor-works {
        background: #047857;
        color: #fff;
      }
      #${PANEL_ID} .douhot-extractor-single-work {
        background: #047857;
        color: #fff;
      }
      #${PANEL_ID} .douhot-extractor-works-filter {
        background: #fff;
        border-color: #9ca3af;
        color: #111827;
      }
      #${PANEL_ID} .douhot-extractor-comment-toggle,
      #${PANEL_ID} .douhot-extractor-transcribe-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 8px;
        color: #374151;
        font-size: 12px;
        user-select: none;
      }
      #${PANEL_ID} .douhot-extractor-comment-toggle input,
      #${PANEL_ID} .douhot-extractor-transcribe-toggle input {
        width: 14px;
        height: 14px;
        margin: 0;
      }
      #${PANEL_ID} .douhot-extractor-secondary {
        background: #fff;
        border-color: rgba(17, 24, 39, 0.16);
        color: #111827;
      }
      #${PANEL_ID} button:disabled {
        cursor: wait;
        opacity: 0.65;
      }
      #${PANEL_ID} .douhot-extractor-status {
        margin-top: 8px;
        min-height: 18px;
        color: #4b5563;
        word-break: break-word;
      }
      #${PANEL_ID} .douhot-extractor-status[data-kind="error"] {
        color: #b91c1c;
      }
      #${PANEL_ID} .douhot-extractor-status[data-kind="success"] {
        color: #047857;
      }
    `;
    document.documentElement.appendChild(style);

    restorePanelState(panel);
    installPanelDrag(panel);
    installPanelCollapse(panel);
    installLocationWatcher();

    $(".douhot-extractor-primary", panel).addEventListener("click", () => {
      if (isDouhotDetailPage()) {
        runExtractor({ download: true, copy: true, sync: false }).catch(reportError);
      } else if (isDouyinVideoPage()) {
        runSingleWorkExtractor({ sync: false, download: true, includeComments: panelIncludeComments() }).catch(reportError);
      } else {
        routeCurrentPageOrPrompt({ sync: false });
      }
    });
    $(".douhot-extractor-sync", panel).addEventListener("click", () => {
      if (isDouhotDetailPage()) {
        runExtractor({ download: false, copy: true, sync: true }).catch(reportError);
      } else if (isDouyinVideoPage()) {
        runSingleWorkExtractor({
          sync: true,
          download: false,
          includeComments: panelIncludeComments(),
          transcribe: panelTranscriptionRequested(),
        }).catch(reportError);
      } else {
        routeCurrentPageOrPrompt({ sync: true });
      }
    });
    $(".douhot-extractor-secondary", panel).addEventListener("click", () => {
      promptAndRoute({ sync: false }).catch(reportError);
    });
    $(".douhot-extractor-works", panel).addEventListener("click", () => {
      runOrRouteWorks({
        sort: "default",
        limit: 0,
        sync: true,
        download: false,
        includeComments: panelIncludeComments(),
        transcribe: panelTranscriptionRequested(),
      }).catch(reportError);
    });
    $(".douhot-extractor-single-work", panel).addEventListener("click", () => {
      runSingleWorkExtractor({
        sync: true,
        download: false,
        includeComments: panelIncludeComments(),
        transcribe: panelTranscriptionRequested(),
      }).catch(reportError);
    });
    $(".douhot-extractor-works-filter", panel).addEventListener("click", async () => {
      const options = await promptWorksOptions({
        includeComments: panelIncludeComments(),
        transcribe: panelTranscriptionRequested(),
      });
      if (options) runOrRouteWorks({ ...options, sync: true, download: false }).catch(reportError);
    });
    updatePrimaryButton();
    return panel;
  }

  function installLocationWatcher() {
    if (window.__douhotExtractorLocationWatcherInstalled) return;
    window.__douhotExtractorLocationWatcherInstalled = true;
    let lastUrl = location.href;
    const refresh = () => {
      if (lastUrl === location.href) return;
      lastUrl = location.href;
      window.setTimeout(updatePrimaryButton, 100);
    };
    ["pushState", "replaceState"].forEach((method) => {
      const original = history[method];
      history[method] = function (...args) {
        const result = original.apply(this, args);
        refresh();
        return result;
      };
    });
    window.addEventListener("popstate", refresh);
    window.setInterval(refresh, 1000);
  }

  function restorePanelState(panel) {
    setPanelCollapsed(panel, safeLocalStorageGet(PANEL_COLLAPSED_STORAGE_KEY) === "1", false);
    const position = readPanelPosition();
    if (position) {
      window.requestAnimationFrame(() => applyPanelPosition(panel, position.x, position.y));
    }
    window.addEventListener("resize", () => clampPanelToViewport(panel));
  }

  function installPanelDrag(panel) {
    const header = $(".douhot-extractor-header", panel);
    if (!header) return;
    let drag = null;

    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target?.closest?.(".douhot-extractor-collapse")) return;
      const rect = panel.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };
      panel.dataset.dragging = "true";
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      header.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    header.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      applyPanelPosition(panel, event.clientX - drag.offsetX, event.clientY - drag.offsetY);
    });

    const finishDrag = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      header.releasePointerCapture?.(event.pointerId);
      drag = null;
      delete panel.dataset.dragging;
      savePanelPosition(panel);
    };
    header.addEventListener("pointerup", finishDrag);
    header.addEventListener("pointercancel", finishDrag);
  }

  function installPanelCollapse(panel) {
    const button = $(".douhot-extractor-collapse", panel);
    if (!button) return;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      setPanelCollapsed(panel, panel.dataset.collapsed !== "true", true);
      clampPanelToViewport(panel);
    });
  }

  function setPanelCollapsed(panel, collapsed, persist = true) {
    panel.dataset.collapsed = collapsed ? "true" : "false";
    const button = $(".douhot-extractor-collapse", panel);
    if (button) {
      button.textContent = collapsed ? "+" : "-";
      button.title = collapsed ? "展开" : "收起";
      button.setAttribute("aria-label", collapsed ? "展开" : "收起");
    }
    if (persist) safeLocalStorageSet(PANEL_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
  }

  function readPanelPosition() {
    const text = safeLocalStorageGet(PANEL_POSITION_STORAGE_KEY);
    if (!text) return null;
    try {
      const value = JSON.parse(text);
      if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) return value;
    } catch (error) {
      return null;
    }
    return null;
  }

  function savePanelPosition(panel) {
    const rect = panel.getBoundingClientRect();
    safeLocalStorageSet(PANEL_POSITION_STORAGE_KEY, JSON.stringify({ x: Math.round(rect.left), y: Math.round(rect.top) }));
  }

  function applyPanelPosition(panel, x, y) {
    const margin = 8;
    const maxX = Math.max(margin, window.innerWidth - panel.offsetWidth - margin);
    const maxY = Math.max(margin, window.innerHeight - panel.offsetHeight - margin);
    panel.style.left = `${clampNumber(x, margin, maxX)}px`;
    panel.style.top = `${clampNumber(y, margin, maxY)}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }

  function clampPanelToViewport(panel) {
    const rect = panel.getBoundingClientRect();
    applyPanelPosition(panel, rect.left, rect.top);
    savePanelPosition(panel);
  }

  function clampNumber(value, min, max) {
    const lower = Number.isFinite(min) ? min : 0;
    const upper = Math.max(lower, Number.isFinite(max) ? max : lower);
    return Math.min(upper, Math.max(lower, Number(value) || lower));
  }

  function safeLocalStorageGet(key) {
    try {
      return window.localStorage?.getItem(key) || "";
    } catch (error) {
      return "";
    }
  }

  function safeLocalStorageSet(key, value) {
    try {
      window.localStorage?.setItem(key, value);
    } catch (error) {
      // Ignore storage failures in restricted browsing contexts.
    }
  }

  function panelIncludeComments() {
    const panel = ensurePanel();
    return $(".douhot-extractor-include-comments", panel)?.checked === true;
  }

  function panelTranscriptionRequested() {
    const panel = ensurePanel();
    return $(".douhot-extractor-transcribe", panel)?.checked === true;
  }

  function updatePrimaryButton() {
    const panel = ensurePanel();
    const isVideoPage = isDouyinVideoPage();
    const isDetailPage = isDouhotDetailPage();
    const hasExtensionApi = extensionApiAvailable();
    const button = $(".douhot-extractor-primary", panel);
    if (isDetailPage) {
      button.textContent = "导出当前达人";
    } else if (isVideoPage) {
      button.textContent = "导出当前作品";
    } else if (location.hostname.endsWith("douyin.com")) {
      button.textContent = "去热点宝提取";
    } else {
      button.textContent = "开始提取";
    }

    const syncButton = $(".douhot-extractor-sync", panel);
    if (hasExtensionApi && !isVideoPage) {
      syncButton.style.display = "block";
      syncButton.textContent = isDetailPage ? "同步到飞书" : "去热点宝同步";
    } else {
      syncButton.style.display = "none";
    }

    const singleWorkButton = $(".douhot-extractor-single-work", panel);
    const worksButton = $(".douhot-extractor-works", panel);
    const filterButton = $(".douhot-extractor-works-filter", panel);
    const commentToggle = $(".douhot-extractor-comment-toggle", panel);
    const transcribeToggle = $(".douhot-extractor-transcribe-toggle", panel);
    const hasCreator = Boolean(currentCreatorId());
    singleWorkButton.style.display = hasExtensionApi && isVideoPage ? "block" : "none";
    worksButton.style.display = hasCreator && !isVideoPage ? "block" : "none";
    filterButton.style.display = hasCreator && !isVideoPage ? "block" : "none";
    commentToggle.style.display = isVideoPage || hasCreator ? "flex" : "none";
    transcribeToggle.style.display = isVideoPage || hasCreator ? "flex" : "none";
    worksButton.textContent = isDetailPage ? "同步作品到飞书" : "同步主页作品";
    filterButton.textContent = "筛选作品同步";
  }

  function setBusy(isBusy) {
    const panel = ensurePanel();
    panel.querySelectorAll("button:not(.douhot-extractor-collapse)").forEach((button) => {
      button.disabled = isBusy;
    });
  }

  function isDouhotDetailPage() {
    return location.hostname === "douhot.douyin.com" && location.pathname.includes("/creator/detail") && currentCreatorId();
  }

  function isDouyinUserPage() {
    return location.hostname.endsWith("douyin.com") && location.pathname.includes("/user/") && currentCreatorId();
  }

  function isDouyinVideoPage() {
    return location.hostname.endsWith("douyin.com") && Boolean(currentAwemeId());
  }

  function currentAwemeId() {
    return parseAwemeIdFromUrl(location.href);
  }

  function routeCurrentPageOrPrompt(options = {}) {
    const creatorId = currentCreatorId();
    if (creatorId) {
      location.href = creatorDetailUrl(creatorId, true, options.sync);
      return;
    }
    promptAndRoute(options).catch(reportError);
  }

  async function promptAndRoute(options = {}) {
    const input = window.prompt("粘贴抖音主页链接、热点宝详情页链接，或 creator_id：", "");
    if (input === null) return;
    const creatorId = await resolveCreatorIdFromInput(input);
    if (!creatorId) {
      const selfHint = /\/user\/self(?:[/?#]|$)/.test(String(input));
      status(selfHint ? "这个 /user/self 链接不是公开达人 ID。请复制对外主页链接，或粘贴包含 MS4w... 的主页链接。" : "没识别出 creator_id。请用完整抖音主页 /user/... 链接、抖音分享短链或热点宝详情页链接。", "error");
      return;
    }
    status("正在打开热点宝详情页...");
    location.href = creatorDetailUrl(creatorId, true, options.sync);
  }

  async function resolveCreatorIdFromInput(input) {
    const direct = parseCreatorId(input);
    if (direct) return direct;
    if (!extensionApiAvailable()) return "";
    status("正在解析抖音主页链接...");
    const response = await sendExtensionMessage({
      type: "douhot:resolveCreatorId",
      payload: { input },
    });
    return normalizeCreatorId(response.data?.creatorId || "");
  }

  function runOrRouteWorks(options = {}) {
    const creatorId = currentCreatorId();
    if (!creatorId) {
      status("当前页面没有识别出达人 ID。", "error");
      return Promise.resolve(null);
    }
    if (isDouyinUserPage() || isDouhotDetailPage()) {
      return runWorksExtractor(options);
    }
    status("正在打开热点宝作品分析页...");
    location.href = creatorDetailUrl(creatorId, false, false, {
      activeTab: "creator_product",
      autoWorks: true,
      worksSort: options.sort || "default",
      worksLimit: options.limit || 0,
      worksSync: options.sync === true,
      worksDownload: options.download === true,
      worksDateStart: options.dateStart || "",
      worksDateEnd: options.dateEnd || "",
      worksLikeMin: options.likeMin || 0,
      worksIncludeComments: options.includeComments === true,
      worksTranscribe: options.transcribe === true,
    });
    return Promise.resolve({ routed: true });
  }

  function promptWorksOptions(defaults = {}) {
    return openWorksFilterDialog(defaults);
  }

  function openWorksFilterDialog(defaults = {}) {
    return new Promise((resolve) => {
      document.getElementById(WORKS_FILTER_DIALOG_ID)?.remove();
      const overlay = document.createElement("div");
      const includeComments = defaults.includeComments === true;
      const transcribe = defaults.transcribe === true;
      overlay.id = WORKS_FILTER_DIALOG_ID;
      overlay.innerHTML = `
        <div class="douhot-works-filter-backdrop"></div>
        <form class="douhot-works-filter-card">
          <div class="douhot-works-filter-title">筛选作品同步</div>
          <label>发布日期</label>
          <div class="douhot-works-filter-grid">
            <input name="dateStart" type="date" aria-label="开始日期">
            <input name="dateEnd" type="date" aria-label="结束日期">
          </div>
          <label for="douhot-like-min">点赞最低值</label>
          <div class="douhot-works-like-row">
            <input id="douhot-like-min" name="likeMinRange" type="range" min="0" max="100000" step="1000" value="0">
            <input name="likeMin" type="number" min="0" step="1000" value="0">
          </div>
          <div class="douhot-works-filter-hint">0 表示不限；例如滑到 70000，就是只同步 7 万赞以上作品。</div>
          <label>排序</label>
          <select name="sort">
            <option value="default">默认顺序</option>
            <option value="like_desc">点赞从高到低</option>
            <option value="comment_desc">评论从高到低</option>
          </select>
          <label class="douhot-works-comments-toggle">
            <input name="includeComments" type="checkbox" ${includeComments ? "checked" : ""}>
            抓取前3条热评
          </label>
          <label class="douhot-works-comments-toggle">
            <input name="transcribe" type="checkbox" ${transcribe ? "checked" : ""}>
            本次选中的作品全部转逐字稿（会产生费用）
          </label>
          <div class="douhot-works-filter-actions">
            <button class="douhot-works-filter-cancel" type="button">取消</button>
            <button class="douhot-works-filter-submit" type="submit">同步</button>
          </div>
        </form>
      `;
      document.documentElement.appendChild(overlay);
      ensureWorksFilterDialogStyle();

      const form = $("form", overlay);
      const range = form.elements.likeMinRange;
      const number = form.elements.likeMin;
      const close = (value) => {
        overlay.remove();
        resolve(value);
      };

      range.addEventListener("input", () => {
        number.value = range.value;
      });
      number.addEventListener("input", () => {
        const value = Math.max(0, Number.parseInt(number.value || "0", 10) || 0);
        range.value = String(Math.min(100000, value));
      });
      $(".douhot-works-filter-cancel", overlay).addEventListener("click", () => close(null));
      $(".douhot-works-filter-backdrop", overlay).addEventListener("click", () => close(null));
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        close({
          sort: String(form.elements.sort.value || "default"),
          dateStart: String(form.elements.dateStart.value || ""),
          dateEnd: String(form.elements.dateEnd.value || ""),
          likeMin: Math.max(0, Number.parseInt(form.elements.likeMin.value || "0", 10) || 0),
          includeComments: form.elements.includeComments.checked,
          transcribe: form.elements.transcribe.checked,
          limit: 0,
        });
      });
    });
  }

  function ensureWorksFilterDialogStyle() {
    if (document.getElementById("douhot-works-filter-style")) return;
    const style = document.createElement("style");
    style.id = "douhot-works-filter-style";
    style.textContent = `
      #${WORKS_FILTER_DIALOG_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        color: #111827;
        font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${WORKS_FILTER_DIALOG_ID} .douhot-works-filter-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(15, 23, 42, 0.42);
      }
      #${WORKS_FILTER_DIALOG_ID} .douhot-works-filter-card {
        position: absolute;
        right: 24px;
        bottom: 24px;
        width: min(360px, calc(100vw - 32px));
        box-sizing: border-box;
        padding: 18px;
        border-radius: 8px;
        background: #fff;
        border: 1px solid rgba(15, 23, 42, 0.12);
        box-shadow: 0 18px 42px rgba(15, 23, 42, 0.28);
      }
      #${WORKS_FILTER_DIALOG_ID} .douhot-works-filter-title {
        margin-bottom: 14px;
        font-size: 16px;
        font-weight: 750;
      }
      #${WORKS_FILTER_DIALOG_ID} label {
        display: block;
        margin: 12px 0 6px;
        font-weight: 650;
      }
      #${WORKS_FILTER_DIALOG_ID} input,
      #${WORKS_FILTER_DIALOG_ID} select {
        width: 100%;
        min-height: 34px;
        box-sizing: border-box;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        padding: 6px 8px;
        font: inherit;
      }
      #${WORKS_FILTER_DIALOG_ID} input[type="range"] {
        padding: 0;
      }
      #${WORKS_FILTER_DIALOG_ID} input[type="checkbox"] {
        width: 14px;
        min-height: 14px;
        height: 14px;
        padding: 0;
      }
      #${WORKS_FILTER_DIALOG_ID} .douhot-works-filter-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      #${WORKS_FILTER_DIALOG_ID} .douhot-works-like-row {
        display: grid;
        grid-template-columns: 1fr 96px;
        gap: 10px;
        align-items: center;
      }
      #${WORKS_FILTER_DIALOG_ID} .douhot-works-filter-hint {
        margin-top: 6px;
        color: #6b7280;
        font-size: 12px;
      }
      #${WORKS_FILTER_DIALOG_ID} .douhot-works-comments-toggle {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 12px;
        font-weight: 500;
      }
      #${WORKS_FILTER_DIALOG_ID} .douhot-works-filter-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 16px;
      }
      #${WORKS_FILTER_DIALOG_ID} button {
        min-height: 34px;
        border-radius: 6px;
        border: 1px solid #d1d5db;
        padding: 0 14px;
        cursor: pointer;
        font: inherit;
      }
      #${WORKS_FILTER_DIALOG_ID} .douhot-works-filter-submit {
        background: #047857;
        border-color: #047857;
        color: #fff;
      }
    `;
    document.documentElement.appendChild(style);
  }

  async function requestJson(path, params = {}) {
    const url = new URL(path, API_BASE);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });

    const response = await fetch(url.toString(), {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json, text/plain, */*",
      },
    });
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error(`接口没有返回 JSON，可能是登录失效或页面被拦截：${url.pathname}`);
    }

    const code = payload && payload.code;
    if (code === 8 || payload.data === "用户未登录") {
      throw new Error("热点宝提示未登录。请先在 douhot.douyin.com 登录后再点提取。");
    }
    if (![undefined, 0, 200, 1001, 1004, 10010, 10011, 10012].includes(code)) {
      throw new Error(`接口返回异常 code=${code}：${payload.message || payload.msg || payload.data || url.pathname}`);
    }
    return payload.data === undefined ? payload : payload.data;
  }

  async function runExtractor(options = {}) {
    const runOptions = {
      download: options.download !== false,
      copy: options.copy !== false,
      sync: options.sync === true,
    };
    const creatorId = currentCreatorId();
    if (!creatorId) {
      status("当前页面没有 creator_id。", "error");
      return null;
    }

    setBusy(true);
    try {
      status("正在读取达人基础信息...");
      const [authorInfo, productData] = await Promise.all([
        requestJson("/douhot/v1/author_analysis/author_info", { sec_uid: creatorId }),
        requestJson("/douhot/v1/author_analysis/product_analysis/product_data", { sec_uid: creatorId, day: 30 }),
      ]);

      status("正在读取粉丝画像...");
      const [gender, province, city, age, cityLevel, devicePrice, deviceBrand] = await Promise.all([
        requestJson("/douhot/v1/author_analysis/user_portrait", { sec_uid: creatorId, option: PORTRAIT_OPTIONS.gender }),
        requestJson("/douhot/v1/author_analysis/user_portrait", { sec_uid: creatorId, option: PORTRAIT_OPTIONS.province }),
        requestJson("/douhot/v1/author_analysis/user_portrait", { sec_uid: creatorId, option: PORTRAIT_OPTIONS.city }),
        requestJson("/douhot/v1/author_analysis/user_portrait", { sec_uid: creatorId, option: PORTRAIT_OPTIONS.age }),
        requestJson("/douhot/v1/author_analysis/user_portrait", { sec_uid: creatorId, option: PORTRAIT_OPTIONS.cityLevel }),
        requestJson("/douhot/v1/author_analysis/user_portrait", { sec_uid: creatorId, option: PORTRAIT_OPTIONS.devicePrice }),
        requestJson("/douhot/v1/author_analysis/user_portrait", { sec_uid: creatorId, option: PORTRAIT_OPTIONS.deviceBrand }),
      ]);

      const result = buildResult({
        creatorId,
        authorInfo,
        productData,
        portraits: { gender, province, city, age, cityLevel, devicePrice, deviceBrand },
      });
      if (runOptions.download) {
        downloadJson(result);
      }
      if (runOptions.copy) {
        await copyText(buildSummary(result));
      }
      if (runOptions.sync) {
        status("正在同步到飞书多维表格...");
        const syncResult = await syncToFeishu(result);
        result.feishuSync = syncResult;
        const syncAction = syncResult.operation === "updated" ? "已更新" : "已新增";
        status(`已同步到飞书：${syncAction} ${result.profile.name || creatorId}${syncResult.recordId ? `（${syncResult.recordId}）` : ""}`, "success");
      } else {
        status(`已导出：${result.profile.name || creatorId}，摘要也复制到剪贴板。`, "success");
      }
      window.douhotCreatorExtractor.lastResult = result;
      return result;
    } finally {
      setBusy(false);
    }
  }

  async function runWorksExtractor(options = {}) {
    const runOptions = {
      sort: options.sort || "default",
      limit: Math.max(0, Number.parseInt(options.limit || "0", 10) || 0),
      dateStart: String(options.dateStart || ""),
      dateEnd: String(options.dateEnd || ""),
      likeMin: Math.max(0, Number.parseInt(options.likeMin || "0", 10) || 0),
      sync: options.sync === true,
      download: options.download === true,
      includeComments: options.includeComments === true,
      transcribe: options.transcribe === true,
    };
    const creatorId = currentCreatorId();
    if (!creatorId) {
      status("当前页面没有 creator_id。", "error");
      return null;
    }

    setBusy(true);
    try {
      status("正在读取作品列表...");
      const rawWorks = await fetchCreatorWorks(creatorId, runOptions);
      const creatorName = await detectCreatorName(rawWorks);
      const works = applyWorksSelection(rawWorks.map((item) => normalizeWork(item, creatorName)).filter((work) => work.videoLink || work.title), runOptions);
      if (!works.length) {
        throw new Error("没有读取到作品。请确认当前达人主页有公开作品，且页面已经加载完成。");
      }
      if (runOptions.includeComments) {
        await enrichWorksWithHotComments(works);
      }
      if (runOptions.sync && runOptions.transcribe) {
        await enrichWorksWithTranscriptionMedia(works);
      }
      const result = {
        sourceUrl: location.href,
        extractedAt: new Date().toISOString(),
        creatorId,
        creatorName,
        sort: runOptions.sort,
        sortText: WORKS_SORT_OPTIONS[runOptions.sort] || WORKS_SORT_OPTIONS.default,
        filters: {
          dateStart: runOptions.dateStart,
          dateEnd: runOptions.dateEnd,
          likeMin: runOptions.likeMin,
        },
        limit: runOptions.limit,
        count: works.length,
        includeComments: runOptions.includeComments,
        transcriptionRequested: runOptions.sync && runOptions.transcribe,
        works,
      };
      if (runOptions.sync) {
        status("正在同步作品到飞书「竞品达人视频数据」...");
        result.feishuSync = await syncWorksToFeishu(result);
      }
      if (runOptions.download) {
        downloadWorksCsv(result);
      }
      window.douhotCreatorExtractor.lastWorksResult = result;
      if (result.feishuSync) {
        status(
          `已同步 ${result.feishuSync.total || works.length} 条作品：新增 ${result.feishuSync.created || 0}，更新 ${result.feishuSync.updated || 0}${formatTranscriptionSyncSummary(result.feishuSync.transcription)}。`,
          "success",
        );
      } else {
        status(`已处理 ${works.length} 条作品。`, "success");
      }
      return result;
    } finally {
      setBusy(false);
    }
  }

  async function runSingleWorkExtractor(options = {}) {
    const runOptions = {
      sync: options.sync === true,
      download: options.download === true,
      includeComments: options.includeComments === true,
      transcribe: options.transcribe === true,
    };
    if (!isDouyinVideoPage()) {
      throw new Error("请先打开单个抖音视频详情页，再提取当前作品。");
    }

    setBusy(true);
    try {
      status("正在读取当前作品...");
      const rawWork = await fetchCurrentVideoWork();
      const creatorName = await detectCreatorName([rawWork]);
      const work = normalizeWork(rawWork, creatorName);
      if (!work.videoLink) work.videoLink = location.href.split("?")[0];
      if (!work.title && !work.videoLink) {
        throw new Error("没有读取到当前作品信息。请确认打开的是抖音视频详情页。");
      }
      if (runOptions.includeComments) {
        await enrichWorksWithHotComments([work]);
      }
      if (runOptions.sync && runOptions.transcribe) {
        await enrichWorksWithTranscriptionMedia([work]);
      }
      const result = {
        sourceUrl: location.href,
        extractedAt: new Date().toISOString(),
        creatorId: getCreatorIdFromWork(rawWork) || currentCreatorId(work.awemeId, true),
        creatorName: work.authorName || creatorName,
        sort: "single",
        sortText: "当前作品",
        filters: {},
        limit: 1,
        count: 1,
        includeComments: runOptions.includeComments,
        transcriptionRequested: runOptions.sync && runOptions.transcribe,
        works: [work],
      };
      if (runOptions.sync) {
        status("正在同步当前作品到飞书...");
        result.feishuSync = await syncWorksToFeishu(result);
      }
      if (runOptions.download) {
        downloadWorksCsv(result);
      }
      window.douhotCreatorExtractor.lastSingleWorkResult = result;
      if (result.feishuSync) {
        status(
          `当前作品已同步：新增 ${result.feishuSync.created || 0}，更新 ${result.feishuSync.updated || 0}${formatTranscriptionSyncSummary(result.feishuSync.transcription)}。`,
          "success",
        );
      } else {
        status("当前作品已提取。", "success");
      }
      return result;
    } finally {
      setBusy(false);
    }
  }

  async function fetchCurrentVideoWork() {
    const awemeId = currentAwemeId();
    const errors = [];
    let detailWork = null;
    let pageWork = null;
    if (awemeId) {
      try {
        detailWork = await fetchDouyinWorkDetailByApi(awemeId);
        if (detailWork && !hasUsefulSingleWorkData(detailWork)) {
          errors.push("作品详情接口只返回了链接或空字段");
        }
      } catch (error) {
        errors.push(error.message || String(error));
      }
    }

    const scriptWorks = collectDouyinWorksFromScripts();
    const matched = findCurrentVideoWork(scriptWorks, awemeId);

    if (awemeId) {
      try {
        status("正在重新读取当前视频页数据...");
        pageWork = await fetchCurrentVideoWorkFromHtml(awemeId);
      } catch (error) {
        errors.push(`视频页数据匹配失败：${error.message || String(error)}`);
      }
    }

    const domWork = collectCurrentVideoWorkFromDom(awemeId);
    const currentPageWork = mergeSingleWorkSources([detailWork, matched, pageWork, domWork]);
    if (hasUsefulSingleWorkData(currentPageWork)) {
      return currentPageWork;
    }

    const creatorId =
      getCreatorIdFromWork(currentPageWork) ||
      currentCreatorId(awemeId, true) ||
      getCreatorIdFromWorks(scriptWorks, awemeId);
    if (awemeId && creatorId) {
      try {
        status("当前视频页数据不足，正在从作者作品列表备用查找...");
        const works = await fetchDouyinWorksByApi(creatorId, { limit: 500, targetAwemeId: awemeId });
        const matchedByCreator = findCurrentVideoWork(works, awemeId);
        if (matchedByCreator) return matchedByCreator;
      } catch (error) {
        errors.push(`作者作品列表匹配失败：${error.message || String(error)}`);
      }
    } else if (awemeId) {
      errors.push("没有识别到当前作品作者 secUid");
    }

    throw new Error(`当前作品读取失败：${errors.join("；") || "页面没有返回作品数据"}`);
  }

  function mergeSingleWorkSources(sources) {
    const merged = {};
    for (const source of sources || []) {
      if (!source || typeof source !== "object") continue;
      mergeNonEmptyWorkValues(merged, source);
    }
    return Object.keys(merged).length ? merged : null;
  }

  function mergeNonEmptyWorkValues(target, source) {
    Object.entries(source).forEach(([key, value]) => {
      if (!hasMergeValue(value)) return;
      const current = target[key];
      if (isPlainObject(value)) {
        if (!isPlainObject(current)) target[key] = {};
        mergeNonEmptyWorkValues(target[key], value);
        return;
      }
      if (!hasMergeValue(current)) {
        target[key] = Array.isArray(value) ? value.slice() : value;
      }
    });
    return target;
  }

  function hasMergeValue(value) {
    if (value === undefined || value === null || value === "") return false;
    if (Array.isArray(value)) return value.length > 0;
    if (isPlainObject(value)) return Object.keys(value).length > 0;
    return true;
  }

  function isPlainObject(value) {
    return Boolean(value) && Object.prototype.toString.call(value) === "[object Object]";
  }

  function hasUsefulSingleWorkData(work) {
    if (!work) return false;
    const statistics = work.statistics || work.stats || work.stat || {};
    const title = cleanWorkTitle(firstPresent([
      work.title,
      work.desc,
      work.item_desc,
      work.aweme_desc,
      work.aweme_title,
      work.item_title,
      work.caption,
      work.share_info?.share_title,
      work.shareInfo?.shareTitle,
    ]));
    const authorName = cleanAuthorName(firstPresent([
      work.authorName,
      work.author?.nickname,
      work.author?.name,
      work.authorInfo?.nickname,
      work.author_info?.nickname,
      work.nickname,
    ]));
    const metric = firstPresent([
      statistics.digg_count,
      statistics.diggCount,
      statistics.comment_count,
      statistics.commentCount,
      statistics.collect_count,
      statistics.collectCount,
      statistics.share_count,
      statistics.shareCount,
      work.digg_count,
      work.diggCount,
      work.comment_count,
      work.commentCount,
    ]);
    const hasMetric = metric !== undefined && metric !== null && metric !== "";
    return Boolean(title || authorName || hasMetric);
  }

  async function fetchDouyinWorkDetailByApi(awemeId) {
    const url = new URL("/aweme/v1/web/aweme/detail/", douyinWebApiOrigin());
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
    if (!response.ok || !text) throw new Error(`抖音作品详情接口没有返回数据：${response.status}`);
    const data = JSON.parse(text);
    return firstPresent([data?.aweme_detail, data?.awemeDetail, data?.item, data?.data?.aweme_detail, data?.data?.item]);
  }

  async function fetchCurrentVideoWorkFromHtml(awemeId) {
    const response = await fetch(location.href, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    });
    const html = await response.text();
    if (!response.ok || !html) throw new Error(`视频页没有返回数据：${response.status}`);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const works = collectDouyinWorksFromScripts(doc);
    return findCurrentVideoWork(works, awemeId);
  }

  function findCurrentVideoWork(works, awemeId) {
    if (!works.length) return null;
    if (!awemeId) return works[0];
    return (
      works.find((work) => getAwemeId(work) === awemeId) ||
      works.find((work) => parseAwemeIdFromUrl(firstPresent([work?.share_url, work?.shareUrl, work?.url])) === awemeId) ||
      null
    );
  }

  function collectCurrentVideoWorkFromDom(awemeId) {
    const currentLink = /\/(?:share\/)?(?:video|note)\//.test(location.pathname) ? normalizeVideoLink(location.href, awemeId) : normalizeVideoLink("", awemeId);
    const title = cleanWorkTitle(
      firstPresent([
        metaContent('meta[property="og:title"]'),
        metaContent('meta[name="twitter:title"]'),
        document.querySelector('[data-e2e="video-desc"]')?.textContent,
        document.querySelector('[data-e2e*="video-desc"]')?.textContent,
      ]),
    );
    const description = cleanWorkTitle(metaContent('meta[name="description"]')) || title;
    const creatorId = currentCreatorId();
    const creatorLink = creatorId
      ? Array.from(document.querySelectorAll('a[href*="/user/"], a[href*="/share/user/"]')).find((link) => link.href.includes(creatorId))
      : null;
    const authorName = cleanAuthorName(
      firstPresent([
        metaContent('meta[name="author"]'),
        document.querySelector('[data-e2e="video-author-name"]')?.textContent,
        document.querySelector('[data-e2e*="author"] [title]')?.getAttribute("title"),
        document.querySelector('[data-e2e*="author"]')?.textContent,
        document.querySelector('[data-e2e*="user"] [title]')?.getAttribute("title"),
        creatorLink?.querySelector("[title]")?.getAttribute("title"),
        creatorLink?.textContent,
      ]),
    );
    return {
      aweme_id: awemeId,
      desc: title || description,
      title: title || description,
      share_url: currentLink,
      cover_url: metaContent('meta[property="og:image"]') || metaContent('meta[name="twitter:image"]') || "",
      author: { nickname: authorName },
    };
  }

  function metaContent(selector) {
    return document.querySelector(selector)?.getAttribute("content") || "";
  }

  async function fetchCreatorWorks(creatorId, options) {
    if (isDouyinUserPage()) {
      return fetchDouyinCreatorWorks(creatorId, options);
    }

    const errors = [];
    for (const endpoint of WORKS_ENDPOINTS) {
      try {
        const works = await fetchCreatorWorksByEndpoint(endpoint, creatorId, options);
        if (works.length) return works;
      } catch (error) {
        errors.push(`${endpoint}: ${error.message || String(error)}`);
      }
    }
    throw new Error(`热点宝作品列表读取失败：${errors.join("；") || "接口没有返回作品"}`);
  }

  async function fetchDouyinCreatorWorks(creatorId, options) {
    const errors = [];
    try {
      const apiWorks = await fetchDouyinWorksByApi(creatorId, options);
      if (apiWorks.length) return apiWorks;
    } catch (error) {
      errors.push(error.message || String(error));
    }

    status("接口没有直接返回作品，正在滚动主页读取页面数据...");
    const pageWorks = await collectDouyinPageWorks(options);
    if (pageWorks.length) return pageWorks;
    throw new Error(`抖音主页作品读取失败：${errors.join("；") || "没有在页面中找到作品数据"}`);
  }

  async function fetchDouyinWorksByApi(creatorId, options) {
    const works = [];
    const seen = new Set();
    const targetAwemeId = normalizeAwemeId(options.targetAwemeId || "");
    let cursor = "0";
    let page = 1;
    const pageSize = 20;
    const maxPages = options.limit ? Math.ceil(options.limit / pageSize) + 3 : 80;
    const dateStartBoundary = dateBoundary(options.dateStart, false);

    while (page <= maxPages) {
      status(
        targetAwemeId
          ? `当前页数据不足，正在备用查找目标视频：第 ${page} 页...`
          : `正在从抖音主页接口读取作品：第 ${page} 页...`,
      );
      const url = new URL("/aweme/v1/web/aweme/post/", location.origin);
      Object.entries({
        device_platform: "webapp",
        aid: "6383",
        channel: "channel_pc_web",
        sec_user_id: creatorId,
        max_cursor: cursor,
        count: pageSize,
        publish_video_strategy_type: 2,
        locate_query: false,
        show_live_replay_strategy: 1,
        need_time_list: 1,
        time_list_query: 0,
      }).forEach(([key, value]) => url.searchParams.set(key, String(value)));

      const response = await fetch(url.toString(), {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json, text/plain, */*" },
      });
      const text = await response.text();
      if (!response.ok || !text) {
        throw new Error(`抖音作品接口没有返回数据：${response.status}`);
      }
      const data = JSON.parse(text);
      const list = extractWorksList(data);
      if (targetAwemeId) {
        const matchedTarget = findCurrentVideoWork(list, targetAwemeId);
        if (matchedTarget) return [matchedTarget];
      }
      const pageTimestamps = list.map(getWorkPublishTimestamp).filter(Boolean);
      if (dateStartBoundary && pageTimestamps.length && Math.max(...pageTimestamps) < dateStartBoundary) {
        break;
      }
      let added = 0;
      list.forEach((item) => {
        const id = getWorkId(item) || JSON.stringify(item).slice(0, 120);
        if (seen.has(id)) return;
        seen.add(id);
        works.push(item);
        added += 1;
      });
      if (!list.length || (page > 1 && added === 0)) break;
      const hasMore = data.has_more === true || Number(data.has_more) === 1;
      cursor = String(data.max_cursor || data.next_cursor || cursor);
      if (!hasMore) break;
      page += 1;
      await sleep(420);
    }
    return works;
  }

  async function collectDouyinPageWorks(options) {
    const wanted = options.limit || 0;
    const maxScrolls = wanted ? Math.min(80, Math.ceil(wanted / 8) + 12) : 80;
    let stableRounds = 0;
    let previousCount = 0;

    for (let index = 0; index < maxScrolls; index += 1) {
      const currentCount = collectDouyinWorksFromDom().length + collectDouyinWorksFromScripts().length;
      if (currentCount <= previousCount) {
        stableRounds += 1;
      } else {
        stableRounds = 0;
        previousCount = currentCount;
      }
      if (wanted && currentCount >= wanted) break;
      if (stableRounds >= 6) break;
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
      await sleep(900);
    }

    return mergeWorks([...collectDouyinWorksFromScripts(), ...collectDouyinWorksFromDom()]);
  }

  async function fetchCreatorWorksByEndpoint(endpoint, creatorId, options) {
    const pageSize = 20;
    const maxPages = 200;
    const works = [];
    const seen = new Set();
    let page = 1;
    let cursor = "";

    while (page <= maxPages) {
      status(`正在读取作品列表：第 ${page} 页...`);
      const data = await requestJson(endpoint, {
        sec_uid: creatorId,
        page,
        page_size: pageSize,
        cursor,
        count: pageSize,
      });
      const list = extractWorksList(data);
      let added = 0;
      for (const item of list) {
        const id = getWorkId(item) || JSON.stringify(item).slice(0, 120);
        if (seen.has(id)) continue;
        seen.add(id);
        works.push(item);
        added += 1;
      }
      if (!list.length || (page > 1 && added === 0)) break;

      const pageInfo = extractPageInfo(data, list.length, pageSize);
      if (!pageInfo.hasMore) break;
      cursor = pageInfo.nextCursor || cursor;
      page += 1;
      await sleep(260);
    }

    return works;
  }

  function extractWorksList(data) {
    const direct = firstArray([
      data?.list,
      data?.items,
      data?.aweme_list,
      data?.awemeList,
      data?.product_list,
      data?.productList,
      data?.item_list,
      data?.itemList,
      data?.works,
      data?.records,
      data?.data?.list,
      data?.data?.items,
      data?.data?.aweme_list,
      data?.data?.product_list,
      data?.data?.item_list,
    ]);
    if (direct) return direct;

    const queue = [data];
    const visited = new Set();
    while (queue.length) {
      const value = queue.shift();
      if (!value || typeof value !== "object" || visited.has(value)) continue;
      visited.add(value);
      if (Array.isArray(value)) {
        if (value.some((item) => item && typeof item === "object" && (getWorkId(item) || item.desc || item.title))) {
          return value;
        }
        continue;
      }
      Object.values(value).forEach((child) => {
        if (child && typeof child === "object") queue.push(child);
      });
    }
    return [];
  }

  function collectDouyinWorksFromScripts(sourceDocument = document) {
    const roots = [];
    const renderNode = sourceDocument.getElementById("RENDER_DATA");
    if (renderNode?.textContent) {
      const parsed = parseMaybeJson(safeDecodeURIComponent(renderNode.textContent));
      if (parsed) roots.push(parsed);
    }

    sourceDocument.querySelectorAll('script[type="application/json"], script[id*="DATA"], script[id*="data"]').forEach((script) => {
      if (!script.textContent || script === renderNode) return;
      const parsed = parseMaybeJson(script.textContent.trim());
      if (parsed) roots.push(parsed);
    });

    const works = [];
    roots.forEach((root) => findAwemeObjects(root, works));
    return mergeWorks(works);
  }

  function collectDouyinWorksFromDom() {
    const links = Array.from(document.querySelectorAll('a[href*="/video/"], a[href*="/note/"]'));
    return mergeWorks(
      links.map((link) => {
        const href = new URL(link.getAttribute("href"), location.origin).toString().split("?")[0];
        const card = link.closest("li, article, div") || link;
        const image = card.querySelector("img") || link.querySelector("img");
        const title = cleanText(
          link.getAttribute("aria-label") ||
            image?.getAttribute("alt") ||
            card.querySelector('[title]')?.getAttribute("title") ||
            link.textContent ||
            card.textContent,
        );
        return {
          title,
          desc: title,
          share_url: href,
          cover_url: image?.currentSrc || image?.src || "",
        };
      }),
    );
  }

  function findAwemeObjects(value, output, seen = new Set()) {
    if (!value || typeof value !== "object" || seen.has(value) || output.length > 5000) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => findAwemeObjects(item, output, seen));
      return;
    }
    if (looksLikeAweme(value)) {
      output.push(value);
    }
    Object.values(value).forEach((child) => findAwemeObjects(child, output, seen));
  }

  function looksLikeAweme(value) {
    return Boolean(
      value &&
        typeof value === "object" &&
        (value.aweme_id || value.awemeId || value.item_id || value.group_id || value.id_str) &&
        (value.desc || value.title || value.statistics || value.video || value.share_url),
    );
  }

  function mergeWorks(works) {
    const seen = new Set();
    const merged = [];
    works.forEach((work) => {
      const id = getWorkId(work) || normalizeVideoLink(firstPresent([work?.share_url, work?.shareUrl, work?.url]), "") || JSON.stringify(work).slice(0, 120);
      if (!id || seen.has(id)) return;
      seen.add(id);
      merged.push(work);
    });
    return merged;
  }

  async function detectCreatorName(rawWorks = []) {
    const fromWorks = cleanAuthorName(firstPresent(
      rawWorks.map((work) =>
        firstPresent([
          work?.author?.nickname,
          work?.author?.name,
          work?.authorInfo?.nickname,
          work?.author_info?.nickname,
          work?.nickname,
        ]),
      ),
    ));
    if (fromWorks) return fromWorks;
    return cleanAuthorName(
      firstPresent([
        document.querySelector('[data-e2e="user-info"] h1')?.textContent,
        document.querySelector('[data-e2e*="author"]')?.textContent,
        document.querySelector("h1")?.textContent,
        isDouyinVideoPage() ? "" : document.title.replace(/的主页.*/, "").replace(/- 抖音.*/, ""),
      ]),
    );
  }

  function parseMaybeJson(text) {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (error) {
      return null;
    }
  }

  function safeDecodeURIComponent(text) {
    try {
      return decodeURIComponent(text);
    } catch (error) {
      return text;
    }
  }

  function extractPageInfo(data, listLength, pageSize) {
    const hasMoreRaw = firstPresent([
      data?.has_more,
      data?.hasMore,
      data?.has_next,
      data?.hasNext,
      data?.more,
      data?.data?.has_more,
      data?.data?.hasMore,
      data?.data?.has_next,
    ]);
    const total = numberOrNull(firstPresent([data?.total, data?.total_count, data?.data?.total, data?.data?.total_count]));
    const nextCursor = firstPresent([
      data?.next_cursor,
      data?.nextCursor,
      data?.cursor,
      data?.max_cursor,
      data?.data?.next_cursor,
      data?.data?.cursor,
      data?.data?.max_cursor,
    ]);
    const hasMore =
      hasMoreRaw === undefined || hasMoreRaw === null
        ? listLength >= pageSize && (!total || listLength < total)
        : hasMoreRaw === true || String(hasMoreRaw).toLowerCase() === "true" || Number(hasMoreRaw) === 1;
    return { hasMore, nextCursor: nextCursor === undefined || nextCursor === null ? "" : String(nextCursor) };
  }

  function normalizeWork(item, creatorName = "") {
    const awemeId = getAwemeId(item);
    const id = awemeId || getWorkId(item);
    const title = cleanWorkTitle(firstPresent([
      item?.title,
      item?.desc,
      item?.item_desc,
      item?.aweme_desc,
      item?.aweme_title,
      item?.item_title,
      item?.caption,
      item?.share_info?.share_title,
      item?.shareInfo?.shareTitle,
    ]));
    const tags = extractWorkTags(item, title);
    const createTime = getWorkPublishTime(item);
    const durationSeconds = normalizeDurationSeconds(firstPresent([
      item?.duration,
      item?.duration_ms,
      item?.durationMs,
      item?.video_duration,
      item?.videoDuration,
      item?.video?.duration,
      item?.video?.duration_ms,
      item?.video?.durationMs,
      item?.music?.duration,
    ]));
    const statistics = item?.statistics || item?.stats || item?.stat || {};
    const videoData = item?.video || {};
    const playAddress = videoData?.play_addr || videoData?.playAddr || {};
    const sourcePlayUri = cleanText(firstPresent([
      playAddress?.uri,
      videoData?.play_addr_h264?.uri,
      videoData?.play_addr_265?.uri,
      videoData?.playAddrH264?.uri,
      videoData?.playAddr265?.uri,
    ]));
    const mediaFallbackUrl = firstUrl([
      playAddress?.url_list,
      playAddress?.urlList,
      videoData?.play_addr_h264?.url_list,
      videoData?.play_addr_265?.url_list,
      videoData?.playAddrH264?.urlList,
      videoData?.playAddr265?.urlList,
      videoData?.download_addr?.url_list,
      videoData?.downloadAddr?.urlList,
    ]);
    const mediaUrl = sourcePlayUri
      ? buildTranscriptionMediaUrl(sourcePlayUri)
      : normalizeMediaHttpUrl(mediaFallbackUrl);
    const videoLink = normalizeVideoLink(
      firstPresent([
        item?.share_url,
        item?.shareUrl,
        item?.aweme_url,
        item?.awemeUrl,
        item?.item_url,
        item?.itemUrl,
        item?.url,
        item?.video_url,
        item?.videoUrl,
      ]),
      id,
    );

    return {
      id,
      awemeId,
      title,
      authorName: cleanAuthorName(firstPresent([item?.authorName, item?.author?.nickname, item?.author?.name, item?.authorInfo?.nickname, item?.author_info?.nickname, item?.nickname, creatorName])),
      tags,
      tagsText: tags.join("、"),
      coverUrl: firstUrl(firstPresent([item?.cover, item?.cover_url, item?.coverUrl, item?.cover_urls, item?.coverUrls, item?.video_cover, item?.videoCover, item?.video?.cover, item?.video?.origin_cover, item?.video?.dynamic_cover, item?.image, item?.images])),
      likeCount: integerOrNull(firstPresent([statistics?.digg_count, statistics?.diggCount, statistics?.digg_cnt, statistics?.like_count, statistics?.likeCount, statistics?.like_cnt, item?.digg_count, item?.digg_cnt, item?.like_count, item?.like_cnt])),
      commentCount: integerOrNull(firstPresent([statistics?.comment_count, statistics?.commentCount, statistics?.comment_cnt, item?.comment_count, item?.commentCount, item?.comment_cnt])),
      collectCount: integerOrNull(firstPresent([statistics?.collect_count, statistics?.collectCount, statistics?.collect_cnt, statistics?.favorite_count, statistics?.favoriteCount, statistics?.favorite_cnt, statistics?.favorites_count, item?.collect_count, item?.collect_cnt, item?.favorite_count, item?.favorite_cnt])),
      shareCount: integerOrNull(firstPresent([statistics?.share_count, statistics?.shareCount, statistics?.share_cnt, item?.share_count, item?.shareCount, item?.share_cnt])),
      durationSeconds,
      durationText: formatDuration(durationSeconds),
      publishDate: formatPublishDate(createTime),
      publishTimestamp: publishTimestamp(createTime),
      videoLink,
      mediaUrl,
      mediaFallbackUrl,
      sourcePlayUri,
    };
  }

  async function enrichWorksWithTranscriptionMedia(works) {
    const pending = (works || []).filter((work) => !hasTranscriptionMedia(work));
    if (!pending.length) return works;

    let cursor = 0;
    let completed = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        const index = cursor;
        cursor += 1;
        const work = pending[index];
        const awemeId = work.awemeId || parseAwemeIdFromUrl(work.videoLink) || work.id;
        if (awemeId) {
          status(`正在准备逐字稿视频地址：${completed + 1}/${pending.length}...`);
          try {
            const detail = await fetchDouyinWorkDetailByApi(awemeId);
            const normalized = normalizeWork(detail, work.authorName);
            mergeMissingNormalizedWorkFields(work, normalized);
          } catch (_error) {
            // The Base row is still written. The transcript status will show
            // that this work did not expose a usable public media URL.
          }
        }
        completed += 1;
      }
    };

    const concurrency = Math.min(3, pending.length);
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return works;
  }

  function hasTranscriptionMedia(work) {
    return Boolean(cleanText(work?.sourcePlayUri) || cleanText(work?.mediaUrl) || cleanText(work?.mediaFallbackUrl));
  }

  function mergeMissingNormalizedWorkFields(target, source) {
    if (!target || !source) return target;
    const fields = [
      "title",
      "authorName",
      "tags",
      "tagsText",
      "coverUrl",
      "likeCount",
      "commentCount",
      "collectCount",
      "shareCount",
      "durationSeconds",
      "durationText",
      "publishDate",
      "publishTimestamp",
      "videoLink",
      "mediaUrl",
      "mediaFallbackUrl",
      "sourcePlayUri",
    ];
    fields.forEach((field) => {
      if (hasNormalizedWorkValue(target[field]) || !hasNormalizedWorkValue(source[field])) return;
      target[field] = Array.isArray(source[field]) ? source[field].slice() : source[field];
    });
    return target;
  }

  function hasNormalizedWorkValue(value) {
    if (value === undefined || value === null || value === "") return false;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }

  function formatTranscriptionSyncSummary(transcription) {
    if (!transcription?.requested) return "";
    if (transcription.missingApiKey) return "；未转写：请先配置阿里云 API Key";
    const queued = Number(transcription.queued || 0);
    const existing = Number(transcription.existing || 0);
    const skipped = Number(transcription.skipped || 0);
    return `；逐字稿排队 ${queued} 条${existing ? `，已有任务 ${existing} 条` : ""}${skipped ? `，缺少视频源 ${skipped} 条` : ""}`;
  }

  async function enrichWorksWithHotComments(works) {
    for (let index = 0; index < works.length; index += 1) {
      const work = works[index];
      const awemeId = work.awemeId || parseAwemeIdFromUrl(work.videoLink) || work.id;
      if (!awemeId) continue;
      status(`正在读取热评：${index + 1}/${works.length}...`);
      try {
        const comments = await fetchTopComments(awemeId, work.videoLink, work.authorName);
        work.hotComments = comments;
        work.hotCommentsText = formatHotComments(comments) || (numberValue(work.commentCount) > 0 ? COMMENT_EMPTY_TEXT : "");
      } catch (error) {
        work.hotComments = [];
        work.hotCommentsText = numberValue(work.commentCount) > 0 ? COMMENT_FAILED_TEXT : "";
      }
      await sleep(260);
    }
  }

  async function fetchTopComments(awemeId, videoLink = "", creatorName = "") {
    const id = cleanText(awemeId);
    if (!id) return [];
    if (isDouyinVideoPage()) {
      return extractVideoPageComments(id, creatorName);
    }
    if (extensionApiAvailable()) {
      try {
        const response = await sendExtensionMessage({
          type: "douhot:fetchTopComments",
          payload: { awemeId: id, videoLink: videoLink || normalizeVideoLink("", id), creatorName },
        });
        const comments = normalizeCommentsList(response.data?.comments || []);
        if (comments.length || !isDouyinUserPage()) return comments;
      } catch (error) {
        if (!isDouyinUserPage()) return [];
      }
    }
    return fetchTopCommentsDirect(id);
  }

  async function fetchTopCommentsDirect(awemeId) {
    const origin = douyinWebApiOrigin();
    for (const url of buildCommentUrls(origin, awemeId)) {
      try {
        const response = await fetch(url.toString(), {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json, text/plain, */*" },
        });
        const text = await response.text();
        if (!response.ok || !text) continue;
        const data = JSON.parse(text);
        const comments = normalizeCommentsList(extractCommentList(data));
        if (comments.length) return comments;
      } catch (error) {
        // Try the next comment-query variant before giving up.
      }
    }
    return [];
  }

  function buildCommentUrls(origin, awemeId) {
    return [
      { sort_type: 2 },
      { sort_type: 0 },
    ].map((extraParams) => {
      const url = new URL("/aweme/v1/web/comment/list/", origin);
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

  function douyinWebApiOrigin() {
    return "https://www.douyin.com";
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

  function extractCommentList(data) {
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
        if (value.some(looksLikeComment)) return value;
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

  function looksLikeComment(value) {
    return Boolean(
      value &&
        typeof value === "object" &&
        (value.text || value.comment_text || value.content || value.reply_comment?.text) &&
        (value.user || value.user_info || value.cid || value.comment_id || value.digg_count !== undefined),
    );
  }

  function normalizeCommentsList(comments) {
    return sortCommentsByLikeCount((Array.isArray(comments) ? comments : [])
      .map(normalizeComment)
      .filter((comment) => comment.text))
      .slice(0, 3);
  }

  async function extractVideoPageComments(awemeId, creatorName = "") {
    const id = cleanText(awemeId) || parseAwemeIdFromUrl(location.href);
    let collected = [];
    await sleep(1200);
    if (id) {
      const direct = await fetchTopCommentsDirect(id);
      collected = mergeUniqueComments(collected, direct);
    }

    await revealCommentsPanel();
    await sleep(1200);
    let stablePasses = 0;
    for (let attempt = 0; attempt < COMMENT_MAX_SCAN_PASSES; attempt += 1) {
      const beforeCount = collected.length;
      const comments = collectVisibleComments(creatorName, COMMENT_DOM_COLLECT_LIMIT);
      collected = mergeUniqueComments(collected, comments);
      stablePasses = collected.length === beforeCount ? stablePasses + 1 : 0;
      if (attempt + 1 >= COMMENT_MIN_SCAN_PASSES && hasEnoughRankableComments(collected)) break;
      if (attempt + 1 >= COMMENT_MIN_SCAN_PASSES && stablePasses >= 2) break;
      scrollCommentsArea();
      await sleep(1200);
    }
    return sortCommentsByLikeCount(collected).slice(0, 3);
  }

  function hasEnoughRankableComments(comments) {
    const list = comments || [];
    return list.filter((comment) => comment.likeCount !== undefined && comment.likeCount !== null).length >= 3 || list.length >= 8;
  }

  function mergeUniqueComments(existing, comments) {
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

  function scrollCommentsArea() {
    const commentSelector = '[data-e2e="comment-item"], [data-e2e*="comment"], [class*="CommentItem"], [class*="commentItem"], [class*="comment-item"], [class*="comment"]';
    const candidates = [];
    const seen = new Set();
    const pushCandidate = (node) => {
      if (!node || node === document.body || node === document.documentElement || seen.has(node) || !isVisibleElement(node)) return;
      if (node.scrollHeight <= node.clientHeight + 80) return;
      seen.add(node);
      const commentCount = node.querySelectorAll(commentSelector).length;
      const rect = node.getBoundingClientRect();
      candidates.push({
        node,
        score: commentCount * 1000 + Math.min(1000, node.scrollHeight - node.clientHeight) + Math.max(0, rect.left),
      });
    };

    document.querySelectorAll(commentSelector).forEach((commentNode) => {
      let node = commentNode.parentElement;
      let depth = 0;
      while (node && depth < 8) {
        pushCandidate(node);
        node = node.parentElement;
        depth += 1;
      }
    });
    document.querySelectorAll("div, section, aside, main").forEach(pushCandidate);

    candidates.sort((left, right) => right.score - left.score);
    if (candidates.length) {
      candidates.slice(0, 4).forEach(({ node }) => {
        node.scrollBy({ top: Math.max(420, node.clientHeight * 0.9), behavior: "smooth" });
      });
      return;
    }
    window.scrollBy({ top: 520, behavior: "smooth" });
  }

  async function revealCommentsPanel() {
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], [aria-label]'));
    const commentButton = buttons.find((button) => {
      const text = cleanText([button.textContent, button.getAttribute("aria-label"), button.getAttribute("title")].join(" "));
      return /评论/.test(text);
    });
    if (commentButton) {
      commentButton.click();
      await sleep(900);
    }
  }

  function collectVisibleComments(creatorName = "", limit = 12) {
    const candidates = commentCandidateElements();
    const comments = [];
    const seen = new Set();
    for (const node of candidates) {
      if (!isVisibleElement(node)) continue;
      const comment = normalizeDomComment(node, creatorName);
      if (!comment.text || seen.has(comment.text)) continue;
      seen.add(comment.text);
      comments.push(comment);
      if (comments.length >= limit) break;
    }
    return sortCommentsByLikeCount(comments).slice(0, limit);
  }

  function commentCandidateElements() {
    const primarySelectors = [
      '[data-e2e="comment-item"]',
      '[class*="CommentItem"]',
      '[class*="commentItem"]',
      '[class*="comment-item"]',
    ];
    const primary = uniqueElements(primarySelectors.flatMap((selector) => Array.from(document.querySelectorAll(selector))))
      .filter((node) => isUsableCommentCandidate(node));
    if (primary.length) return preferLeafCommentNodes(primary);

    const broadSelectors = [
      '[data-e2e*="comment"]',
      '[class*="comment"]',
    ];
    return preferLeafCommentNodes(
      uniqueElements(broadSelectors.flatMap((selector) => Array.from(document.querySelectorAll(selector))))
        .filter((node) => isUsableCommentCandidate(node)),
    );
  }

  function preferLeafCommentNodes(nodes) {
    return nodes.filter((node) => !nodes.some((other) => other !== node && node.contains(other)));
  }

  function isUsableCommentCandidate(node) {
    if (!node || !isVisibleElement(node)) return false;
    const text = cleanText(node.textContent);
    if (!text || text.length > 900) return false;
    const lines = visibleTextLines(node).map(cleanText).filter(Boolean).filter((line) => !isCommentMetaLine(line));
    return lines.length >= 2 && lines.length <= 14;
  }

  function uniqueElements(elements) {
    const seen = new Set();
    const list = [];
    for (const element of elements) {
      if (!element || seen.has(element)) continue;
      seen.add(element);
      list.push(element);
    }
    return list;
  }

  function isVisibleElement(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function normalizeDomComment(node, creatorName = "") {
    const lines = visibleTextLines(node)
      .map(cleanText)
      .filter(Boolean)
      .filter((line) => !isCommentMetaLine(line));
    if (lines.length < 2) return { text: "", author: "", likeCount: null };
    const author = chooseAuthorLine(lines);
    const text = chooseCommentLine(lines, author, creatorName);
    if (!text || isAuthorOnlyDomComment(text, author, creatorName, lines)) {
      return { text: "", author: "", likeCount: null };
    }
    const likeCount = extractDomCommentLikeCount(node, lines);
    return { text, author, likeCount };
  }

  function visibleTextLines(root) {
    const lines = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || !isVisibleElement(parent)) return NodeFilter.FILTER_REJECT;
        const text = cleanText(node.nodeValue);
        if (!text) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) {
      lines.push(walker.currentNode.nodeValue);
    }
    return uniqueStrings(lines);
  }

  function isCommentMetaLine(line) {
    const text = cleanText(line);
    return (
      !text ||
      isPlaceholderCommentLine(text) ||
      text.length > 180 ||
      /^(作者|视频作者|评论|全部评论|暂无评论|打开看看|登录|关注|已关注|回复|展开|收起|查看更多|展开更多|查看全文|分享|收藏|点赞|置顶)$/.test(text) ||
      /^IP属地[:：]?/.test(text) ||
      /^(刚刚|今天|昨天|前天)$/.test(text) ||
      /^\d+\s*(秒|分钟|小时|天|周|个月|月|年)前(?:[·・•]\S+)?$/.test(text) ||
      /^\d+\s*(秒|分钟|小时|天|周|个月|月|年)前$/.test(text) ||
      /^\d{1,2}月\d{1,2}日(?:[·・•]\S+)?$/.test(text) ||
      /^展开\s*\d+\s*条/.test(text) ||
      /^共\s*\d+\s*条/.test(text) ||
      /^作者赞过$/.test(text) ||
      /^[\u4e00-\u9fa5]{2,}(?:市|省)?$/.test(text) && /^(北京|上海|天津|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门|杭州|广州|深圳|成都|武汉|南京|苏州|西安|长沙|郑州|青岛|厦门|宁波|无锡|合肥|福州|济南|大连|昆明|沈阳|长春|哈尔滨)$/.test(text.replace(/市|省$/, "")) ||
      /^\d{1,4}([.:：]\d{1,2})?$/.test(text) ||
      /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(text) ||
      /^\d{1,2}[-/.]\d{1,2}$/.test(text)
    );
  }

  function isPlaceholderCommentLine(line) {
    const text = cleanText(line);
    if (!text) return true;
    const compact = text.replace(/\s+/g, "");
    return (
      /^[.。·・•]{2,}$/.test(compact) ||
      /^…+$/.test(compact) ||
      /^\.{2,}$/.test(compact) ||
      /^(?:\.\.\.|…)(?:全文|更多)?$/.test(compact) ||
      /^(?:展开|查看)?(?:全文|更多)$/.test(compact)
    );
  }

  function chooseCommentLine(lines, author = "", creatorName = "") {
    const candidates = lines
      .filter((line) => line !== author)
      .filter((line) => line.length >= 2)
      .filter((line) => !isPlaceholderCommentLine(line))
      .filter((line) => !parseLikeCountText(line))
      .filter((line) => !sameCleanText(line, creatorName));
    return candidates.find(isLikelyCommentText) || candidates.find((line) => !looksLikeNicknameOnly(line)) || candidates[0] || "";
  }

  function chooseAuthorLine(lines) {
    return lines.find((line) => isLikelyAuthorName(line) && !parseLikeCountText(line)) || "";
  }

  function isAuthorOnlyDomComment(text, author, creatorName, lines) {
    if (!text) return true;
    if (sameCleanText(text, creatorName)) return true;
    if (sameCleanText(text, author)) return true;
    return false;
  }

  function isLikelyCommentText(line) {
    const text = cleanText(line);
    if (isPlaceholderCommentLine(text)) return false;
    if (!text || looksLikeNicknameOnly(text)) return false;
    return text.length >= 6 || /[，,。.!！?？、;；:：\s]/.test(text);
  }

  function looksLikeNicknameOnly(line) {
    const text = cleanText(line);
    if (!text) return true;
    if (text.length > 18) return false;
    if (/[，,。.!！?？、;；:：]/.test(text)) return false;
    if (/[\u4e00-\u9fff]/.test(text) && text.length >= 6) return false;
    return /^[\w.\-\s\u4e00-\u9fff·…]+$/.test(text);
  }

  function isLikelyAuthorName(line) {
    const text = cleanText(line);
    return Boolean(
      text &&
        !isPlaceholderCommentLine(text) &&
        text.length <= 32 &&
        !isCommentMetaLine(text) &&
        !parseLikeCountText(text),
    );
  }

  function sameCleanText(left, right) {
    const a = cleanText(left).toLowerCase();
    const b = cleanText(right).toLowerCase();
    return Boolean(a && b && a === b);
  }

  function extractDomCommentLikeCount(node, lines = []) {
    const fromAttributes = firstPresent(commentActionTexts(node).map(parseLikeCountText));
    if (fromAttributes !== undefined && fromAttributes !== null) return integerOrNull(fromAttributes);
    return null;
  }

  function commentActionTexts(node) {
    const values = [];
    const elements = Array.from(node.querySelectorAll('button, [role="button"], [aria-label], [title], [class*="like"], [class*="digg"], [class*="zan"], [data-e2e*="like"], [data-e2e*="digg"]'));
    for (const element of elements) {
      const className = typeof element.className === "string" ? element.className : "";
      const dataE2e = cleanText(element.getAttribute("data-e2e"));
      const pieces = [
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        dataE2e,
        element.textContent,
      ].map(cleanText);
      const joined = pieces.join(" ");
      if (/(赞|点赞|喜欢|like|digg|zan)/i.test(joined) || /(like|digg|zan)/i.test(className) || /(like|digg|zan)/i.test(dataE2e)) {
        values.push(joined, ...pieces);
      }
    }
    return uniqueStrings(values);
  }

  function parseLikeCountText(line) {
    const text = cleanText(line).replace(/,/g, "");
    if (!text || /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(text) || /^\d{1,2}[-/.]\d{1,2}$/.test(text)) return null;
    const likeMatch =
      text.match(/(?:赞|点赞|喜欢|like|likes|digg|zan)\s*[:：]?\s*(\d+(?:\.\d+)?\s*[万亿wWkK]?)/i) ||
      text.match(/(\d+(?:\.\d+)?\s*[万亿wWkK]?)\s*(?:赞|点赞|喜欢|like|likes|digg|zan)/i);
    if (likeMatch) return integerOrNull(likeMatch[1]);
    return null;
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

  function normalizeComment(comment) {
    return {
      text: cleanText(commentText(firstPresent([comment?.text, comment?.comment_text, comment?.content, comment?.reply_comment?.text]))),
      author: cleanText(firstPresent([comment?.user?.nickname, comment?.user_info?.nickname, comment?.author?.nickname, comment?.author, comment?.user?.unique_id, comment?.user?.short_id, comment?.nickname])),
      likeCount: integerOrNull(firstPresent([comment?.digg_count, comment?.diggCount, comment?.like_count, comment?.likeCount, comment?.statistics?.digg_count])),
    };
  }

  function commentText(value) {
    if (Array.isArray(value)) return value.map(commentText).filter(Boolean).join("");
    if (value && typeof value === "object") {
      return firstPresent([value.text, value.content, value.string, value.value]) || "";
    }
    return value;
  }

  function formatHotComments(comments) {
    return sortCommentsByLikeCount(comments || [])
      .map((comment, index) => {
        const likeText = comment.likeCount !== undefined && comment.likeCount !== null ? `（赞 ${formatInteger(comment.likeCount)}）` : "";
        return `${index + 1}. ${comment.author || "匿名"}：${comment.text}${likeText}`;
      })
      .join("\n");
  }

  function applyWorksSelection(works, options) {
    const start = dateBoundary(options.dateStart, false);
    const end = dateBoundary(options.dateEnd, true);
    const likeMin = Math.max(0, Number.parseInt(options.likeMin || "0", 10) || 0);
    const sorted = works.filter((work) => {
      if (start && (!work.publishTimestamp || work.publishTimestamp < start)) return false;
      if (end && (!work.publishTimestamp || work.publishTimestamp > end)) return false;
      if (likeMin && numberValue(work.likeCount) < likeMin) return false;
      return true;
    });
    const sort = options.sort || "default";
    const sorters = {
      like_desc: (a, b) => numberValue(b.likeCount) - numberValue(a.likeCount),
      comment_desc: (a, b) => numberValue(b.commentCount) - numberValue(a.commentCount),
    };
    if (sorters[sort]) sorted.sort(sorters[sort]);
    return options.limit ? sorted.slice(0, options.limit) : sorted;
  }

  function dateBoundary(value, endOfDay) {
    if (!value) return 0;
    const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }

  function normalizeDurationSeconds(value) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return null;
      return Math.round(value > 10000 ? value / 1000 : value);
    }
    const text = String(value).trim();
    if (!text) return null;
    if (/^\d+(\.\d+)?$/.test(text)) {
      const number = Number(text);
      return Number.isFinite(number) ? Math.round(number > 10000 ? number / 1000 : number) : null;
    }
    const parts = text.split(":").map((part) => Number(part));
    if (parts.length >= 2 && parts.every((part) => Number.isFinite(part))) {
      return parts.reduce((total, part) => total * 60 + part, 0);
    }
    return null;
  }

  function formatDuration(seconds) {
    const number = integerOrNull(seconds);
    if (number === null) return "";
    const minutes = Math.floor(number / 60);
    const rest = number % 60;
    return `${minutes}:${String(rest).padStart(2, "0")}`;
  }

  function getWorkId(item) {
    return cleanText(firstPresent([item?.aweme_id, item?.awemeId, item?.item_id, item?.itemId, item?.group_id, item?.groupId, item?.id, item?.id_str]));
  }

  function getAwemeId(item) {
    const direct = cleanText(firstPresent([item?.aweme_id, item?.awemeId, item?.aweme?.aweme_id, item?.aweme?.awemeId]));
    if (direct) return direct;
    const fromUrl = parseAwemeIdFromUrl(
      firstPresent([
        item?.share_url,
        item?.shareUrl,
        item?.share_info?.share_url,
        item?.shareInfo?.shareUrl,
        item?.aweme_url,
        item?.awemeUrl,
        item?.item_url,
        item?.itemUrl,
        item?.videoLink,
        item?.url,
      ]),
    );
    if (fromUrl) return fromUrl;
    return cleanText(firstPresent([item?.item_id, item?.itemId, item?.group_id, item?.groupId, item?.id_str, item?.id]));
  }

  function parseAwemeIdFromUrl(value) {
    const text = cleanText(value);
    if (!text) return "";
    try {
      const url = new URL(text, location.origin);
      const direct =
        url.searchParams.get("modal_id") ||
        url.searchParams.get("aweme_id") ||
        url.searchParams.get("awemeId") ||
        url.searchParams.get("item_id") ||
        url.searchParams.get("itemId") ||
        url.searchParams.get("group_id") ||
        url.searchParams.get("groupId");
      if (direct) return normalizeAwemeId(direct);
      const match = url.pathname.match(/\/(?:share\/)?(?:video|note)\/([^/?#]+)/);
      if (match) return normalizeAwemeId(decodeURIComponent(match[1]));
    } catch (error) {
      const queryMatch = text.match(/[?&](?:modal_id|aweme_id|awemeId|item_id|itemId|group_id|groupId)=([^&#\s]+)/);
      if (queryMatch) return normalizeAwemeId(decodeURIComponent(queryMatch[1]));
      const match = text.match(/\/(?:share\/)?(?:video|note)\/([^/?#]+)/);
      if (match) return normalizeAwemeId(decodeURIComponent(match[1]));
    }
    return "";
  }

  function normalizeAwemeId(value) {
    const text = cleanText(value).replace(/[，。；;、/]+$/, "");
    return /^\d{8,}$/.test(text) ? text : "";
  }

  function getWorkPublishTime(item) {
    return firstPresent([
      item?.create_time,
      item?.createTime,
      item?.publish_time,
      item?.publishTime,
      item?.publish_timestamp,
      item?.publishTimestamp,
      item?.create_date,
      item?.publish_date,
      item?.time,
    ]);
  }

  function getWorkPublishTimestamp(item) {
    return publishTimestamp(getWorkPublishTime(item));
  }

  function extractWorkTags(item, title) {
    const values = [];
    const tagSources = [
      item?.tags,
      item?.tag_list,
      item?.tagList,
      item?.hashtags,
      item?.text_extra,
      item?.textExtra,
      item?.cha_list,
      item?.chaList,
    ];
    tagSources.forEach((source) => {
      if (!Array.isArray(source)) return;
      source.forEach((tag) => {
        if (typeof tag === "string") {
          values.push(tag);
          return;
        }
        values.push(firstPresent([tag?.name, tag?.tag_name, tag?.tagName, tag?.hashtag_name, tag?.hashtagName, tag?.cha_name, tag?.chaName, tag?.title]));
      });
    });
    values.push(...extractHashtags(title));
    return uniqueStrings(values.map((tag) => String(tag || "").replace(/^#/, "")));
  }

  function extractHashtags(text) {
    return (String(text || "").match(/#[^\s#，,。.!！?？、;；:：]+/g) || []).map((tag) => tag.replace(/^#/, ""));
  }

  function normalizeVideoLink(value, id) {
    const text = cleanText(value);
    if (/^https?:\/\//.test(text)) {
      const awemeId = parseAwemeIdFromUrl(text);
      return awemeId ? `https://www.douyin.com/video/${encodeURIComponent(awemeId)}` : text.split("?")[0];
    }
    return id ? `https://www.douyin.com/video/${encodeURIComponent(id)}` : "";
  }

  function buildTranscriptionMediaUrl(value) {
    const source = cleanText(value);
    if (!source) return "";
    if (/^https?:\/\//i.test(source) || source.startsWith("//")) {
      return normalizeMediaHttpUrl(source);
    }
    return `https://aweme.snssdk.com/aweme/v1/play/?video_id=${encodeURIComponent(source)}&ratio=720p&line=0`;
  }

  function normalizeMediaHttpUrl(value) {
    const source = cleanText(value);
    if (!source) return "";
    if (source.startsWith("//")) return `https:${source}`;
    return source.replace(/^http:\/\//i, "https://");
  }

  function firstUrl(value, depth = 0) {
    if (!value || depth > 4) return "";
    if (typeof value === "string") return /^https?:\/\//.test(value) ? value : "";
    if (Array.isArray(value)) {
      for (const item of value) {
        const url = firstUrl(item, depth + 1);
        if (url) return url;
      }
      return "";
    }
    if (typeof value === "object") {
      const direct = firstPresent([value.url, value.url_list, value.urlList, value.cover_url, value.coverUrl, value.display_url, value.displayUrl, value.src]);
      const directUrl = firstUrl(direct, depth + 1);
      if (directUrl) return directUrl;
      for (const child of Object.values(value)) {
        const url = firstUrl(child, depth + 1);
        if (url) return url;
      }
    }
    return "";
  }

  function formatPublishDate(value) {
    const timestamp = publishTimestamp(value);
    if (timestamp) return formatDateTime(timestamp);
    return cleanText(value);
  }

  function formatDateTime(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return cleanText(value);
    const pad = (number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function publishTimestamp(value) {
    if (value === undefined || value === null || value === "") return 0;
    if (typeof value === "number") return value > 100000000000 ? value : value * 1000;
    const text = String(value).trim();
    if (/^\d+$/.test(text)) {
      const number = Number(text);
      return number > 100000000000 ? number : number * 1000;
    }
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }

  function firstPresent(values) {
    return values.find((value) => value !== undefined && value !== null && value !== "");
  }

  function firstArray(values) {
    return values.find((value) => Array.isArray(value));
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function cleanWorkTitle(value) {
    const text = cleanText(value).replace(/\s*[-_|｜]\s*抖音.*$/, "").trim();
    return isDouyinPlaceholderText(text) ? "" : text;
  }

  function cleanAuthorName(value) {
    const text = cleanText(value).replace(/^@+/, "").trim();
    return isDouyinPlaceholderText(text) ? "" : text;
  }

  function isDouyinPlaceholderText(value) {
    const text = cleanText(value);
    if (!text) return true;
    const compact = text.replace(/\s+/g, "");
    if (DOUYIN_PLACEHOLDER_TEXTS.has(text) || DOUYIN_PLACEHOLDER_TEXTS.has(compact)) return true;
    return /^抖音(?:短视频)?$/.test(compact) || /记录美好生活/.test(text);
  }

  function uniqueStrings(values) {
    const seen = new Set();
    const list = [];
    for (const value of values || []) {
      const text = cleanText(value);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      list.push(text);
    }
    return list;
  }

  function buildResult({ creatorId, authorInfo, productData, portraits }) {
    const profile = normalizeProfile(authorInfo, creatorId);
    return {
      sourceUrl: location.href,
      extractedAt: new Date().toISOString(),
      creatorId,
      profile,
      product30d: normalizeProductData(productData),
      fanPortrait: {
        gender: normalizePortraitChart(portraits.gender),
        province: normalizePortraitTable(portraits.province),
        city: normalizePortraitTable(portraits.city),
        age: normalizePortraitChart(portraits.age),
        cityLevel: normalizePortraitChart(portraits.cityLevel),
        devicePrice: normalizePortraitChart(portraits.devicePrice),
        deviceBrand: normalizePortraitChart(portraits.deviceBrand),
      },
    };
  }

  function normalizeProfile(info = {}, creatorId) {
    const followerCount = integerOrNull(info.follower_count);
    const totalLiked = integerOrNull(info.total_favorited);
    const workCount = integerOrNull(info.aweme_count);
    const douyinId =
      info.uniqueId ||
      info.unique_id ||
      info.short_id ||
      info.display_id ||
      "";
    const tags = [info.first_tag_name, info.second_tag_name].filter(Boolean);

    return {
      name: info.nickname || "",
      douyinId,
      followerCount,
      followerCountText: formatCompactCn(followerCount),
      totalLiked,
      totalLikedText: formatCompactCn(totalLiked),
      workCount,
      workCountText: formatInteger(workCount),
      signature: info.signature || "",
      tags,
      avatarUrl: info.avatar_url || "",
      douyinProfileUrl: `https://www.douyin.com/user/${encodeURIComponent(creatorId)}`,
    };
  }

  function normalizeProductData(data = {}) {
    const result = {};
    Object.entries(PRODUCT_30D_KEYS).forEach(([apiKey, outputKey]) => {
      const value = numberOrNull(data[apiKey]);
      result[outputKey] = value;
      result[`${outputKey}Text`] = formatDecimal(value);
      result[`${outputKey}Label`] = PRODUCT_30D_LABELS[outputKey];
    });
    result.averageLikesChangeRatio = numberOrNull(data.avg_like_count_c);
    result.averageSharesChangeRatio = numberOrNull(data.avg_share_count_c);
    result.averageCommentsChangeRatio = numberOrNull(data.avg_comment_count_c);
    return result;
  }

  function normalizePortraitTable(data = {}) {
    const portraitRows = data?.portrait?.portrait_data || [];
    const tgiRows = data?.portrait_tgi?.portrait_data || [];
    const tgiByName = new Map(tgiRows.map((row) => [row.name, numberOrNull(row.value)]));
    return portraitRows
      .slice()
      .sort((a, b) => numberValue(b.value) - numberValue(a.value))
      .map((row) => {
        const ratio = numberOrNull(row.value);
        const tgi = tgiByName.has(row.name) ? tgiByName.get(row.name) : null;
        return {
          name: NAME_MAP[row.name] || row.name || "",
          ratio,
          ratioText: formatPercent(ratio),
          tgi,
          tgiText: formatDecimal(tgi),
        };
      });
  }

  function normalizePortraitChart(data = {}) {
    const portraitRows = data?.portrait?.portrait_data || [];
    const tgiRows = data?.portrait_tgi?.portrait_data || [];
    const tgiByName = new Map(tgiRows.map((row) => [row.name, numberOrNull(row.value)]));
    return portraitRows
      .filter((row) => row.name !== "其他")
      .slice()
      .sort((a, b) => numberValue(b.value) - numberValue(a.value))
      .map((row) => {
        const ratio = numberOrNull(row.value);
        const tgi = tgiByName.has(row.name) ? tgiByName.get(row.name) : null;
        return {
          name: NAME_MAP[row.name] || row.name || "",
          ratio,
          ratioText: formatPercent(ratio),
          tgi,
          tgiText: formatDecimal(tgi),
        };
      });
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

  function formatInteger(value) {
    const number = numberOrNull(value);
    if (number === null) return "";
    return Math.round(number).toLocaleString("zh-CN");
  }

  function formatDecimal(value, digits = 2) {
    const number = numberOrNull(value);
    if (number === null) return "";
    return number.toLocaleString("zh-CN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    });
  }

  function formatCompactCn(value) {
    const number = numberOrNull(value);
    if (number === null) return "";
    const abs = Math.abs(number);
    if (abs >= 100000000) return trimFixed(number / 100000000, 1) + "亿";
    if (abs >= 10000) return trimFixed(number / 10000, 1) + "万";
    return formatInteger(number);
  }

  function formatPercent(value) {
    const number = numberOrNull(value);
    if (number === null) return "";
    const percent = Math.abs(number) <= 1 ? number * 100 : number;
    return `${trimFixed(percent, 2)}%`;
  }

  function trimFixed(value, digits) {
    return Number(value.toFixed(digits)).toLocaleString("zh-CN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    });
  }

  function buildSummary(result) {
    const { profile, product30d, fanPortrait } = result;
    const gender = fanPortrait.gender.map((row) => `${row.name} ${row.ratioText}${row.tgiText ? ` / TGI ${row.tgiText}` : ""}`).join("，");
    const cities = fanPortrait.city
      .slice(0, 10)
      .map((row) => `${row.name} ${row.ratioText}${row.tgiText ? ` / TGI ${row.tgiText}` : ""}`)
      .join("，");
    return [
      `名称：${profile.name}`,
      `抖音号：${profile.douyinId || "未返回"}`,
      `总粉丝量：${profile.followerCountText}`,
      `总获赞量：${profile.totalLikedText}`,
      `总作品数：${profile.workCountText}`,
      `签名：${profile.signature}`,
      `标签：${profile.tags.join("、") || "未返回"}`,
      `近30天平均点赞量：${product30d.averageLikesText}`,
      `近30天平均分享量：${product30d.averageSharesText}`,
      `近30天平均评论量：${product30d.averageCommentsText}`,
      `粉丝性别：${gender}`,
      `城市占比 TOP10：${cities}`,
    ].join("\n");
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      // Some browser/user-script contexts block clipboard writes. The JSON file is still downloaded.
    }
  }

  function extensionApiAvailable() {
    return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id && chrome.runtime?.sendMessage);
  }

  function sendExtensionMessage(message) {
    return new Promise((resolve, reject) => {
      if (!extensionApiAvailable()) {
        reject(new Error("当前不是 Chrome 扩展环境。请用 Chrome 插件方式安装后再同步飞书。"));
        return;
      }
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || "扩展后台没有返回成功结果。"));
          return;
        }
        resolve(response);
      });
    });
  }

  async function syncToFeishu(result) {
    const response = await sendExtensionMessage({
      type: "douhot:syncFeishu",
      payload: result,
    });
    return response.data || {};
  }

  async function syncWorksToFeishu(result) {
    const response = await sendExtensionMessage({
      type: "douhot:syncWorksFeishu",
      payload: result,
    });
    return response.data || {};
  }

  function downloadJson(data) {
    const fileName = [
      "douhot",
      safeFilePart(data.profile.name || data.creatorId),
      timestampForFile(),
    ].join("-") + ".json";
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(link.href);
      link.remove();
    }, 1000);
  }

  function downloadWorksCsv(result) {
    const columns = [
      ["标题", "title"],
      ["标签", "tagsText"],
      ["博主名称", "authorName"],
      ["封面", "coverUrl"],
      ["点赞", "likeCount"],
      ["评论", "commentCount"],
      ["前3条热评", "hotCommentsText"],
      ["收藏", "collectCount"],
      ["分享", "shareCount"],
      ["作品时长", "durationSeconds"],
      ["发布日期", "publishDate"],
      ["视频链接", "videoLink"],
    ];
    const rows = [
      columns.map(([label]) => label),
      ...result.works.map((work) => columns.map(([, key]) => work[key] ?? "")),
    ];
    const csv = "\ufeff" + rows.map((row) => row.map(csvCell).join(",")).join("\n");
    const fileName = [
      "douyin-works",
      safeFilePart(result.creatorId),
      result.sort || "default",
      timestampForFile(),
    ].join("-") + ".csv";
    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(link.href);
      link.remove();
    }, 1000);
  }

  function csvCell(value) {
    const text = String(value === undefined || value === null ? "" : value);
    return `"${text.replace(/"/g, '""')}"`;
  }

  function safeFilePart(value) {
    return String(value || "creator")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 50);
  }

  function timestampForFile() {
    const pad = (value) => String(value).padStart(2, "0");
    const date = new Date();
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds()),
    ].join("");
  }

  function reportError(error) {
    console.error("[汤淡采集]", error);
    status(error.message || String(error), "error");
  }

  window.douhotCreatorExtractor = {
    run: runExtractor,
    runWorks: runWorksExtractor,
    runSingleWork: runSingleWorkExtractor,
    parseCreatorId,
    creatorDetailUrl,
    get lastResult() {
      return window.__douhotCreatorExtractorLastResult || null;
    },
    set lastResult(value) {
      window.__douhotCreatorExtractorLastResult = value;
    },
    get lastWorksResult() {
      return window.__douhotCreatorExtractorLastWorksResult || null;
    },
    set lastWorksResult(value) {
      window.__douhotCreatorExtractorLastWorksResult = value;
    },
    get lastSingleWorkResult() {
      return window.__douhotCreatorExtractorLastSingleWorkResult || null;
    },
    set lastSingleWorkResult(value) {
      window.__douhotCreatorExtractorLastSingleWorkResult = value;
    },
  };

  if (extensionApiAvailable()) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (![
        "douhot:run",
        "douhot:runWorks",
        "douhot:runSingleWork",
        "douhot:extractVideoComments",
        "douhot:resolveWorkForTranscription",
      ].includes(message?.type)) return false;
      const options = message.options || {};
      Promise.resolve()
        .then(async () => {
          if (message.type === "douhot:extractVideoComments") {
            return { comments: await extractVideoPageComments(message.awemeId, message.creatorName) };
          }
          if (message.type === "douhot:resolveWorkForTranscription") {
            const awemeId = normalizeAwemeId(message.awemeId);
            if (!awemeId) throw new Error("缺少有效的作品 ID");
            const detail = await fetchDouyinWorkDetailByApi(awemeId);
            return { work: normalizeWork(detail, "") };
          }
          if (message.type === "douhot:runSingleWork") {
            return runSingleWorkExtractor({
              sync: options.sync !== false,
              download: options.download === true,
              includeComments: options.includeComments === true,
              transcribe: options.transcribe === true,
            });
          }
          if (message.type === "douhot:runWorks") {
            const worksOptions = options.prompt
              ? await promptWorksOptions({
                includeComments: options.includeComments === true,
                transcribe: options.transcribe === true,
              })
              : options;
            if (!worksOptions) return { cancelled: true };
            const includeComments = options.prompt ? worksOptions.includeComments === true : options.includeComments === true;
            const transcribe = options.prompt ? worksOptions.transcribe === true : options.transcribe === true;
            return runOrRouteWorks({
              ...worksOptions,
              sync: options.sync !== false,
              download: options.download === true,
              includeComments,
              transcribe,
            });
          }
          if (isDouhotDetailPage()) {
            return runExtractor({
              download: options.download !== false,
              copy: options.copy !== false,
              sync: options.sync === true,
            });
          }
          routeCurrentPageOrPrompt({ sync: options.sync === true });
          return { routed: true };
        })
        .then((result) => sendResponse({ ok: true, data: result }))
        .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
      return true;
    });
  }

  ensurePanel();

  if (location.hostname === "douhot.douyin.com" && new URLSearchParams(location.search).get(AUTO_PARAM) === "1") {
    const shouldSync = new URLSearchParams(location.search).get(SYNC_PARAM) === "1";
    status("页面已打开，稍后自动提取...");
    sleep(2500)
      .then(() => runExtractor({ download: !shouldSync, copy: true, sync: shouldSync }))
      .catch(reportError);
  }

  if (location.hostname === "douhot.douyin.com" && new URLSearchParams(location.search).get(WORKS_PARAM) === "1") {
    const params = new URLSearchParams(location.search);
    status("作品分析页已打开，稍后自动采集作品...");
    sleep(2500)
      .then(() =>
        runWorksExtractor({
          sort: params.get(WORKS_SORT_PARAM) || "default",
          limit: params.get(WORKS_LIMIT_PARAM) || 0,
          dateStart: params.get(WORKS_DATE_START_PARAM) || "",
          dateEnd: params.get(WORKS_DATE_END_PARAM) || "",
          likeMin: params.get(WORKS_LIKE_MIN_PARAM) || 0,
          sync: params.get(WORKS_SYNC_PARAM) !== "0",
          download: params.get(WORKS_DOWNLOAD_PARAM) === "1",
          includeComments: params.get(WORKS_COMMENTS_PARAM) === "1",
          transcribe: params.get(WORKS_TRANSCRIBE_PARAM) === "1",
        }),
      )
      .catch(reportError);
  }
})();
