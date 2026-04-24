import crypto from "node:crypto";
import { spawn } from "node:child_process";
import * as XLSX from "xlsx";
import { readJsonFile, writeJsonFile } from "../../../lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIG_FILE = "sync-config.json";
const HISTORY_FILE = "sync-history.json";
const TIME_ZONE = "Asia/Shanghai";
const TRACKING_FIELDS = ["来源名称", "来源类型", "来源链接", "来源记录ID", "最新更新日期", "同步时间", "同步唯一键"];
const READ_ONLY_FIELD_TYPES = new Set(["auto_number", "formula", "lookup", "created_time", "modified_time", "created_by", "modified_by"]);

const DEFAULT_CONFIG = {
  target: {
    url: "https://motqu370kv.feishu.cn/wiki/OOyQwVJgui6mQDk5nmwcdWn2nTg?from=from_copylink"
  },
  sources: [
    {
      id: "src_feishu_base_1",
      name: "飞书表格 1",
      type: "lark_base",
      enabled: true,
      url: "https://my.feishu.cn/base/G40pbW4gQaF8TdsfyThcUgHZnMf?table=tblDHAb97vZ7tJ9w&view=vewoFH3MoX",
      updatedAtField: ""
    },
    {
      id: "src_tencent_sheet_1",
      name: "腾讯文档表格 2",
      type: "tencent_sheet",
      enabled: true,
      url: "https://docs.qq.com/sheet/DQUZ5RUdFd2hveXJm?tab=eno0p4",
      updatedAtField: ""
    }
  ]
};

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
    const parts = params.syncPath || [];

    if (method === "GET" && isPath(parts, ["config"])) {
      const config = await readConfig();
      const history = await readHistory();
      const status = await getLarkStatus(config.target.url);
      return json({ config, history: history.slice(0, 5), status });
    }

    if (method === "GET" && isPath(parts, ["history"])) {
      return json({ history: await readHistory() });
    }

    if (method === "PATCH" && isPath(parts, ["target"])) {
      const body = await readJson(request);
      const config = await readConfig();
      config.target = { url: requireText(body.url, "Target URL is required.") };
      await writeConfig(config);
      return json({ config });
    }

    if (method === "POST" && isPath(parts, ["sources"])) {
      const body = await readJson(request);
      const config = await readConfig();
      const source = normalizeSource({ ...body, id: makeId("src"), enabled: body.enabled ?? true });
      config.sources.unshift(source);
      await writeConfig(config);
      return json({ source, config }, 201);
    }

    if ((method === "PATCH" || method === "DELETE") && parts[0] === "sources" && parts[1]) {
      const config = await readConfig();
      const source = config.sources.find((item) => item.id === parts[1]);
      if (!source) throw createError(404, "Source not found.");

      if (method === "DELETE") {
        config.sources = config.sources.filter((item) => item.id !== source.id);
        await writeConfig(config);
        return json({ success: true, config });
      }

      const body = await readJson(request);
      Object.assign(source, normalizeSource({ ...source, ...body, id: source.id }));
      await writeConfig(config);
      return json({ source, config });
    }

    if (method === "POST" && isPath(parts, ["run"])) {
      const config = await readConfig();
      const result = await runSync(config);
      const history = await readHistory();
      history.unshift(result);
      await writeHistory(history.slice(0, 20));
      return json({ result, history: history.slice(0, 20) });
    }

    if (method === "POST" && isPath(parts, ["preview"])) {
      const config = await readConfig();
      const result = await previewSync(config);
      return json({ result });
    }

    throw createError(404, "API route not found.");
  } catch (error) {
    return json({ error: error.message || "Request failed.", details: error.details || null }, error.status || 500);
  }
}

