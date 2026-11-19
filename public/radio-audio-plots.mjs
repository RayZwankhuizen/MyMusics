export function createRadioAudioPlots({ waveform, spectrogram, createAnalyser }) {
  const waveContext = waveform.getContext("2d");
  const spectrumContext = spectrogram.getContext("2d");
  let input;
  let drawTimer;

  function stop() {
    clearInterval(drawTimer);
    input?.close();
    input = undefined;
    waveContext?.clearRect(0, 0, waveform.width, waveform.height);
    spectrumContext?.clearRect(0, 0, spectrogram.width, spectrogram.height);
  }

  function start() {
    stop();
    if (!waveContext || !spectrumContext) return;
    input = createAnalyser();
    if (!input) return;
    const { analyser } = input;
    const wave = new Float32Array(analyser.fftSize);
    const frequencies = new Uint8Array(analyser.frequencyBinCount);
    const highestBin = Math.min(frequencies.length - 1, Math.floor(8000 * analyser.fftSize / analyser.context.sampleRate));
    const { width: waveWidth, height: waveHeight } = waveform;
    const { width, height } = spectrogram;
    const columnWidth = 4;
    const colors = Array.from({ length: 256 }, (_, level) =>
      `hsl(${230 - level * 0.84}, 85%, ${7 + level * 0.27}%)`);

    drawTimer = setInterval(() => {
      analyser.getFloatTimeDomainData(wave);
      waveContext.clearRect(0, 0, waveWidth, waveHeight);
      waveContext.beginPath();
      waveContext.moveTo(0, waveHeight / 2);
      waveContext.lineTo(waveWidth, waveHeight / 2);
      waveContext.strokeStyle = "#46516a";
      waveContext.stroke();
      waveContext.beginPath();
      for (let x = 0; x < waveWidth; x++) {
        const sample = wave[Math.floor(x * wave.length / waveWidth)];
        const y = (1 - Math.max(-1, Math.min(1, sample))) * waveHeight / 2;
        if (x === 0) waveContext.moveTo(x, y);
        else waveContext.lineTo(x, y);
      }
      waveContext.strokeStyle = "#67e8f9";
      waveContext.stroke();

      analyser.getByteFrequencyData(frequencies);
      spectrumContext.drawImage(spectrogram, columnWidth, 0, width - columnWidth, height, 0, 0, width - columnWidth, height);
      for (let row = 0; row < height; row++) {
        const bin = Math.round(highestBin * (height - 1 - row) / (height - 1));
        spectrumContext.fillStyle = colors[frequencies[bin]];
        spectrumContext.fillRect(width - columnWidth, row, columnWidth, 1);
      }
    }, 60);
  }

  return { start, stop };
}
