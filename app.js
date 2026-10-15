(() => {
  const { apiUrl } = window.SITE_CONFIG;

  const $ = (id) => document.getElementById(id);
  const grid = $("grid"), dlg = $("dlg"), form = $("itemForm");
  let links = [];
  let code = sessionStorage.getItem("mh_code") || "";
  let editMode = false;
  let formMode = "add";   // "add" | "edit" | "auth"
  let editing = null;     // 수정 중인 항목
  const selected = new Set(); // 선택된 시트 행 번호

  const isHttp = (u) => /^https?:\/\//i.test(u || "");

  // Apps Script는 CORS 프리플라이트를 처리하지 못하므로 text/plain으로 전송
  async function call(payload) {
    const r = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ code, ...payload }),
    });
    return r.json();
  }

  // ---------- 자체 모달 (alert/confirm 대체) ----------
  function modal({ title, message, ok = "확인", cancel = null, danger = false }) {
    return new Promise((resolve) => {
      const d = $("mdlg"), okB = $("mOk"), cB = $("mCancel");
      $("mTitle").textContent = title;
      $("mMsg").textContent = message;
      okB.textContent = ok;
      okB.classList.toggle("danger", danger);
      okB.classList.toggle("primary", !danger);
      cB.hidden = !cancel;
      if (cancel) cB.textContent = cancel;
      const done = (v) => { okB.onclick = cB.onclick = d.oncancel = null; d.close(); resolve(v); };
      okB.onclick = () => done(true);
      cB.onclick = () => done(false);
      d.oncancel = (e) => { e.preventDefault(); done(false); }; // ESC
      d.showModal();
    });
  }

  // 서버 오류 코드 → 사용자 메시지
  function errText(res) {
    switch (res.error) {
      case "unauthorized": return "인증 코드가 올바르지 않아요.";
      case "locked": return "시도 횟수를 초과했어요. 잠시 후 다시 시도해 주세요.";
      case "invalid": return "입력값을 확인해 주세요.";
      case "stale": return "시트의 내용이 그 사이 바뀌었어요. 목록을 새로 불러올게요.";
      default: return "처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
    }
  }
  function dropAuth() {
    code = ""; sessionStorage.removeItem("mh_code");
    if (editMode) exitEdit();
  }

  // ---------- 목록 표시 ----------
  function setStatus(text) {
    $("empty").textContent = text;
    $("empty").hidden = !text;
  }

  function updateBar() {
    const n = selected.size;
    $("selCount").textContent = `${n}개 선택`;
    $("delBtn").disabled = n === 0;
    const all = links.filter((l) => l.row).length;
    $("selAllBtn").textContent = n && n === all ? "선택 해제" : "전체 선택";
  }

  function toggle(row) {
    selected.has(row) ? selected.delete(row) : selected.add(row);
    render();
  }

  function render() {
    grid.innerHTML = "";
    for (const l of links) {
      if (!isHttp(l.url)) continue; // javascript: 등 차단
      const card = document.createElement("article");
      card.className = "card";

      const img = document.createElement("img");
      img.className = "thumb"; img.loading = "lazy"; img.alt = "";
      if (isHttp(l.thumbnail)) img.src = l.thumbnail; // 없으면 그라데이션 배경
      img.onerror = () => img.removeAttribute("src");

      const body = document.createElement("div");
      body.className = "body";
      const h = document.createElement("h3"); h.textContent = l.title;
      const p = document.createElement("p"); p.textContent = l.description || "";
      const t = document.createElement("span"); t.className = "link"; t.textContent = l.url;

      let action;
      if (editMode && l.row) {
        card.classList.add("editing");
        card.classList.toggle("selected", selected.has(l.row));
        card.tabIndex = 0;
        card.setAttribute("role", "checkbox");
        card.setAttribute("aria-checked", selected.has(l.row));
        card.onclick = (e) => { if (!e.target.closest("button")) toggle(l.row); };
        card.onkeydown = (e) => {
          if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(l.row); }
        };
        const chk = document.createElement("span"); chk.className = "check";
        card.append(chk);
        action = document.createElement("button");
        action.type = "button"; action.className = "btn primary open"; action.textContent = "수정";
        action.onclick = () => openDlg("edit", l);
      } else {
        action = document.createElement("a");
        action.className = "btn primary open"; action.textContent = "열기";
        action.href = l.url; action.target = "_blank"; action.rel = "noopener noreferrer";
      }

      body.append(h, p, t, action);
      card.append(img, body);
      grid.append(card);
    }
    updateBar();
  }

  async function refresh() {
    const data = await (await fetch(apiUrl)).json();
    if (!Array.isArray(data)) throw new Error("bad data");
    links = data;
    localStorage.setItem("mh_links", JSON.stringify(links));
    selected.clear();
    render();
    setStatus(links.length ? "" : "아직 등록된 웹앱이 없어요.");
  }

  async function load() {
    if (!apiUrl) { setStatus("config.js에 apiUrl을 설정해 주세요."); return; }
    // 캐시된 목록이 있으면 먼저 보여주고(콜드 스타트 대비), 없으면 로딩 문구 표시
    try { links = JSON.parse(localStorage.getItem("mh_links") || "[]"); } catch { links = []; }
    render();
    setStatus(links.length ? "" : "불러오는 중...");
    try { await refresh(); }
    catch { setStatus(links.length ? "" : "목록을 불러오지 못했어요. 새로고침해 주세요."); }
  }

  // ---------- 편집 모드 ----------
  function enterEdit() {
    editMode = true; selected.clear();
    $("editBar").hidden = false; $("editBtn").hidden = true;
    render();
  }
  function exitEdit() {
    editMode = false; selected.clear();
    $("editBar").hidden = true; $("editBtn").hidden = false;
    render();
  }
  $("editBtn").onclick = () => (code ? enterEdit() : openDlg("auth"));
  $("doneBtn").onclick = exitEdit;
  $("selAllBtn").onclick = () => {
    const rows = links.filter((l) => l.row).map((l) => l.row);
    if (selected.size === rows.length) selected.clear(); else rows.forEach((r) => selected.add(r));
    render();
  };

  $("delBtn").onclick = async () => {
    const items = links.filter((l) => selected.has(l.row));
    if (!items.length) return;
    const ok = await modal({
      title: "삭제 확인",
      message: `선택한 ${items.length}개 항목을 삭제할까요? 삭제하면 되돌릴 수 없어요.`,
      ok: "삭제", cancel: "취소", danger: true,
    });
    if (!ok) return;
    const btn = $("delBtn");
    btn.disabled = true; btn.textContent = "삭제 중…";
    try {
      const res = await call({
        action: "delete",
        items: items.map(({ row, title, url }) => ({ row, title, url })),
      });
      if (!res.ok) {
        if (res.error === "unauthorized" || res.error === "locked") dropAuth();
        await modal({ title: "삭제하지 못했어요", message: errText(res) });
      }
      await refresh();
    } catch {
      await modal({ title: "오류", message: "서버에 연결하지 못했어요." });
    } finally { btn.textContent = "선택 삭제"; updateBar(); }
  };

  // ---------- 추가 / 수정 / 인증 모달 ----------
  const fields = $("fields"), saveBtn = $("saveBtn");

  function setUnlocked(on) {
    $("authBox").hidden = on;
    fields.disabled = !on;
    saveBtn.disabled = !on;
  }

  function openDlg(mode, item = null) {
    formMode = mode; editing = item;
    $("authMsg").textContent = ""; $("addMsg").textContent = "";
    $("token").value = "";
    form.reset();
    $("formTitle").textContent = { add: "웹앱 추가", edit: "웹앱 수정", auth: "편집 모드" }[mode];
    fields.hidden = mode === "auth";
    saveBtn.hidden = mode === "auth";
    $("cancelBtn").textContent = "취소";
    if (mode === "edit" && item) {
      form.elements.title.value = item.title;
      form.elements.description.value = item.description || "";
      form.elements.url.value = item.url;
      form.elements.thumbnail.value = item.thumbnail || "";
    }
    setUnlocked(!!code && mode !== "auth");
    dlg.showModal();
    (code ? form.elements.title : $("token")).focus();
  }
  $("addBtn").onclick = () => openDlg("add");
  $("cancelBtn").onclick = () => dlg.close();

  // 인증 확인
  async function verify() {
    const msg = $("authMsg"), btn = $("verifyBtn");
    const c = $("token").value.trim();
    if (!c) { msg.textContent = "인증 코드를 입력해 주세요."; return; }
    if (!apiUrl) { msg.textContent = "config.js에 apiUrl을 설정해 주세요."; return; }
    code = c; msg.textContent = ""; btn.disabled = true; btn.textContent = "확인 중…";
    try {
      const res = await call({ action: "verify" });
      if (res.ok) {
        sessionStorage.setItem("mh_code", code);
        if (formMode === "auth") { dlg.close(); enterEdit(); }
        else { setUnlocked(true); form.elements.title.focus(); }
      } else {
        code = ""; msg.textContent = errText(res);
      }
    } catch { code = ""; msg.textContent = "서버에 연결하지 못했어요."; }
    finally { btn.disabled = false; btn.textContent = "확인"; }
  }
  $("verifyBtn").onclick = verify;
  $("token").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); verify(); } };

  // 저장 (추가 / 수정)
  form.onsubmit = async (e) => {
    e.preventDefault();
    const msg = $("addMsg");
    if (!code || formMode === "auth") return;
    const f = Object.fromEntries(new FormData(form));
    const item = {
      title: (f.title || "").trim(), description: (f.description || "").trim(),
      url: (f.url || "").trim(), linkText: (editing && editing.linkText) || "",
      thumbnail: (f.thumbnail || "").trim(),
    };
    if (!item.title) { msg.textContent = "사이트 제목을 입력해 주세요."; return; }
    if (!isHttp(item.url) || (item.thumbnail && !isHttp(item.thumbnail))) {
      msg.textContent = "URL은 http:// 또는 https://로 시작해야 해요."; return;
    }
    saveBtn.disabled = true; msg.textContent = "저장 중…";
    try {
      const res = formMode === "edit"
        ? await call({ action: "update", row: editing.row, expect: { title: editing.title, url: editing.url }, item })
        : await call({ action: "add", item });
      if (!res.ok) {
        if (res.error === "unauthorized" || res.error === "locked") { dropAuth(); dlg.close(); }
        if (res.error === "stale") { dlg.close(); refresh().catch(() => {}); }
        throw new Error(errText(res));
      }
      await refresh();
      dlg.close();
    } catch (err) {
      msg.textContent = err.message || "오류가 발생했어요.";
      if (!code) await modal({ title: "인증이 필요해요", message: err.message });
    } finally { saveBtn.disabled = !code; }
  };

  load();
})();
