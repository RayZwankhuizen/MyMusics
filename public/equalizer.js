const bands = [
  ["Bass", "lowshelf", 100], ["Low mids", "peaking", 250], ["Mids", "peaking", 1000],
  ["High mids", "peaking", 4000], ["Treble", "highshelf", 10000]
];
const presets = {
  flat: [0, 0, 0, 0, 0], pop: [-2, 2, 4, 3, -1], rock: [4, 2, -1, 2, 4],
  classical: [3, 1, -1, 2, 3], jazz: [2, 1, -1, 2, 2], electronic: [4, 1, -2, 3, 5],
  spoken: [-5, -2, 3, 5, -4], country: [3, 2, 0, 2, 1]
};

window.MyMusicsEqualizer = Object.freeze({
  bands,
  presets,
  drawFrame({ canvas, analyser, sampleRate, sensitivity, playing, phase }) {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(rect.width * ratio) || canvas.height !== Math.round(rect.height * ratio)) {
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
    }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const bands = this.bandLevels(data, sampleRate / 2, sensitivity, playing);
    const nextPhase = phase + (playing ? 0.018 : 0);
    this.drawBands(ctx, canvas, bands, ratio, nextPhase);
    return nextPhase;
  },
  drawBands(ctx, canvas, bands, ratio, phaseValue) {
    const center = canvas.height * 0.64;
    const colors = ["#00D1FF", "#7B7CFF", "#FF4FA3"];
    const fills = ["rgba(0,209,255,.09)", "rgba(123,124,255,.08)", "rgba(255,79,163,.08)"];
    const cycles = [1.25, 2.1, 3.2];
    const speeds = [0.72, 1, 1.3];
    ctx.globalCompositeOperation = "screen";
    bands.forEach((energy, layer) => {
      const amplitude = (5 + energy * canvas.height * 0.17) * ratio;
      const offset = (layer - 1) * 5 * ratio;
      const phase = phaseValue * speeds[layer];
      const points = [];
      ctx.beginPath();
      for (let x = 0; x <= canvas.width; x += 2 * ratio) {
        const position = x / canvas.width;
        const swell = 0.68 + 0.32 * Math.sin(position * Math.PI);
        const wave = Math.sin(position * cycles[layer] * Math.PI * 2 - phase)
          + 0.32 * Math.sin(position * cycles[layer] * Math.PI * 4 + phase * 0.7);
        const y = center + offset + wave * amplitude * swell;
        points.push({ x, y });
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.lineTo(canvas.width, center + offset);
      ctx.lineTo(0, center + offset);
      ctx.closePath();
      ctx.fillStyle = fills[layer];
      ctx.fill();
      ctx.beginPath();
      points.forEach(({ x, y }, index) => index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
      ctx.strokeStyle = colors[layer];
      ctx.lineWidth = (layer === 1 ? 2.4 : 1.7) * ratio;
      ctx.shadowColor = colors[layer];
      ctx.shadowBlur = (8 + energy * 15) * ratio;
      ctx.stroke();
    });
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = "source-over";
  },
  createGraph(context, mediaElements, readBandGain, stereoMeter = false) {
    const sources = mediaElements.map((media) => context.createMediaElementSource(media));
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.minDecibels = -85;
    analyser.maxDecibels = -25;
    analyser.smoothingTimeConstant = 0.72;
    const dryGain = context.createGain();
    const wetGain = context.createGain();
    const meterAnalyserSets = stereoMeter ? sources.map(() => [context.createAnalyser(), context.createAnalyser()]) : [];
    if (stereoMeter) {
      sources.forEach((source, index) => {
        const splitter = context.createChannelSplitter(2);
        source.connect(splitter);
        meterAnalyserSets[index].forEach((analyser, channel) => {
          analyser.fftSize = 1024;
          splitter.connect(analyser, channel);
        });
      });
    }
    const meterAnalysers = meterAnalyserSets[0] || [];
    dryGain.gain.value = 0;
    wetGain.gain.value = 1;
    sources.forEach((source) => source.connect(dryGain));
    dryGain.connect(analyser);
    const filters = bands.map(([, type, frequency], index) => {
      const filter = context.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      if (type === "peaking") filter.Q.value = 0.8;
      filter.gain.value = readBandGain(index);
      return filter;
    });
    for (const source of sources) {
      let node = source;
      for (const filter of filters) { node.connect(filter); node = filter; }
      node.connect(wetGain);
    }
    wetGain.connect(analyser);
    analyser.connect(context.destination);
    return { analyser, dryGain, wetGain, filters, meterAnalysers, meterAnalyserSets };
  },
  setEnabled({ context, dryGain, wetGain }, button, enabled) {
    const time = context.currentTime;
    dryGain.gain.setTargetAtTime(enabled ? 0 : 1, time, 0.025);
    wetGain.gain.setTargetAtTime(enabled ? 1 : 0, time, 0.025);
    button.setAttribute("aria-pressed", String(enabled));
    button.textContent = enabled ? "EQ On" : "EQ Off";
  },
  bandLevels(data, nyquist, sensitivity, playing) {
    const bandEnergy = (from, to) => {
      const first = Math.max(1, Math.floor(from / nyquist * data.length));
      const last = Math.min(data.length - 1, Math.ceil(to / nyquist * data.length));
      let energy = 0;
      for (let bin = first; bin <= last; bin++) energy += (data[bin] / 255) ** 2;
      return Math.sqrt(energy / Math.max(1, last - first + 1));
    };
    const drive = (energy) => playing
      ? Math.min(1, Math.pow(Math.max(0, (energy - 0.15) / 0.7), 0.95) * sensitivity / 1.8)
      : 0;
    return [drive(bandEnergy(45, 220)), drive(bandEnergy(220, 2200)), drive(bandEnergy(2200, 10000))];
  },
  buildControls(container, getFilters, presetSelect) {
    container.replaceChildren();
    bands.forEach(([name], index) => {
      const label = document.createElement("label");
      label.className = "equalizer-band";
      const title = document.createElement("span");
      title.textContent = name;
      const input = document.createElement("input");
      input.type = "range";
      input.min = "-12";
      input.max = "12";
      input.step = "1";
      input.value = "0";
      input.disabled = true;
      input.setAttribute("aria-label", `${name} equalizer, decibels`);
      const value = document.createElement("output");
      value.textContent = "0 dB";
      input.addEventListener("input", () => {
        value.textContent = `${input.value} dB`;
        const filter = getFilters()[index];
        if (filter) filter.gain.value = Number(input.value);
        presetSelect.value = "custom";
      });
      label.append(title, input, value);
      container.append(label);
    });
  },
  applyPreset(name, container, getFilters, presetSelect) {
    const gains = presets[name];
    if (!gains) return;
    container.querySelectorAll(".equalizer-band input").forEach((input, index) => {
      input.value = gains[index];
      input.nextElementSibling.textContent = `${gains[index]} dB`;
      const filter = getFilters()[index];
      if (filter) filter.gain.value = gains[index];
    });
    presetSelect.value = name;
  }
});
