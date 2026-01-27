export const isPrivateIp = (ip) => {
  const parts = ip.split(".");
  if (parts.length === 4) {
    const first = parseInt(parts[0], 10);
    const second = parseInt(parts[1], 10);
    if (first === 127) return true;
    if (first === 10) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 192 && second === 168) return true;
    if (first === 0) return true;
    return false;
  } else if (ip.includes(":")) {
    const lowerIp = ip.toLowerCase();
    if (lowerIp === "::1" || lowerIp === "::") return true;
    if (lowerIp.startsWith("fc") || lowerIp.startsWith("fd")) return true;
    if (lowerIp.startsWith("fe80")) return true;
    return false;
  }
  return false;
};

export const safeUrlCheck = (urlStr) => {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const hostname = u.hostname;
    if (hostname === "localhost") return false;
    if (isPrivateIp(hostname)) return false;
    return true;
  } catch {
    return false;
  }
};