async function previewSync(config) {
  const startedAt = new Date().toISOString();
  const enabledSources = config.sources.filter((source) => source.enabled);
  const results = [];

  for (const source of enabledSources) {
    const item = {
      sourceId: source.id,
      sourceName: source.name,
      sourceType: source.type,
      status: "ok",
      latestDate: null,
      scanned: 0,
      matched: 0,
      sampleRows: [],
      sourceFields: [],
      mappedFields: [],
      error: null
    };

    try {
      const rows = source.type === "tencent_sheet" ? await readTencentSource(source) : await readLarkBaseSource(source);
      item.scanned = rows.length;
      item.latestDate = rows.map((row) => row.updateDate).filter(Boolean).sort().at(-1) || null;
      if (!item.latestDate) {
        item.status = "skipped";
        item.error = "No usable update date was found.";
        results.push(item);
        continue;
      }

      const latestRows = rows.filter((row) => row.updateDate === item.latestDate);
      item.matched = latestRows.length;
      item.sourceFields = Object.keys(latestRows[0]?.values || {});
      item.mappedFields = getMappedFieldNames(source, item.sourceFields);
      item.sampleRows = latestRows.slice(0, 5).map((row) => ({
        recordId: row.recordId,
        updateDate: row.updateDate,
        values: row.values
      }));
    } catch (error) {
      item.status = "error";
      item.error = error.message || "Preview failed.";
      item.details = error.details || null;
    }

    results.push(item);
  }

  return {
    id: makeId("preview"),
    mode: "preview",
    startedAt,
    finishedAt: new Date().toISOString(),
    sourceCount: enabledSources.length,
    results
  };
}

async function runSync(config) {
  const startedAt = new Date().toISOString();
  const target = await resolveTarget(config.target.url);
  const writer = target.objType === "bitable" ? await createBitableWriter(target) : await createSheetWriter(target);
  const enabledSources = config.sources.filter((source) => source.enabled);
  const results = [];

  for (const source of enabledSources) {
    const item = {
      sourceId: source.id,
      sourceName: source.name,
      sourceType: source.type,
      status: "ok",
      latestDate: null,
      scanned: 0,
      matched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      error: null
    };

    try {
      const rows = source.type === "tencent_sheet" ? await readTencentSource(source) : await readLarkBaseSource(source);
      item.scanned = rows.length;
      item.latestDate = rows.map((row) => row.updateDate).filter(Boolean).sort().at(-1) || null;
      if (!item.latestDate) {
        item.status = "skipped";
        item.error = "No usable update date was found.";
        results.push(item);
        continue;
      }

      const latestRows = rows.filter((row) => row.updateDate === item.latestDate);
      item.matched = latestRows.length;
      for (const row of latestRows) {
        const writeResult = await writer.upsert(source, row, item.latestDate, startedAt);
        if (writeResult.action === "created") item.created += 1;
        if (writeResult.action === "updated") item.updated += 1;
        if (writeResult.action === "skipped") item.skipped += 1;
      }
    } catch (error) {
      item.status = "error";
      item.error = error.message || "Sync failed.";
      item.details = error.details || null;
    }

    results.push(item);
  }

  return {
    id: makeId("run"),
    startedAt,
    finishedAt: new Date().toISOString(),
    target: { url: config.target.url, type: target.objType, title: target.title },
    sourceCount: enabledSources.length,
    results
  };
}

async function readLarkBaseSource(source) {
  const parsed = parseLarkBaseUrl(source.url);
  const fields = await listBitableFields(parsed.baseToken, parsed.tableId);
  const updateField = findModifiedField(fields);
  if (!updateField) throw createError(400, "No modified-time field found in the Feishu Base source.");

  const records = await listBitableRecords(parsed.baseToken, parsed.tableId, parsed.viewId);
  return records.map((record) => {
    const values = normalizeRecordFields(record.fields || {});
    const rawUpdatedAt = values[updateField.name] ?? values[updateField.id] ?? record.modified_time ?? record.updated_at;
    const updatedAt = parseDateValue(rawUpdatedAt);
    return {
      recordId: String(record.record_id || record.id || makeId("rec")),
      updatedAt,
      updateDate: updatedAt ? dateInShanghai(updatedAt) : null,
      values
    };
  });
}

