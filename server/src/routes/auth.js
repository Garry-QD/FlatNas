import express from "express";
import * as authService from "../services/authService.js";
import * as userService from "../services/userService.js";
import { state } from "../config/state.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = express.Router();

router.post("/login", asyncHandler(async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || req.ip;
  
  const waitSeconds = authService.checkLockout(ip);
  if (waitSeconds > 0) {
    return res.status(429).json({ error: `Too many attempts, wait ${waitSeconds}s` });
  }

  let { username = "", password } = req.body;
  if (state.systemConfig.authMode === "single" && !username) {
    username = "admin";
  }
  if (!username) username = "admin";

  try {
    const userData = await userService.getUserData(username, state.systemConfig.authMode);
    const match = await authService.comparePassword(password, userData.password || "admin");

    if (match) {
      authService.resetFailedAttempt(ip);
      
      // If password was plain text, hash it and save
      if (!userData.password.startsWith("$")) {
        userData.password = await authService.hashPassword(password);
        await userService.saveUserData(username, userData, state.systemConfig.authMode);
      }

      const token = authService.generateToken({ username }, state.SECRET_KEY);
      res.json({ success: true, token, username });
    } else {
      authService.recordFailedAttempt(ip);
      res.status(401).json({ error: "Password incorrect" });
    }
  } catch (err) {
    authService.recordFailedAttempt(ip);
    res.status(401).json({ error: "User not found or password incorrect" });
  }
}));

router.get("/verify", asyncHandler(async (req, res) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded = authService.verifyToken(token, state.SECRET_KEY);
    res.json({ success: true, user: decoded });
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
}));

export default router;
