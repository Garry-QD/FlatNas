import crypto from "crypto";

export const state = {
  SECRET_KEY: process.env.SECRET_KEY || crypto.randomBytes(32).toString("hex"),
  systemConfig: { authMode: "single" },
};

export const setSystemConfig = (config) => {
  state.systemConfig = { ...state.systemConfig, ...config };
};

export const rotateSecretKey = () => {
  state.SECRET_KEY = crypto.randomBytes(32).toString("hex");
};
