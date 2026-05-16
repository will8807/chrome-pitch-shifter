// Wraps <audio> and <video> elements on the page in a Web Audio graph that
// routes them through a pitch-shifting AudioWorklet. Reports back to the
// service worker so it can fall back to tab capture when wiring fails.

(() => {
  if (window.__pitchShifterInstalled) return;
  window.__pitchShifterInstalled = true;

  let audioCtx = null;
  let workletReady = null;
  let currentSemitones = 0;
  // Map<HTMLMediaElement, { source, node }>
  const wired = new WeakMap();
  const liveNodes = new Set();

  function ensureContext() {
    if (audioCtx) return workletReady;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const url = chrome.runtime.getURL('worklets/pitch-shift-processor.js');
    workletReady = audioCtx.audioWorklet.addModule(url);
    return workletReady;
  }

  async function wireElement(el) {
    if (wired.has(el)) return true;
    try {
      await ensureContext();
      // Resume in case it started suspended (autoplay policies).
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      const source = audioCtx.createMediaElementSource(el);
      const node = new AudioWorkletNode(audioCtx, 'pitch-shift-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2]
      });
      const param = node.parameters.get('pitchSemitones');
      if (param) param.setValueAtTime(currentSemitones, audioCtx.currentTime);
      source.connect(node).connect(audioCtx.destination);
      wired.set(el, { source, node });
      liveNodes.add(node);
      return true;
    } catch (err) {
      // Common: InvalidStateError if element already attached to another context,
      // or SecurityError on cross-origin tainted media.
      console.warn('[PitchShifter] failed to wire element', err);
      return false;
    }
  }

  function findMediaElements() {
    return Array.from(document.querySelectorAll('audio, video'));
  }

  async function applyToAll(semitones) {
    currentSemitones = semitones;
    const elements = findMediaElements();
    let wiredCount = 0;
    for (const el of elements) {
      const ok = await wireElement(el);
      if (ok) wiredCount++;
    }
    // Update parameter on all live nodes (existing and newly-wired).
    for (const node of liveNodes) {
      const p = node.parameters.get('pitchSemitones');
      if (p) p.setValueAtTime(semitones, audioCtx.currentTime);
    }
    return wiredCount;
  }

  // Watch for media elements added later (SPA navigation, lazy loading).
  const observer = new MutationObserver((mutations) => {
    if (currentSemitones === 0 && liveNodes.size === 0) return;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node instanceof HTMLMediaElement) {
          wireElement(node);
        } else if (node instanceof Element) {
          node.querySelectorAll?.('audio, video').forEach(wireElement);
        }
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type !== 'cs:applyPitch') return;
    applyToAll(msg.semitones)
      .then((mediaCount) => sendResponse({ ok: true, mediaCount }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true; // async
  });
})();
