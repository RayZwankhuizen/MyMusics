export function wireRadioSpeechVolumeSettings({ getStation, getStations, setStations, setActiveStation, isDucked, applyPercent, renderStations, updateSuppressionButton }) {
  const dialog = document.querySelector("#speech-volume-dialog");
  const value = document.querySelector("#speech-volume-value");
  const message = document.querySelector("#speech-volume-message");

  document.querySelector("#speech-volume-open").addEventListener("click", async () => {
    try {
      const response = await fetch("/stations", { cache: "no-store" });
      if (response.ok) {
        const stations = await response.json();
        setStations(stations);
        const station = getStation();
        const match = Object.entries(stations).find(([, list]) => list.some((item) => item.url === station?.url));
        if (match) {
          const [genre, list] = match;
          setActiveStation(list.find((item) => item.url === station.url), genre);
          updateSuppressionButton();
        }
      }
    } catch {}
    value.value = getStation()?.speechVolumePercent ?? 30;
    message.textContent = "";
    dialog.showModal();
  });

  document.querySelector("#speech-volume-cancel").addEventListener("click", () => dialog.close());
  document.querySelector("#speech-volume-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const station = getStation();
    const percent = Number(value.value);
    if (!Number.isInteger(percent) || percent < 0 || percent > 100 || !station) return;
    const stations = getStations();
    const genre = Object.keys(stations).find((name) => stations[name].some((item) => item.url === station.url));
    const index = genre ? stations[genre].findIndex((item) => item.url === station.url) : -1;
    if (index < 0) return;
    message.textContent = "Saving…";
    try {
      const response = await fetch(`/api/genres/${encodeURIComponent(genre)}/stations/${index}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...station, genre, speechVolumePercent: percent })
      });
      const updated = await response.json();
      if (!response.ok) throw new Error(updated.error || "Could not save this setting.");
      setStations(updated);
      const updatedStation = updated[genre][index];
      setActiveStation(updatedStation, genre);
      if (updatedStation.speechVolumePercent !== percent) throw new Error(`Server kept ${updatedStation.speechVolumePercent ?? 30}%; refresh MyMusics before trying again.`);
      if (isDucked()) applyPercent(percent);
      renderStations();
      updateSuppressionButton();
      dialog.close();
    } catch (error) { message.textContent = error.message; }
  });
}
