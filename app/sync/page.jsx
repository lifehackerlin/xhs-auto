"use client";

import clsx from "clsx";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Database,
  FileSpreadsheet,
  Link2,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import "./sync.css";

const SOURCE_TYPES = [
  { value: "lark_base", label: "飞书 Base" },
  { value: "tencent_sheet", label: "腾讯文档" }
];

export default function SyncPage() {
  const [config, setConfig] = useState(null);
  const [history, setHistory] = useState([]);
  const [status, setStatus] = useState(null);
  const [runResult, setRunResult] = useState(null);
  const [previewResult, setPreviewResult] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [sourceDraft, setSourceDraft] = useState({ name: "", url: "", type: "lark_base", updatedAtField: "", fieldMapText: "" });
  const [targetDraft, setTargetDraft] = useState("");

  const latestRun = runResult || history[0] || null;
  const enabledCount = useMemo(() => (config?.sources || []).filter((source) => source.enabled).length, [config]);

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    await run("refresh", async () => {
      const payload = await api("/api/sync/config");
      setConfig(payload.config);
      setTargetDraft(payload.config.target.url);
      setHistory(payload.history || []);
      setStatus(payload.status);
    });
  }

  async function addSource() {
    if (!sourceDraft.url.trim()) return setError("先填写来源表格链接");
    await run("source", async () => {
      const payload = await api("/api/sync/sources", { method: "POST", body: sourceDraft });
      setConfig(payload.config);
      setSourceDraft({ name: "", url: "", type: "lark_base", updatedAtField: "", fieldMapText: "" });
    });
  }

  async function updateSource(sourceId, patch) {
    const source = config.sources.find((item) => item.id === sourceId);
    await run(`source-${sourceId}`, async () => {
      const payload = await api(`/api/sync/sources/${sourceId}`, { method: "PATCH", body: { ...source, ...patch } });
      setConfig(payload.config);
    });
  }

  async function deleteSource(sourceId) {
    if (!window.confirm("删除这个来源表格？")) return;
    await run(`source-${sourceId}`, async () => {
      const payload = await api(`/api/sync/sources/${sourceId}`, { method: "DELETE" });
      setConfig(payload.config);
    });
  }

  async function saveTarget() {
    await run("target", async () => {
      const payload = await api("/api/sync/target", { method: "PATCH", body: { url: targetDraft } });
      setConfig(payload.config);
      await refresh();
    });
  }

  async function syncNow() {
    setRunResult(null);
    await run("sync", async () => {
      const payload = await api("/api/sync/run", { method: "POST" });
      setRunResult(payload.result);
      setHistory(payload.history || []);
    });
  }

  async function previewNow() {
    setPreviewResult(null);
    await run("preview", async () => {
      const payload = await api("/api/sync/preview", { method: "POST" });
      setPreviewResult(payload.result);
    });
  }

  async function run(label, action) {
    setError("");
    setBusy(label);
    try {
      await action();
    } catch (caught) {
      setError(caught.message || "操作失败");
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="sync-shell">
      <header className="sync-hero">
        <div>
          <span className="sync-eyebrow">Spreadsheet Sync</span>
          <h1>表格最新更新同步</h1>
          <p>抓取每个来源表格最近更新那一天的全部条目，按同名字段写入目标飞书表格，并用同步唯一键去重更新。</p>
        </div>
        <div className="sync-hero-actions">
          <button className="sync-soft" onClick={previewNow} disabled={!config || busy === "preview" || !enabledCount}>
            {busy === "preview" ? <Loader2 className="sync-spin" size={18} /> : <RefreshCw size={18} />}
            测试采集
          </button>
          <button className="sync-primary" onClick={syncNow} disabled={!config || busy === "sync" || !enabledCount}>
            {busy === "sync" ? <Loader2 className="sync-spin" size={18} /> : <Play size={18} />}
            写入目标表
          </button>
        </div>
      </header>

      {error ? (
        <div className="sync-alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="sync-status-grid">
        <article className="sync-panel">
          <div className="sync-panel-head">
            <span>目标表格</span>
            <Database size={18} />
          </div>
          <div className="sync-target-editor">
            <input value={targetDraft} onChange={(event) => setTargetDraft(event.target.value)} placeholder="飞书 Wiki / Base / Sheet 链接" />
            <button className="sync-icon" onClick={saveTarget} disabled={busy === "target"} title="保存目标">
              {busy === "target" ? <Loader2 className="sync-spin" size={17} /> : <Save size={17} />}
            </button>
          </div>
          <p>目标表需要已有追踪字段：来源名称、来源类型、来源链接、来源记录ID、最新更新日期、同步时间、同步唯一键。</p>
        </article>

        <article className={clsx("sync-panel", status?.loggedIn ? "ok" : "warn")}>
          <div className="sync-panel-head">
            <span>飞书登录</span>
            {status?.loggedIn ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          </div>
          <strong>{status?.loggedIn ? "已连接" : "需要登录"}</strong>
          <p>{status?.message || "正在检查飞书 CLI 状态"}</p>
          {!status?.loggedIn ? <code>lark-cli auth login --domain motqu370kv.feishu.cn</code> : null}
        </article>

        <article className="sync-panel">
          <div className="sync-panel-head">
            <span>最近运行</span>
            <Clock3 size={18} />
          </div>
          <strong>{latestRun ? formatDateTime(latestRun.finishedAt) : "暂无记录"}</strong>
          <p>{latestRun ? `${summarizeRun(latestRun)}，目标：${latestRun.target?.title || latestRun.target?.type || "表格"}` : "添加来源后即可手动同步。"}</p>
        </article>
      </section>

      <section className="sync-workspace">
        <aside className="sync-source-panel">
          <div className="sync-section-head">
            <div>
              <h2>来源表格</h2>
              <p>{enabledCount} 个启用来源</p>
            </div>
            <button className="sync-soft" onClick={refresh} disabled={busy === "refresh"}>
              {busy === "refresh" ? <Loader2 className="sync-spin" size={16} /> : <RefreshCw size={16} />}
              刷新
            </button>
          </div>

          <div className="sync-source-list">
            {(config?.sources || []).map((source) => (
              <article key={source.id} className={clsx("sync-source-card", !source.enabled && "disabled")}>
                <div className="sync-source-main">
                  <FileSpreadsheet size={20} />
                  <div>
                    <input value={source.name} onChange={(event) => updateSource(source.id, { name: event.target.value })} aria-label="来源名称" />
                    <span>{typeLabel(source.type)}</span>
                  </div>
                </div>
                <input className="sync-url-input" value={source.url} onChange={(event) => updateSource(source.id, { url: event.target.value })} aria-label="来源链接" />
                {source.type === "tencent_sheet" ? (
                  <input
                    className="sync-url-input"
                    value={source.updatedAtField || ""}
                    onChange={(event) => updateSource(source.id, { updatedAtField: event.target.value })}
                    placeholder="腾讯文档更新时间列名，例如 更新时间"
                  />
                ) : null}
                <FieldMapEditor source={source} onChange={(fieldMap) => updateSource(source.id, { fieldMap })} />
                <div className="sync-source-actions">
                  <label className="sync-toggle">
                    <input type="checkbox" checked={source.enabled} onChange={(event) => updateSource(source.id, { enabled: event.target.checked })} />
                    启用
                  </label>
                  <button className="sync-danger" onClick={() => deleteSource(source.id)} title="删除来源">
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))}
          </div>

          <div className="sync-add-source">
            <h3>添加来源</h3>
            <input value={sourceDraft.name} onChange={(event) => setSourceDraft((current) => ({ ...current, name: event.target.value }))} placeholder="来源名称" />
            <select value={sourceDraft.type} onChange={(event) => setSourceDraft((current) => ({ ...current, type: event.target.value }))}>
              {SOURCE_TYPES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <input value={sourceDraft.url} onChange={(event) => setSourceDraft((current) => ({ ...current, url: event.target.value }))} placeholder="表格链接" />
            {sourceDraft.type === "tencent_sheet" ? (
              <input
                value={sourceDraft.updatedAtField}
                onChange={(event) => setSourceDraft((current) => ({ ...current, updatedAtField: event.target.value }))}
                placeholder="更新时间列名，可先留空自动识别"
              />
            ) : null}
            <textarea
              value={sourceDraft.fieldMapText}
              onChange={(event) => setSourceDraft((current) => ({ ...current, fieldMapText: event.target.value }))}
              placeholder={'字段映射 JSON，例如：{"源字段名":"目标字段名"}'}
              rows={3}
            />
            <button className="sync-primary full" onClick={addSource} disabled={busy === "source"}>
              {busy === "source" ? <Loader2 className="sync-spin" size={18} /> : <Plus size={18} />}
              添加来源
            </button>
          </div>
        </aside>

        <section className="sync-result-panel">
          <div className="sync-section-head">
            <div>
              <h2>同步结果</h2>
              <p>每个来源独立执行，失败不会挡住其他来源。</p>
            </div>
            <span className="sync-run-badge">{busy === "sync" ? "运行中" : "手动同步"}</span>
          </div>

          {previewResult ? <PreviewBlock preview={previewResult} /> : null}

          {busy === "sync" ? (
            <div className="sync-empty">
              <Loader2 className="sync-spin" size={30} />
              <span>正在读取来源表格并写入目标表...</span>
            </div>
          ) : latestRun ? (
            <div className="sync-result-list">
              {(latestRun.results || []).map((item) => (
                <article key={`${latestRun.id}-${item.sourceId}`} className={clsx("sync-result-card", item.status)}>
                  <div className="sync-result-title">
                    <div>
                      {item.status === "ok" ? <CheckCircle2 size={20} /> : item.status === "skipped" ? <AlertCircle size={20} /> : <XCircle size={20} />}
                      <strong>{item.sourceName}</strong>
                    </div>
                    <span>{item.latestDate || "无日期"}</span>
                  </div>
                  <div className="sync-metrics">
                    <Metric label="读取" value={item.scanned} />
                    <Metric label="匹配" value={item.matched} />
                    <Metric label="新增" value={item.created} />
                    <Metric label="更新" value={item.updated} />
                    <Metric label="跳过" value={item.skipped} />
                  </div>
                  {item.error ? <p className="sync-error-text">{item.error}</p> : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="sync-empty">
              <Link2 size={28} />
              <span>还没有同步结果。点击“同步最新更新”开始。</span>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value }) {
  return (
    <div>
      <strong>{value ?? 0}</strong>
      <span>{label}</span>
    </div>
  );
}

function FieldMapEditor({ source, onChange }) {
  const [text, setText] = useState(JSON.stringify(source.fieldMap || {}, null, 2));

  useEffect(() => {
    setText(JSON.stringify(source.fieldMap || {}, null, 2));
  }, [source.id, source.fieldMap]);

  function save() {
    try {
      onChange(JSON.parse(text || "{}"));
    } catch {
      window.alert("字段映射必须是 JSON，例如 {\"源字段名\":\"目标字段名\"}");
    }
  }

  return (
    <div className="sync-map-editor">
      <textarea value={text} onChange={(event) => setText(event.target.value)} rows={3} placeholder={'字段映射 JSON，例如：{"源字段名":"目标字段名"}'} />
      <button className="sync-soft" onClick={save}>
        <Save size={15} />
        保存映射
      </button>
    </div>
  );
}

function PreviewBlock({ preview }) {
  return (
    <section className="sync-preview">
      <div className="sync-section-head">
        <div>
          <h2>测试采集结果</h2>
          <p>这里只读取来源表格，不写入目标表。每个来源最多显示 5 条样例。</p>
        </div>
      </div>
      <div className="sync-result-list">
        {(preview.results || []).map((item) => (
          <article key={`${preview.id}-${item.sourceId}`} className={clsx("sync-result-card", item.status)}>
            <div className="sync-result-title">
              <div>
                {item.status === "ok" ? <CheckCircle2 size={20} /> : item.status === "skipped" ? <AlertCircle size={20} /> : <XCircle size={20} />}
                <strong>{item.sourceName}</strong>
              </div>
              <span>{item.latestDate || "无日期"}</span>
            </div>
            <div className="sync-metrics compact">
              <Metric label="读取" value={item.scanned} />
              <Metric label="最新日条目" value={item.matched} />
              <Metric label="源字段" value={item.sourceFields?.length || 0} />
            </div>
            {item.error ? <p className="sync-error-text">{item.error}</p> : null}
            {item.mappedFields?.length ? (
              <div className="sync-field-list">
                {item.mappedFields.map((field) => (
                  <span key={`${field.sourceField}-${field.targetField}`}>
                    {field.sourceField} → {field.targetField}
                  </span>
                ))}
              </div>
            ) : null}
            {item.sampleRows?.length ? (
              <pre className="sync-sample">{JSON.stringify(item.sampleRows, null, 2)}</pre>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function typeLabel(type) {
  return SOURCE_TYPES.find((item) => item.value === type)?.label || type;
}

function summarizeRun(run) {
  const totals = (run.results || []).reduce(
    (sum, item) => ({
      created: sum.created + (item.created || 0),
      updated: sum.updated + (item.updated || 0),
      errors: sum.errors + (item.status === "error" ? 1 : 0)
    }),
    { created: 0, updated: 0, errors: 0 }
  );
  return `新增 ${totals.created}，更新 ${totals.updated}，失败 ${totals.errors}`;
}

function formatDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "medium", hour12: false }).format(new Date(value));
}

async function api(url, options = {}) {
  const body = options.body ? normalizeRequestBody(options.body) : undefined;
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (response.ok) return response.json();
  let message = "请求失败";
  try {
    const body = await response.json();
    message = body.error || message;
  } catch {}
  throw new Error(message);
}

function normalizeRequestBody(body) {
  if (!Object.prototype.hasOwnProperty.call(body, "fieldMapText")) return body;
  const { fieldMapText, ...rest } = body;
  try {
    return { ...rest, fieldMap: JSON.parse(fieldMapText || "{}") };
  } catch {
    throw new Error("字段映射必须是 JSON，例如 {\"源字段名\":\"目标字段名\"}");
  }
}
