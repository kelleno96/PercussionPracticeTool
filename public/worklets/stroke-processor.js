// AudioWorkletProcessor for transient stroke detection.
// Listens for configuration messages to adjust sensitivity, cooldown, and minEnergy.
class StrokeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.energySMA = 0;
    this.alpha = 0.05; // smoothing factor
    this.cooldownFrames = 0;
    this.minDb = -55;
    this.sensitivity = 1.5;
    this.debounceMs = 35;
    this.lastHitTime = 0;
    this.measureWindowMs = 30;
    this.measureWindowFrames = Math.max(1, Math.round(sampleRate * this.measureWindowMs / 1000));
    this.pendingMeasure = null;
    this.hitSeq = 0;
    this.runId = Math.random().toString(36).slice(2, 10);
    this.port.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === "config") {
        this.sensitivity = data.sensitivity ?? this.sensitivity;
        this.debounceMs = data.debounceMs ?? this.debounceMs;
        this.minDb = data.minDb ?? this.minDb;
        this.alpha = data.alpha ?? this.alpha;
        if (data.measureWindowMs !== undefined) {
          this.measureWindowMs = data.measureWindowMs;
          this.measureWindowFrames = Math.max(1, Math.round(sampleRate * this.measureWindowMs / 1000));
        }
        if (data.runId) {
          this.runId = data.runId;
        }
      }
    };
  }

  _accumulateMeasure(data) {
    const pending = this.pendingMeasure;
    if (!pending) return;
    const toProcess = Math.min(pending.remaining, data.length);
    for (let i = 0; i < toProcess; i++) {
      const sample = data[i];
      pending.sumSquares += sample * sample;
      pending.count++;
      const abs = Math.abs(sample);
      if (abs > pending.peakAbs) pending.peakAbs = abs;
    }
    pending.remaining -= toProcess;
    if (pending.remaining <= 0) {
      const rms = Math.sqrt(pending.sumSquares / Math.max(1, pending.count));
      const db = 20 * Math.log10(rms + 1e-9);
      const peakDb = 20 * Math.log10(pending.peakAbs + 1e-9);
      this.port.postMessage({
        type: "stroke-measure",
        seq: pending.seq,
        runId: this.runId,
        rms,
        db,
        peakDb
      });
      this.pendingMeasure = null;
    }
  }

  process(inputs, _outputs, _parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    // use a single channel to avoid phase artifacts from mixing
    const data = input[0];
    if (!data || data.length === 0) return true;
    let frameEnergy = 0;
    let peakAbs = 0;
    for (let i = 0; i < data.length; i++) {
      const sample = data[i];
      frameEnergy += sample * sample;
      const abs = Math.abs(sample);
      if (abs > peakAbs) peakAbs = abs;
    }
    const rms = Math.sqrt(frameEnergy / data.length);
    const db = 20 * Math.log10(rms + 1e-9);
    const peakDb = 20 * Math.log10(peakAbs + 1e-9);

    // adaptive noise floor via exponential moving average on linear rms
    this.energySMA = this.alpha * rms + (1 - this.alpha) * this.energySMA;
    const floorDb = 20 * Math.log10(this.energySMA + 1e-9);
    const dynamicThresholdDb = Math.max(floorDb + this.sensitivity * 6, this.minDb);

    const nowMs = currentTime * 1000;
    const isOverThreshold = db > dynamicThresholdDb && rms > this.energySMA * this.sensitivity;
    if (isOverThreshold && nowMs - this.lastHitTime > this.debounceMs) {
      this.lastHitTime = nowMs;
      const seq = ++this.hitSeq;
      this.pendingMeasure = {
        seq,
        remaining: this.measureWindowFrames,
        sumSquares: 0,
        peakAbs: 0,
        count: 0
      };
      this.port.postMessage({
        type: "stroke",
        seq,
        runId: this.runId,
        db,
        peakDb,
        rms,
        at: nowMs,
        floorDb,
        thresholdDb: dynamicThresholdDb
      });
      this._accumulateMeasure(data);
    } else {
      this._accumulateMeasure(data);
    }

    // Send occasional debug telemetry upstream without spamming UI.
    if (Math.random() < 0.002) {
      this.port.postMessage({
        type: "telemetry",
        db,
        floorDb,
        thresholdDb: dynamicThresholdDb
      });
    }

    return true;
  }
}

registerProcessor("stroke-processor", StrokeProcessor);
