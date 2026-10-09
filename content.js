(() => {
  if (window.pinterestAutoScrollLoaded) {
    return;
  }
  window.pinterestAutoScrollLoaded = true;

  const DEFAULT_SPEED = 40;
  const MIN_SPEED = 5;
  const MAX_SPEED = 400;
  const SPEED_STEP = 5;
  const RESUME_DELAY_MS = 5000;
  const RELOAD_INTERVAL_MS = 30 * 60 * 1000;
  const STALL_LIMIT_MS = 60 * 1000;
  const HANDOFF_INTERVAL_MS = 400;
  const GLIDE_DURATION_MS = 60 * 1000;
  const HUD_VISIBLE_MS = 1500;
  const ENABLED_CLASS = 'autoscroll-on';
  const IDLE_CLASS = 'autoscroll-idle';
  const ENABLED_KEY = 'pinterest-autoscroll-enabled';
  const PINNED_ATTRIBUTE = 'data-autoscroll-pinned';
  const PINNED_PROBE_ROWS = [8, 40, 72, 104, 136];
  const PINNED_PROBE_COLUMNS = [0.05, 0.25, 0.5, 0.75, 0.95];
  const PINNED_MAX_HEIGHT_RATIO = 0.5;

  const root = document.documentElement;
  const listeners = new AbortController();

  let enabled = false;
  let speed = DEFAULT_SPEED;
  let manuallyPaused = false;
  let resumeAt = 0;
  let startedAt = 0;
  let lastHandoffAt = 0;
  let frameRequest = 0;
  let glide = null;
  let glideSpeed = 0;
  let committedOffset = 0;
  let stalledMs = 0;
  let lastPointerX = null;
  let lastPointerY = null;
  let hud = null;
  let controls = null;
  let hudTimer = 0;
  let wakeLock = null;

  function showHud(text) {
    if (!hud) {
      hud = document.createElement('div');
      hud.className = 'autoscroll-hud';
      root.appendChild(hud);
    }
    hud.textContent = text;
    hud.classList.add('autoscroll-hud-visible');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => hud.classList.remove('autoscroll-hud-visible'), HUD_VISIBLE_MS);
  }

  function addControls() {
    const stopButton = document.createElement('button');
    stopButton.type = 'button';
    stopButton.className = 'autoscroll-stop';
    stopButton.textContent = '■ Stop';
    stopButton.title = 'Stop AutoScroll';
    stopButton.addEventListener('click', () => setEnabled(false));

    const version = document.createElement('div');
    version.className = 'autoscroll-version';
    version.textContent = `v${chrome.runtime.getManifest().version}`;

    controls = document.createElement('div');
    controls.className = 'autoscroll-controls';
    controls.append(stopButton, version);
    root.appendChild(controls);
  }

  function removeControls() {
    controls?.remove();
    controls = null;
  }

  function goHome() {
    location.assign(location.origin + '/');
  }

  function postponeScrolling() {
    if (enabled) {
      resumeAt = performance.now() + RESUME_DELAY_MS;
    }
  }

  function changeSpeed(delta) {
    speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed + delta));
    chrome.storage.local.set({ speed });
    showHud(`Speed ${speed} px/s`);
  }

  function togglePause() {
    manuallyPaused = !manuallyPaused;
    resumeAt = 0;
    showHud(manuallyPaused ? 'Paused' : 'Running');
  }

  function isTyping(target) {
    return target instanceof HTMLElement
      && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
  }

  function onKeyDown(event) {
    if (shutDownIfOrphaned() || !enabled) {
      return;
    }
    if (isTyping(event.target) || event.ctrlKey || event.altKey || event.metaKey) {
      postponeScrolling();
      return;
    }
    if (event.code === 'Space') {
      togglePause();
    } else if (event.key === 'Escape') {
      setEnabled(false);
    } else if (event.key === '+' || event.key === '=') {
      changeSpeed(SPEED_STEP);
    } else if (event.key === '-') {
      changeSpeed(-SPEED_STEP);
    } else {
      postponeScrolling();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  function onPointerMove(event) {
    const moved = event.screenX !== lastPointerX || event.screenY !== lastPointerY;
    const firstSample = lastPointerX === null;
    lastPointerX = event.screenX;
    lastPointerY = event.screenY;
    if (moved && !firstSample) {
      postponeScrolling();
    }
  }

  function findPinnedAncestor(element) {
    for (let node = element; node && node !== document.body && node !== root; node = node.parentElement) {
      const { position } = getComputedStyle(node);
      if (position === 'fixed' || position === 'sticky') {
        return node;
      }
    }
    return null;
  }

  function markPinnedElements() {
    const maxHeight = window.innerHeight * PINNED_MAX_HEIGHT_RATIO;
    for (const y of PINNED_PROBE_ROWS) {
      for (const column of PINNED_PROBE_COLUMNS) {
        for (const element of document.elementsFromPoint(window.innerWidth * column, y)) {
          const pinned = findPinnedAncestor(element);
          const ownControl = pinned === controls || pinned === hud;
          if (pinned && !ownControl && pinned.getBoundingClientRect().height <= maxHeight) {
            pinned.setAttribute(PINNED_ATTRIBUTE, '');
          }
        }
      }
    }
  }

  function unmarkPinnedElements() {
    for (const element of document.querySelectorAll(`[${PINNED_ATTRIBUTE}]`)) {
      element.removeAttribute(PINNED_ATTRIBUTE);
    }
  }

  function startGlide(initialOffset) {
    glideSpeed = speed;
    committedOffset = 0;
    document.body.style.translate = '';
    glide = document.body.animate(
      [
        { transform: 'translate3d(0, 0, 0)' },
        { transform: `translate3d(0, ${-(speed * GLIDE_DURATION_MS) / 1000}px, 0)` },
      ],
      { duration: GLIDE_DURATION_MS, easing: 'linear', fill: 'forwards' },
    );
    glide.currentTime = (initialOffset / speed) * 1000;
    lastHandoffAt = performance.now();
  }

  function pendingOffset() {
    return ((glide.currentTime ?? 0) * glideSpeed) / 1000 - committedOffset;
  }

  function commitGlide() {
    const ratio = window.devicePixelRatio || 1;
    const wanted = Math.floor(pendingOffset() * ratio) / ratio;
    const before = window.scrollY;
    window.scrollTo(0, before + wanted);
    const moved = window.scrollY - before;
    committedOffset += moved;
    document.body.style.translate = `0 ${committedOffset}px`;
    return { wanted, moved };
  }

  function stopGlide() {
    if (!glide) {
      return;
    }
    commitGlide();
    glide.cancel();
    glide = null;
    document.body.style.translate = '';
  }

  function advance(now) {
    if (!glide) {
      markPinnedElements();
      startGlide(0);
      return;
    }
    const sinceHandoffMs = now - lastHandoffAt;
    if (sinceHandoffMs < HANDOFF_INTERVAL_MS) {
      return;
    }
    lastHandoffAt = now;
    markPinnedElements();
    const { wanted, moved } = commitGlide();
    stalledMs = moved > 0 ? 0 : stalledMs + sinceHandoffMs;
    const blocked = wanted - moved > 1;
    const expiring = glide.currentTime > GLIDE_DURATION_MS / 2;
    if (blocked || expiring || glideSpeed !== speed) {
      const remainder = blocked ? 0 : pendingOffset();
      glide.cancel();
      startGlide(remainder);
    }
  }

  function onFrame(now) {
    if (shutDownIfOrphaned()) {
      return;
    }
    const scrolling = !manuallyPaused && now >= resumeAt;
    root.classList.toggle(IDLE_CLASS, scrolling);

    if (scrolling) {
      advance(now);
      if (stalledMs > STALL_LIMIT_MS || now - startedAt > RELOAD_INTERVAL_MS) {
        goHome();
        return;
      }
    } else {
      stopGlide();
      stalledMs = 0;
    }
    frameRequest = requestAnimationFrame(onFrame);
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      keepScreenAwake();
    } else {
      stopGlide();
    }
  }

  async function keepScreenAwake() {
    if (!enabled || !('wakeLock' in navigator) || document.visibilityState !== 'visible' || wakeLock) {
      return;
    }
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    } catch {
      wakeLock = null;
    }
  }

  function start() {
    startedAt = performance.now();
    manuallyPaused = false;
    resumeAt = 0;
    stalledMs = 0;
    root.classList.add(ENABLED_CLASS);
    addControls();
    keepScreenAwake();
    frameRequest = requestAnimationFrame(onFrame);
  }

  function stop() {
    cancelAnimationFrame(frameRequest);
    stopGlide();
    removeControls();
    unmarkPinnedElements();
    root.classList.remove(ENABLED_CLASS, IDLE_CLASS);
    wakeLock?.release();
  }

  function shutDownIfOrphaned() {
    if (chrome.runtime?.id) {
      return false;
    }
    listeners.abort();
    if (enabled) {
      enabled = false;
      sessionStorage.removeItem(ENABLED_KEY);
      stop();
    }
    return true;
  }

  function setEnabled(value) {
    if (enabled === value) {
      return;
    }
    enabled = value;
    if (enabled) {
      sessionStorage.setItem(ENABLED_KEY, '1');
      start();
    } else {
      sessionStorage.removeItem(ENABLED_KEY);
      stop();
    }
    chrome.runtime.sendMessage({ type: 'state', enabled }).catch(() => {});
  }

  const passiveCapture = { capture: true, passive: true, signal: listeners.signal };
  window.addEventListener('keydown', onKeyDown, { capture: true, signal: listeners.signal });
  window.addEventListener('mousemove', onPointerMove, passiveCapture);
  window.addEventListener('wheel', postponeScrolling, passiveCapture);
  window.addEventListener('mousedown', postponeScrolling, passiveCapture);
  window.addEventListener('touchstart', postponeScrolling, passiveCapture);
  document.addEventListener('visibilitychange', onVisibilityChange, { signal: listeners.signal });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'toggle') {
      setEnabled(!enabled);
      sendResponse({ enabled });
    }
  });

  chrome.storage.local.get({ speed: DEFAULT_SPEED }).then((stored) => {
    speed = stored.speed;
  });

  if (sessionStorage.getItem(ENABLED_KEY)) {
    setEnabled(true);
  }
})();
