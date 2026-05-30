import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONFIG_PATH = path.join(ROOT, "config", "proxy.config.json");

let _configCache = null;
let _configMtime = 0;

function getDefaultConfig() {
  return {
    enabled: false,
    protocol: "http",
    host: "127.0.0.1",
    port: 10809,
    username: "",
    password: "",
    no_proxy: "127.0.0.1,localhost,::1",
  };
}

export function getProxyConfig() {
  try {
    const stat = fs.statSync(CONFIG_PATH);
    if (_configCache && stat.mtimeMs === _configMtime) return _configCache;
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    _configCache = { ...getDefaultConfig(), ...parsed };
    _configMtime = stat.mtimeMs;
    return _configCache;
  } catch {
    _configCache = getDefaultConfig();
    return _configCache;
  }
}

export function clearProxyCache() {
  _configCache = null;
  _configMtime = 0;
}

function buildProxyUrl(config) {
  const { protocol, host, port, username, password } = config;
  let url = `${protocol}://${host}:${port}`;
  if (username && password) {
    url = `${protocol}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
  }
  return url;
}

export function shouldProxy(urlStr, config) {
  if (!config) config = getProxyConfig();
  if (!config.enabled) return false;
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    const noProxyList = (config.no_proxy || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    for (const pattern of noProxyList) {
      if (pattern.startsWith(".")) {
        if (host.endsWith(pattern) || host === pattern.slice(1)) return false;
      } else if (host === pattern) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function proxyFetch(url, options = {}) {
  const config = getProxyConfig();
  if (!shouldProxy(url, config)) return fetch(url, options);

  const proxyUrl = buildProxyUrl(config);
  const urlObj = new URL(url);
  const isHttps = urlObj.protocol === "https:";
  const envKey = isHttps ? "HTTPS_PROXY" : "HTTP_PROXY";
  const envKeyLower = isHttps ? "https_proxy" : "http_proxy";

  const backup = {
    [envKey]: process.env[envKey],
    [envKeyLower]: process.env[envKeyLower],
  };

  try {
    process.env[envKey] = proxyUrl;
    process.env[envKeyLower] = proxyUrl;
    return await fetch(url, options);
  } finally {
    for (const [k, v] of Object.entries(backup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
