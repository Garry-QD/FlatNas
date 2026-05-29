const extractHost = (input) => {
  const value = typeof input === "string" ? input.trim() : String(input ?? "").trim();
  if (!value) return "";
  if (value.startsWith("[") && value.includes("]")) {
    return value.slice(1, value.indexOf("]"));
  }
  try {
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value)) {
      return new URL(value).hostname;
    }
    if (value.startsWith("//")) {
      return new URL(`http:${value}`).hostname;
    }
    if (value.includes("/") || value.includes("?") || value.includes("#")) {
      return new URL(`http://${value}`).hostname;
    }
  } catch {
    return value;
  }
  return value;
};

const isIpv4 = (host) => /^(\d{1,3}\.){3}\d{1,3}$/.test(host);

const isIpv4PrefixLike = (value) => /^\d{1,3}(\.\d{1,3}){0,3}\.?$/.test(String(value || "").trim());

const isPrivateIpv4 = (host) => {
  if (!isIpv4(host)) return false;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  return /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
};

const isOverlayIpv4 = (host) => {
  if (!isIpv4(host)) return false;
  // CGNAT range, often used by overlay networks (e.g. tailscale)
  return /^100\.(6[4-9]|[78]\d|9\d|1[01]\d|12[0-7])\./.test(host);
};

const normalizeRule = (line) => String(line || "").trim();

const parseNetworkRules = (rawRules) => {
  return String(rawRules || "")
    .split("\n")
    .map((line) => normalizeRule(line))
    .filter((line) => line && !line.startsWith("#"));
};

const normalizeRuleHostLike = (value) => {
  let v = String(value || "").trim().toLowerCase();
  if (!v) return "";

  v = v.replace(/^\*\./, "");

  const parsed = extractHost(v);
  if (parsed) {
    v = parsed.toLowerCase();
  }

  v = v.replace(/^\[|\]$/g, "").replace(/^\./, "").replace(/\/$/, "");
  return v;
};

const matchDomainSuffix = (host, suffix) => {
  const normalized = normalizeRuleHostLike(suffix);
  if (!normalized) return false;
  return host === normalized || host.endsWith(`.${normalized}`);
};

const classifyByRules = (host, rules) => {
  for (const rule of rules) {
    const v = rule.toLowerCase();

    if (v.startsWith("domain_suffix:")) {
      const suffix = v.slice("domain_suffix:".length).trim();
      if (matchDomainSuffix(host, suffix)) {
        if (suffix.includes("ts.net") || suffix.includes("zerotier")) return "overlay";
        if (suffix.includes("trycloudflare.com") || suffix.includes("ngrok.io") || suffix.includes("ngrok-free.app"))
          return "wan";
        return "lan";
      }
      continue;
    }

    if (v.startsWith("host:")) {
      const target = normalizeRuleHostLike(v.slice("host:".length).trim());
      if (target && host === target) return "lan";
      continue;
    }

    if (v.startsWith("ip:")) {
      const rawTarget = v.slice("ip:".length).trim();
      const target = rawTarget.endsWith(".") && isIpv4(rawTarget.slice(0, -1)) ? rawTarget.slice(0, -1) : rawTarget;
      if (target && host === target) return "lan";
      if (target && isIpv4(host) && !isIpv4(target) && isIpv4PrefixLike(target)) {
        const prefix = target.endsWith(".") ? target : `${target}.`;
        if (host.startsWith(prefix)) return "lan";
      }
      continue;
    }

    // Backward compatibility:
    // - ipv4 host: plain rule means ip prefix match (e.g. 192.168.)
    // - domain host: plain rule means domain suffix match (e.g. iepose.cn / *.iepose.cn / http://iepose.cn/)
    if (isIpv4(host) && host.startsWith(v)) return "lan";
    if (matchDomainSuffix(host, v)) return "lan";
  }

  return "wan";
};

export const NETWORK_PRESET_RULES = {
  tailscale: ["domain_suffix:.ts.net", "ip:100.64."],
  zerotier: ["domain_suffix:.zerotier.net"],
  frp: ["# frp 常见为自定义域名，建议补充 host/domain_suffix 规则"],
  cloudflareTunnel: ["domain_suffix:.trycloudflare.com"],
  ngrok: ["domain_suffix:.ngrok.io", "domain_suffix:.ngrok-free.app"],
};

export const DEFAULT_NETWORK_RULES = [
  "# overlay networks",
  ...NETWORK_PRESET_RULES.tailscale,
  ...NETWORK_PRESET_RULES.zerotier,
  "# tunnels (kept as WAN by default)",
  ...NETWORK_PRESET_RULES.cloudflareTunnel,
  ...NETWORK_PRESET_RULES.ngrok,
].join("\n");

const DEFAULT_LATENCY_THRESHOLD_MS = 50;

