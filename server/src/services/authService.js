import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const loginAttempts = {};

export const recordFailedAttempt = (ip) => {
  if (!loginAttempts[ip]) {
    loginAttempts[ip] = { count: 0, lockUntil: 0 };
  }
  const entry = loginAttempts[ip];
  entry.count++;
  if (entry.count >= 5) {
    entry.lockUntil = Date.now() + 15 * 60 * 1000;
    entry.count = 0;
  }
};

export const resetFailedAttempt = (ip) => {
  if (loginAttempts[ip]) {
    delete loginAttempts[ip];
  }
};

export const checkLockout = (ip) => {
  const entry = loginAttempts[ip];
  if (entry && entry.lockUntil > Date.now()) {
    return Math.ceil((entry.lockUntil - Date.now()) / 1000);
  }
  return 0;
};

export const hashPassword = async (password) => {
  return await bcrypt.hash(password, 10);
};

export const comparePassword = async (password, hash) => {
  if (hash.startsWith("$2b$") || hash.startsWith("$2a$")) {
    return await bcrypt.compare(password, hash);
  }
  return password === hash;
};

export const generateToken = (payload, secret, expiresIn = "3d") => {
  return jwt.sign(payload, secret, { expiresIn });
};

export const verifyToken = (token, secret) => {
  return jwt.verify(token, secret);
};
