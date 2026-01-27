import Docker from "dockerode";
import { DOCKER_STATS_TIMEOUT } from "../config/constants.js";

const socketPath =
  process.env.DOCKER_SOCKET_PATH ||
  (process.platform === "win32" ? "//./pipe/docker_engine" : "/var/run/docker.sock");
const docker = new Docker({ socketPath });

const containerStatsCache = new Map();
const containerUpdateCache = new Map();
let isStatsCollectorRunning = false;
let isUpdateCheckerRunning = false;
let lastDockerRequestTime = 0;

const updateCheckStatus = {
  lastCheck: 0,
  isChecking: false,
  lastError: null,
  checkedCount: 0,
  totalCount: 0,
  updateCount: 0,
  failures: [],
};

export const getDockerInstance = () => docker;

export const calculateStats = (s) => {
  let cpuPercent = 0;
  let memUsage = 0;
  let memLimit = 0;
  let memPercent = 0;
  let netRx = 0;
  let netTx = 0;
  let blockRead = 0;
  let blockWrite = 0;

  try {
    const cpuStats = s.cpu_stats;
    const precpuStats = s.precpu_stats;

    if (cpuStats && precpuStats) {
      const cpuDelta = cpuStats.cpu_usage.total_usage - precpuStats.cpu_usage.total_usage;
      const systemDelta = cpuStats.system_cpu_usage - precpuStats.system_cpu_usage;
      const onlineCpus =
        cpuStats.online_cpus ||
        (cpuStats.cpu_usage.percpu_usage ? cpuStats.cpu_usage.percpu_usage.length : 0);

      if (systemDelta > 0 && onlineCpus > 0) {
        cpuPercent = (cpuDelta / systemDelta) * onlineCpus * 100.0;
      }
    }

    if (s.memory_stats) {
      memUsage = s.memory_stats.usage;
      if (s.memory_stats.stats && s.memory_stats.stats.cache) {
        memUsage -= s.memory_stats.stats.cache;
      } else if (s.memory_stats.stats && s.memory_stats.stats.inactive_file) {
        memUsage -= s.memory_stats.stats.inactive_file;
      }
      memLimit = s.memory_stats.limit;
      if (memLimit > 0) {
        memPercent = (memUsage / memLimit) * 100.0;
      }
    }

    if (s.networks) {
      Object.values(s.networks).forEach((n) => {
        netRx += n.rx_bytes || 0;
        netTx += n.tx_bytes || 0;
      });
    }

    if (s.blkio_stats && s.blkio_stats.io_service_bytes_recursive) {
      s.blkio_stats.io_service_bytes_recursive.forEach((io) => {
        if (io.op === "Read") blockRead += io.value;
        if (io.op === "Write") blockWrite += io.value;
      });
    }
  } catch (err) {
    // Ignore errors
  }

  return {
    cpuPercent,
    memUsage,
    memLimit,
    memPercent,
    netIO: { rx: netRx, tx: netTx },
    blockIO: { read: blockRead, write: blockWrite },
  };
};

export const startStatsCollector = () => {
  if (isStatsCollectorRunning) return;
  isStatsCollectorRunning = true;

  const collect = async () => {
    try {
      const containers = await docker.listContainers({ all: false }).catch(() => []);
      const running = containers.filter((c) => c.State === "running");
      const concurrency = 5;
      const queue = [...running];

      const worker = async () => {
        while (queue.length > 0) {
          const c = queue.shift();
          if (!c) break;
          try {
            const container = docker.getContainer(c.Id);
            const statsPromise = container.stats({ stream: false });
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Stats timeout")), DOCKER_STATS_TIMEOUT),
            );
            const rawStats = await Promise.race([statsPromise, timeoutPromise]);
            const processed = calculateStats(rawStats);
            containerStatsCache.set(c.Id, { ...processed, timestamp: Date.now() });
          } catch (err) {
            // Stats fetch failed
          }
        }
      };

      await Promise.all(Array.from({ length: concurrency }).map(() => worker()));

      const runningIds = new Set(running.map((c) => c.Id));
      for (const id of containerStatsCache.keys()) {
        if (!runningIds.has(id)) containerStatsCache.delete(id);
      }
    } catch (err) {
      console.error("Stats collector error:", err);
    } finally {
      if (Date.now() - lastDockerRequestTime < 30000) {
        setTimeout(collect, 5000);
      } else {
        isStatsCollectorRunning = false;
      }
    }
  };

  collect();
};

export const getContainerStats = (id) => {
  lastDockerRequestTime = Date.now();
  if (!isStatsCollectorRunning) startStatsCollector();
  return containerStatsCache.get(id);
};

export const checkContainerUpdates = async (force = false) => {
  if (isUpdateCheckerRunning) return;
  if (!force && Date.now() - updateCheckStatus.lastCheck < 5 * 60 * 1000) return;

  isUpdateCheckerRunning = true;
  updateCheckStatus.isChecking = true;
  updateCheckStatus.lastError = null;
  updateCheckStatus.checkedCount = 0;
  updateCheckStatus.updateCount = 0;
  updateCheckStatus.failures = [];

  try {
    const containers = await docker.listContainers({ all: false });
    const targets = containers.filter((c) => c.Image && !c.Image.startsWith("sha256:"));
    updateCheckStatus.totalCount = targets.length;

    for (const container of targets) {
      const containerName = (container.Names?.[0] || "unknown").replace(/^\//, "");
      try {
        const imageName = container.Image;
        await new Promise((resolve, reject) => {
          let timedOut = false;
          let idleTimer = null;
          let totalTimer = setTimeout(() => {
            timedOut = true;
            if (idleTimer) clearTimeout(idleTimer);
            reject(new Error("Total timeout pulling image"));
          }, 600000);

          const resetIdleTimer = () => {
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
              timedOut = true;
              clearTimeout(totalTimer);
              reject(new Error("Idle timeout pulling image"));
            }, 60000);
          };

          resetIdleTimer();
          docker.pull(imageName, (err, stream) => {
            if (timedOut) return;
            if (err) {
              clearTimeout(totalTimer);
              if (idleTimer) clearTimeout(idleTimer);
              return reject(err);
            }
            docker.modem.followProgress(stream, (err, output) => {
              clearTimeout(totalTimer);
              if (idleTimer) clearTimeout(idleTimer);
              if (timedOut) return;
              if (err) return reject(err);
              resolve(output);
            }, () => { if (!timedOut) resetIdleTimer(); });
          });
        });

        const image = docker.getImage(imageName);
        const imageInfo = await image.inspect();
        if (imageInfo.Id !== container.ImageID) {
          containerUpdateCache.set(container.Id, true);
          updateCheckStatus.updateCount++;
        } else {
          containerUpdateCache.set(container.Id, false);
        }
      } catch (err) {
        updateCheckStatus.failures.push({ name: containerName, error: err.message });
      } finally {
        updateCheckStatus.checkedCount++;
      }
    }
    updateCheckStatus.lastCheck = Date.now();
  } catch (err) {
    updateCheckStatus.lastError = err.message;
  } finally {
    isUpdateCheckerRunning = false;
    updateCheckStatus.isChecking = false;
  }
};

export const getUpdateStatus = () => updateCheckStatus;
export const hasUpdate = (id) => containerUpdateCache.get(id);
