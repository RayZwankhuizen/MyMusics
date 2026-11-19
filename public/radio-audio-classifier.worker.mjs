import { AudioClassifier, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@1.2.3/audio_bundle.mjs";

const wasmPath = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@1.2.3/wasm";
const modelAssetPath = "https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite";
const categories = ["Speech", "Singing", "Music"];

try {
  const files = await FilesetResolver.forAudioTasks(wasmPath, true);
  const classifier = await AudioClassifier.createFromOptions(files, {
    baseOptions: { modelAssetPath },
    categoryAllowlist: categories,
    scoreThreshold: 0
  });
  self.addEventListener("message", ({ data: { samples, generation } }) => {
    try {
      const results = classifier.classify(samples, 16000);
      const scoresByName = new Map(categories.map((name) => [name, 0]));
      for (const { classifications } of results) {
        for (const { categories: matches } of classifications) {
          for (const { categoryName, score } of matches) {
            if (scoresByName.has(categoryName)) scoresByName.set(categoryName, Math.max(scoresByName.get(categoryName), score));
          }
        }
      }
      const scores = [...scoresByName.values()];
      self.postMessage({ scores, generation });
    } catch {
      self.postMessage({ error: true });
    }
  });
  self.postMessage({ ready: true });
} catch {
  self.postMessage({ error: true });
}
