export type NetworkTargetType = "lan" | "overlay" | "wan";

export const NETWORK_PRESET_RULES: Record<string, string[]>;

export const DEFAULT_NETWORK_RULES: string;

export function classifyNetworkTarget(
  url: unknown,
  networkRules?: string,
  internalDomains?: string,
): NetworkTargetType;

export function detectNetworkByLatency(
  measuredLatencyMs: number,
  thresholdMs?: number,
): "lan" | "wan" | "unknown";

export function isInternalNetwork(url: unknown, internalDomains?: string, networkRules?: string): boolean;

export function getNetworkConfig(appConfig?: {
  internalDomains?: string;
  networkRules?: string;
  networkPresets?: Record<string, boolean>;
  latencyThresholdMs?: number;
  whitelistLatencyMode?: boolean;
  lanProbeTarget?: string;
}, localForceNetworkMode?: "auto" | "lan" | "wan" | "latency"): {
  internalDomains: string;
  networkRules: string;
  lanProbeTarget: string;
  whitelistLatencyMode: boolean;
  forceNetworkMode: "auto" | "lan" | "wan" | "latency";
  latencyThresholdMs: number;
};

export function computeEffectiveNetworkMode(
  hostname: string,
  clientIp: string,
  clientIpSource: string,
  measuredLatencyMs: number,
  config?: {
    internalDomains?: string;
    networkRules?: string;
    whitelistLatencyMode?: boolean;
    forceNetworkMode?: "auto" | "lan" | "wan" | "latency";
    latencyThresholdMs?: number;
    lanProbeReachable?: boolean;
  },
): { isLan: boolean; reason: string; measuredLatencyMs: number };
