const SELECTION_KEY = "xhs-matrix-selection-v1";

const appState = {
  data: null,
  activeAccountId: null,
  activeWorkId: null,
  captionTimers: new Map(),
  toastTimer: null
};

const els = {
  accountList: document.querySelector("#account-list"),
  accountSummary: document.querySelector("#account-summary"),
  accountActions: document.querySelector("#account-actions"),
  metricsGrid: document.querySelector("#metrics-grid"),
  workTabs: document.querySelector("#work-tabs"),
  workDetail: document.querySelector("#work-detail"),
  toast: document.querySelector("#toast")
};

const formatter = new Intl.NumberFormat("zh-CN");

document.addEventListener("click", handleClick);
document.addEventListener("change", handleChange);
document.addEventListener("input", handleInput);
document.addEventListener("dragover", handleDragOver);
document.addEventListener("dragleave", handleDragLeave);
document.addEventListener("drop", handleDrop);

init().catch(handleError);

async function init() {
  await refreshState();
}

async function refreshState(options = {}) {
  const response = await fetch("/api/state");
  const data = await parseJson(response);
  appState.data = data;
  restoreSelection();
  syncSelection();
  if (options.nextWorkId) {
    appState.activeWorkId = options.nextWorkId;
  }
  persistSelection();
  render();
}

function restoreSelection() {
  const raw = localStorage.getItem(SELECTION_KEY);
  if (!raw) return;

  try {
    const saved = JSON.parse(raw);
    appState.activeAccountId = saved.activeAccountId || appState.activeAccountId;
    appState.activeWorkId = saved.activeWorkId || appState.activeWorkId;
  } catch (error) {
    console.warn("selection restore failed", error);
  }
}

function persistSelection() {
  localStorage.setItem(
    SELECTION_KEY,
    JSON.stringify({
      activeAccountId: appState.activeAccountId,
      activeWorkId: appState.activeWorkId
    })
  );
}

function syncSelection() {
  const accounts = appState.data?.accounts || [];
  if (!accounts.length) {
    appState.activeAccountId = null;
    appState.activeWorkId = null;
    return;
  }

  const account = accounts.find(item => item.id === appState.activeAccountId) || accounts[0];
  appState.activeAccountId = account.id;

  if (!account.works.length) {
    appState.activeWorkId = null;
    return;
  }

  const work = account.works.find(item => item.id === appState.activeWorkId) || account.works[0];
  appState.activeWorkId = work.id;
}

function currentAccount() {
  return (appState.data?.accounts || []).find(account => account.id === appState.activeAccountId) || null;
}

function currentWork() {
  return currentAccount()?.works.find(work => work.id === appState.activeWorkId) || null;
}

function render() {
  renderAccounts();
  renderSummary();
  renderMetrics();
  renderWorkTabs();
  renderWorkDetail();
}

function renderAccounts() {
  const accounts = appState.data?.accounts || [];
  if (!accounts.length) {
    els.accountList.innerHTML = `
      <div class="empty-state">
        <div>
          <h3>还没有账号</h3>
          <p>先创建一个账号，再开始整理作品素材。</p>
          <button class="primary-button" type="button" data-action="add-account">新增账号</button>
        </div>
      </div>
    `;
    return;
  }

  els.accountList.innerHTML = accounts.map(account => `
    <button class="account-button ${account.id === appState.activeAccountId ? "active" : ""}" type="button" data-action="select-account" data-account-id="${account.id}">
      <strong>${escapeHtml(account.name)}</strong>
      <span>${formatter.format(account.works.length)} 个作品 · ${formatter.format(countImages(account))} 张图 · ${formatter.format(countCaptions(account))} 条文案</span>
    </button>
  `).join("");
}

function renderSummary() {
  const account = currentAccount();
  if (!account) {
    els.accountSummary.innerHTML = "";
    els.accountActions.innerHTML = "";
    return;
  }

  const completed = account.works.filter(work => work.status === "done").length;
  els.accountSummary.innerHTML = `
    <p class="eyebrow">Current Account</p>
    <h2 class="hero-title">${escapeHtml(account.name)}</h2>
    <p class="hero-summary">当前账号共 ${formatter.format(account.works.length)} 个作品，已完成 ${formatter.format(completed)} 个。你可以继续往单个作品里堆图片和文案，也可以直接做整号复制，发到微信时更顺手。</p>
  `;

  els.accountActions.innerHTML = `
    <button class="ghost-button" type="button" data-action="rename-account">重命名账号</button>
    <button class="ghost-button" type="button" data-action="copy-account">全部复制</button>
    <button class="danger-button" type="button" data-action="delete-account">删除账号</button>
  `;
}

