import fs from "fs/promises";
import os from "os";

export async function ensureDir(dirPath) {
  try {
    await fs.access(dirPath);
  } catch {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (err) {
      console.error(`Failed to create directory: ${dirPath}`, err);
    }
  }
}

export async function atomicWrite(filePath, content) {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tempFile = `${filePath}.tmp-${uniqueSuffix}`;
  try {
    await fs.writeFile(tempFile, content);
    let retries = 3;
    while (retries > 0) {
      try {
        await fs.rename(tempFile, filePath);
        return;
      } catch (err) {
        retries--;
        if (retries === 0) throw err;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  } catch (err) {
    if (os.platform() === "win32") {
      try {
        await fs.copyFile(tempFile, filePath);
        await fs.unlink(tempFile);
        return;
      } catch (copyErr) {
        console.error(`Atomic write failed for ${filePath}:`, copyErr);
      }
    }
    throw err;
  }
}
