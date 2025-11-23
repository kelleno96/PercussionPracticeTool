// AudioWorkletProcessor for transient stroke detection.
// Listens for configuration messages to adjust sensitivity, cooldown, and minEnergy.
class StrokeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.energySMA = 0;
    this.alpha = 0.05; // smoothing factor
    this.cooldownFrames = 0;
    this.minDb = -55;
    this.sensitivity = 2.6;
    this.debounceMs = 85;
    this.lastHitTime = 0;
    this.port.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === "config") {
        this.sensitivity = data.sensitivity ?? this.sensitivity;
        this.debounceMs = data.debounceMs ?? this.debounceMs;
        this.minDb = data.minDb ?? this.minDb;
        this.alpha = data.alpha ?? this.alpha;
      }
    };
  }

  process(inputs, _outputs, _parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    // mix to mono
    let frameEnergy = 0;
    let count = 0;
    for (let channel = 0; channel < input.length; channel++) {
      const data = input[channel];
      for (let i = 0; i < data.length; i++) {
        const sample = data[i];
        frameEnergy += sample * sample;
        count++;
      }
    }
    if (count === 0) return true;
    const rms = Math.sqrt(frameEnergy / count);
    const db = 20 * Math.log10(rms + 1e-9);

    // adaptive noise floor via exponential moving average on linear rms
    this.energySMA = this.alpha * rms + (1 - this.alpha) * this.energySMA;
    const floorDb = 20 * Math.log10(this.energySMA + 1e-9);
    const dynamicThresholdDb = Math.max(floorDb + this.sensitivity * 6, this.minDb);

    const nowMs = currentTime * 1000;
    const isOverThreshold = db > dynamicThresholdDb && rms > this.energySMA * this.sensitivity;
    if (isOverThreshold && nowMs - this.lastHitTime > this.debounceMs) {
      this.lastHitTime = nowMs;
      this.port.postMessage({
        type: "stroke",
        db,
        rms,
        at: nowMs,
        floorDb,
        thresholdDb: dynamicThresholdDb
      });
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
