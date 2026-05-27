const slider = document.getElementById('slider');
const number = document.getElementById('number');
const decr = document.getElementById('decr');
const incr = document.getElementById('incr');
const reset = document.getElementById('reset');
const statusEl = document.getElementById('status');

let activeTabId = null;

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', !!isError);
}

function clamp(v) {
  v = Math.round(Number(v));
  if (!Number.isFinite(v)) v = 0;
  return Math.max(-12, Math.min(12, v));
}

function setUI(value) {
  slider.value = String(value);
  number.value = String(value);
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    setStatus('No active tab', true);
    return;
  }
  activeTabId = tab.id;

  const stored = await chrome.storage.session.get(['pitchByTab']);
  const pitchByTab = stored.pitchByTab || {};
  const current = pitchByTab[activeTabId] ?? 0;
  setUI(current);
  setStatus(current === 0 ? 'Idle' : `Active: ${current > 0 ? '+' : ''}${current} st`);
}

async function apply(value) {
  const v = clamp(value);
  setUI(v);

  const stored = await chrome.storage.session.get(['pitchByTab']);
  const pitchByTab = stored.pitchByTab || {};
  pitchByTab[activeTabId] = v;
  await chrome.storage.session.set({ pitchByTab });

  setStatus('Applying…');
  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'applyPitch',
      tabId: activeTabId,
      semitones: v
    });
    if (!resp || !resp.ok) {
      setStatus(resp?.error || 'Failed to apply', true);
      return;
    }
    if (v === 0) {
      setStatus(`Bypassed (mode: ${resp.mode})`);
    } else {
      setStatus(`Active: ${v > 0 ? '+' : ''}${v} st (mode: ${resp.mode})`);
    }
  } catch (err) {
    setStatus(String(err && err.message || err), true);
  }
}

slider.addEventListener('input', () => apply(slider.value));
decr.addEventListener('click', () => apply(Number(slider.value) - 1));
incr.addEventListener('click', () => apply(Number(slider.value) + 1));
slider.addEventListener('wheel', (e) => {
  e.preventDefault();
  apply(clamp(Number(slider.value) - Math.sign(e.deltaY)));
}, { passive: false });
number.addEventListener('change', () => apply(number.value));
number.addEventListener('wheel', (e) => {
  e.preventDefault();
  apply(clamp(Number(number.value) - Math.sign(e.deltaY)));
}, { passive: false });
reset.addEventListener('click', () => apply(0));

init();
