import archiver from "archiver";
import crypto from "node:crypto";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import {
  copyPrefix,
  deleteFile,
  deletePrefix,
  readFileStream,
  readJsonFile,
  writeBinaryFile,
  writeJsonFile
} from "../../lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_FILE = "state.json";
const DEFAULT_WORK_COUNT = 5;

export async function GET(request, context) {
  return handle(request, context, "GET");
}

export async function POST(request, context) {
  return handle(request, context, "POST");
}

export async function PATCH(request, context) {
  return handle(request, context, "PATCH");
}

export async function DELETE(request, context) {
  return handle(request, context, "DELETE");
}

async function handle(request, context, method) {
  try {
    const params = await context.params;
    const parts = params.path || [];

    if (method === "GET" && isPath(parts, ["state"])) {
      const state = await readState();
      return json({ accounts: state.accounts });
    }

    if (method === "POST" && isPath(parts, ["accounts"])) {
      const body = await readJson(request);
      const state = await readState();
      const account = createAccount(cleanName(body.name, "账号名不能为空"));
      account.works = createDefaultWorks();
      state.accounts.push(account);
      await writeState(state);
      return json({ account }, 201);
    }

    if (method === "POST" && isPath(parts, ["reset-all"])) {
      const state = await readState();
      await backupState(state, "reset-all", state.accounts.map((account) => account.id));
      for (const account of state.accounts) {
        await removeAccountFiles(account);
        account.works = createDefaultWorks();
        account.updatedAt = now();
      }
      await writeState(state);
      return json({ accounts: state.accounts });
    }

    if ((method === "PATCH" || method === "DELETE") && parts[0] === "accounts" && parts.length === 2) {
      const state = await readState();
      const account = requireAccount(state, parts[1]);

      if (method === "PATCH") {
        const body = await readJson(request);
        account.name = cleanName(body.name, "账号名不能为空");
        account.updatedAt = now();
        await writeState(state);
        return json({ account });
      }

      await backupState(state, "delete-account", [account.id]);
      await removeAccountFiles(account);
      state.accounts = state.accounts.filter((item) => item.id !== account.id);
      await writeState(state);
      return json({ success: true });
    }

    if (method === "POST" && parts[0] === "accounts" && parts[2] === "works" && parts.length === 3) {
      const body = await readJson(request);
      const state = await readState();
      const account = requireAccount(state, parts[1]);
      const work = createWork(cleanName(body.name, "作品名不能为空"));
      account.works.push(work);
      account.updatedAt = now();
      await writeState(state);
      return json({ work }, 201);
    }

    if (method === "POST" && parts[0] === "accounts" && parts[2] === "reset-works" && parts.length === 3) {
      const state = await readState();
      const account = requireAccount(state, parts[1]);
      await backupState(state, "reset-account", [account.id]);
      await removeAccountFiles(account);
      account.works = createDefaultWorks();
      account.updatedAt = now();
      await writeState(state);
      return json({ account });
    }

    if (parts[0] === "accounts" && parts[2] === "works" && parts.length >= 4) {
      const state = await readState();
      const account = requireAccount(state, parts[1]);
      const work = requireWork(account, parts[3]);

      if (method === "GET" && parts[4] === "download" && parts.length === 5) {
        return createWorkArchive(account, work);
      }

      if ((method === "PATCH" || method === "DELETE") && parts.length === 4) {
        if (method === "PATCH") {
          const body = await readJson(request);
          if (typeof body.name === "string") work.name = cleanName(body.name, "作品名不能为空");
          if (typeof body.status === "string") {
            work.status = body.status === "done" ? "done" : "draft";
            work.completedAt = work.status === "done" ? now() : null;
          }
          work.updatedAt = now();
          account.updatedAt = now();
          await writeState(state);
          return json({ work });
        }

        await backupState(state, "delete-work", [account.id]);
        await removeWorkFiles(account.id, work);
        account.works = account.works.filter((item) => item.id !== work.id);
        account.updatedAt = now();
        await writeState(state);
        return json({ success: true });
      }

      if (method === "POST" && parts[4] === "images" && parts.length === 5) {
        const formData = await request.formData();
        const files = formData
          .getAll("images")
          .filter((file) => file && typeof file === "object" && file.type?.startsWith("image/"));

        if (!files.length) throw createError(400, "请选择图片文件");

        const images = [];
        for (const file of files) {
          const imageId = makeId("img");
          const ext = normalizeExt(path.extname(file.name || ""), file.type);
          const filename = `${imageId}${ext}`;
          const bytes = Buffer.from(await file.arrayBuffer());
          await writeBinaryFile(uploadPath(account.id, work.id, filename), bytes, file.type || "application/octet-stream");

          const image = {
            id: imageId,
            name: file.name || filename,
            filename,
            size: file.size || bytes.length,
            mimeType: file.type || "application/octet-stream",
            createdAt: now(),
            url: `/uploads/${encodeURIComponent(account.id)}/${encodeURIComponent(work.id)}/${encodeURIComponent(filename)}`
          };
          work.images.push(image);
          images.push(image);
        }

        work.updatedAt = now();
        account.updatedAt = now();
        await writeState(state);
        return json({ images }, 201);
      }

      if (method === "DELETE" && parts[4] === "images" && parts.length === 6) {
        const image = work.images.find((item) => item.id === parts[5]);
        if (!image) throw createError(404, "图片不存在");
        await backupState(state, "delete-image", [account.id]);
        await deleteFile(uploadPath(account.id, work.id, image.filename));
        work.images = work.images.filter((item) => item.id !== image.id);
        work.updatedAt = now();
        account.updatedAt = now();
        await writeState(state);
        return json({ success: true });
      }

      if (method === "POST" && parts[4] === "captions" && parts.length === 5) {
        const body = await readJson(request);
        const caption = {
          id: makeId("cap"),
          text: cleanText(body.text, "文案内容不能为空"),
          createdAt: now(),
          updatedAt: now()
        };
        work.captions.unshift(caption);
        work.updatedAt = now();
        account.updatedAt = now();
        await writeState(state);
        return json({ caption }, 201);
      }

      if ((method === "PATCH" || method === "DELETE") && parts[4] === "captions" && parts.length === 6) {
        const caption = work.captions.find((item) => item.id === parts[5]);
        if (!caption) throw createError(404, "文案不存在");

        if (method === "PATCH") {
          const body = await readJson(request);
          caption.text = cleanText(body.text, "文案内容不能为空");
          caption.updatedAt = now();
        } else {
          await backupState(state, "delete-caption", [account.id]);
          work.captions = work.captions.filter((item) => item.id !== caption.id);
        }

        work.updatedAt = now();
        account.updatedAt = now();
        await writeState(state);
        return json({ success: true, caption });
      }
    }

    throw createError(404, "接口不存在");
  } catch (error) {
    return json({ error: error.message || "请求失败" }, error.status || 500);
  }
}