function renderMetrics() {
  const account = currentAccount();
  if (!account) {
    els.metricsGrid.innerHTML = "";
    return;
  }

  const completed = account.works.filter(work => work.status === "done").length;
  const images = countImages(account);
  const captions = countCaptions(account);
  const remaining = Math.max(account.works.length - completed, 0);

  const metrics = [
    { label: "作品总数", value: account.works.length, footnote: "当前账号下全部作品" },
    { label: "已完成", value: completed, footnote: "点完成后可继续下一个" },
    { label: "图片总数", value: images, footnote: "所有作品图片区汇总" },
    { label: "文案总数", value: captions, footnote: `还剩 ${formatter.format(remaining)} 个作品待推进` }
  ];

  els.metricsGrid.innerHTML = metrics.map(metric => `
    <article class="metric-card panel">
      <span class="metric-label">${metric.label}</span>
      <strong class="metric-value">${formatter.format(metric.value)}</strong>
      <span class="metric-footnote">${metric.footnote}</span>
    </article>
  `).join("");
}

function renderWorkTabs() {
  const account = currentAccount();
  if (!account) {
    els.workTabs.innerHTML = "";
    return;
  }

  if (!account.works.length) {
    els.workTabs.innerHTML = `
      <div class="empty-state">
        <div>
          <h3>这个账号还没有作品</h3>
          <p>给 ${escapeHtml(account.name)} 新建一个作品，就能开始上传图片和收纳文案。</p>
          <button class="primary-button" type="button" data-action="add-work">新增作品</button>
        </div>
      </div>
    `;
    return;
  }

  els.workTabs.innerHTML = account.works.map((work, index) => `
    <button class="work-tab ${work.id === appState.activeWorkId ? "active" : ""}" type="button" data-action="select-work" data-work-id="${work.id}">
      <div class="work-tab-main">
        <strong>${escapeHtml(work.name)}</strong>
        <span class="status-pill ${work.status === "done" ? "done" : "draft"}">
          <span class="status-dot"></span>
          ${work.status === "done" ? "已完成" : "进行中"}
        </span>
      </div>
      <span>作品 ${formatter.format(index + 1)} · ${formatter.format(work.images.length)} 张图 · ${formatter.format(work.captions.length)} 条文案</span>
    </button>
  `).join("");
}