async function readTencentSource(source) {
  const workbook = await fetchTencentWorkbook(source.url);
  const sheetName = selectWorkbookSheet(workbook, parseTencentUrl(source.url).tab);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
  const updateField = source.updatedAtField || findUpdateColumn(Object.keys(rows[0] || {}));
  if (!updateField) {
    throw createError(400, "Tencent Docs public export does not expose row update time. Fill in an update-date column name for this source.");
  }

  return rows.map((row, index) => {
    const updatedAt = parseDateValue(row[updateField]);
    return {
      recordId: `row_${index + 2}`,
      updatedAt,
      updateDate: updatedAt ? dateInShanghai(updatedAt) : null,
      values: normalizeRecordFields(row)
    };
  });
}

async function fetchTencentWorkbook(url) {
  const { docId } = parseTencentUrl(url);
  const exportUrls = [
    `https://docs.qq.com/dop-api/opendoc?id=${encodeURIComponent(docId)}&normal=1&outformat=1`,
    `https://docs.qq.com/dop-api/opendoc?id=${encodeURIComponent(docId)}&normal=1&outformat=2`,
    `https://docs.qq.com/dop-api/opendoc?id=${encodeURIComponent(docId)}&type=export_xlsx`
  ];

  for (const exportUrl of exportUrls) {
    try {
      const response = await fetch(exportUrl, { headers: { "User-Agent": "Mozilla/5.0", Referer: url }, redirect: "follow" });
      if (!response.ok) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || looksLikeHtml(bytes)) continue;
      const head = bytes.toString("utf8", 0, Math.min(bytes.length, 300));
      return head.includes(",") ? XLSX.read(bytes.toString("utf8"), { type: "string" }) : XLSX.read(bytes, { type: "buffer" });
    } catch {
      // Try the next public export shape.
    }
  }

  throw createError(400, "This Tencent Docs sheet is not publicly exportable as CSV/XLSX.");
}

async function resolveTarget(url) {
  const wikiToken = parseWikiToken(url);
  if (wikiToken) {
    const response = await runLark(["wiki", "spaces", "get_node", "--params", JSON.stringify({ token: wikiToken }), "--as", "user"]);
    const node = response.node || response.data?.node || response;
    const objType = node.obj_type || node.objType;
    const objToken = node.obj_token || node.objToken;
    if (!objType || !objToken) throw createError(400, "Could not resolve the target Wiki node.");
    return { objType, objToken, title: node.title || "Target", originalUrl: url };
  }

  const base = parseLarkBaseUrl(url);
  return { objType: "bitable", objToken: base.baseToken, tableId: base.tableId, title: "Target Base", originalUrl: url };
}

async function createBitableWriter(target) {
  const tableId = target.tableId || (await getFirstBitableTableId(target.objToken));
  const fields = await listBitableFields(target.objToken, tableId);
  const fieldNames = new Set(fields.filter(isWritableField).map((field) => field.name));
  const missingTracking = TRACKING_FIELDS.filter((field) => !fieldNames.has(field));
  if (missingTracking.length) {
    const error = createError(400, `Target Base is missing tracking fields: ${missingTracking.join(", ")}`);
    error.details = { missingTracking };
    throw error;
  }

  const existingByKey = new Map();
  for (const record of await listBitableRecords(target.objToken, tableId)) {
    const fieldsMap = normalizeRecordFields(record.fields || {});
    const key = stringifyCell(fieldsMap["同步唯一键"]);
    if (key) existingByKey.set(key, record.record_id || record.id);
  }

  return {
    async upsert(source, row, latestDate, syncTime) {
      const uniqueKey = `${source.id}:${row.recordId}`;
      const payload = buildTargetPayload(source, row, latestDate, syncTime, fieldNames, uniqueKey);
      if (!Object.keys(payload).length) return { action: "skipped" };
      const recordId = existingByKey.get(uniqueKey);
      const args = ["base", "+record-upsert", "--base-token", target.objToken, "--table-id", tableId, "--json", JSON.stringify(payload), "--as", "user"];
      if (recordId) args.splice(args.length - 2, 0, "--record-id", recordId);
      const response = await runLark(args);
      const nextRecordId = response.record?.record_id || response.data?.record?.record_id || response.record_id || recordId;
      if (nextRecordId) existingByKey.set(uniqueKey, nextRecordId);
      return { action: recordId ? "updated" : "created" };
    }
  };
}

