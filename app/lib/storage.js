import { del, get, list, put, copy } from "@vercel/blob";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { getDataDir } from "./storage-paths";

const BLOB_PREFIX = normalizeBlobPrefix(process.env.XHS_BLOB_PREFIX || "xhs-auto");
const BLOB_ACCESS = "private";

export function isBlobStorage() {
  if (process.env.XHS_STORAGE === "fs") {
    return false;
  }
  return process.env.XHS_STORAGE === "blob" || Boolean(process.env.BLOB_READ_WRITE_TOKEN) || Boolean(process.env.VERCEL);
}

export async function readJsonFile(relativePath) {
  const text = await readTextFile(relativePath);
  return JSON.parse(text);
}

export async function writeJsonFile(relativePath, value) {
  await writeTextFile(relativePath, JSON.stringify(value, null, 2), "application/json; charset=utf-8");
}

export async function readTextFile(relativePath) {
  if (isBlobStorage()) {
    assertBlobToken();
    const result = await get(blobPath(relativePath), { access: BLOB_ACCESS, useCache: false });
    if (!result?.stream) {
      throw notFoundError(relativePath);
    }
    const response = new Response(result.stream);
    return response.text();
  }

  return fs.readFile(localPath(relativePath), "utf8");
}

export async function writeTextFile(relativePath, text, contentType = "text/plain; charset=utf-8") {
  if (isBlobStorage()) {
    assertBlobToken();
    await put(blobPath(relativePath), text, {
      access: BLOB_ACCESS,
      allowOverwrite: true,
      contentType
    });
    return;
  }

  const filePath = localPath(relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
}

export async function writeBinaryFile(relativePath, bytes, contentType = "application/octet-stream") {
  if (isBlobStorage()) {
    assertBlobToken();
    await put(blobPath(relativePath), bytes, {
      access: BLOB_ACCESS,
      allowOverwrite: true,
      contentType,
      multipart: bytes.length > 4 * 1024 * 1024
    });
    return;
  }

  const filePath = localPath(relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, bytes);
}

export async function readFileStream(relativePath) {
  if (isBlobStorage()) {
    assertBlobToken();
    const result = await get(blobPath(relativePath), { access: BLOB_ACCESS, useCache: false });
    if (!result?.stream) {
      throw notFoundError(relativePath);
    }
    return {
      contentType: result.blob.contentType || contentType(relativePath),
      size: result.blob.size || 0,
      stream: Readable.fromWeb(result.stream)
    };
  }

  const filePath = localPath(relativePath);
  const stat = await fs.stat(filePath);
  return {
    contentType: contentType(filePath),
    size: stat.size,
    stream: createReadStream(filePath)
  };
}

export async function deleteFile(relativePath) {
  if (isBlobStorage()) {
    assertBlobToken();
    try {
      await del(blobPath(relativePath));
    } catch (error) {
      if (!isMissingBlobError(error)) throw error;
    }
    return;
  }

  await fs.rm(localPath(relativePath), { force: true });
}

export async function deletePrefix(relativePrefix) {
  if (isBlobStorage()) {
    assertBlobToken();
    const pathnames = await listBlobPathnames(`${trimSlashes(relativePrefix)}/`);
    if (pathnames.length) {
      await del(pathnames);
    }
    return;
  }

  await fs.rm(localPath(relativePrefix), { recursive: true, force: true });
}

export async function copyPrefix(sourcePrefix, targetPrefix) {
  if (isBlobStorage()) {
    assertBlobToken();
    const source = `${trimSlashes(sourcePrefix)}/`;
    const target = `${trimSlashes(targetPrefix)}/`;
    const pathnames = await listBlobPathnames(source);
    await Promise.all(
      pathnames.map((pathname) =>
        copy(pathname, blobPath(pathname.slice(BLOB_PREFIX.length + 1).replace(source, target)), {
          access: BLOB_ACCESS,
          allowOverwrite: true
        })
      )
    );
    return;
  }

  await fs.cp(localPath(sourcePrefix), localPath(targetPrefix), { recursive: true });
}

export function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  return "image/jpeg";
}

function localPath(relativePath) {
  return path.join(getDataDir(), ...trimSlashes(relativePath).split("/"));
}

function assertBlobToken() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("Vercel Blob 未配置。请在 Vercel 项目里创建并绑定 Blob Store，让环境变量 BLOB_READ_WRITE_TOKEN 生效。");
  }
}

function blobPath(relativePath) {
  return `${BLOB_PREFIX}/${trimSlashes(relativePath)}`;
}

async function listBlobPathnames(relativePrefix) {
  const prefix = blobPath(relativePrefix);
  const pathnames = [];
  let cursor;
  do {
    const result = await list({ prefix, cursor, limit: 1000 });
    pathnames.push(...result.blobs.map((blob) => blob.pathname));
    cursor = result.cursor;
  } while (cursor);
  return pathnames;
}

function trimSlashes(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function normalizeBlobPrefix(value) {
  return trimSlashes(value) || "xhs-auto";
}

function notFoundError(relativePath) {
  const error = new Error(`File not found: ${relativePath}`);
  error.code = "ENOENT";
  return error;
}

function isMissingBlobError(error) {
  return error?.name === "BlobNotFoundError" || /not found/i.test(error?.message || "");
}
