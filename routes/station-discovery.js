const fetch = require("node-fetch");
const dns = require("node:dns").promises;
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");

function withTimeout(promise, milliseconds) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Station directory lookup timed out.")), milliseconds); })
  ]).finally(() => clearTimeout(timer));
}

function publicAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2))) || (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) || (a === 203 && b === 0 && c === 113));
  }
  if (!net.isIPv6(address)) return false;
  const ip = address.toLowerCase();
  if (ip.startsWith("::ffff:")) return publicAddress(ip.slice(7));
  const first = parseInt(ip.split(":")[0] || "0", 16);
  return first >= 0x2000 && first <= 0x3fff && !ip.startsWith("2001:db8:");
}

async function fetchPublicUrl(value, maxBytes = 2_000_000, deadline = Date.now() + 20_000) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Enter a valid image or website URL."); }
  for (let redirects = 0; redirects <= 3; redirects++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Logo lookup timed out.");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Only public HTTP or HTTPS URLs are supported.");
    const addresses = await withTimeout(dns.lookup(url.hostname, { all: true, verbatim: true }), Math.min(5000, remaining));
    if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error("The URL must point to a public website.");
    const { address, family } = addresses[0];
    const agentOptions = { lookup: (_host, _options, callback) => callback(null, address, family) };
    const response = await fetch(url.href, {
      agent: url.protocol === "https:" ? new https.Agent(agentOptions) : new http.Agent(agentOptions),
      headers: { "User-Agent": "MyMusics/1.0 (station logo finder)", Accept: "image/*, text/html;q=0.8" },
      redirect: "manual", timeout: Math.min(8000, remaining), size: maxBytes
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      response.body?.destroy();
      if (!location || redirects === 3) throw new Error("The logo website redirected too many times.");
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) { response.body?.destroy(); throw new Error(`Website returned HTTP ${response.status}.`); }
    return { url, type: (response.headers.get("content-type") || "").split(";")[0].toLowerCase(), body: await response.buffer() };
  }
  throw new Error("Could not fetch the logo.");
}

function logoCandidates(html, pageUrl) {
  const candidates = [];
  const add = (value, priority = 0) => {
    if (!value) return;
    try {
      const url = new URL(value.replace(/&amp;/gi, "&"), pageUrl);
      if (["http:", "https:"].includes(url.protocol) && !candidates.some((candidate) => candidate.href === url.href)) candidates.push({ href: url.href, priority });
    } catch {}
  };
  for (const match of html.matchAll(/<(meta|link|img)\b[^>]*>/gi)) {
    const tag = match[0];
    const name = tag.match(/\b(?:property|name|itemprop)=["']([^"']+)["']/i)?.[1]?.toLowerCase() || "";
    const rel = tag.match(/\brel=["']([^"']+)["']/i)?.[1]?.toLowerCase() || "";
    const value = tag.match(/\b(content|href|src|data-src)=["']([^"']+)["']/i)?.[2] || "";
    const hint = `${name} ${rel} ${tag}`.toLowerCase();
    if (name === "logo" || name === "og:logo" || /(?:logo|brand)/.test(name)) add(value, 0);
    else if (/apple-touch-icon/.test(rel)) add(value, 1);
    else if (/\bicon\b/.test(rel)) add(value, 2);
    else if (name === "og:image" || name === "twitter:image") add(value, 3);
    else if (/<img/i.test(tag) && /logo|brand/.test(hint)) add(tag.match(/\b(?:src|data-src)=["']([^"']+)["']/i)?.[1], 0);
  }
  add("/favicon.ico", 4);
  return candidates.sort((a, b) => a.priority - b.priority).map(({ href }) => href).slice(0, 12);
}

async function radioBrowserSearch(searches, { countrycode = "", limit = 60, order = "clickcount" } = {}) {
  const deadline = Date.now() + 25_000;
  const settle = (promise) => withTimeout(promise, 5000)
    .then((value) => ({ status: "fulfilled", value }), () => ({ status: "rejected" }));
  const discovered = await Promise.all([
    settle(dns.resolveSrv("_api._tcp.radio-browser.info")),
    settle(dns.resolve4("all.api.radio-browser.info")),
    settle(dns.resolve6("all.api.radio-browser.info"))
  ]);
  const hosts = discovered[0].status === "fulfilled" ? discovered[0].value.map(({ name }) => name.replace(/\.$/, "")) : [];
  const addresses = discovered.slice(1).flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const reverseLookups = await withTimeout(Promise.allSettled([...new Set(addresses)].map((address) => dns.reverse(address))), 4000).catch(() => []);
  hosts.push(...reverseLookups.flatMap((result) => result.status === "fulfilled" ? result.value.map((host) => host.replace(/\.$/, "")) : []));
  const servers = [...new Set(hosts.filter((host) => /(?:^|\.)api\.radio-browser\.info$/i.test(host)))].sort(() => Math.random() - 0.5).slice(0, 2);
  if (!servers.length) throw new Error("Could not discover a Radio Browser server.");
  let pending = searches.slice(0, 4);
  let lastError;
  const matches = [];
  for (const endpoint of servers.flatMap((server) => [`https://${server}`, `http://${server}`])) {
    const retry = [];
    for (const filter of pending) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        lastError ||= new Error("Station directory search timed out.");
        break;
      }
      try {
        const query = new URLSearchParams({ ...filter, ...(countrycode ? { countrycode } : {}), limit: String(limit), hidebroken: "true", order, reverse: "true" });
        const response = await fetch(`${endpoint}/json/stations/search?${query}`, { headers: { "User-Agent": "MyMusics/1.0 (station discovery)" }, timeout: Math.min(6000, remaining) });
        if (!response.ok) throw new Error(`Radio directory returned ${response.status}.`);
        matches.push(...await response.json());
      } catch (error) { lastError = new Error(`${endpoint}: ${error.code || error.message || "request failed"}`); retry.push(filter); }
    }
    pending = retry;
    if (!pending.length) break;
  }
  if (pending.length && !matches.length) throw lastError || new Error("All Radio Browser servers failed.");
  return matches;
}

module.exports = { fetchPublicUrl, logoCandidates, radioBrowserSearch };
