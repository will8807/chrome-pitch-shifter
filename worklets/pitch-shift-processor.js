// Granular pitch shifter using a delay-line with two crossfaded read taps.
//
// Algorithm sketch:
//   - We continuously write incoming samples into a circular buffer (delay line).
//   - Two read "taps" sit at different delays from the write head and advance at
//     a rate of (1 - ratio) per output sample, where ratio = 2^(semitones/12).
//   - For pitch up (ratio>1) the taps move toward the write head (read faster);
//     for pitch down (ratio<1) they move away (read slower).
//   - Each tap's delay wraps within [0, grainSize). Because the two taps are
//     offset by half a grain, when one tap wraps the other is at full window
//     weight, so the wrap is inaudible after weighted-sum normalization.
//   - The window is sin(pi * t/grainSize) — sin/cos pair sums to constant power.
//
// At semitones === 0 we bypass entirely so there's no added latency or coloration.

class PitchShiftProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{
      name: 'pitchSemitones',
      defaultValue: 0,
      minValue: -24,
      maxValue: 24,
      automationRate: 'k-rate'
    }];
  }

  constructor() {
    super();
    this.grainSize = 4096;          // samples per grain window
    this.bufferSize = 16384;        // delay line size; > grainSize
    this.buffers = [];              // per-channel Float32Array
    this.writeIndex = 0;
    this.tap1Delay = 0;
    this.tap2Delay = this.grainSize / 2;
  }

  ensureBuffers(numChannels) {
    while (this.buffers.length < numChannels) {
      this.buffers.push(new Float32Array(this.bufferSize));
    }
  }

  // Read with linear interpolation, indexed by delay (samples back from write head).
  readDelayed(buf, delay) {
    let pos = this.writeIndex - delay;
    pos = ((pos % this.bufferSize) + this.bufferSize) % this.bufferSize;
    const i = Math.floor(pos);
    const f = pos - i;
    const a = buf[i];
    const b = buf[(i + 1) % this.bufferSize];
    return a + (b - a) * f;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !input[0]) {
      // No input this block — emit silence so downstream doesn't keep stale data.
      for (let c = 0; c < output.length; c++) output[c].fill(0);
      return true;
    }

    const numChannels = Math.min(input.length, output.length);
    this.ensureBuffers(numChannels);

    const semitones = parameters.pitchSemitones[0] || 0;
    const blockSize = input[0].length;

    // Bypass at exactly 0 semitones: copy input → output and keep buffers warm.
    if (semitones === 0) {
      for (let i = 0; i < blockSize; i++) {
        for (let c = 0; c < numChannels; c++) {
          this.buffers[c][this.writeIndex] = input[c][i];
          output[c][i] = input[c][i];
        }
        this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
      }
      // Leave taps where they are; next non-zero block resumes from current state.
      return true;
    }

    const ratio = Math.pow(2, semitones / 12);
    const tapDelta = 1 - ratio; // delay change per output sample
    const grainSize = this.grainSize;

    for (let i = 0; i < blockSize; i++) {
      // 1) write current input
      for (let c = 0; c < numChannels; c++) {
        this.buffers[c][this.writeIndex] = input[c][i];
      }

      // 2) compute tap weights (sine window)
      const w1 = Math.sin(Math.PI * (this.tap1Delay / grainSize));
      const w2 = Math.sin(Math.PI * (this.tap2Delay / grainSize));
      const wsum = w1 + w2 || 1;

      // 3) read taps and write weighted sum to output
      for (let c = 0; c < numChannels; c++) {
        const buf = this.buffers[c];
        const s1 = this.readDelayed(buf, this.tap1Delay);
        const s2 = this.readDelayed(buf, this.tap2Delay);
        output[c][i] = (s1 * w1 + s2 * w2) / wsum;
      }

      // 4) advance write head and tap delays
      this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
      let d1 = this.tap1Delay + tapDelta;
      let d2 = this.tap2Delay + tapDelta;
      // Wrap into [0, grainSize)
      if (d1 < 0) d1 += grainSize; else if (d1 >= grainSize) d1 -= grainSize;
      if (d2 < 0) d2 += grainSize; else if (d2 >= grainSize) d2 -= grainSize;
      this.tap1Delay = d1;
      this.tap2Delay = d2;
    }

    return true;
  }
}

registerProcessor('pitch-shift-processor', PitchShiftProcessor);
