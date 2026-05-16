# Pitch Shifter (Chrome Extension)

Pitch-shifts the audio playing in the active tab by ±12 semitones.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked** and select this folder.
4. Pin the extension from the toolbar puzzle-piece menu.

## Usage

1. Click the extension icon on a tab playing audio.
2. Drag the slider or type a number (-12 to +12 semitones).
3. The change applies live. Click **Reset** for 0 (bypass).

## How it works

Two strategies, attempted in order per tab:

1. **Content-script mode** — finds `<audio>` / `<video>` elements and routes each
   through a Web Audio graph: `MediaElementSource → AudioWorklet → destination`.
   Lower latency, no extra mute. Fails on DRM-protected media (Spotify, Netflix
   paid streaming) and on cross-origin tainted media.

2. **Tab-capture mode** (fallback) — captures the whole tab via
   `chrome.tabCapture.getMediaStreamId`, processes the resulting `MediaStream`
   in an offscreen document, and plays the result. The original tab is muted
   while this is active so you only hear the processed audio.

The DSP itself is a granular pitch-shifter (two crossfaded delay-line read taps
with a sine window) running inside an `AudioWorkletProcessor`. See
[worklets/pitch-shift-processor.js](worklets/pitch-shift-processor.js) for the
algorithm and comments.

## Files

- [manifest.json](manifest.json) — MV3 manifest.
- [popup/](popup/) — toolbar UI.
- [background/service-worker.js](background/service-worker.js) — orchestrates
  per-tab state, picks content vs. capture mode.
- [content/content-script.js](content/content-script.js) — wires media elements
  through the worklet.
- [offscreen/offscreen.js](offscreen/offscreen.js) — runs the tab-capture path
  (service workers can't use `getUserMedia`).
- [worklets/pitch-shift-processor.js](worklets/pitch-shift-processor.js) — the
  pitch-shift DSP.

## Known limitations

- **Latency** in tab-capture mode is ~100–150 ms (Chrome's tab-capture pipeline
  + the worklet's grain buffering).
- **DRM media** (Widevine / EME content like Spotify or Netflix) bypasses Web
  Audio entirely. Tab-capture mode still works on such pages but the original
  audio cannot be replaced; muting the tab silences DRM playback.
- **Bypass click**: switching to/from semitones=0 may produce a brief
  discontinuity on some content. Tweak the worklet to crossfade between bypass
  and active modes if this matters for your use case.
- **Quality at large shifts**: granular shifters get audibly grainy past ~±7
  semitones. To improve, swap the worklet for a phase vocoder or vendor
  [SoundTouch.js](https://github.com/cutterbl/SoundTouchJS) — the
  `AudioWorkletNode` interface (parameter `pitchSemitones`) is the only
  contract callers depend on.

## Reload after changes

After editing source files, click the **Reload** button on the extension's card
in `chrome://extensions`. Reload the page being affected too — content scripts
only inject on page load.
