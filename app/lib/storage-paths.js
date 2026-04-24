import os from "node:os";
import path from "node:path";

export function getDataDir() {
  if (process.env.XHS_DATA_DIR) {
    return process.env.XHS_DATA_DIR;
  }

  if (process.env.VERCEL) {
    return path.join(os.tmpdir(), "xhs-auto-data");
  }

  return path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
}

export function getUploadsDir() {
  return path.join(getDataDir(), "uploads");
}
