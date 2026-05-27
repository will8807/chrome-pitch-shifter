// Per-tab state: { mode: 'content' | 'capture', semitones: number }
const tabState = new Map();

const OFFSCREEN_URL = 'offscreen/offscreen.html';

async function ensureOffscreen() {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
    });
    if (contexts.length > 0) return;
  } catch {
    // getContexts unavailable on older Chrome; fall through and rely on createDocument's error.
  }
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['USER_MEDIA'],
      justification: 'Process tab audio with a Web Audio AudioWorklet for pitch shifting.'
    });
  } catch (err) {
    if (!String(err?.message || '').includes('Only a single offscreen')) throw err;
  }
}

async function tryContentScript(tabId, semitones) {
  // Enumerate frames so iframe-embedded media (e.g. YouTube embeds) is also wired up.
  let frames;
  try {
    frames = await chrome.webNavigation.getAllFrames({ tabId });
  } catch {
    frames = [{ frameId: 0 }];
  }
  if (!frames || frames.length === 0) frames = [{ frameId: 0 }];

  let total = 0;
  let anyOk = false;
  await Promise.all(frames.map(async (f) => {
    try {
      const resp = await chrome.tabs.sendMessage(
        tabId,
        { type: 'cs:applyPitch', semitones },
        { frameId: f.frameId }
      );
      if (resp?.ok) {
        anyOk = true;
        total += resp.mediaCount || 0;
      }
    } catch {
      // No content script in this frame (e.g. about:blank, chrome:// subframe). Ignore.
    }
  }));
  return anyOk ? { ok: true, mediaCount: total } : null;
}

async function startTabCapture(tabId, semitones) {
  await ensureOffscreen();
  const streamId = await new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId(
      { targetTabId: tabId },
      (id) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(id);
      }
    );
  });
  // Mute before starting playback so there is no window where both original
  // and processed audio play simultaneously (audible as echo).
  await chrome.tabs.update(tabId, { muted: true });
  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'os:start',
      streamId,
      tabId,
      semitones
    });
    if (!resp || !resp.ok) throw new Error(resp?.error || 'Offscreen failed to start');
  } catch (err) {
    await chrome.tabs.update(tabId, { muted: false }).catch(() => {});
    throw err;
  }
}

async function updateTabCapture(tabId, semitones) {
  const resp = await chrome.runtime.sendMessage({
    type: 'os:setPitch',
    tabId,
    semitones
  });
  if (!resp || !resp.ok) throw new Error(resp?.error || 'Offscreen update failed');
}

async function stopTabCapture(tabId) {
  await chrome.runtime.sendMessage({ type: 'os:stop', tabId }).catch(() => {});
  await chrome.tabs.update(tabId, { muted: false }).catch(() => {});
}

function updateBadge(tabId, semitones) {
  const text = semitones === 0 ? '' : (semitones > 0 ? `+${semitones}` : String(semitones));
  chrome.action.setBadgeText({ text, tabId });
  const color = semitones > 0 ? '#0077bb' : semitones < 0 ? '#ee7733' : '#888';
  chrome.action.setBadgeBackgroundColor({ color, tabId });
}

async function applyPitch(tabId, semitones) {
  const prev = tabState.get(tabId);

  // If we're already in capture mode, stay in capture mode (no point switching back).
  if (prev?.mode === 'capture') {
    await updateTabCapture(tabId, semitones);
    tabState.set(tabId, { mode: 'capture', semitones });
    updateBadge(tabId, semitones);
    return { ok: true, mode: 'capture' };
  }

  // First try content script.
  const csResp = await tryContentScript(tabId, semitones);
  if (csResp && csResp.ok && csResp.mediaCount > 0) {
    tabState.set(tabId, { mode: 'content', semitones });
    updateBadge(tabId, semitones);
    return { ok: true, mode: 'content' };
  }

  // Fall back to tab capture.
  try {
    await startTabCapture(tabId, semitones);
    tabState.set(tabId, { mode: 'capture', semitones });
    updateBadge(tabId, semitones);
    return { ok: true, mode: 'capture' };
  } catch (err) {
    return { ok: false, error: 'Tab capture failed: ' + err.message };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'applyPitch') {
    applyPitch(msg.tabId, msg.semitones)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true; // async
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const state = tabState.get(tabId);
  if (state?.mode === 'capture') stopTabCapture(tabId);
  tabState.delete(tabId);
  chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
});
