const browserRules = [
  ["Vivaldi", /\bVivaldi\/([^\s;]+)/i],
  ["Yandex", /\bYaBrowser\/([^\s;]+)/i],
  ["Samsung Internet", /\bSamsungBrowser\/([^\s;]+)/i],
  ["Microsoft Edge", /\b(?:Edg|EdgA|EdgiOS|Edge)\/([^\s;]+)/i],
  ["Opera", /\b(?:OPR|OPiOS|Opera)\/([^\s;]+)/i],
  ["Firefox", /\b(?:Firefox|FxiOS)\/([^\s;]+)/i],
  ["Chrome", /\b(?:Chrome|CriOS|Chromium)\/([^\s;]+)/i],
  ["Safari", /\bVersion\/([^\s;]+).*\bSafari\//i]
];

export function detectBrowser(userAgent = "") {
  if (/\bSilk(?:\/|\b)/i.test(userAgent)) {
    return { name: "Silk", version: userAgent.match(/\bSilk\/([^\s;]+)/i)?.[1] || "Not reported" };
  }
  if (/\bwv\b/i.test(userAgent) && /Android/i.test(userAgent)) {
    return { name: "Android WebView", version: userAgent.match(/\bChrome\/([^\s;]+)/i)?.[1] || "Not reported" };
  }
  const chromiumVersion = userAgent.match(/\bChrome\/([^\s;]+)/i)?.[1];
  if (chromiumVersion && typeof navigator !== "undefined" && navigator.brave) return { name: "Brave", version: chromiumVersion };
  for (const [name, pattern] of browserRules) {
    const match = userAgent.match(pattern);
    if (match) return { name, version: match[1] };
  }
  return { name: "Unknown", version: "Not reported" };
}

export async function getBrowserInfo() {
  const ua = navigator.userAgent || "";
  const browser = detectBrowser(ua);
  const clientHints = navigator.userAgentData;
  const screenInfo = window.screen;
  let storage = "Available";
  try { void window.localStorage.length; } catch { storage = "Unavailable"; }
  const rows = [
    ["Detected browser", `${browser.name} ${browser.version}`],
    ["Client-hints platform", clientHints?.platform || "Not exposed"],
    ["Browser vendor", navigator.vendor || "Not reported"],
    ["User-Agent Client Hints", clientHints?.brands?.map(({ brand, version }) => `${brand} ${version}`).join(", ") || "Not exposed"],
    ["Device platform", navigator.platform || "Not reported"],
    ["Language preferences", navigator.languages?.join(", ") || navigator.language || "Not reported"],
    ["User agent", ua || "Not reported"],
    ["Screen resolution", `${screenInfo.width} × ${screenInfo.height}`],
    ["Available screen area", `${screenInfo.availWidth} × ${screenInfo.availHeight}`],
    ["Browser viewport", `${window.innerWidth} × ${window.innerHeight} CSS pixels`],
    ["Device pixel ratio", String(window.devicePixelRatio || 1)],
    ["Screen size × DPR estimate", `${Math.round(screenInfo.width * (window.devicePixelRatio || 1))} × ${Math.round(screenInfo.height * (window.devicePixelRatio || 1))} pixels (screen size × DPR; not HDMI output)`],
    ["Screen color depth", `${screenInfo.colorDepth} bits`],
    ["Screen orientation", screenInfo.orientation?.type || "Not exposed"],
    ["Touch points", String(navigator.maxTouchPoints ?? "Not exposed")],
    ["Logical processors", String(navigator.hardwareConcurrency ?? "Not exposed")],
    ["Device memory", navigator.deviceMemory ? `${navigator.deviceMemory} GB` : "Not exposed"],
    ["Timezone", Intl.DateTimeFormat().resolvedOptions().timeZone || "Not reported"],
    ["Connection", navigator.onLine ? "Online" : "Offline"],
    ["Cookies", navigator.cookieEnabled ? "Enabled" : "Disabled"],
    ["Local storage", storage],
    ["JavaScript", "Enabled"]
  ];

  if (clientHints?.getHighEntropyValues) {
    try {
      const hints = await clientHints.getHighEntropyValues(["architecture", "bitness", "model", "platformVersion", "uaFullVersion", "wow64"]);
      rows.splice(4, 0,
        ["Platform version", hints.platformVersion || "Not exposed"],
        ["Device model", hints.model || "Not exposed"],
        ["Architecture / bitness", [hints.architecture, hints.bitness].filter(Boolean).join(" / ") || "Not exposed"],
        ["Full browser version", hints.uaFullVersion || "Not exposed"],
        ["32-bit compatibility", hints.wow64 === undefined ? "Not exposed" : hints.wow64 ? "Yes" : "No"]
      );
    } catch {}
  }

  return rows;
}