async function createSheetWriter(target) {
  if (target.objType !== "sheet") throw createError(400, `Unsupported target Wiki type: ${target.objType}. Use a Feishu Base or Sheet.`);
  const info = await runLark(["sheets", "+info", "--spreadsheet-token", target.objToken, "--as", "user"]);
  const sheet = (info.sheets || info.data?.sheets || [])[0];
  const sheetId = sheet?.sheet_id || sheet?.sheetId || sheet?.id;
  if (!sheetId) throw createError(400, "Could not read target Sheet ID.");

  const current = await readSheetMatrix(target.objToken, sheetId);
  const headers = current[0] || [];
  const missingTracking = TRACKING_FIELDS.filter((field) => !headers.includes(field));
  if (missingTracking.length) {
    const error = createError(400, `Target Sheet is missing tracking columns: ${missingTracking.join(", ")}`);
    error.details = { missingTracking };
    throw error;
  }

  const keyIndex = headers.indexOf("同步唯一键");
  const existingByKey = new Map();
  current.slice(1).forEach((row, index) => {
    const key = stringifyCell(row[keyIndex]);
    if (key) existingByKey.set(key, index + 2);
  });

  return {
    async upsert(source, row, latestDate, syncTime) {
      const uniqueKey = `${source.id}:${row.recordId}`;
      const payload = buildTargetPayload(source, row, latestDate, syncTime, new Set(headers), uniqueKey);
      const values = headers.map((header) => payload[header] ?? "");
      const existingRow = existingByKey.get(uniqueKey);
      if (existingRow) {
        await runLark(["sheets", "+write", "--spreadsheet-token", target.objToken, "--sheet-id", sheetId, "--range", `${sheetId}!A${existingRow}:${columnName(headers.length)}${existingRow}`, "--values", JSON.stringify([values]), "--as", "user"]);
        return { action: "updated" };
      }
      await runLark(["sheets", "+append", "--spreadsheet-token", target.objToken, "--sheet-id", sheetId, "--range", `${sheetId}!A1:${columnName(headers.length)}1`, "--values", JSON.stringify([values]), "--as", "user"]);
      existingByKey.set(uniqueKey, current.length + existingByKey.size + 1);
      return { action: "created" };
    }
  };
}

async function readSheetMatrix(spreadsheetToken, sheetId) {
  const response = await runLark(["sheets", "+read", "--spreadsheet-token", spreadsheetToken, "--sheet-id", sheetId, "--range", `${sheetId}!A1:ZZ10000`, "--value-render-option", "ToString", "--as", "user"]);
  return response.values || response.data?.valueRange?.values || response.data?.values || [];
}

function buildTargetPayload(source, row, latestDate, syncTime, targetFieldNames, uniqueKey) {
  const payload = {};
  for (const [field, value] of Object.entries(row.values)) {
    const targetField = source.fieldMap?.[field] || field;
    if (targetFieldNames.has(targetField)) payload[targetField] = normalizeWritableValue(value);
  }

  const tracking = {
    来源名称: source.name,
    来源类型: source.type === "tencent_sheet" ? "腾讯文档" : "飞书 Base",
    来源链接: source.url,
    来源记录ID: row.recordId,
    最新更新日期: latestDate,
    同步时间: formatDateTime(syncTime),
    同步唯一键: uniqueKey
  };
  for (const [field, value] of Object.entries(tracking)) {
    if (targetFieldNames.has(field)) payload[field] = value;
  }
  return payload;
}

async function listBitableFields(baseToken, tableId) {
  const fields = [];
  let offset = 0;
  while (true) {
    const response = await runLark(["base", "+field-list", "--base-token", baseToken, "--table-id", tableId, "--offset", String(offset), "--limit", "100", "--as", "user"]);
    const items = extractItems(response);
    fields.push(...items.map((field) => ({ id: field.field_id || field.id, name: field.field_name || field.name || field.title, type: normalizeFieldType(field.type || field.ui_type || field.field_type) })));
    if (items.length < 100) break;
    offset += 100;
  }
  return fields.filter((field) => field.name);
}

