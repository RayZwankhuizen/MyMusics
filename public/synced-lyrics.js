window.MyMusicsLyrics = Object.freeze({
  parseSynced(value) {
    return value.split(/\r?\n/).flatMap((line) => {
      const matches = [...line.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
      const text = line.replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, "").trim();
      return text ? matches.map((match) => ({ time: Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3] || 0}`), text })) : [];
    }).sort((a, b) => a.time - b.time);
  }
});
