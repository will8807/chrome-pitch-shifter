// Runs the tab-capture path. The service worker hands us a tabCapture streamId;
// we wire it through a pitch-shift AudioWorklet and play the result.

const sessions = new Map(); // tabId -> { stream, ctx, source, node }

async function start(streamId, tabId, semitones) {
  if (sessions.has(tabId)) {
    setPitch(tabId, semitones);
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule('../worklets/pitch-shift-processor.js');
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'pitch-shift-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2]
  });
  const param = node.parameters.get('pitchSemitones');
  if (param) param.setValueAtTime(semitones, ctx.currentTime);
  source.connect(node).connect(ctx.destination);
  sessions.set(tabId, { stream, ctx, source, node });
}

function setPitch(tabId, semitones) {
  const s = sessions.get(tabId);
  if (!s) throw new Error('No session for tab ' + tabId);
  const p = s.node.parameters.get('pitchSemitones');
  if (p) p.setValueAtTime(semitones, s.ctx.currentTime);
}

async function stop(tabId) {
  const s = sessions.get(tabId);
  if (!s) return;
  try { s.node.disconnect(); } catch {}
  try { s.source.disconnect(); } catch {}
  for (const track of s.stream.getTracks()) track.stop();
  await s.ctx.close().catch(() => {});
  sessions.delete(tabId);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'os:start') {
        await start(msg.streamId, msg.tabId, msg.semitones);
        sendResponse({ ok: true });
      } else if (msg?.type === 'os:setPitch') {
        setPitch(msg.tabId, msg.semitones);
        sendResponse({ ok: true });
      } else if (msg?.type === 'os:stop') {
        await stop(msg.tabId);
        sendResponse({ ok: true });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err.message || err) });
    }
  })();
  return true; // async
});