export const classifyNetworkTarget = (url, networkRules = "", internalDomains = "") => {
  const raw = typeof url === "string" ? url.trim() : String(url ?? "").trim();
  if (!raw) return "wan";

  const host = extractHost(raw).toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return "wan";

  if (host === "::1" || host.includes("localhost") || /^fe[89ab][0-9a-f]:/i.test(host) || /^f[cd][0-9a-f]{2}:/i.test(host)) {
    return "lan";
  }

  if (isPrivateIpv4(host) || host.endsWith(".local")) return "lan";
  if (isOverlayIpv4(host)) return "overlay";

  const rules = [...parseNetworkRules(networkRules), ...parseNetworkRules(internalDomains)];
  return classifyByRules(host, rules);
};

export const detectNetworkByLatency = (measuredLatencyMs, thresholdMs = DEFAULT_LATENCY_THRESHOLD_MS) => {
  if (!Number.isFinite(measuredLatencyMs) || measuredLatencyMs < 0) return "unknown";
  if (measuredLatencyMs <= thresholdMs) return "lan";
  return "wan";
};

export const isInternalNetwork = (url, internalDomains = "", networkRules = "") => {
  const type = classifyNetworkTarget(url, networkRules, internalDomains);
  return type === "lan" || type === "overlay";
};

export const buildRulesFromPresets = (presets = {}) => {
  const enabled = Object.entries(presets || {}).filter(([, v]) => !!v);
  if (enabled.length === 0) return "";
  const lines = [];
  for (const [key] of enabled) {
    if (!NETWORK_PRESET_RULES[key]) continue;
    lines.push(...NETWORK_PRESET_RULES[key]);
  }
  return Array.from(new Set(lines)).join("\n");
};

const isDomainInWhitelist = (hostname, whitelistStr) => {
  if (!hostname || !whitelistStr) return false;
  const lines = whitelistStr.split("\n").map(l => l.trim().toLowerCase()).filter(Boolean);
  for (const line of lines) {
    const domain = line.replace(/^\*\./, "").replace(/^https?:\/\//, "");
    if (hostname === domain || hostname.endsWith(`.${domain}`)) {
      return true;
    }
  }
  return false;
};

export const getNetworkConfig = (appConfig = {}, localForceNetworkMode) => {
  const internalDomains = typeof appConfig.internalDomains === "string" ? appConfig.internalDomains : "";
  const networkRules = typeof appConfig.networkRules === "string" ? appConfig.networkRules : "";
  const lanProbeTarget = typeof appConfig.lanProbeTarget === "string" ? appConfig.lanProbeTarget.trim() : "";
  const whitelistLatencyMode = appConfig.whitelistLatencyMode === true;
  const mode = typeof localForceNetworkMode === "string" ? localForceNetworkMode : "";
  const forceNetworkMode = ["auto", "lan", "wan", "latency"].includes(mode) ? mode : "auto";
  const raw = appConfig.latencyThresholdMs;
  const base = typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : 50;
  const latencyThresholdMs = Math.min(30000, Math.max(10, base));
  return { internalDomains, networkRules, lanProbeTarget, whitelistLatencyMode, forceNetworkMode, latencyThresholdMs };
};

export const computeEffectiveNetworkMode = (
  hostname,
  clientIp,
  clientIpSource,
  measuredLatencyMs,
  {
    internalDomains = "",
    networkRules = "",
    whitelistLatencyMode = false,
    forceNetworkMode = "auto",
    latencyThresholdMs = 50,
    lanProbeReachable = false,
  } = {},
) => {
  const hostnameIntrinsicLan = isInternalNetwork(hostname, "", "");
  const hostnameRuleLan = !!hostname && isInternalNetwork(hostname, "", networkRules);
  const canTrustClientIp = clientIpSource === "header";
  const clientIsLan = canTrustClientIp && !!clientIp && isInternalNetwork(clientIp, "", "");
  const latencyBasedLan = Number.isFinite(measuredLatencyMs) && measuredLatencyMs > 0 && measuredLatencyMs <= latencyThresholdMs;
  const isInWhitelist = isDomainInWhitelist(hostname, internalDomains);

  // 强制模式优先级最高
  if (forceNetworkMode === "lan") return { isLan: true, reason: "force_lan", measuredLatencyMs };
  if (forceNetworkMode === "wan") return { isLan: false, reason: "force_wan", measuredLatencyMs };

  // 域名本身是内网地址
  if (hostnameIntrinsicLan) return { isLan: true, reason: "hostname_intrinsic", measuredLatencyMs };
  if (hostnameRuleLan) return { isLan: true, reason: "hostname_rule", measuredLatencyMs };
  if (lanProbeReachable) return { isLan: true, reason: "lan_probe", measuredLatencyMs };

  // 白名单域名：启用延迟判定时根据延迟判定，未启用则直接判定为外网
  if (isInWhitelist) {
    if (whitelistLatencyMode) {
      if (latencyBasedLan) return { isLan: true, reason: "whitelist_latency_ok", measuredLatencyMs };
      return { isLan: false, reason: "whitelist_latency_high", measuredLatencyMs };
    }
    return { isLan: true, reason: "whitelist_matched", measuredLatencyMs };
  }

  // 客户端IP是内网
  if (canTrustClientIp && clientIsLan) return { isLan: true, reason: "client_ip_header", measuredLatencyMs };

  // 默认外网
  return { isLan: false, reason: "default_wan", measuredLatencyMs };
};
