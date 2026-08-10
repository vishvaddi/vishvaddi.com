class DjScratchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.channels = [];
    this.sourceRate = sampleRate;
    this.position = 0;
    this.velocity = 0;
    this.active = false;
    this.reportCountdown = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === "load") {
        this.channels = data.channels.map((channel) => new Float32Array(channel));
        this.sourceRate = data.sampleRate;
        this.position = 0;
      } else if (data.type === "scratch") {
        if (Number.isFinite(data.position)) this.position = data.position * this.sourceRate;
        this.velocity = Math.max(-8, Math.min(8, Number(data.velocity) || 0));
        this.active = Boolean(data.active);
      }
    };
  }

  sample(channel, position) {
    if (!channel.length) return 0;
    const bounded = Math.max(0, Math.min(channel.length - 2, position));
    const index = Math.floor(bounded), fraction = bounded - index;
    return channel[index] + (channel[index + 1] - channel[index]) * fraction;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output?.length) return true;
    for (let frame = 0; frame < output[0].length; frame++) {
      for (let channelIndex = 0; channelIndex < output.length; channelIndex++) {
        const source = this.channels[channelIndex] || this.channels[0];
        output[channelIndex][frame] = this.active && source ? this.sample(source, this.position) : 0;
      }
      if (this.active) {
        this.position += this.velocity * this.sourceRate / sampleRate;
        const length = this.channels[0]?.length || 0;
        if (this.position < 0) this.position = 0;
        if (length && this.position >= length - 1) this.position = length - 2;
      }
    }
    this.reportCountdown -= output[0].length;
    if (this.reportCountdown <= 0) {
      this.reportCountdown = 1024;
      this.port.postMessage({ type: "position", seconds: this.position / this.sourceRate, velocity: this.velocity, active: this.active });
    }
    return true;
  }
}

registerProcessor("vv-dj-scratch", DjScratchProcessor);