function renderWorkDetail() {
  const account = currentAccount();
  const work = currentWork();
  if (!account || !work) {
    els.workDetail.innerHTML = `
      <div class="empty-state">
        <div>
          <h3>先选中一个作品</h3>
          <p>选中后就可以上传图片、添加文案、完成标记和下载。</p>
        </div>
      </div>
    `;
    return;
  }

  els.workDetail.innerHTML = `
    <div class="work-detail-shell">
      <div class="work-detail-head">
        <div>
          <p class="eyebrow">Current Work</p>
          <h2>${escapeHtml(work.name)}</h2>
          <p class="helper-text">图片区和文案区独立计数。标记完成后会自动跳到下一个作品，方便连续整理。</p>
        </div>
        <span class="status-pill ${work.status === "done" ? "done" : "draft"}">
          <span class="status-dot"></span>
          ${work.status === "done" ? "已完成" : "进行中"}
        </span>
      </div>

      <div class="split-actions">
        <div class="hero-actions">
          <button class="ghost-button" type="button" data-action="rename-work">重命名作品</button>
          <button class="primary-button" type="button" data-action="${work.status === "done" ? "reopen-work" : "complete-work"}">${work.status === "done" ? "取消完成" : "完成并去下一个"}</button>
        </div>
        <div class="hero-actions">
          <button class="ghost-button" type="button" data-action="copy-work">作品复制</button>
          <button class="ghost-button" type="button" data-action="download-work">作品下载</button>
          <button class="danger-button" type="button" data-action="delete-work">删除作品</button>
        </div>
      </div>

      <div class="zone-grid">
        <section class="zone-card">
          <div class="zone-head">
            <div>
              <h3>图片区</h3>
              <p class="helper-text">支持点击上传或拖拽到这里，图片会按账号 / 作品归档。</p>
            </div>
            <span class="status-pill draft">${formatter.format(work.images.length)} 张图片</span>
          </div>

          <label class="dropzone" data-dropzone>
            <input data-role="image-input" type="file" accept="image/*" multiple hidden>
            <div>
              <strong>拖拽图片到这里，或点击选择文件</strong>
              <p class="helper-text">图片会暂存在本地项目里，后续复制和下载都会直接用这些文件。</p>
            </div>
          </label>

          <div class="image-grid">
            ${work.images.length ? work.images.map(image => `
              <article class="image-card">
                <img src="${encodeURI(image.url)}" alt="${escapeHtml(image.name)}">
                <div class="image-card-body">
                  <span class="image-name">${escapeHtml(image.name)}</span>
                  <p class="image-meta">${formatBytes(image.size)} · ${formatDate(image.createdAt)}</p>
                  <div class="inline-actions">
                    <a class="ghost-button" href="${encodeURI(image.url)}" target="_blank" rel="noreferrer">查看</a>
                    <button class="danger-button" type="button" data-action="delete-image" data-image-id="${image.id}">删除</button>
                  </div>
                </div>
              </article>
            `).join("") : `
              <div class="empty-state">
                <div>
                  <h3>还没有图片素材</h3>
                  <p>先把作品需要发的小红书图片拖进来，后面复制和下载会更省事。</p>
                </div>
              </div>
            `}
          </div>
        </section>

        <section class="zone-card">
          <div class="zone-head">
            <div>
              <h3>文案区</h3>
              <p class="helper-text">每条文案单独保存，可以随时复制、编辑或删除。</p>
            </div>
            <span class="status-pill draft">${formatter.format(work.captions.length)} 条文案</span>
          </div>

          <textarea id="caption-draft" class="draft-input" placeholder="把作品文案贴到这里，支持多段内容，一次添加为 1 条文案。"></textarea>
          <div class="hero-actions" style="margin-top: 14px;">
            <button class="primary-button" type="button" data-action="add-caption">添加文案</button>
          </div>

          <div class="caption-list">
            ${work.captions.length ? work.captions.map((caption, index) => `
              <article class="caption-card">
                <div class="caption-card-head">
                  <span class="caption-index">文案 ${formatter.format(index + 1)}</span>
                  <div class="inline-actions">
                    <button class="ghost-button" type="button" data-action="copy-single-caption" data-caption-id="${caption.id}">复制</button>
                    <button class="danger-button" type="button" data-action="delete-caption" data-caption-id="${caption.id}">删除</button>
                  </div>
                </div>
                <textarea class="caption-entry" data-role="caption-editor" data-caption-id="${caption.id}" placeholder="编辑这条文案">${escapeHtml(caption.text)}</textarea>
              </article>
            `).join("") : `
              <div class="empty-state">
                <div>
                  <h3>还没有文案</h3>
                  <p>把标题、正文、评论区补充都拆成独立文案，发的时候会更快。</p>
                </div>
              </div>
            `}
          </div>
        </section>
      </div>
    </div>
  `;
}

async function handleClick(event) {
  const trigger = event.target.closest("[data-action]");
  if (!trigger) return;

  const action = trigger.dataset.action;

  try {
    if (action === "refresh") {
      await refreshState();
      showToast("数据已刷新");
      return;
    }

    if (action === "add-account") {
      await createAccount();
      return;
    }

    if (action === "select-account") {
      appState.activeAccountId = trigger.dataset.accountId;
      appState.activeWorkId = currentAccount()?.works[0]?.id || null;
      syncSelection();
      persistSelection();
      render();
      return;
    }

    if (action === "rename-account") {
      await renameAccount();
      return;
    }

    if (action === "delete-account") {
      await deleteAccount();
      return;
    }

    if (action === "copy-account") {
      await postAndToast(`/api/accounts/${currentAccount().id}/copy`, "该账号的图片和文案已写入系统剪贴板");
      return;
    }

    if (action === "add-work") {
      await createWork();
      return;
    }

    if (action === "select-work") {
      appState.activeWorkId = trigger.dataset.workId;
      persistSelection();
      render();
      return;
    }

    if (action === "rename-work") {
      await renameWork();
      return;
    }

    if (action === "complete-work") {
      await completeWorkAndAdvance();
      return;
    }

    if (action === "reopen-work") {
      await updateWork({ status: "draft" });
      showToast("作品已重新打开");
      return;
    }

    if (action === "delete-work") {
      await deleteWork();
      return;
    }

    if (action === "copy-work") {
      const account = currentAccount();
      const work = currentWork();
      await postAndToast(`/api/accounts/${account.id}/works/${work.id}/copy`, "作品的图片和文案已写入系统剪贴板");
      return;
    }

    if (action === "download-work") {
      await downloadWork();
      return;
    }

    if (action === "delete-image") {
      await deleteImage(trigger.dataset.imageId);
      return;
    }

    if (action === "add-caption") {
      await addCaption();
      return;
    }

    if (action === "delete-caption") {
      await deleteCaption(trigger.dataset.captionId);
      return;
    }

    if (action === "copy-single-caption") {
      await copySingleCaption(trigger.dataset.captionId);
    }
  } catch (error) {
    handleError(error);
  }
}

