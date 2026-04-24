const express = require("express");
const multer = require("multer");
const archiver = require("archiver");
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 50,
    fileSize: 20 * 1024 * 1024
  }
});

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(UPLOADS_DIR));
app.get("/", (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, "index.html"));
});

app.get("/styles.css", (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, "styles.css"));
});

app.get("/script.js", (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, "script.js"));
});

app.get("/api/state", async (_req, res, next) => {
  try {
    const state = await readState();
    res.json({ accounts: state.accounts });
  } catch (error) {
    next(error);
  }
});

app.post("/api/accounts", async (req, res, next) => {
  try {
    const state = await readState();
    const name = cleanName(req.body?.name, "账号名不能为空");
    const account = createAccount(name);
    state.accounts.push(account);
    await writeState(state);
    res.status(201).json({ account });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/accounts/:accountId", async (req, res, next) => {
  try {
    const state = await readState();
    const account = requireAccount(state, req.params.accountId);
    account.name = cleanName(req.body?.name, "账号名不能为空");
    await writeState(state);
    res.json({ account });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/accounts/:accountId", async (req, res, next) => {
  try {
    const state = await readState();
    const account = requireAccount(state, req.params.accountId);
    await removeAccountFiles(account);
    state.accounts = state.accounts.filter(item => item.id !== account.id);
    await writeState(state);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/accounts/:accountId/works", async (req, res, next) => {
  try {
    const state = await readState();
    const account = requireAccount(state, req.params.accountId);
    const work = createWork(cleanName(req.body?.name, "作品名不能为空"));
    account.works.push(work);
    await writeState(state);
    res.status(201).json({ work });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/accounts/:accountId/works/:workId", async (req, res, next) => {
  try {
    const state = await readState();
    const account = requireAccount(state, req.params.accountId);
    const work = requireWork(account, req.params.workId);
    if (typeof req.body?.name === "string") {
      work.name = cleanName(req.body.name, "作品名不能为空");
    }
    if (typeof req.body?.status === "string") {
      work.status = req.body.status === "done" ? "done" : "draft";
      work.completedAt = work.status === "done" ? new Date().toISOString() : null;
    }
    work.updatedAt = new Date().toISOString();
    await writeState(state);
    res.json({ work });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/accounts/:accountId/works/:workId", async (req, res, next) => {
  try {
    const state = await readState();
    const account = requireAccount(state, req.params.accountId);
    const work = requireWork(account, req.params.workId);
    await removeWorkFiles(account.id, work);
    account.works = account.works.filter(item => item.id !== work.id);
    await writeState(state);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/accounts/:accountId/works/:workId/images", upload.array("images"), async (req, res, next) => {
  try {
    const state = await readState();
    const account = requireAccount(state, req.params.accountId);
    const work = requireWork(account, req.params.workId);
    const files = (req.files || []).filter(file => file.mimetype.startsWith("image/"));

    if (!files.length) {
      throw createError(400, "请上传图片文件");
    }

    const workDir = path.join(UPLOADS_DIR, account.id, work.id);
    await fs.mkdir(workDir, { recursive: true });

    const addedImages = [];
    for (const file of files) {
      const ext = normalizeExt(path.extname(file.originalname), file.mimetype);
      const imageId = makeId("img");
      const filename = `${imageId}${ext}`;
      const absolutePath = path.join(workDir, filename);
      await fs.writeFile(absolutePath, file.buffer);
      const image = {
        id: imageId,
        name: file.originalname,
        filename,
        size: file.size,
        mimeType: file.mimetype,
        createdAt: new Date().toISOString(),
        url: `/uploads/${encodeURIComponent(account.id)}/${encodeURIComponent(work.id)}/${encodeURIComponent(filename)}`
      };
      work.images.push(image);
      addedImages.push(image);
    }

    work.updatedAt = new Date().toISOString();
    await writeState(state);
    res.status(201).json({ images: addedImages });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/accounts/:accountId/works/:workId/images/:imageId", async (req, res, next) => {
  try {
    const state = await readState();
    const account = requireAccount(state, req.params.accountId);
    const work = requireWork(account, req.params.workId);
    const image = work.images.find(item => item.id === req.params.imageId);
    if (!image) {
      throw createError(404, "图片不存在");
    }

    await removeFile(path.join(UPLOADS_DIR, account.id, work.id, image.filename));
    work.images = work.images.filter(item => item.id !== image.id);
    work.updatedAt = new Date().toISOString();
    await writeState(state);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/accounts/:accountId/works/:workId/captions", async (req, res, next) => {
  try {
    const state = await readState();
    const account = requireAccount(state, req.params.accountId);
    const work = requireWork(account, req.params.workId);
    const text = cleanText(req.body?.text, "文案内容不能为空");
    const caption = {
      id: makeId("cap"),
      text,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    work.captions.unshift(caption);
    work.updatedAt = new Date().toISOString();
    await writeState(state);
    res.status(201).json({ caption });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/accounts/:accountId/works/:workId/captions/:captionId", async (req, res, next) => {
  try {
    const state = await readState();
    const account = requireAccount(state, req.params.accountId);
    const work = requireWork(account, req.params.workId);
    const caption = work.captions.find(item => item.id === req.params.captionId);
    if (!caption) {
      throw createError(404, "文案不存在");
    }
    caption.text = cleanText(req.body?.text ?? "", "文案内容不能为空");
    caption.updatedAt = new Date().toISOString();
    work.updatedAt = new Date().toISOString();
    await writeState(state);
    res.json({ caption });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/accounts/:accountId/works/:workId/captions/:captionId", async (req, res, next) => {
  try {
    const state = await readState();
    const account = requireAccount(state, req.params.accountId);
    const work = requireWork(account, req.params.workId);
    work.captions = work.captions.filter(item => item.id !== req.params.captionId);
    work.updatedAt = new Date().toISOString();
    await writeState(state);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/accounts/:accountId/works/:workId/copy", async (req, res, next) => {
  try {
    const state = await readState();
    const account = requireAccount(state, req.params.accountId);
    const work = requireWork(account, req.params.workId);
    const payload = buildWorkClipboardPayload(account, work);
    await setWindowsClipboard(payload);
    res.json({
      success: true,
      imageCount: payload.filePaths.length,
      captionCount: work.captions.length
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/accounts/:accountId/copy", async (req, res, next) => {
  try {
    const state = await readState();
    const account = requireAccount(state, req.params.accountId);
    const payload = buildAccountClipboardPayload(account);
    await setWindowsClipboard(payload);
    res.json({
      success: true,
      imageCount: payload.filePaths.length,
      captionCount: account.works.reduce((sum, work) => sum + work.captions.length, 0)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/accounts/:accountId/works/:workId/copy-caption", async (req, res, next) => {
  try {
    const state = await readState();
    const account = requireAccount(state, req.params.accountId);
    const work = requireWork(account, req.params.workId);
    await setWindowsClipboard({
      text: buildWorkCopyText(account, work),
      filePaths: []
    });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/accounts/:accountId/works/:workId/download", async (req, res, next) => {
  try {
    const state = await readState();
    const account = requireAccount(state, req.params.accountId);
    const work = requireWork(account, req.params.workId);
    if (!work.images.length) {
      throw createError(400, "当前作品还没有图片可下载");
    }

    res.attachment(`${safeName(account.name)}-${safeName(work.name)}-素材.zip`);
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", error => next(error));
    archive.pipe(res);

    const folderPrefix = `${safeZipSegment(account.name)}/${safeZipSegment(work.name)}`;
    for (const image of work.images) {
      const filePath = path.join(UPLOADS_DIR, account.id, work.id, image.filename);
      if (fssync.existsSync(filePath)) {
        archive.file(filePath, { name: `${folderPrefix}/${image.name}` });
      }
    }

    await archive.finalize();
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = error.statusCode || 500;
  res.status(status).json({
    error: error.message || "服务端出错了"
  });
});

bootstrap()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`小红书矩阵系统已启动: http://localhost:${PORT}`);
    });
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

async function bootstrap() {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  try {
    await fs.access(STATE_FILE);
  } catch {
    await writeState(createDefaultState());
  }
}

function createDefaultState() {
  return {
    accounts: [createAccount("妮妮"), createAccount("kola")]
  };
}

function createAccount(name) {
  return {
    id: makeId("acct"),
    name,
    createdAt: new Date().toISOString(),
    works: [createWork("作品1"), createWork("作品2"), createWork("作品3")]
  };
}

function createWork(name) {
  const timestamp = new Date().toISOString();
  return {
    id: makeId("work"),
    name,
    status: "draft",
    completedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    images: [],
    captions: []
  };
}

async function readState() {
  const raw = await fs.readFile(STATE_FILE, "utf8");
  const parsed = JSON.parse(raw);
  parsed.accounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
  for (const account of parsed.accounts) {
    account.works = Array.isArray(account.works) ? account.works : [];
    for (const work of account.works) {
      work.images = Array.isArray(work.images) ? work.images : [];
      work.captions = Array.isArray(work.captions) ? work.captions : [];
    }
  }
  return parsed;
}

async function writeState(state) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function requireAccount(state, accountId) {
  const account = state.accounts.find(item => item.id === accountId);
  if (!account) {
    throw createError(404, "账号不存在");
  }
  return account;
}

function requireWork(account, workId) {
  const work = account.works.find(item => item.id === workId);
  if (!work) {
    throw createError(404, "作品不存在");
  }
  return work;
}

function cleanName(value, message) {
  const name = String(value || "").trim();
  if (!name) {
    throw createError(400, message);
  }
  return name;
}

function cleanText(value, message) {
  const text = String(value || "").trim();
  if (!text) {
    throw createError(400, message);
  }
  return text;
}

function createError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(5).toString("hex")}`;
}

function normalizeExt(ext, mimeType) {
  if (ext) return ext.toLowerCase();
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  return ".jpg";
}

async function removeAccountFiles(account) {
  for (const work of account.works) {
    await removeWorkFiles(account.id, work);
  }
  await fs.rm(path.join(UPLOADS_DIR, account.id), { recursive: true, force: true });
}

async function removeWorkFiles(accountId, work) {
  await fs.rm(path.join(UPLOADS_DIR, accountId, work.id), { recursive: true, force: true });
}

async function removeFile(filePath) {
  await fs.rm(filePath, { force: true });
}

function buildWorkClipboardPayload(account, work) {
  const filePaths = work.images
    .map(image => path.join(UPLOADS_DIR, account.id, work.id, image.filename))
    .filter(filePath => fssync.existsSync(filePath));

  if (!filePaths.length && !work.captions.length) {
    throw createError(400, "这个作品还没有图片或文案可复制");
  }

  return {
    text: buildWorkCopyText(account, work),
    filePaths
  };
}

function buildAccountClipboardPayload(account) {
  const filePaths = account.works.flatMap(work =>
    work.images
      .map(image => path.join(UPLOADS_DIR, account.id, work.id, image.filename))
      .filter(filePath => fssync.existsSync(filePath))
  );

  if (!filePaths.length && !account.works.some(work => work.captions.length)) {
    throw createError(400, "这个账号还没有图片或文案可复制");
  }

  return {
    text: buildAccountCopyText(account),
    filePaths
  };
}

function buildWorkCopyText(account, work) {
  const lines = [`【${account.name} / ${work.name}】`];
  if (!work.captions.length) {
    lines.push("暂无文案");
  } else {
    work.captions.forEach((caption, index) => {
      lines.push(``);
      lines.push(`文案 ${index + 1}`);
      lines.push(caption.text);
    });
  }
  return lines.join(os.EOL);
}

function buildAccountCopyText(account) {
  const lines = [`【${account.name} 全部作品】`];
  if (!account.works.length) {
    lines.push("暂无作品");
    return lines.join(os.EOL);
  }

  account.works.forEach((work, workIndex) => {
    lines.push("");
    lines.push(`作品 ${workIndex + 1} · ${work.name}`);
    if (!work.captions.length) {
      lines.push("暂无文案");
      return;
    }
    work.captions.forEach((caption, captionIndex) => {
      lines.push("");
      lines.push(`文案 ${captionIndex + 1}`);
      lines.push(caption.text);
    });
  });

  return lines.join(os.EOL);
}

async function setWindowsClipboard({ text, filePaths }) {
  const payloadPath = path.join(DATA_DIR, `clipboard-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.json`);
  await fs.writeFile(payloadPath, JSON.stringify({ text, filePaths }, null, 2), "utf8");

  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Collections
$payload = Get-Content -Raw -LiteralPath '${psEscape(payloadPath)}' | ConvertFrom-Json
$data = New-Object System.Windows.Forms.DataObject
$files = New-Object System.Collections.Specialized.StringCollection
foreach ($file in $payload.filePaths) {
  if ([System.IO.File]::Exists([string]$file)) {
    [void]$files.Add([string]$file)
  }
}
if ($files.Count -gt 0) {
  $data.SetFileDropList($files)
}
if ($payload.text) {
  $data.SetText([string]$payload.text, [System.Windows.Forms.TextDataFormat]::UnicodeText)
}
[System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
`;

  try {
    await runPowerShell(script);
  } catch (error) {
    throw createError(500, `写入剪贴板失败: ${error.message}`);
  } finally {
    await removeFile(payloadPath);
  }
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", "-"], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stderr = "";
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
    });

    child.stdin.end(script);
  });
}

function psEscape(value) {
  return String(value).replaceAll("'", "''");
}

function safeZipSegment(value) {
  return String(value || "untitled").replace(/[\\/:*?"<>|]/g, "_").trim() || "untitled";
}

function safeName(value) {
  return safeZipSegment(value).replace(/\s+/g, "_");
}