async function listBitableRecords(baseToken, tableId, viewId = "") {
  const records = [];
  let offset = 0;
  while (true) {
    const args = ["base", "+record-list", "--base-token", baseToken, "--table-id", tableId, "--offset", String(offset), "--limit", "200", "--as", "user"];
    if (viewId) args.splice(args.length - 2, 0, "--view-id", viewId);
    const response = await runLark(args);
    const items = extractItems(response);
    records.push(...items);
    if (items.length < 200) break;
    offset += 200;
  }
  return records;
}

async function getFirstBitableTableId(baseToken) {
  const response = await runLark(["base", "+table-list", "--base-token", baseToken, "--limit", "50", "--as", "user"]);
  const table = extractItems(response)[0];
  const tableId = table?.table_id || table?.id;
  if (!tableId) throw createError(400, "Target Base has no tables.");
  return tableId;
}

async function getLarkStatus(targetUrl) {
  if (process.env.VERCEL) {
    return {
      larkCli: false,
      loggedIn: false,
      message: "Vercel Serverless 不能运行本机 lark-cli。素材管理可正常使用，表格同步需要部署到可安装 lark-cli 的服务器。"
    };
  }

  try {
    const token = parseWikiToken(targetUrl);
    if (!token) return { larkCli: true, loggedIn: true, message: "Target is not a Wiki URL; auth will be checked on sync." };
    await runLark(["wiki", "spaces", "get_node", "--params", JSON.stringify({ token }), "--as", "user"]);
    return { larkCli: true, loggedIn: true, message: "Feishu user auth is ready." };
  } catch (error) {
    const message = error.message || "";
    const larkCli = !message.includes("lark-cli not found");
    return { larkCli, loggedIn: larkCli && !message.includes("not logged in"), message };
  }
}

function runLark(args) {
  if (process.env.VERCEL) {
    throw createError(400, "Vercel Serverless 不能运行本机 lark-cli。请把表格同步部署到可安装 lark-cli 的服务器，或改造成飞书开放平台 API 鉴权。");
  }

  return new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? "lark-cli.cmd" : "lark-cli";
    const child = spawn(command, args, { shell: process.platform === "win32", windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", () => reject(createError(500, "lark-cli not found or not executable.")));
    child.on("close", (code) => {
      const parsed = parseCliJson(stdout) || parseCliJson(stderr);
      if (code !== 0 || parsed?.ok === false) {
        const error = createError(parsed?.error?.type === "auth" ? 401 : 500, parsed?.error?.message || stderr || stdout || "lark-cli failed.");
        error.details = parsed?.error || { stdout, stderr };
        reject(error);
        return;
      }
      resolve(parsed || { stdout: stdout.trim() });
    });
  });
}

async function readConfig() {
  try {
    const parsed = await readJsonFile(CONFIG_FILE);
    return {
      target: parsed.target?.url ? parsed.target : DEFAULT_CONFIG.target,
      sources: Array.isArray(parsed.sources) ? parsed.sources.map(normalizeSource) : DEFAULT_CONFIG.sources
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeConfig(DEFAULT_CONFIG);
    return structuredClone(DEFAULT_CONFIG);
  }
}

async function writeConfig(config) {
  await writeJsonFile(CONFIG_FILE, config);
}

async function readHistory() {
  try {
    const parsed = await readJsonFile(HISTORY_FILE);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return [];
  }
}

async function writeHistory(history) {
  await writeJsonFile(HISTORY_FILE, history);
}

function normalizeSource(source) {
  const type = source.type || guessSourceType(source.url);
  return {
    id: source.id || makeId("src"),
    name: requireText(source.name || (type === "tencent_sheet" ? "腾讯文档表格" : "飞书 Base 表格"), "Source name is required.").slice(0, 80),
    type,
    enabled: source.enabled !== false,
    url: requireText(source.url, "Source URL is required."),
    updatedAtField: source.updatedAtField || "",
    fieldMap: normalizeFieldMap(source.fieldMap)
  };
}

function normalizeFieldMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([sourceField, targetField]) => [String(sourceField).trim(), String(targetField || "").trim()])
      .filter(([sourceField, targetField]) => sourceField && targetField)
  );
}