async function handleChange(event) {
  if (event.target.matches('[data-role="image-input"]')) {
    const files = Array.from(event.target.files || []);
    if (files.length) {
      await uploadImages(files);
      event.target.value = "";
    }
  }
}

function handleInput(event) {
  if (!event.target.matches('[data-role="caption-editor"]')) return;

  const captionId = event.target.dataset.captionId;
  const text = event.target.value;
  const timerId = appState.captionTimers.get(captionId);
  if (timerId) {
    clearTimeout(timerId);
  }

  appState.captionTimers.set(captionId, window.setTimeout(async () => {
    try {
      await patchCaption(captionId, text);
      appState.captionTimers.delete(captionId);
    } catch (error) {
      handleError(error);
    }
  }, 450));
}

function handleDragOver(event) {
  const dropzone = event.target.closest("[data-dropzone]");
  if (!dropzone) return;
  event.preventDefault();
  dropzone.classList.add("dragover");
}

function handleDragLeave(event) {
  const dropzone = event.target.closest("[data-dropzone]");
  if (!dropzone) return;
  if (dropzone.contains(event.relatedTarget)) return;
  dropzone.classList.remove("dragover");
}

async function handleDrop(event) {
  const dropzone = event.target.closest("[data-dropzone]");
  if (!dropzone) return;
  event.preventDefault();
  dropzone.classList.remove("dragover");
  const files = Array.from(event.dataTransfer?.files || []).filter(file => file.type.startsWith("image/"));
  if (!files.length) {
    showToast("这里只支持图片文件");
    return;
  }
  await uploadImages(files);
}

async function createAccount() {
  const name = window.prompt("输入账号名，例如 妮妮 / kola");
  if (!name || !name.trim()) return;

  const response = await fetch("/api/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim() })
  });

  const data = await parseJson(response);
  appState.activeAccountId = data.account.id;
  appState.activeWorkId = data.account.works[0]?.id || null;
  await refreshState();
  showToast(`账号 ${name.trim()} 已创建`);
}

