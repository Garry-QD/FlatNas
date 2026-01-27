import express from "express";
import * as dockerService from "../services/dockerService.js";

const router = express.Router();

router.get("/containers", async (req, res) => {
  try {
    const docker = dockerService.getDockerInstance();
    const containers = await docker.listContainers({ all: false });
    
    const data = containers.map(c => {
      const stats = dockerService.getContainerStats(c.Id);
      return {
        ...c,
        stats,
        hasUpdate: dockerService.hasUpdate(c.Id)
      };
    });
    
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/update-status", (req, res) => {
  res.json(dockerService.getUpdateStatus());
});

router.post("/check-updates", async (req, res) => {
  dockerService.checkContainerUpdates(true);
  res.json({ success: true, message: "Update check started" });
});

export default router;
