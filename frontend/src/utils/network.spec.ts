import { describe, it, expect } from "vitest";
import { classifyNetworkTarget, computeEffectiveNetworkMode, getNetworkConfig, isInternalNetwork } from "./network";

describe("network rules: ip:", () => {
  it("matches ip prefix with trailing dot", () => {
    expect(classifyNetworkTarget("11.22.33.44", "ip:11.22.", "")).toBe("lan");
    expect(isInternalNetwork("11.22.33.44", "", "ip:11.22.")).toBe(true);
  });

  it("matches ip prefix without trailing dot", () => {
    expect(classifyNetworkTarget("11.22.33.44", "ip:11.22", "")).toBe("lan");
    expect(classifyNetworkTarget("11.22.33.44", "ip:11.22.33", "")).toBe("lan");
  });

  it("matches full ipv4 exactly (does not behave like prefix)", () => {
    expect(classifyNetworkTarget("11.22.33.44", "ip:11.22.33.44", "")).toBe("lan");
    expect(classifyNetworkTarget("11.22.33.45", "ip:11.22.33.44", "")).toBe("wan");
  });

  it("does not match domains", () => {
    expect(classifyNetworkTarget("example.com", "ip:11.22.", "")).toBe("wan");
  });
});

describe("getNetworkConfig", () => {
  it("returns network rules, probe target, and latency mode", () => {
    expect(
      getNetworkConfig(
        {
          internalDomains: "a.example.com",
          networkRules: "domain_suffix:corp.local",
          lanProbeTarget: " http://192.168.1.1 ",
          whitelistLatencyMode: true,
          latencyThresholdMs: 123,
        },
        "latency",
      ),
    ).toEqual({
      internalDomains: "a.example.com",
      networkRules: "domain_suffix:corp.local",
      lanProbeTarget: "http://192.168.1.1",
      whitelistLatencyMode: true,
      forceNetworkMode: "latency",
      latencyThresholdMs: 123,
    });
  });
});

describe("computeEffectiveNetworkMode", () => {
  it("treats successful LAN probe as intranet", () => {
    expect(
      computeEffectiveNetworkMode("flatnas.example.com", "", "", 0, {
        lanProbeReachable: true,
      }),
    ).toMatchObject({ isLan: true, reason: "lan_probe" });
  });

  it("treats hostname matched by network rules as intranet", () => {
    expect(
      computeEffectiveNetworkMode("panel.corp.local", "", "", 0, {
        networkRules: "domain_suffix:corp.local",
      }),
    ).toMatchObject({ isLan: true, reason: "hostname_rule" });
  });
});