async function renameAccount() {
  const account = currentAccount();
  if (!account) return;
  const name = window.prompt("新的账号名", account.name);
  if (!name || !name.trim() || name.trim() === account.name) return;

  await fetchJson(`/api/accounts/${account.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim() })
  });
  await refreshState();
  showToast("账号名已更新");
}

async function deleteAccount() {
  const account = currentAccount();
  if (!account) return;
  const confirmed = window.confirm(`确认删除账号“${account.name}”吗？该账号下所有作品、图片和文案都会一起删除。`);
  if (!confirmed) return;

  await fetchJson(`/api/accounts/${account.id}`, { method: "DELETE" });
  appState.activeAccountId = null;
  appState.activeWorkId = null;
  await refreshState();
  showToast("账号已删除");
}

async function createWork() {
  const account = currentAccount();
  if (!account) return;
  const name = window.prompt("作品名称", `作品${account.works.length + 1}`);
  if (!name || !name.trim()) return;

  const data = await fetchJson(`/api/accounts/${account.id}/works`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim() })
  });

  appState.activeWorkId = data.work.id;
  await refreshState();
  showToast("作品已创建");
}

async function renameWork() {
  const work = currentWork();
  if (!work) return;
  const name = window.prompt("新的作品名称", work.name);
  if (!name || !name.trim() || name.trim() === work.name) return;

  await updateWork({ name: name.trim() });
  showToast("作品名已更新");
}

async function updateWork(payload) {
  const account = currentAccount();
  const work = currentWork();
  if (!account || !work) return;

  await fetchJson(`/api/accounts/${account.id}/works/${work.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  await refreshState();
}

async function completeWorkAndAdvance() {
  const account = currentAccount();
  const work = currentWork();
  if (!account || !work) return;

  const works = account.works;
  const index = works.findIndex(item => item.id === work.id);
  const nextCandidate = works.slice(index + 1).find(item => item.status !== "done") || works[index + 1] || works[index];

  await fetchJson(`/api/accounts/${account.id}/works/${work.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "done" })
  });

  appState.activeWorkId = nextCandidate?.id || work.id;
  await refreshState({ nextWorkId: appState.activeWorkId });
  showToast(nextCandidate?.id !== work.id ? "作品已完成，已切到下一个作品" : "作品已完成");
}

async function deleteWork() {
  const account = currentAccount();
  const work = currentWork();
  if (!account || !work) return;
  const confirmed = window.confirm(`确认删除作品“${work.name}”吗？该作品下的图片和文案都会清空。`);
  if (!confirmed) return;

  await fetchJson(`/api/accounts/${account.id}/works/${work.id}`, { method: "DELETE" });
  appState.activeWorkId = null;
  await refreshState();
  showToast("作品已删除");
}

async function uploadImages(files) {
  const account = currentAccount();
  const work = currentWork();
  if (!account || !work) return;

  const formData = new FormData();
  files.forEach(file => formData.append("images", file));

  await fetchJson(`/api/accounts/${account.id}/works/${work.id}/images`, {
    method: "POST",
    body: formData
  });

  await refreshState();
  showToast(`已上传 ${files.length} 张图片`);
}

async function deleteImage(imageId) {
  const account = currentAccount();
  const work = currentWork();
  if (!account || !work || !imageId) return;

  await fetchJson(`/api/accounts/${account.id}/works/${work.id}/images/${imageId}`, {
    method: "DELETE"
  });

  await refreshState();
  showToast("图片已删除");
}

async function addCaption() {
  const account = currentAccount();
  const work = currentWork();
  const draft = document.querySelector("#caption-draft");
  if (!account || !work || !draft) return;

  const text = draft.value.trim();
  if (!text) {
    showToast("先输入文案内容");
    return;
  }

  await fetchJson(`/api/accounts/${account.id}/works/${work.id}/captions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });

  draft.value = "";
  await refreshState();
  showToast("文案已添加");
}

async function patchCaption(captionId, text) {
  const account = currentAccount();
  const work = currentWork();
  if (!account || !work || !captionId) return;

  await fetchJson(`/api/accounts/${account.id}/works/${work.id}/captions/${captionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
}

async function deleteCaption(captionId) {
  const account = currentAccount();
  const work = currentWork();
  if (!account || !work || !captionId) return;

  await fetchJson(`/api/accounts/${account.id}/works/${work.id}/captions/${captionId}`, {
    method: "DELETE"
  });

  await refreshState();
  showToast("文案已删除");
}

async function copySingleCaption(captionId) {
  const work = currentWork();
  const caption = work?.captions.find(item => item.id === captionId);
  if (!caption) return;

  await navigator.clipboard.writeText(caption.text);
  showToast("单条文案已复制");
}

async function downloadWork() {
  const account = currentAccount();
  const work = currentWork();
  if (!account || !work) return;

  await fetchJson(`/api/accounts/${account.id}/works/${work.id}/copy-caption`, { method: "POST" });
  window.location.href = `/api/accounts/${account.id}/works/${work.id}/download?ts=${Date.now()}`;
  showToast("作品图片开始下载，文案已复制");
}

async function postAndToast(url, message) {
  await fetchJson(url, { method: "POST" });
  showToast(message);
}

function countImages(account) {
  return account.works.reduce((sum, work) => sum + work.images.length, 0);
}

function countCaptions(account) {
  return account.works.reduce((sum, work) => sum + work.captions.length, 0);
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function showToast(message) {
  if (!message) return;
  els.toast.textContent = message;
  els.toast.classList.add("show");
  if (appState.toastTimer) {
    clearTimeout(appState.toastTimer);
  }
  appState.toastTimer = window.setTimeout(() => {
    els.toast.classList.remove("show");
  }, 2600);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  return parseJson(response);
}

async function parseJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "请求失败，请稍后重试");
  }
  return data;
}

function handleError(error) {
  console.error(error);
  showToast(error.message || "发生错误，请稍后再试");
}
