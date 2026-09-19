(async () => {
  const DEFAULT_CONFIG = {
    enabled: false,
    targetConversation: "AI相关入库",
    selfSenderName: "汤淡",
    scanIntervalMs: 300,
    resolveTimeoutMs: 8000,
  };
  const storedConfig = await chrome.storage.local.get({ douhotMonitor: DEFAULT_CONFIG });
  const config = { ...DEFAULT_CONFIG, ...(storedConfig.douhotMonitor || {}) };
  config.scanIntervalMs = Math.min(300, Math.max(150, Number(config.scanIntervalMs) || 300));
  if (!config.enabled) return;
  if (new URL(location.href).searchParams.get("dycollector") !== "tangdan") return;
  if (globalThis.__DOUHOT_CHAT_MONITOR_V1__) return;
  globalThis.__DOUHOT_CHAT_MONITOR_V1__ = true;
  document.documentElement.dataset.douyinCollector = "active";
  document.documentElement.dataset.douyinCollectorVersion = "integrated-0.6.3";

  const STATE_KEY = `douyinCollectorStateV2:${config.targetConversation}`;
  const SOURCE_RETRY_KEY = `douyinCollectorSourceRetryV1:${config.targetConversation}`;
  const SOURCE_RETRY_VERSION = "play-uri-v1";
  const MAX_SEEN = 3000;

  let state = { initialized: false, seen: [] };
  let seen = new Set();
  let processing = new Set();
  let attachedDialog = null;
  let observer = null;
  let scanScheduled = false;
  let scanning = false;
  let serial = Promise.resolve();
  let lastReportedStatus = "";
  let lastReportedDetail = "";
  let lastReportedAt = 0;
  let maintaining = false;
  let retryLatestRequested = false;
  let retryLatestAttempted = false;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const text = (node) => (node && node.textContent ? node.textContent.trim() : "");
  const normalizeHttpUrl = (value) => {
    const url = String(value || "").trim();
    if (!url) return "";
    if (url.startsWith("//")) return `https:${url}`;
    return url.replace(/^http:\/\//i, "https://");
  };
  const douyinSourceUrl = (playUri) => {
    const uri = String(playUri || "").trim();
    if (!uri) return "";
    if (/^https?:\/\//i.test(uri) || uri.startsWith("//")) {
      const normalized = normalizeHttpUrl(uri);
      try {
        const url = new URL(normalized);
        if (url.pathname.includes("/aweme/v1/playwm/")) {
          url.pathname = url.pathname.replace("/aweme/v1/playwm/", "/aweme/v1/play/");
          url.searchParams.delete("logo_name");
        }
        return url.toString();
      } catch (_error) {
        return normalized;
      }
    }
    return `https://aweme.snssdk.com/aweme/v1/play/?video_id=${encodeURIComponent(uri)}&ratio=720p&line=0`;
  };
  const visible = (node) => {
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  function setStatus(status, detail = "") {
    document.documentElement.dataset.douyinCollectorStatus = status;
    document.documentElement.dataset.douyinCollectorDetail = detail.slice(0, 180);
    const now = Date.now();
    if (status !== lastReportedStatus || detail !== lastReportedDetail || now - lastReportedAt > 10000) {
      lastReportedStatus = status;
      lastReportedDetail = detail;
      lastReportedAt = now;
      void chrome.runtime.sendMessage({
        type: "douhot:monitorHeartbeat",
        payload: { status, detail },
      }).catch(() => undefined);
    }
  }

  function timestampInfo(messageText) {
    const match = messageText.match(/^(刚刚|今天\s*\d{1,2}:\d{2}|\d{1,2}:\d{2}|\d{2}\/\d{2})/);
    const label = match ? match[0].trim() : "";
    if (label === "刚刚") return { label, recent: true };

    const now = new Date();
    const dateLabel = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;
    if (label === dateLabel) return { label, recent: true };

    const timeMatch = label.match(/(\d{1,2}):(\d{2})$/);
    if (!timeMatch) return { label, recent: false };
    const candidate = new Date(now);
    candidate.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
    const ageMs = now.getTime() - candidate.getTime();
    return { label, recent: ageMs >= -60000 && ageMs <= 10 * 60 * 1000 };
  }

  function exactText(root, value, selector = "div,span,p") {
    if (!root) return null;
    return Array.from(root.querySelectorAll(selector)).find((node) => text(node) === value) || null;
  }

  async function loadState() {
    const stored = await chrome.storage.local.get([STATE_KEY, SOURCE_RETRY_KEY]);
    const candidate = stored[STATE_KEY];
    if (candidate && Array.isArray(candidate.seen)) state = candidate;
    seen = new Set(state.seen || []);
    retryLatestRequested = stored[SOURCE_RETRY_KEY] !== SOURCE_RETRY_VERSION;
  }

  async function saveState() {
    state.seen = Array.from(seen).slice(-MAX_SEEN);
    await chrome.storage.local.set({ [STATE_KEY]: state });
  }

  async function markSourceRetryComplete() {
    retryLatestRequested = false;
    await chrome.storage.local.set({ [SOURCE_RETRY_KEY]: SOURCE_RETRY_VERSION });
  }

  function findDialog() {
    return Array.from(document.querySelectorAll('[data-e2e="im-dialog"]')).find(visible) || null;
  }

  function targetIsSelected(dialog) {
    return Boolean(exactText(dialog, `${config.targetConversation}(12)`) ||
      Array.from(dialog.querySelectorAll("div,span,p")).some((node) => {
        const value = text(node);
        return value.startsWith(`${config.targetConversation}(`) && value.endsWith(")");
      }));
  }

  async function ensureTargetConversation() {
    let dialog = findDialog();
    if (!dialog) {
      const messageLabel = Array.from(document.querySelectorAll("p,span,div"))
        .find((node) => text(node) === "消息" && visible(node));
      if (messageLabel) {
        setStatus("opening-chat", "正在打开消息面板");
        await trustedClick(messageLabel.closest("li") || messageLabel);
        await sleep(350);
        dialog = findDialog();
      }
    }

    if (!dialog) return null;
    if (!targetIsSelected(dialog)) {
      const list = dialog.querySelector(".conversationConversationListwrapper") || dialog;
      const target = exactText(list, config.targetConversation);
      if (target) {
        setStatus("selecting-chat", config.targetConversation);
        await trustedClick(target.closest(".conversationConversationItemwrapper") || target);
        await sleep(400);
      }
    }
    return findDialog();
  }

  function messageCards(dialog) {
    const list = dialog.querySelector(".messageMessageListlist") || dialog;
    return Array.from(list.querySelectorAll('[data-e2e="msg-item-content"]'))
      .map((clickable) => {
        const message = clickable.closest(".messageMessageBoxmessageBox");
        const row = clickable.closest(".MessageBoxContentrowBox") || clickable;
        const thumbnail = row.querySelector("img.MessageItemShareAwemeawemeContainer") || row.querySelector("img");
        const authorNode = row.querySelector("p") || Array.from(row.querySelectorAll("div,span")).find((node) => text(node));
        const authorName = text(authorNode);
        const senderText = text(message && message.querySelector(".MessageBoxContentcolumnBox"));
        if (!message || !thumbnail || !authorName || !senderText.includes(config.selfSenderName)) return null;

        let thumbKey = thumbnail.currentSrc || thumbnail.src || "";
        try {
          const parsed = new URL(thumbKey);
          thumbKey = `${parsed.hostname}${parsed.pathname}`;
        } catch (_error) {
          thumbKey = thumbKey.split("?")[0];
        }

        const messageText = text(message);
        const time = timestampInfo(messageText);
        const forwardedAtText = time.label;
        const fingerprint = `${authorName}|${thumbKey}`;
        return {
          clickable,
          authorName,
          forwardedAtText,
          fingerprint,
          isRecent: time.recent,
          thumbnailUrl: thumbnail.currentSrc || thumbnail.src || "",
        };
      })
      .filter(Boolean);
  }

  function douyinWebCommonParams() {
    const userAgent = navigator.userAgent || "";
    const browserMatch = userAgent.match(/(?:Chrome|CriOS)\/([\d.]+)/);
    const platformText = `${navigator.platform || ""} ${userAgent}`;
    let osName = "";
    if (/Mac/i.test(platformText)) osName = "Mac OS";
    else if (/Win/i.test(platformText)) osName = "Windows";
    else if (/Android/i.test(platformText)) osName = "Android";
    else if (/iPhone|iPad|iOS/i.test(platformText)) osName = "iOS";
    else if (/Linux/i.test(platformText)) osName = "Linux";

    return {
      device_platform: "webapp",
      aid: "6383",
      channel: "channel_pc_web",
      pc_client_type: 1,
      version_code: "170400",
      version_name: "17.4.0",
      cookie_enabled: navigator.cookieEnabled,
      browser_language: navigator.language || "zh-CN",
      browser_platform: navigator.platform || "",
      browser_name: "Chrome",
      browser_version: browserMatch ? browserMatch[1] : "",
      browser_online: navigator.onLine,
      engine_name: "Blink",
      engine_version: browserMatch ? browserMatch[1] : "",
      os_name: osName,
      os_version: "",
    };
  }

  async function fetchVideoDetail(videoId) {
    const url = new URL("/aweme/v1/web/aweme/detail/", location.origin);
    Object.entries({ ...douyinWebCommonParams(), aweme_id: videoId }).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    });
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json, text/plain, */*" },
    });
    if (!response.ok) throw new Error(`抖音作品详情接口返回 ${response.status}`);
    const payload = await response.json();
    return payload?.aweme_detail || payload?.awemeDetail || payload?.item || payload?.data?.aweme_detail || payload?.data?.item || null;
  }

  async function trustedClick(element) {
    element.scrollIntoView({ block: "center", inline: "nearest" });
    await sleep(100);
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) throw new Error("点击目标当前不可见");

    const response = await chrome.runtime.sendMessage({
      type: "douhot:monitorTrustedClick",
      point: {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      },
    });
    if (!response || response.ok !== true) {
      throw new Error(response && response.error ? response.error : "可信点击失败");
    }
  }

  async function trustedKeypress(key) {
    const response = await chrome.runtime.sendMessage({
      type: "douhot:monitorTrustedKey",
      key,
    });
    if (!response || response.ok !== true) {
      throw new Error(response && response.error ? response.error : "可信按键失败");
    }
  }

  function currentModalId() {
    try {
      return new URL(location.href).searchParams.get("modal_id") || "";
    } catch (_error) {
      return "";
    }
  }

  function pausePlayingVideos() {
    for (const video of document.querySelectorAll("video")) {
      if (!video.paused) video.pause();
    }
  }

  async function closeOpenedVideo() {
    if (!currentModalId()) return false;
    pausePlayingVideos();
    setStatus("closing-video", "已取到信息，正在关闭视频");
    await trustedKeypress("Escape");
    const deadline = Date.now() + 1200;
    while (Date.now() < deadline && currentModalId()) {
      pausePlayingVideos();
      await sleep(30);
    }
    pausePlayingVideos();
    if (currentModalId()) throw new Error("视频详情未能自动关闭");
    return true;
  }

  async function revealNewest(dialog) {
    const tip = dialog.querySelector(".RightPanelNewMessageTipwrapper");
    if (!tip) return false;
    setStatus("opening-new-message", text(tip));
    await trustedClick(tip);
    await sleep(500);
    return true;
  }

  async function resolveOpenedVideo(expectedAuthor, previousId) {
    const deadline = Date.now() + config.resolveTimeoutMs;
    while (Date.now() < deadline) {
      pausePlayingVideos();
      const routeVideoId = currentModalId();
      const infos = Array.from(document.querySelectorAll('[data-e2e="video-info"][data-e2e-aweme-id]'));
      const matching = infos.find((info) => {
        const nickname = text(info.querySelector('[data-e2e="feed-video-nickname"]'));
        const id = info.getAttribute("data-e2e-aweme-id") || "";
        return (routeVideoId && id === routeVideoId)
          || nickname.includes(expectedAuthor)
          || (id && id !== previousId && infos.length === 1);
      });

      if (matching) {
        const videoId = matching.getAttribute("data-e2e-aweme-id") || "";
        const nickname = text(matching.querySelector('[data-e2e="feed-video-nickname"]'));
        const profileLink = Array.from(matching.querySelectorAll('a[href*="/user/"]'))[0];
        const domProfileUrl = profileLink ? profileLink.href.split("?")[0] : "";
        const domProfileId = domProfileUrl ? domProfileUrl.split("/").filter(Boolean).pop() : "";
        const videoInfoText = text(matching).slice(0, 600);
        const detailPromise = videoId ? fetchVideoDetail(videoId).catch(() => null) : Promise.resolve(null);

        // The modal is no longer needed once the ID and DOM fallbacks are captured.
        // Close it before waiting for the API or Feishu so the next message can proceed.
        if (currentModalId()) await closeOpenedVideo();

        const detail = await detailPromise;
        const detailAuthor = detail?.author || detail?.authorInfo || detail?.author_info || {};
        const authorName = text({ textContent: detailAuthor.nickname || detailAuthor.name || nickname })
          .replace(/^@/, "")
          .replace(/认证徽章.*$/, "")
          .trim() || expectedAuthor;
        const apiProfileId = detailAuthor.sec_uid || detailAuthor.secUid || detailAuthor.sec_user_id || detailAuthor.secUserId || "";
        const profileId = apiProfileId || domProfileId;
        const profileUrl = profileId ? `https://www.douyin.com/user/${encodeURIComponent(profileId)}` : domProfileUrl;
        if (videoId) {
          const statistics = detail?.statistics || detail?.stats || {};
          const videoData = detail?.video || {};
          const durationRaw = Number(videoData.duration || detail?.duration || 0);
          const durationSeconds = Number.isFinite(durationRaw) && durationRaw > 0
            ? Math.round(durationRaw > 10000 ? durationRaw / 1000 : durationRaw)
            : null;
          const title = String(detail?.desc || detail?.title || "").trim();
          const tagValues = [];
          for (const item of detail?.text_extra || detail?.textExtra || []) {
            const value = item?.hashtag_name || item?.hashtagName || item?.name || "";
            if (value) tagValues.push(String(value).replace(/^#/, "").trim());
          }
          for (const match of title.matchAll(/#([^\s#，,。.!！?？、;；:：]+)/g)) tagValues.push(match[1]);
          const tags = Array.from(new Set(tagValues.filter(Boolean)));
          const coverUrl = videoData?.cover?.url_list?.[0]
            || videoData?.origin_cover?.url_list?.[0]
            || videoData?.dynamic_cover?.url_list?.[0]
            || "";
          const playAddress = videoData?.play_addr || videoData?.playAddr || {};
          const sourcePlayUri = playAddress?.uri
            || videoData?.play_addr_h264?.uri
            || videoData?.play_addr_265?.uri
            || "";
          const mediaUrlRaw = playAddress?.url_list?.[0]
            || playAddress?.urlList?.[0]
            || videoData?.playAddr?.urlList?.[0]
            || videoData?.play_addr_h264?.url_list?.[0]
            || videoData?.play_addr_265?.url_list?.[0]
            || videoData?.download_addr?.url_list?.[0]
            || videoData?.downloadAddr?.urlList?.[0]
            || "";
          const mediaFallbackUrl = normalizeHttpUrl(mediaUrlRaw);
          // play_addr.url_list frequently points at playwm or a short-lived CDN URL.
          // DashScope fetches from another server, so prefer the stable URI resolver.
          const mediaUrl = douyinSourceUrl(sourcePlayUri) || douyinSourceUrl(mediaFallbackUrl) || mediaFallbackUrl;
          const publishedAt = detail?.create_time
            ? new Date(Number(detail.create_time) * 1000).toISOString()
            : "";
          return {
            authorName,
            profileId: profileId || videoId,
            profileUrl,
            videoId,
            videoUrl: `https://www.douyin.com/video/${videoId}`,
            title,
            tags,
            coverUrl,
            mediaUrl,
            mediaFallbackUrl,
            sourcePlayUri,
            likeCount: detail ? Number(statistics.digg_count ?? statistics.diggCount ?? 0) : null,
            commentCount: detail ? Number(statistics.comment_count ?? statistics.commentCount ?? 0) : null,
            collectCount: detail ? Number(statistics.collect_count ?? statistics.collectCount ?? 0) : null,
            shareCount: detail ? Number(statistics.share_count ?? statistics.shareCount ?? 0) : null,
            durationSeconds,
            publishedAt,
            videoInfoText,
          };
        }
      }
      await sleep(100);
    }
    throw new Error(`未能解析 ${expectedAuthor} 的作品信息`);
  }

  async function sendEvent(card, force = false) {
    setStatus("resolving", card.authorName);
    let playbackGuard = 0;
    try {
      if (!force && seen.has(card.fingerprint)) return;
      // A previous failed attempt may have left its modal open. It must be closed
      // before clicking another chat card or that click toggles the old player.
      await closeOpenedVideo();
      const currentInfo = document.querySelector('[data-e2e="video-info"][data-e2e-aweme-id]');
      const previousId = currentInfo ? currentInfo.getAttribute("data-e2e-aweme-id") : "";
      playbackGuard = setInterval(pausePlayingVideos, 25);
      await trustedClick(card.clickable);
      const video = await resolveOpenedVideo(card.authorName, previousId);
      clearInterval(playbackGuard);
      playbackGuard = 0;
      const publishTimestamp = video.publishedAt ? new Date(video.publishedAt).getTime() : null;
      const result = {
        sourceUrl: video.videoUrl,
        extractedAt: new Date().toISOString(),
        creatorId: video.profileId,
        creatorName: video.authorName,
        sort: "monitor",
        sortText: "私聊自动监控",
        filters: {},
        limit: 1,
        count: 1,
        includeComments: false,
        monitor: {
          fingerprint: card.fingerprint,
          forwardedAtText: card.forwardedAtText,
          targetConversation: config.targetConversation,
        },
        works: [{
          id: video.videoId,
          awemeId: video.videoId,
          title: video.title || video.videoInfoText || video.authorName,
          authorName: video.authorName,
          tags: video.tags || [],
          tagsText: (video.tags || []).join("、"),
          coverUrl: video.coverUrl || card.thumbnailUrl,
          likeCount: video.likeCount,
          commentCount: video.commentCount,
          collectCount: video.collectCount,
          shareCount: video.shareCount,
          durationSeconds: video.durationSeconds,
          publishTimestamp,
          publishDate: publishTimestamp,
          videoLink: video.videoUrl,
          mediaUrl: video.mediaUrl,
          mediaFallbackUrl: video.mediaFallbackUrl,
          sourcePlayUri: video.sourcePlayUri,
        }],
      };

      const response = await chrome.runtime.sendMessage({
        type: "douhot:monitorSyncWork",
        payload: result,
      });
      if (!response || response.ok !== true) {
        throw new Error(response && response.error ? response.error : "飞书同步入队失败");
      }

      seen.add(card.fingerprint);
      await saveState();
      if (force) await markSourceRetryComplete();
      if (response.data?.queued) {
        setStatus("queued", `${card.authorName} 视频已关闭，正在后台入库`);
      } else {
        setStatus("written", `${card.authorName} 已同步飞书`);
      }
    } catch (error) {
      setStatus("error", String(error && error.message ? error.message : error));
      await chrome.storage.local.set({
        douyinCollectorPageErrorV1: {
          at: new Date().toISOString(),
          message: String(error && error.message ? error.message : error),
          fingerprint: card.fingerprint,
        },
      });
    } finally {
      if (playbackGuard) clearInterval(playbackGuard);
      pausePlayingVideos();
      if (currentModalId()) await closeOpenedVideo().catch(() => undefined);
      processing.delete(card.fingerprint);
    }
  }

  async function scan(dialog) {
    if (scanning || !dialog || !targetIsSelected(dialog)) return;
    scanning = true;
    try {
      if (!state.initialized) {
        await revealNewest(dialog);
        const baseline = messageCards(dialog);
        for (const card of baseline) seen.add(card.fingerprint);
        state.initialized = true;
        await saveState();
        setStatus("watching", `已建立基线：${baseline.length} 条可见消息`);
        return;
      }

      await revealNewest(dialog);
      const cards = messageCards(dialog);
      if (retryLatestRequested && !retryLatestAttempted && cards.length && !processing.size) {
        const latest = cards[0];
        retryLatestAttempted = true;
        processing.add(latest.fingerprint);
        setStatus("retrying-source", `正在用新版视频源重试：${latest.authorName}`);
        serial = serial.then(() => sendEvent(latest, true));
        return;
      }
      const candidates = cards.filter((card) =>
        card.isRecent && !seen.has(card.fingerprint) && !processing.has(card.fingerprint));

      if (candidates.length === 0) {
        if (!processing.size) setStatus("watching", `可见消息：${cards.length} 条`);
        return;
      }

      for (const card of candidates.slice().reverse()) {
        // Reserve before adding to the serial chain. Mutation-driven scans can run
        // many times while another item is syncing; without this, the same card is
        // queued repeatedly and later toggles the player on every duplicate run.
        processing.add(card.fingerprint);
        serial = serial.then(() => sendEvent(card));
      }
    } catch (error) {
      setStatus("error", String(error && error.message ? error.message : error));
    } finally {
      scanning = false;
    }
  }

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(() => {
      scanScheduled = false;
      if (attachedDialog) void scan(attachedDialog);
    }, 40);
  }

  function attach(dialog) {
    if (!dialog || dialog === attachedDialog) return;
    if (observer) observer.disconnect();
    attachedDialog = dialog;
    observer = new MutationObserver(scheduleScan);
    observer.observe(dialog, { childList: true, subtree: true, characterData: true });
    scheduleScan();
  }

  async function maintain() {
    if (maintaining) return;
    maintaining = true;
    try {
      const dialog = await ensureTargetConversation();
      if (!dialog) {
        setStatus("waiting-for-chat", "未找到私聊窗口，请确认已登录抖音并打开消息面板");
      } else if (!targetIsSelected(dialog)) {
        setStatus("waiting-for-target", `未进入目标会话“${config.targetConversation}”，请确认会话名称与设置一致`);
      } else {
        attach(dialog);
        await scan(dialog);
      }
    } catch (error) {
      setStatus("error", error.message || String(error));
    } finally {
      maintaining = false;
    }
  }

  void loadState().then(() => {
    setStatus("starting", "正在连接私聊监控");
    void maintain();
    setInterval(() => void maintain(), config.scanIntervalMs);
  });
})();