async function readState() {
  try {
    const parsed = await readJsonFile(STATE_FILE);
    const state = { accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [] };
    if (normalizeState(state)) {
      await writeState(state);
    }
    return state;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const state = createInitialState();
    await writeState(state);
    return state;
  }
}

async function writeState(state) {
  await writeJsonFile(STATE_FILE, state);
}

async function backupState(state, label, accountIds = []) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = `backups/${stamp}-${label}`;
  await writeJsonFile(`${backupDir}/state.json`, state);

  for (const accountId of accountIds) {
    try {
      await copyPrefix(`uploads/${accountId}`, `${backupDir}/uploads/${accountId}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function createInitialState() {
  return {
    accounts: [createAccount("妮妮"), createAccount("kola")].map((account) => ({
      ...account,
      works: createDefaultWorks()
    }))
  };
}

function createAccount(name) {
  return {
    id: makeId("acct"),
    name,
    createdAt: now(),
    updatedAt: now(),
    works: []
  };
}

function createWork(name) {
  return {
    id: makeId("work"),
    name,
    status: "draft",
    completedAt: null,
    createdAt: now(),
    updatedAt: now(),
    images: [],
    captions: []
  };
}

function createDefaultWorks() {
  return Array.from({ length: DEFAULT_WORK_COUNT }, (_item, index) => createWork(`作品${index + 1}`));
}

function normalizeState(state) {
  let changed = false;
  for (const account of state.accounts) {
    account.works ||= [];
    for (const work of account.works) {
      work.images ||= [];
      work.captions ||= [];
      work.status = work.status === "done" ? "done" : "draft";
      work.completedAt = work.status === "done" ? work.completedAt || now() : null;
    }

    while (account.works.length < DEFAULT_WORK_COUNT) {
      account.works.push(createWork(`作品${account.works.length + 1}`));
      changed = true;
    }
  }
  return changed;
}

async function createWorkArchive(account, work) {
  const archive = archiver("zip", { zlib: { level: 9 } });
  const stream = new PassThrough();
  archive.on("error", (error) => stream.destroy(error));
  archive.pipe(stream);

  for (const image of work.images) {
    const entryName = `${safeFilePart(work.name)}-${safeFilePart(image.name || image.filename)}`;
    try {
      const file = await readFileStream(uploadPath(account.id, work.id, image.filename));
      archive.append(file.stream, { name: entryName });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  if (!work.images.length) {
    archive.append("这个作品暂时还没有图片。\n", { name: "README.txt" });
  }

  const captions = work.captions.map((caption) => caption.text).join("\n\n");
  if (captions) {
    archive.append(captions, { name: "文案.txt" });
  }

  archive.finalize();

  return new Response(Readable.toWeb(stream), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${account.name}-${work.name}.zip`)}`
    }
  });
}

function requireAccount(state, accountId) {
  const account = state.accounts.find((item) => item.id === accountId);
  if (!account) throw createError(404, "账号不存在");
  account.works ||= [];
  return account;
}

function requireWork(account, workId) {
  const work = account.works.find((item) => item.id === workId);
  if (!work) throw createError(404, "作品不存在");
  work.images ||= [];
  work.captions ||= [];
  return work;
}

async function removeAccountFiles(account) {
  await deletePrefix(`uploads/${account.id}`);
}

async function removeWorkFiles(accountId, work) {
  await deletePrefix(`uploads/${accountId}/${work.id}`);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function cleanName(value, message) {
  const text = String(value || "").trim();
  if (!text) throw createError(400, message);
  return text.slice(0, 40);
}

function cleanText(value, message) {
  const text = String(value || "").trim();
  if (!text) throw createError(400, message);
  return text.slice(0, 5000);
}

function normalizeExt(ext, mimeType) {
  const safeExt = ext.toLowerCase().replace(/[^a-z0-9.]/g, "");
  if (safeExt && safeExt.length <= 8) return safeExt;
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  return ".jpg";
}

function safeFilePart(value) {
  return String(value || "素材")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .slice(0, 80);
}

function uploadPath(accountId, workId, filename) {
  return `uploads/${accountId}/${workId}/${filename}`;
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(5).toString("hex")}`;
}

function now() {
  return new Date().toISOString();
}

function isPath(parts, expected) {
  return parts.length === expected.length && expected.every((part, index) => parts[index] === part);
}

function createError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function json(payload, status = 200) {
  return Response.json(payload, { status });
}
