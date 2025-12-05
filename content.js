
(() => {
  // Prevent double-injection
  if (window.__sfmInitialized) return;
  window.__sfmInitialized = true;

  // --- CONFIG ---

  // Default daily time limit (10 minutes) – user can change via 3-dot menu
  const DEFAULT_LIMIT_SECONDS = 10 * 60;

  // Popup duration
  const POPUP_DURATION_MS = 10000;

  // How often we check if we're on Shorts / Reels / TikTok
  const SHORTFORM_CHECK_INTERVAL_MS = 500;

  // TikTok-specific popup interval (seconds)
  const TIKTOK_POPUP_INTERVAL_SECONDS = 2 * 60; // 2 minutes

  // Storage keys (ONE global daily timer across all sites)
  const STORAGE_TIME_KEY = "sfm_time";     // total daily seconds
  const STORAGE_DATE_KEY = "sfm_date";     // "YYYY-MM-DD"
  const STORAGE_LIMIT_KEY = "sfm_limit";   // user daily limit in seconds

  // --- POP-UP MESSAGES (why you should stop) ---

  const POPUP_MESSAGES = [
    "The longer you stay on this feed, the harder it becomes to focus on anything else today.",
    "Each extra short you watch is time taken away from goals that actually matter to you.",
    "Staying in this loop trains your brain to expect constant stimulation instead of real rest.",
    "Right now you could choose to pause and give your mind a break instead of one more video.",
    "Short-form scrolling feels relaxing, but it often leaves you more drained and distracted afterward.",
    "Every swipe makes it easier to keep going and harder to pull yourself away from the screen.",
    "If you stopped now, you’d instantly create more time for something meaningful or genuinely relaxing.",
    "Your attention is valuable—this feed is designed to keep it, not to protect your wellbeing.",
    "A quick exit now can protect your energy for things that will still matter tomorrow.",
    "You won’t remember most of these clips, but you will feel the time lost if you keep going."
  ];

  let popupMessageIndex = 0;
  function getNextPopupMessage() {
    const msg = POPUP_MESSAGES[popupMessageIndex];
    popupMessageIndex = (popupMessageIndex + 1) % POPUP_MESSAGES.length;
    return msg;
  }

  // --- STATE (ONE daily total) ---

  let elapsedSeconds = 0;       // global daily time across ALL short-form sites
  let storedDate = null;        // YYYY-MM-DD stored with that time
  let userLimitSeconds = DEFAULT_LIMIT_SECONDS;

  let scrollCount = 0;          // per-session scrolls (based on URL changes)
  let timerId = null;
  let isActive = !document.hidden;
  let shortFormActive = false;
  let lastShortFormUrl = null;  // used to detect new Shorts/Reels/TikToks

  // TikTok-specific timer for periodic popups
  let tiktokSecondsSincePopup = 0;

  // Settings panel
  let menuPanel = null;
  let menuInput = null;
  let menuOpen = false;

  // --- UTILITIES ---

  function getTodayDateString() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function isOnTikTokNow() {
    const hostname = window.location.hostname || "";
    return hostname.includes("tiktok.com");
  }

  // Load state from chrome.storage (ONE global total)
  function loadGlobalStateAndInit() {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.local) {
        storedDate = getTodayDateString();
        elapsedSeconds = 0;
        userLimitSeconds = DEFAULT_LIMIT_SECONDS;
        initAfterLoad();
        return;
      }
    } catch {
      storedDate = getTodayDateString();
      elapsedSeconds = 0;
      userLimitSeconds = DEFAULT_LIMIT_SECONDS;
      initAfterLoad();
      return;
    }

    chrome.storage.local.get(
      {
        [STORAGE_TIME_KEY]: 0,
        [STORAGE_DATE_KEY]: null,
        [STORAGE_LIMIT_KEY]: DEFAULT_LIMIT_SECONDS
      },
      (data) => {
        const today = getTodayDateString();

        let time = typeof data[STORAGE_TIME_KEY] === "number" ? data[STORAGE_TIME_KEY] : 0;
        let date = typeof data[STORAGE_DATE_KEY] === "string" ? data[STORAGE_DATE_KEY] : null;
        let limit = typeof data[STORAGE_LIMIT_KEY] === "number" ? data[STORAGE_LIMIT_KEY] : DEFAULT_LIMIT_SECONDS;

        if (date !== today) {
          time = 0;
          date = today;
        }

        elapsedSeconds = time;
        storedDate = date;
        userLimitSeconds = limit > 0 ? limit : DEFAULT_LIMIT_SECONDS;

        saveGlobalState();
        initAfterLoad();
      }
    );
  }

  function saveGlobalState() {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.set({
        [STORAGE_TIME_KEY]: elapsedSeconds,
        [STORAGE_DATE_KEY]: storedDate,
        [STORAGE_LIMIT_KEY]: userLimitSeconds
      });
    } catch {
      // ignore
    }
  }

  function maybeResetForNewDay() {
    const today = getTodayDateString();
    if (storedDate !== today) {
      storedDate = today;
      elapsedSeconds = 0;
      scrollCount = 0;
      tiktokSecondsSincePopup = 0;
      saveGlobalState();
      updateMeterUI();
      removeFunFactPopup();
    }
  }

  // --- SHORT-FORM DETECTION ---

  function isOnShortFormNow() {
    const hostname = window.location.hostname || "";
    const path = window.location.pathname || "";
    const href = window.location.href || "";

    const onYouTube = hostname.includes("youtube.com");
    const onTikTok = hostname.includes("tiktok.com");
    const onInstagram = hostname.includes("instagram.com");

    const isYouTubeShorts =
      onYouTube && (path.includes("/shorts") || href.includes("/shorts"));

    const isTikTokShortForm = onTikTok; // treat all TikTok as short-form

    const isInstagramReels =
      onInstagram &&
      (path.includes("/reels") ||
        path.includes("/reel") ||
        href.includes("/reels/") ||
        href.includes("/reel/"));

    return isYouTubeShorts || isTikTokShortForm || isInstagramReels;
  }

  // --- DOM: Meter + Settings menu ---

  function createMeter() {
    if (document.getElementById("sfm-meter-container")) return;

    const container = document.createElement("div");
    container.id = "sfm-meter-container";

    // Header
    const header = document.createElement("div");
    header.id = "sfm-meter-header";

    const title = document.createElement("div");
    title.id = "sfm-meter-title";
    title.textContent = "Time-Spent Meter";

    const headerRight = document.createElement("div");
    headerRight.id = "sfm-meter-header-right";

    const setting = document.createElement("div");
    setting.id = "sfm-meter-setting";
    setting.textContent = formatMeterSetting();

    const menuButton = document.createElement("button");
    menuButton.id = "sfm-meter-menu-button";
    menuButton.type = "button";
    menuButton.textContent = "⋯";

    headerRight.appendChild(setting);
    headerRight.appendChild(menuButton);

    header.appendChild(title);
    header.appendChild(headerRight);

    // Progress bar
    const bar = document.createElement("div");
    bar.id = "sfm-meter-bar";

    const fill = document.createElement("div");
    fill.id = "sfm-meter-fill";
    bar.appendChild(fill);

    // Stats
    const stats = document.createElement("div");
    stats.id = "sfm-meter-stats";

    const timeLabel = document.createElement("span");
    timeLabel.id = "sfm-meter-time-label";
    timeLabel.textContent = "Time: 0:00";

    const scrollLabel = document.createElement("span");
    scrollLabel.id = "sfm-meter-scroll-label";
    scrollLabel.textContent = "Scrolls: 0";

    stats.appendChild(timeLabel);
    stats.appendChild(scrollLabel);

    // Hint
    const hint = document.createElement("div");
    hint.id = "sfm-meter-hint";
    hint.textContent = ""; // will set in updateHintText()

    container.appendChild(header);
    container.appendChild(bar);
    container.appendChild(stats);
    container.appendChild(hint);

    document.documentElement.appendChild(container);

    createSettingsPanel();

    menuButton.addEventListener("click", () => {
      toggleMenuPanel();
    });

    updateHintText();
    updateMeterUI();
  }

  function destroyMeter() {
    const container = document.getElementById("sfm-meter-container");
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    removeFunFactPopup();
    closeMenuPanel();
  }

  function createSettingsPanel() {
    if (menuPanel) return;

    menuPanel = document.createElement("div");
    menuPanel.id = "sfm-meter-menu-panel";
    menuPanel.style.display = "none";

    const label = document.createElement("div");
    label.id = "sfm-meter-menu-label";
    label.textContent = "Daily limit (minutes):";

    const input = document.createElement("input");
    input.id = "sfm-meter-menu-input";
    input.type = "number";
    input.min = "1";
    input.max = "600";
    input.step = "1";
    input.value = Math.round(userLimitSeconds / 60);

    const btnRow = document.createElement("div");
    btnRow.id = "sfm-meter-menu-buttons";

    const cancelBtn = document.createElement("button");
    cancelBtn.id = "sfm-meter-menu-cancel";
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";

    const saveBtn = document.createElement("button");
    saveBtn.id = "sfm-meter-menu-save";
    saveBtn.type = "button";
    saveBtn.textContent = "Save";

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);

    menuPanel.appendChild(label);
    menuPanel.appendChild(input);
    menuPanel.appendChild(btnRow);

    document.documentElement.appendChild(menuPanel);

    menuInput = input;

    cancelBtn.addEventListener("click", () => {
      closeMenuPanel();
      if (menuInput) {
        menuInput.value = Math.round(userLimitSeconds / 60);
      }
    });

    saveBtn.addEventListener("click", () => {
      if (!menuInput) return;
      const mins = parseInt(menuInput.value, 10);
      if (!Number.isFinite(mins) || mins <= 0) {
        menuInput.value = Math.round(userLimitSeconds / 60);
        closeMenuPanel();
        return;
      }
      userLimitSeconds = mins * 60;
      saveGlobalState();
      updateSettingLabel();
      updateMeterUI();
      closeMenuPanel();
    });
  }

  function openMenuPanel() {
    if (!menuPanel || !menuInput) return;
    menuInput.value = Math.round(userLimitSeconds / 60);
    menuPanel.style.display = "flex";
    menuOpen = true;
  }

  function closeMenuPanel() {
    if (!menuPanel) return;
    menuPanel.style.display = "none";
    menuOpen = false;
  }

  function toggleMenuPanel() {
    if (!menuPanel) return;
    if (menuOpen) {
      closeMenuPanel();
    } else {
      openMenuPanel();
    }
  }

  // --- POP-UP (center) ---

  function createFunFactPopup() {
    removeFunFactPopup();

    const popup = document.createElement("div");
    popup.id = "sfm-funfact-popup";

    const text = document.createElement("div");
    text.id = "sfm-funfact-text";
    text.textContent = "POP-UP FUN FACTS: " + getNextPopupMessage();

    const progress = document.createElement("div");
    progress.id = "sfm-funfact-progress";

    const progressInner = document.createElement("div");
    progressInner.id = "sfm-funfact-progress-inner";

    progress.appendChild(progressInner);
    popup.appendChild(text);
    popup.appendChild(progress);

    document.documentElement.appendChild(popup);

    setTimeout(removeFunFactPopup, POPUP_DURATION_MS);
  }

  function removeFunFactPopup() {
    const existing = document.getElementById("sfm-funfact-popup");
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
  }

  // --- UI HELPERS ---

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const paddedSecs = secs < 10 ? "0" + secs : secs.toString();
    return `${mins}:${paddedSecs}`;
  }

  function formatMeterSetting() {
    const limit = userLimitSeconds > 0 ? userLimitSeconds : DEFAULT_LIMIT_SECONDS;
    const mins = Math.round(limit / 60);
    return `${mins} min daily limit`;
  }

  function updateSettingLabel() {
    const setting = document.getElementById("sfm-meter-setting");
    if (setting) {
      setting.textContent = formatMeterSetting();
    }
  }

  // NEW: update hint text depending on TikTok vs Shorts/Reels
  function updateHintText() {
    const hint = document.getElementById("sfm-meter-hint");
    if (!hint) return;

    if (isOnTikTokNow()) {
      hint.textContent =
        "Daily short-form time. POP-UP appears every 2 minutes on TikTok.";
    } else {
      hint.textContent =
        "Daily short-form time. POP-UP appears every 10 Shorts/Reels.";
    }
  }

  function updateMeterUI() {
    const fill = document.getElementById("sfm-meter-fill");
    const timeLabel = document.getElementById("sfm-meter-time-label");
    const scrollLabel = document.getElementById("sfm-meter-scroll-label");

    if (!fill || !timeLabel || !scrollLabel) {
      updateHintText();
      return;
    }

    const limit = userLimitSeconds > 0 ? userLimitSeconds : DEFAULT_LIMIT_SECONDS;
    const exceeded = elapsedSeconds >= limit;

    const baseTime = `Time: ${formatTime(elapsedSeconds)}`;
    timeLabel.textContent = exceeded ? `${baseTime} • TIME EXCEEDED` : baseTime;

    // TikTok: hide scrolls label & don't show count
    if (isOnTikTokNow()) {
      scrollLabel.style.display = "none";
    } else {
      scrollLabel.style.display = "";
      scrollLabel.textContent = `Scrolls: ${scrollCount}`;
    }

    const ratio = Math.min(elapsedSeconds / limit, 1);
    fill.style.width = (ratio * 100).toFixed(1) + "%";

    if (ratio < 0.5) {
      fill.style.backgroundColor = "#3cd37f";
    } else if (ratio < 0.85) {
      fill.style.backgroundColor = "#f2b94e";
    } else {
      fill.style.backgroundColor = "#f25f4c";
    }

    // keep hint in sync with current site
    updateHintText();
  }

  // --- "Scroll" via URL changes (every 10 → popup) ---

  function recordScrollLikeAction() {
    if (!shortFormActive) return;
    scrollCount += 1;
    updateMeterUI();

    // For Shorts/Reels (where URL changes), show popup every 10
    if (!isOnTikTokNow() && scrollCount > 0 && scrollCount % 10 === 0) {
      createFunFactPopup();
    }
  }

  // --- TIMER / DAILY TIME ---

  function tick() {
    if (!isActive || !shortFormActive) return;

    maybeResetForNewDay();

    elapsedSeconds += 1;
    updateMeterUI();
    saveGlobalState();

    // TikTok-specific 2-minute popup
    if (isOnTikTokNow()) {
      tiktokSecondsSincePopup += 1;
      if (tiktokSecondsSincePopup >= TIKTOK_POPUP_INTERVAL_SECONDS) {
        createFunFactPopup();
        tiktokSecondsSincePopup = 0;
      }
    } else {
      tiktokSecondsSincePopup = 0;
    }
  }

  function startTimer() {
    if (timerId !== null) return;
    timerId = setInterval(tick, 1000);
  }

  function stopTimer() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  // --- VISIBILITY ---

  document.addEventListener("visibilitychange", () => {
    isActive = !document.hidden;
  });

  // --- SHORT-FORM WATCHER ---

  function enterShortForm() {
    shortFormActive = true;
    scrollCount = 0; // only scrolls reset per session – NOT time
    lastShortFormUrl = window.location.href;
    destroyMeter();
    createMeter();
    updateSettingLabel();
    updateMeterUI();
    startTimer();
  }

  function leaveShortForm() {
    shortFormActive = false;
    stopTimer();
    destroyMeter();
    lastShortFormUrl = null;
    tiktokSecondsSincePopup = 0;
  }

  function startShortFormWatcher() {
    let lastWasShortForm = isOnShortFormNow();

    if (lastWasShortForm) {
      enterShortForm();
    }

    setInterval(() => {
      const nowShortForm = isOnShortFormNow();
      const currentUrl = window.location.href;

      if (nowShortForm) {
        // URL-based "scroll" detection for Shorts/Reels only
        if (
          !isOnTikTokNow() && // don't use URL changes on TikTok
          lastShortFormUrl &&
          currentUrl !== lastShortFormUrl &&
          lastWasShortForm
        ) {
          recordScrollLikeAction();
        }
        lastShortFormUrl = currentUrl;
      } else {
        lastShortFormUrl = null;
      }

      if (nowShortForm && !lastWasShortForm) {
        enterShortForm();
      } else if (!nowShortForm && lastWasShortForm) {
        leaveShortForm();
      }

      lastWasShortForm = nowShortForm;
    }, SHORTFORM_CHECK_INTERVAL_MS);
  }

  // --- INIT ---

  function initAfterLoad() {
    startShortFormWatcher();
  }

  loadGlobalStateAndInit();
})();
