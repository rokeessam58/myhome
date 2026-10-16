// 관리자 페이지: 링크 추가·수정·삭제, 그룹 관리, 드래그로 순서/그룹 이동
(() => {
  const { apiUrl } = window.SITE_CONFIG;
  const $ = (id) => document.getElementById(id);
  const board = $("board"), dlg = $("dlg"), form = $("itemForm");
  const UNGROUPED = "기타";

  let code = sessionStorage.getItem("mh_code") || "";
  // model: 화면에 보이는 배치. groups[].rows / loose = 시트 행 번호 배열
  let model = { groups: [], loose: [] };
  const byRow = new Map();     // 행 번호 → 링크 데이터
  const selected = new Set();  // 선택된 행 번호
  let nextGid = 1, dirty = false, sortables = [];
  let formMode = "add", editing = null;

  const isHttp = (u) => /^https?:\/\//i.test(u || "");
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  // ---------- 서버 통신 ----------
  // Apps Script는 CORS 프리플라이트를 처리하지 못하므로 text/plain으로 전송
  async function call(payload) {
    const r = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ code, ...payload }),
    });
    return r.json();
  }

  function errText(res) {
    switch (res.error) {
      case "unauthorized": return "인증 코드가 올바르지 않아요.";
      case "locked": return "시도 횟수를 초과했어요. 잠시 후 다시 시도해 주세요.";
      case "invalid": return "입력값을 확인해 주세요.";
      case "stale": return "시트의 내용이 그 사이 바뀌었어요. 목록을 새로 불러올게요.";
      default: return "처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
    }
  }

  // 쓰기 요청 공통 처리: 성공하면 res, 실패하면 안내 모달을 띄우고 null
  async function api(payload) {
    api.last = "";
    let res;
    try { res = await call(payload); }
    catch { api.last = "network"; await modal({ title: "오류", message: "서버에 연결하지 못했어요." }); return null; }
    if (res.ok) return res;
    api.last = res.error;
    if (res.error === "unauthorized" || res.error === "locked") dropAuth();
    await modal({ title: "처리하지 못했어요", message: errText(res) });
    if (res.error === "stale") await reload().catch(() => {});
    return null;
  }

  // ---------- 자체 모달 / 토스트 ----------
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

  let toastTimer;
  function toast(text) {
    const t = $("toast");
    t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2200);
  }

  // 한 줄 텍스트 입력 모달 (그룹 이름용). 취소하면 null
  function askText({ title, value = "", ok = "확인", validate }) {
    return new Promise((resolve) => {
      const d = $("pdlg"), f = $("pForm"), input = $("pInput");
      $("pTitle").textContent = title; $("pOk").textContent = ok;
      input.value = value; $("pMsg").textContent = "";
      const done = (v) => { f.onsubmit = $("pCancel").onclick = d.oncancel = null; d.close(); resolve(v); };
      f.onsubmit = (e) => {
        e.preventDefault();
        const v = input.value.trim();
        const err = validate(v);
        if (err) { $("pMsg").textContent = err; return; }
        done(v);
      };
      $("pCancel").onclick = () => done(null);
      d.oncancel = (e) => { e.preventDefault(); done(null); };
      d.showModal();
      input.focus(); input.select();
    });
  }

  // ---------- 데이터 로드 / 모델 ----------
  const normalize = (d) =>
    Array.isArray(d) ? { groups: [], links: d } : { groups: d.groups || [], links: d.links || [] };

  function buildModel(d) {
    byRow.clear();
    const gs = d.groups.map((name) => ({ id: nextGid++, name, rows: [] }));
    const loose = [];
    const sorted = d.links.filter((l) => l.row)
      .sort((a, b) => (a.order || 0) - (b.order || 0) || a.row - b.row);
    for (const l of sorted) {
      byRow.set(l.row, l);
      const g = gs.find((x) => x.name === l.group);
      (g ? g.rows : loose).push(l.row);
    }
    model = { groups: gs, loose };
    for (const r of [...selected]) if (!byRow.has(r)) selected.delete(r);
  }

  async function reload() {
    const raw = await (await fetch(apiUrl)).json();
    if (!Array.isArray(raw) && !Array.isArray(raw.links)) throw new Error("bad data");
    buildModel(normalize(raw));
    setDirty(false);
    render();
  }

  function setDirty(v) {
    dirty = v;
    $("saveBar").hidden = !v;
  }

  // ---------- 화면 그리기 ----------
  function cardEl(row) {
    const l = byRow.get(row);
    const card = el("article", "card");
    card.dataset.row = row;

    const pick = el("label", "pick");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = selected.has(row);
    cb.setAttribute("aria-label", `${l.title} 선택`);
    cb.onchange = () => { cb.checked ? selected.add(row) : selected.delete(row); updateSel(); };
    pick.append(cb, el("span", "box"));

    const handle = el("button", "chandle", "⠿");
    handle.type = "button"; handle.title = "끌어서 이동";
    handle.setAttribute("aria-label", "끌어서 이동");

    const img = el("img", "thumb");
    img.loading = "lazy"; img.alt = "";
    if (isHttp(l.thumbnail)) img.src = l.thumbnail;
    img.onerror = () => img.removeAttribute("src");

    const body = el("div", "body");
    const edit = el("button", "btn open", "수정");
    edit.type = "button";
    edit.onclick = () => openForm("edit", l);
    body.append(el("h3", "", l.title), el("p", "", l.description || ""), el("span", "link", l.url), edit);

    card.append(pick, handle, img, body);
    return card;
  }

  function groupEl(g) {
    const ungrouped = !g;
    const sec = el("section", "group" + (ungrouped ? " ungrouped" : ""));
    const rows = ungrouped ? model.loose : g.rows;
    if (!ungrouped) sec.dataset.gid = g.id;

    const head = el("div", "ghead");
    if (!ungrouped) {
      const gh = el("button", "ghandle", "⠿");
      gh.type = "button"; gh.title = "끌어서 그룹 순서 변경";
      head.append(gh);
    }
    head.append(el("h2", "", ungrouped ? UNGROUPED : g.name), el("span", "count", `${rows.length}개`));
    const tools = el("div", "gtools");
    const add = el("button", "btn sm", "+ 링크");
    add.type = "button";
    add.onclick = () => openForm("add", null, ungrouped ? "" : g.name);
    tools.append(add);
    if (!ungrouped) {
      const ren = el("button", "btn sm", "이름 변경");
      ren.type = "button"; ren.onclick = () => renameGroup(g);
      const del = el("button", "btn sm danger-text", "그룹 삭제");
      del.type = "button"; del.onclick = () => deleteGroup(g);
      tools.append(ren, del);
    }
    head.append(tools);

    const cards = el("div", "cards grid");
    rows.forEach((r) => cards.append(cardEl(r)));
    sec.append(head, cards);
    return sec;
  }

  function render() {
    sortables.forEach((s) => s.destroy());
    sortables = [];
    board.innerHTML = "";
    model.groups.forEach((g) => board.append(groupEl(g)));
    board.append(groupEl(null)); // 기타(미분류)는 항상 맨 아래

    sortables.push(Sortable.create(board, {
      animation: 160, handle: ".ghandle", draggable: ".group:not(.ungrouped)",
      ghostClass: "ghost",
      // "기타"보다 아래로 내려가지 않게 항상 그 앞에 끼워 넣음
      onMove: (e) => (e.related.classList.contains("ungrouped") ? -1 : true),
      onEnd: onLayoutChange,
    }));
    board.querySelectorAll(".cards").forEach((c) => {
      sortables.push(Sortable.create(c, {
        group: "links", animation: 160, handle: ".chandle", ghostClass: "ghost",
        onEnd: onLayoutChange,
      }));
    });
    updateSel();
  }

  function updateSel() {
    const n = selected.size;
    $("selCount").textContent = `${n}개 선택`;
    $("delBtn").disabled = n === 0;
    $("selAllBtn").textContent = n && n === byRow.size ? "선택 해제" : "전체 선택";
  }

  // 드래그가 끝나면 DOM의 현재 배치를 모델로 읽어 옴
  function readLayout() {
    const rowsOf = (sec) => [...sec.querySelectorAll(".card")].map((c) => Number(c.dataset.row));
    const groups = [...board.querySelectorAll(".group:not(.ungrouped)")].map((sec) => {
      const old = model.groups.find((g) => g.id === Number(sec.dataset.gid));
      return { id: old.id, name: old.name, rows: rowsOf(sec) };
    });
    return { groups, loose: rowsOf(board.querySelector(".group.ungrouped")) };
  }

  function onLayoutChange() {
    model = readLayout();
    board.querySelectorAll(".group").forEach((sec) => {
      sec.querySelector(".count").textContent = `${sec.querySelectorAll(".card").length}개`;
    });
    setDirty(true);
  }

  // ---------- 그룹 관리 ----------
  const groupError = (name, selfId) => {
    if (!name) return "그룹 이름을 입력해 주세요.";
    if (name.length > 30) return "그룹 이름은 30자 이하로 입력해 주세요.";
    if (name === UNGROUPED) return `"${UNGROUPED}"는 기본 그룹 이름이라 쓸 수 없어요.`;
    if (model.groups.some((g) => g.id !== selfId && g.name.toLowerCase() === name.toLowerCase()))
      return "이미 있는 그룹 이름이에요.";
    return "";
  };

  $("addGroupBtn").onclick = async () => {
    const name = await askText({ title: "그룹 추가", ok: "추가", validate: (v) => groupError(v) });
    if (name === null) return;
    model.groups.push({ id: nextGid++, name, rows: [] });
    setDirty(true); render();
  };

  async function renameGroup(g) {
    const name = await askText({
      title: "그룹 이름 변경", value: g.name, ok: "변경", validate: (v) => groupError(v, g.id),
    });
    if (name === null || name === g.name) return;
    g.name = name;
    setDirty(true); render();
  }

  async function deleteGroup(g) {
    const ok = await modal({
      title: "그룹 삭제",
      message: g.rows.length
        ? `"${g.name}" 그룹을 삭제할까요? 안에 있는 링크 ${g.rows.length}개는 "${UNGROUPED}"로 옮겨져요. (링크는 삭제되지 않아요)`
        : `"${g.name}" 그룹을 삭제할까요?`,
      ok: "삭제", cancel: "취소", danger: true,
    });
    if (!ok) return;
    model.loose.push(...g.rows);
    model.groups = model.groups.filter((x) => x.id !== g.id);
    setDirty(true); render();
  }

  // ---------- 순서·그룹 저장 ----------
  async function saveLayout() {
    const items = [];
    const push = (rows, group) => rows.forEach((row, i) => {
      const l = byRow.get(row);
      items.push({ row, title: l.title, url: l.url, group, order: i + 1 });
    });
    model.groups.forEach((g) => push(g.rows, g.name));
    push(model.loose, "");

    const btn = $("saveBtn");
    btn.disabled = true; btn.textContent = "저장 중…";
    try {
      const res = await api({ action: "layout", groups: model.groups.map((g) => g.name), items });
      if (!res) return false;
      await reload();
      toast("저장했어요");
      return true;
    } catch {
      await modal({ title: "오류", message: "저장은 됐지만 목록을 다시 불러오지 못했어요. 새로고침해 주세요." });
      return false;
    } finally { btn.disabled = false; btn.textContent = "변경사항 저장"; }
  }
  $("saveBtn").onclick = saveLayout;
  $("revertBtn").onclick = async () => {
    try { await reload(); toast("되돌렸어요"); }
    catch { await modal({ title: "오류", message: "목록을 불러오지 못했어요." }); }
  };

  // 링크 추가/수정/삭제는 서버의 최신 행 번호가 필요하므로 먼저 배치 변경을 저장
  async function ensureSaved() {
    if (!dirty) return true;
    const ok = await modal({
      title: "변경사항을 먼저 저장할까요?",
      message: "순서·그룹 변경이 아직 저장되지 않았어요. 저장한 뒤에 계속할 수 있어요.",
      ok: "저장하고 계속", cancel: "취소",
    });
    return ok ? saveLayout() : false;
  }

  // ---------- 링크 선택 / 삭제 ----------
  $("selAllBtn").onclick = () => {
    if (selected.size === byRow.size) selected.clear();
    else byRow.forEach((_, r) => selected.add(r));
    board.querySelectorAll(".card").forEach((c) => {
      c.querySelector("input").checked = selected.has(Number(c.dataset.row));
    });
    updateSel();
  };

  $("delBtn").onclick = async () => {
    if (!(await ensureSaved())) return;
    const items = [...selected].map((r) => byRow.get(r)).filter(Boolean);
    if (!items.length) return;
    const ok = await modal({
      title: "삭제 확인",
      message: `선택한 ${items.length}개 링크를 삭제할까요? 삭제하면 되돌릴 수 없어요.`,
      ok: "삭제", cancel: "취소", danger: true,
    });
    if (!ok) return;
    const btn = $("delBtn");
    btn.disabled = true; btn.textContent = "삭제 중…";
    try {
      const res = await api({ action: "delete", items: items.map(({ row, title, url }) => ({ row, title, url })) });
      if (res) { selected.clear(); await reload(); toast(`${res.deleted ?? items.length}개를 삭제했어요`); }
    } catch {
      await modal({ title: "오류", message: "목록을 다시 불러오지 못했어요. 새로고침해 주세요." });
    } finally { btn.textContent = "선택 삭제"; updateSel(); }
  };

  // ---------- 링크 추가 / 수정 폼 ----------
  async function openForm(mode, item = null, group = "") {
    if (!(await ensureSaved())) return;
    // 저장 후 모델이 새로 만들어졌으므로 최신 데이터를 다시 찾음
    if (item) item = byRow.get(item.row) || item;
    formMode = mode; editing = item;
    form.reset();
    $("addMsg").textContent = "";
    $("formTitle").textContent = mode === "edit" ? "링크 수정" : "링크 추가";

    const sel = $("groupSel");
    sel.innerHTML = "";
    sel.append(new Option(UNGROUPED, ""));
    model.groups.forEach((g) => sel.append(new Option(g.name, g.name)));

    if (mode === "edit" && item) {
      form.elements.title.value = item.title;
      form.elements.description.value = item.description || "";
      form.elements.url.value = item.url;
      form.elements.thumbnail.value = item.thumbnail || "";
      sel.value = item.group || "";
    } else {
      sel.value = group;
    }
    dlg.showModal();
    form.elements.title.focus();
  }
  $("addLinkBtn").onclick = () => openForm("add");
  $("cancelBtn").onclick = () => dlg.close();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const msg = $("addMsg"), btn = $("saveItemBtn");
    const f = Object.fromEntries(new FormData(form));
    const item = {
      title: (f.title || "").trim(), description: (f.description || "").trim(),
      url: (f.url || "").trim(), linkText: (editing && editing.linkText) || "",
      thumbnail: (f.thumbnail || "").trim(), group: f.group || "",
    };
    if (!item.title) { msg.textContent = "사이트 제목을 입력해 주세요."; return; }
    if (!isHttp(item.url) || (item.thumbnail && !isHttp(item.thumbnail))) {
      msg.textContent = "URL은 http:// 또는 https://로 시작해야 해요."; return;
    }
    btn.disabled = true; msg.textContent = "저장 중…";
    try {
      const res = formMode === "edit"
        ? await api({ action: "update", row: editing.row, expect: { title: editing.title, url: editing.url }, item })
        : await api({ action: "add", item });
      if (res) { await reload(); dlg.close(); toast("저장했어요"); }
      else if (api.last === "stale" || !code) dlg.close();
    } catch {
      msg.textContent = "저장은 됐지만 목록을 다시 불러오지 못했어요. 새로고침해 주세요.";
    } finally { btn.disabled = false; if (msg.textContent === "저장 중…") msg.textContent = ""; }
  };

  // ---------- 인증 ----------
  function showGate() {
    $("gate").hidden = false; $("app").hidden = true; $("logoutBtn").hidden = true;
    setDirty(false); $("gateToken").value = "";
  }
  function dropAuth() {
    code = ""; sessionStorage.removeItem("mh_code");
    selected.clear();
    showGate();
  }
  async function showApp() {
    $("gate").hidden = true; $("app").hidden = false; $("logoutBtn").hidden = false;
    const st = $("status");
    st.textContent = "불러오는 중..."; st.hidden = false;
    try { await reload(); st.hidden = true; }
    catch { st.textContent = "목록을 불러오지 못했어요. 새로고침해 주세요."; }
  }

  $("gateForm").onsubmit = async (e) => {
    e.preventDefault();
    const msg = $("gateMsg"), btn = $("gateBtn");
    const c = $("gateToken").value.trim();
    if (!c) { msg.textContent = "인증 코드를 입력해 주세요."; return; }
    if (!apiUrl) { msg.textContent = "config.js에 apiUrl을 설정해 주세요."; return; }
    code = c; msg.textContent = ""; btn.disabled = true; btn.textContent = "확인 중…";
    try {
      const res = await call({ action: "verify" });
      if (res.ok) { sessionStorage.setItem("mh_code", code); await showApp(); }
      else { code = ""; msg.textContent = errText(res); }
    } catch { code = ""; msg.textContent = "서버에 연결하지 못했어요."; }
    finally { btn.disabled = false; btn.textContent = "확인"; }
  };

  $("logoutBtn").onclick = async () => {
    if (dirty) {
      const ok = await modal({
        title: "로그아웃", message: "저장하지 않은 변경사항이 사라져요. 로그아웃할까요?",
        ok: "로그아웃", cancel: "취소", danger: true,
      });
      if (!ok) return;
    }
    dropAuth();
  };

  if (code) showApp(); else showGate();
})();
