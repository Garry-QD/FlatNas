import express from "express";
import * as userService from "../services/userService.js";
import { state } from "../config/state.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import * as authService from "../services/authService.js";

const router = express.Router();

router.get("/data", asyncHandler(async (req, res) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  let username = "";
  if (token) {
    try {
      const user = authService.verifyToken(token, state.SECRET_KEY);
      username = user.username;
    } catch {}
  }

  let isGuest = false;
  if (!username) {
    username = "admin";
    isGuest = true;
  }

  const userData = await userService.getUserData(username, state.systemConfig.authMode);
  const safeData = { ...userData };
  delete safeData.password;
  safeData.username = username;
  safeData.systemConfig = state.systemConfig;

  if (isGuest) {
    if (safeData.groups) {
      safeData.groups = safeData.groups
        .map((group) => ({
          ...group,
          items: (group.items || []).filter((item) => item.isPublic === true),
        }))
        .filter((group) => group.items.length > 0 || group.preset);
    }
    if (safeData.widgets) {
      safeData.widgets = safeData.widgets.filter((w) => w.isPublic === true);
    }
  }

  res.json(safeData);
}));

export default router;