function getMappedFieldNames(source, sourceFields) {
  return sourceFields.map((field) => ({ sourceField: field, targetField: source.fieldMap?.[field] || field }));
}

function guessSourceType(url) {
  return String(url || "").includes("docs.qq.com") ? "tencent_sheet" : "lark_base";
}

function parseLarkBaseUrl(value) {
  const url = new URL(value);
  const baseToken = url.pathname.match(/\/base\/([^/?#]+)/)?.[1];
  const tableId = url.searchParams.get("table");
  const viewId = url.searchParams.get("view") || "";
  if (!baseToken || !tableId) throw createError(400, "Feishu Base URL must include base token and table parameter.");
  return { baseToken, tableId, viewId };
}

function parseWikiToken(value) {
  try {
    return new URL(value).pathname.match(/\/wiki\/([^/?#]+)/)?.[1] || "";
  } catch {
    return "";
  }
}

function parseTencentUrl(value) {
  const url = new URL(value);
  const docId = url.pathname.match(/\/sheet\/([^/?#]+)/)?.[1];
  if (!docId) throw createError(400, "Invalid Tencent Docs sheet URL.");
  return { docId, tab: url.searchParams.get("tab") || "" };
}

function selectWorkbookSheet(workbook, tab) {
  return tab && workbook.SheetNames.includes(tab) ? tab : workbook.SheetNames[0];
}

function findModifiedField(fields) {
  return fields.find((field) => field.type === "modified_time") || fields.find((field) => /最后.*(更新|修改)|修改时间|更新时间|last.*(modified|updated)|updated/i.test(field.name));
}

function findUpdateColumn(headers) {
  return headers.find((header) => /最后.*(更新|修改)|修改时间|更新时间|更新日期|updated_at|updatedAt|last.*(modified|updated)/i.test(header));
}

function isWritableField(field) {
  return field.name && !READ_ONLY_FIELD_TYPES.has(field.type);
}

function normalizeRecordFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, normalizeWritableValue(value)]));
}

function normalizeWritableValue(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(stringifyCell).filter(Boolean).join(", ");
  if (typeof value === "object") return stringifyCell(value);
  return value;
}

function stringifyCell(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(stringifyCell).filter(Boolean).join(", ");
  if (value.text) return String(value.text);
  if (value.name) return String(value.name);
  if (value.value) return stringifyCell(value.value);
  return JSON.stringify(value);
}

function parseDateValue(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    if (value > 1000000000000) return new Date(value);
    if (value > 1000000000) return new Date(value * 1000);
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000);
  }
  const text = stringifyCell(value).trim();
  if (!text) return null;
  const numeric = Number(text);
  if (!Number.isNaN(numeric) && numeric > 1000000000) return parseDateValue(numeric);
  const parsed = new Date(text.replace(/\//g, "-").replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateInShanghai(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  const datePart = dateInShanghai(date);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
  return `${datePart} ${time}`;
}

function extractItems(response) {
  return response.items || response.records || response.fields || response.tables || response.data?.items || response.data?.records || response.data?.fields || response.data?.tables || [];
}

function parseCliJson(output) {
  const text = String(output || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {}
  }
  return null;
}

function normalizeFieldType(type) {
  return String(type || "").toLowerCase();
}

function looksLikeHtml(bytes) {
  const head = bytes.toString("utf8", 0, Math.min(bytes.length, 200)).trim().toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html") || head.includes("<title>");
}

function columnName(index) {
  let name = "";
  let value = index;
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name || "A";
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function requireText(value, message) {
  const text = String(value || "").trim();
  if (!text) throw createError(400, message);
  return text;
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(5).toString("hex")}`;
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
