"use client";

import clsx from "clsx";
import {
  Check,
  Clipboard,
  Download,
  ImagePlus,
  Loader2,
  PenLine,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  UserRound,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const SELECTION_KEY = "xhs-matrix-selection-v5";

export default function Home() {
  const [data, setData] = useState({ accounts: [] });
  const [activeAccountId, setActiveAccountId] = useState(null);
  const [activeWorkId, setActiveWorkId] = useState(null);
  const [accountName, setAccountName] = useState("");
  const [captionText, setCaptionText] = useState("");
  const [captionEdits, setCaptionEdits] = useState({});
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef(null);
  const toastTimerRef = useRef(null);

  const accounts = data.accounts || [];
  const activeAccount = useMemo(
    () => accounts.find((account) => account.id === activeAccountId) || accounts[0] || null,
    [accounts, activeAccountId]
  );
  const activeWork = useMemo(
    () => activeAccount?.works?.find((work) => work.id === activeWorkId) || activeAccount?.works?.[0] || null,
    [activeAccount, activeWorkId]
  );
  const stats = activeAccount ? getAccountStats(activeAccount) : { works: 0, done: 0, images: 0, captions: 0 };

  useEffect(() => {
    const saved = readSelection();
    setActiveAccountId(saved.activeAccountId);
    setActiveWorkId(saved.activeWorkId);
    refresh(saved);
  }, []);

  useEffect(() => {
    if (!activeAccount) return;
    if (activeAccount.id !== activeAccountId) setActiveAccountId(activeAccount.id);
    if (activeWork?.id !== activeWorkId) setActiveWorkId(activeWork?.id || null);
    localStorage.setItem(
      SELECTION_KEY,
      JSON.stringify({ activeAccountId: activeAccount.id, activeWorkId: activeWork?.id || null })
    );
  }, [activeAccount, activeAccountId, activeWork, activeWorkId]);

  useEffect(() => {
    function handlePaste(event) {
      const files = Array.from(event.clipboardData?.items || [])
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter(Boolean);
      if (!files.length) return;
      event.preventDefault();
      uploadImages(files);
    }

    function handleDragOver(event) {
      event.preventDefault();
      setDragging(true);
    }

    function handleDragLeave(event) {
      if (!event.relatedTarget) setDragging(false);
    }

    function handleDrop(event) {
      event.preventDefault();
      setDragging(false);
      uploadImages(event.dataTransfer?.files);
    }

    window.addEventListener("paste", handlePaste);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("paste", handlePaste);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, [activeAccount?.id, activeWork?.id]);

  async function refresh(preferred = {}) {
    const next = await api("/api/state");
    setData(next);
    const account =
      next.accounts?.find((item) => item.id === preferred.activeAccountId) ||
      next.accounts?.find((item) => item.id === activeAccountId) ||
      next.accounts?.[0] ||
      null;
    const work =
      account?.works?.find((item) => item.id === preferred.activeWorkId) ||
      account?.works?.find((item) => item.id === activeWorkId) ||
      account?.works?.[0] ||
      null;
    setActiveAccountId(account?.id || null);
    setActiveWorkId(work?.id || null);
  }

  async function run(label, action) {
    setBusy(label);
    try {
      await action();
    } catch (error) {
      showToast(error.message || "操作失败");
    } finally {
      setBusy("");
    }
  }

  function showToast(message) {
    setToast(message);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 2400);
  }

  async function addAccount() {
    const name = accountName.trim();
    if (!name) return showToast("先输入账号名");
    await run("account", async () => {
      const result = await api("/api/accounts", { method: "POST", body: { name } });
      setAccountName("");
      await refresh({ activeAccountId: result.account.id, activeWorkId: result.account.works?.[0]?.id });
      showToast("账号已创建");
    });
  }

  async function renameAccount() {
    if (!activeAccount) return;
    const name = window.prompt("新的账号名", activeAccount.name);
    if (!name?.trim()) return;
    await run("rename-account", async () => {
      await api(`/api/accounts/${activeAccount.id}`, { method: "PATCH", body: { name } });
      await refresh({ activeAccountId: activeAccount.id, activeWorkId: activeWork?.id });
      showToast("账号已重命名");
    });
  }

  async function deleteAccount() {
    if (!activeAccount) return;
    if (!window.confirm(`删除账号「${activeAccount.name}」以及它的全部素材？`)) return;
    await run("delete-account", async () => {
      await api(`/api/accounts/${activeAccount.id}`, { method: "DELETE" });
      await refresh();
      showToast("账号已删除");
    });
  }

  async function resetWorks() {
    if (!activeAccount) return;
    if (!window.confirm(`重置「${activeAccount.name}」的 5 个作品？当前图片和文案会被清空。`)) return;
    await run("reset", async () => {
      const result = await api(`/api/accounts/${activeAccount.id}/reset-works`, { method: "POST" });
      setCaptionText("");
      setCaptionEdits({});
      await refresh({ activeAccountId: activeAccount.id, activeWorkId: result.account.works?.[0]?.id });
      showToast("当前账号已重置");
    });
  }

  async function resetAllWorks() {
    if (!accounts.length) return;
    if (!window.confirm("重置所有账号的全部作品？所有图片和文案都会被清空。")) return;
    await run("reset-all", async () => {
      const result = await api("/api/reset-all", { method: "POST" });
      const firstAccount = result.accounts?.[0] || null;
      setCaptionText("");
      setCaptionEdits({});
      await refresh({ activeAccountId: firstAccount?.id, activeWorkId: firstAccount?.works?.[0]?.id });
      showToast("所有账号已重置");
    });
  }

  async function renameWork() {
    if (!activeAccount || !activeWork) return;
    const name = window.prompt("新的作品名", activeWork.name);
    if (!name?.trim()) return;
    await run("rename-work", async () => {
      await api(`/api/accounts/${activeAccount.id}/works/${activeWork.id}`, { method: "PATCH", body: { name } });
      await refresh({ activeAccountId: activeAccount.id, activeWorkId: activeWork.id });
      showToast("作品已重命名");
    });
  }

  async function completeWork() {
    if (!activeAccount || !activeWork) return;
    await run("complete", async () => {
      const nextStatus = activeWork.status === "done" ? "draft" : "done";
      await api(`/api/accounts/${activeAccount.id}/works/${activeWork.id}`, {
        method: "PATCH",
        body: { status: nextStatus }
      });
      const nextWork = activeAccount.works.find((work) => work.id !== activeWork.id && work.status !== "done");
      await refresh({ activeAccountId: activeAccount.id, activeWorkId: nextStatus === "done" ? nextWork?.id : activeWork.id });
      showToast(nextStatus === "done" ? "已完成，进入下一个作品" : "已恢复为进行中");
    });
  }

  async function uploadImages(files) {
    if (!activeAccount || !activeWork) return showToast("先选择账号和作品");
    const images = Array.from(files || []).filter((file) => file?.type?.startsWith("image/"));
    if (!images.length) return;
    await run("upload", async () => {
      const formData = new FormData();
      images.forEach((file) => formData.append("images", file));
      await fetch(`/api/accounts/${activeAccount.id}/works/${activeWork.id}/images`, {
        method: "POST",
        body: formData
      }).then(ensureOk);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await refresh({ activeAccountId: activeAccount.id, activeWorkId: activeWork.id });
      showToast(`已加入 ${images.length} 张图片`);
    });
  }

  async function deleteImage(imageId) {
    if (!activeAccount || !activeWork) return;
    await run("delete-image", async () => {
      await api(`/api/accounts/${activeAccount.id}/works/${activeWork.id}/images/${imageId}`, { method: "DELETE" });
      await refresh({ activeAccountId: activeAccount.id, activeWorkId: activeWork.id });
      showToast("图片已删除");
    });
  }

  async function addCaption() {
    if (!activeAccount || !activeWork) return;
    const text = captionText.trim();
    if (!text) return showToast("先写文案");
    await run("caption", async () => {
      await api(`/api/accounts/${activeAccount.id}/works/${activeWork.id}/captions`, { method: "POST", body: { text } });
      setCaptionText("");
      await refresh({ activeAccountId: activeAccount.id, activeWorkId: activeWork.id });
      showToast("文案已加入");
    });
  }

  async function saveCaption(caption) {
    if (!activeAccount || !activeWork) return;
    const text = (captionEdits[caption.id] ?? caption.text).trim();
    if (!text) return showToast("文案不能为空");
    await run("save-caption", async () => {
      await api(`/api/accounts/${activeAccount.id}/works/${activeWork.id}/captions/${caption.id}`, {
        method: "PATCH",
        body: { text }
      });
      await refresh({ activeAccountId: activeAccount.id, activeWorkId: activeWork.id });
      showToast("文案已保存");
    });
  }

  async function deleteCaption(captionId) {
    if (!activeAccount || !activeWork) return;
    await run("delete-caption", async () => {
      await api(`/api/accounts/${activeAccount.id}/works/${activeWork.id}/captions/${captionId}`, { method: "DELETE" });
      await refresh({ activeAccountId: activeAccount.id, activeWorkId: activeWork.id });
      showToast("文案已删除");
    });
  }

  async function copyWork() {
    if (!activeAccount || !activeWork) return;
    await copyBundle([activeWork], "作品已复制");
  }

  async function copyAccount() {
    if (!activeAccount) return;
    await copyBundle(activeAccount.works || [], "账号内容已复制");
  }

  async function copyBundle(works, message) {
    await run("copy", async () => {
      const imageUrls = works.flatMap((work) => (work.images || []).map((image) => absoluteUrl(image.url)));
      const text = buildCopyText(activeAccount, works);
      const copied = imageUrls.length > 0
        ? await writeRichBundleToClipboard(imageUrls, text)
        : await writeClipboardText(text);
      if (!copied) throw new Error("浏览器阻止了剪贴板，请先点击页面后再试");
      showToast(imageUrls.length > 0 ? `${message}，已复制全部图片和文案` : `${message}，已复制文案`);
    });
  }

  async function downloadWork() {
    if (!activeAccount || !activeWork) return;
    await run("download", async () => {
      const captions = (activeWork.captions || []).map((caption) => caption.text).join("\n\n");
      if (captions) await writeClipboardText(captions);
      const link = document.createElement("a");
      link.href = `/api/accounts/${activeAccount.id}/works/${activeWork.id}/download`;
      link.download = `${activeAccount.name}-${activeWork.name}.zip`;
      link.click();
      showToast(captions ? "图片已下载，文案已复制" : "图片已下载");
    });
  }

  return (
    <main className="app-shell">
      <div className={clsx("drop-overlay", dragging && "show")}>
        <div>
          <ImagePlus size={30} />
          <strong>松手添加到当前作品</strong>
          <span>也可以直接 Ctrl+V 粘贴截图或图片</span>
        </div>
      </div>

      <header className="top-bar">
        <div className="brand">
          <span className="brand-mark">X</span>
          <div>
            <p>小红书素材台</p>
            <strong>Matrix Studio</strong>
          </div>
        </div>
        <div className="new-account">
          <UserRound size={16} />
          <input
            value={accountName}
            onChange={(event) => setAccountName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && addAccount()}
            placeholder="新增账号"
          />
          <button className="icon-button primary" onClick={addAccount} title="新增账号">
            {busy === "account" ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
          </button>
        </div>
      </header>

      <section className="matrix">
        <aside className="sidebar">
          <div className="sidebar-head">
            <span>账号</span>
            <button className="plain-button" onClick={renameAccount} disabled={!activeAccount}>
              <PenLine size={14} /> 改名
            </button>
          </div>
          <div className="account-list">
            {accounts.map((account) => {
              const accountStats = getAccountStats(account);
              return (
                <button
                  key={account.id}
                  className={clsx("account-row", account.id === activeAccount?.id && "active")}
                  onClick={() => {
                    setActiveAccountId(account.id);
                    setActiveWorkId(account.works?.[0]?.id || null);
                  }}
                >
                  <span>{account.name.slice(0, 1).toUpperCase()}</span>
                  <strong>{account.name}</strong>
                  <small>
                    {accountStats.done}/{accountStats.works} 完成 · {accountStats.images} 图
                  </small>
                </button>
              );
            })}
          </div>
          <div className="sidebar-actions">
            <button className="soft-command" onClick={resetAllWorks}>
              <RotateCcw size={15} /> 全部重置
            </button>
          </div>
        </aside>

        <section className="work-column">
          {activeAccount ? (
            <>
              <section className="account-card">
                <div>
                  <p>Account</p>
                  <h1>{activeAccount.name}</h1>
                  <span>
                    {stats.done}/{stats.works} 完成 · {stats.images} 张图片 · {stats.captions} 条文案
                  </span>
                </div>
                <button className="soft-command danger" onClick={deleteAccount}>
                  <Trash2 size={15} /> 删除账号
                </button>
              </section>

              <nav className="work-strip" aria-label="作品列表">
                {(activeAccount.works || []).map((work, index) => (
                  <button
                    key={work.id}
                    className={clsx("work-pill", work.id === activeWork?.id && "active", work.status === "done" && "done")}
                    onClick={() => setActiveWorkId(work.id)}
                  >
                    <span>{index + 1}</span>
                    <strong>{work.name}</strong>
                    <small>
                      {(work.images || []).length} 图 · {(work.captions || []).length} 文案
                    </small>
                  </button>
                ))}
              </nav>
            </>
          ) : (
            <section className="empty-state">先创建一个账号</section>
          )}
        </section>

        <section className="workspace">
          {activeAccount && activeWork ? (
            <>
              <section className="quick-actions">
                <button className="primary-button" onClick={copyAccount}>
                  <Clipboard size={15} /> 复制账号原图
                </button>
                <button className="secondary-button" onClick={resetWorks}>
                  <RotateCcw size={15} /> 重置当前账号
                </button>
              </section>

              <section className="studio-panel">
                <div className="studio-head">
                  <div>
                    <p>{activeWork.status === "done" ? "已完成" : "进行中"}</p>
                    <h2>{activeWork.name}</h2>
                  </div>
                  <div className="toolbar">
                    <button className="secondary-button" onClick={renameWork}>
                      <PenLine size={15} /> 改名
                    </button>
                    <button className="primary-button" onClick={completeWork}>
                      <Check size={15} /> {activeWork.status === "done" ? "取消完成" : "完成"}
                    </button>
                    <button className="secondary-button" onClick={copyWork}>
                      <Clipboard size={15} /> 复制原图
                    </button>
                    <button className="secondary-button" onClick={downloadWork}>
                      <Download size={15} /> 下载图片
                    </button>
                  </div>
                </div>

                <div className="materials">
                  <section
                    className="material-section"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      uploadImages(event.dataTransfer.files);
                    }}
                  >
                    <div className="section-title">
                      <div>
                        <h3>图片</h3>
                        <p>{(activeWork.images || []).length} 张素材</p>
                      </div>
                      <button className="icon-button primary" onClick={() => fileInputRef.current?.click()} title="上传图片">
                        {busy === "upload" ? <Loader2 className="spin" size={16} /> : <ImagePlus size={16} />}
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        hidden
                        onChange={(event) => uploadImages(event.target.files)}
                      />
                    </div>
                    <button className="drop-zone" onClick={() => fileInputRef.current?.click()}>
                      <ImagePlus size={20} />
                      <span>点击上传、全屏拖入或 Ctrl+V 粘贴</span>
                    </button>
                    <div className="image-grid">
                      {(activeWork.images || []).map((image) => (
                        <figure key={image.id} className="image-card">
                          <img src={image.url} alt={image.name} />
                          <figcaption>
                            <span>{image.name}</span>
                            <button onClick={() => deleteImage(image.id)} title="删除图片">
                              <X size={14} />
                            </button>
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  </section>

                  <section className="material-section">
                    <div className="section-title">
                      <div>
                        <h3>文案</h3>
                        <p>{(activeWork.captions || []).length} 条内容</p>
                      </div>
                    </div>
                    <div className="caption-compose">
                      <textarea
                        value={captionText}
                        onChange={(event) => setCaptionText(event.target.value)}
                        placeholder="标题、正文、话题标签"
                        rows={5}
                      />
                      <button className="primary-button" onClick={addCaption}>
                        <Plus size={15} /> 添加文案
                      </button>
                    </div>
                    <div className="caption-list">
                      {(activeWork.captions || []).map((caption, index) => (
                        <article key={caption.id} className="caption-card">
                          <div>
                            <strong>文案 {index + 1}</strong>
                            <span>{caption.text.length} 字</span>
                          </div>
                          <textarea
                            value={captionEdits[caption.id] ?? caption.text}
                            onChange={(event) =>
                              setCaptionEdits((current) => ({ ...current, [caption.id]: event.target.value }))
                            }
                            rows={4}
                          />
                          <div className="caption-actions">
                            <button onClick={() => saveCaption(caption)}>
                              <Save size={14} /> 保存
                            </button>
                            <button onClick={() => deleteCaption(caption.id)}>
                              <Trash2 size={14} /> 删除
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                </div>
              </section>
            </>
          ) : (
            <section className="empty-state">选择一个账号开始整理</section>
          )}
        </section>
      </section>

      <div className={clsx("toast", toast && "show")}>{toast}</div>
    </main>
  );
}

function getAccountStats(account) {
  const works = account.works || [];
  return {
    works: works.length,
    done: works.filter((work) => work.status === "done").length,
    images: works.reduce((sum, work) => sum + (work.images || []).length, 0),
    captions: works.reduce((sum, work) => sum + (work.captions || []).length, 0)
  };
}

function buildCopyText(account, works) {
  return works
    .map((work, index) => {
      const captions = (work.captions || [])
        .map((caption, captionIndex) => `文案${captionIndex + 1}：\n${caption.text}`)
        .join("\n\n");
      return [`【${account.name} / ${work.name || `作品${index + 1}`}】`, captions].filter(Boolean).join("\n\n");
    })
    .join("\n\n----------------\n\n");
}

async function writeRichBundleToClipboard(imageUrls, text) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    return false;
  }

  try {
    const dataUrls = [];
    for (const url of imageUrls.slice(0, 30)) {
      const blob = await imageUrlToPngBlob(url);
      dataUrls.push(await blobToDataUrl(blob));
    }

    const html = buildClipboardHtml(text, dataUrls);
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" })
      })
    ]);
    return true;
  } catch {
    return false;
  }
}

function buildClipboardHtml(text, dataUrls) {
  const paragraphs = escapeHtml(text)
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, "<br>")}</p>`)
    .join("");
  const images = dataUrls
    .map((url) => `<p><img src="${url}" style="max-width:100%;height:auto;display:block;" /></p>`)
    .join("");

  return `<!doctype html><html><body>${paragraphs}${images}</body></html>`;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function imageUrlToPngBlob(url) {
  const sourceBlob = await fetch(url).then((response) => {
    if (!response.ok) throw new Error("图片读取失败");
    return response.blob();
  });
  const bitmap = await createImageBitmap(sourceBlob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("图片转换失败"));
    }, "image/png");
  });
}

async function writeClipboardText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}

function absoluteUrl(url) {
  if (typeof window === "undefined") return url;
  return new URL(url, window.location.origin).toString();
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  await ensureOk(response);
  return response.json();
}

async function ensureOk(response) {
  if (response.ok) return;
  let message = "请求失败";
  try {
    const body = await response.json();
    message = body.error || message;
  } catch {}
  throw new Error(message);
}

function readSelection() {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(SELECTION_KEY) || "{}");
  } catch {
    return {};
  }
}
