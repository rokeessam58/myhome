(() => {
  const { apiUrl } = window.SITE_CONFIG;

  const $ = (id) => document.getElementById(id);
  const grid = $("grid"), dlg = $("dlg");
  const authForm = $("authForm"), addForm = $("addForm");
  let links = [];
  let code = "";

  // ---------- 유틸 ----------
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

  // ---------- 목록 표시 ----------
  // 상태 메시지: 목록이 비어 있을 때만 표시 (불러오는 중 / 실패 / 실제로 비어 있음)
  function setStatus(text) {
    $("empty").textContent = text;
    $("empty").hidden = !text;
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
      const t = document.createElement("span"); t.className = "link";
      t.textContent = l.url;
      const a = document.createElement("a");
      a.className = "btn primary open"; a.textContent = "열기";
      a.href = l.url; a.target = "_blank"; a.rel = "noopener noreferrer";

      body.append(h, p, t, a);
      card.append(img, body);
      grid.append(card);
    }
  }

  async function load() {
    if (!apiUrl) { setStatus("config.js에 apiUrl을 설정해 주세요."); return; }
    // 캐시된 목록이 있으면 먼저 보여주고(콜드 스타트 대비), 없으면 로딩 문구 표시
    try { links = JSON.parse(localStorage.getItem("mh_links") || "[]"); } catch { links = []; }
    render();
    setStatus(links.length ? "" : "불러오는 중...");
    try {
      const data = await (await fetch(apiUrl)).json();
      if (!Array.isArray(data)) throw new Error();
      links = data;
      localStorage.setItem("mh_links", JSON.stringify(links));
      render();
      setStatus(links.length ? "" : "아직 등록된 웹앱이 없어요.");
    } catch {
      // 실패해도 캐시된 목록이 있으면 그대로 두고, 없을 때만 안내
      setStatus(links.length ? "" : "목록을 불러오지 못했어요. 새로고침해 주세요.");
    }
  }

  // ---------- 모달 ----------
  function openDialog() {
    authForm.hidden = false; addForm.hidden = true;
    $("authMsg").textContent = ""; $("addMsg").textContent = "";
    $("token").value = "";
    const saved = sessionStorage.getItem("mh_code");
    if (saved) { code = saved; authForm.hidden = true; addForm.hidden = false; }
    dlg.showModal();
  }
  $("addBtn").onclick = openDialog;
  dlg.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => dlg.close()));

  // ---------- 1단계: 인증 ----------
  authForm.onsubmit = async (e) => {
    e.preventDefault();
    code = $("token").value.trim();
    const msg = $("authMsg"); msg.textContent = "확인 중…";
    if (!apiUrl) { msg.textContent = "config.js에 apiUrl을 설정해 주세요."; return; }
    try {
      const res = await call({ action: "verify" });
      if (res.ok) {
        sessionStorage.setItem("mh_code", code);
        authForm.hidden = true; addForm.hidden = false;
      } else {
        code = "";
        msg.textContent = res.error === "locked"
          ? "시도 횟수를 초과했어요. 잠시 후 다시 시도해 주세요."
          : "인증 코드가 올바르지 않아요.";
      }
    } catch { code = ""; msg.textContent = "서버에 연결하지 못했어요."; }
  };

  // ---------- 2단계: 저장 ----------
  addForm.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(addForm));
    const item = {
      title: f.title.trim(), description: f.description.trim(),
      url: f.url.trim(), linkText: "", thumbnail: f.thumbnail.trim(),
    };
    const btn = $("saveBtn"), msg = $("addMsg");
    if (!isHttp(item.url) || (item.thumbnail && !isHttp(item.thumbnail))) {
      msg.textContent = "URL은 http:// 또는 https://로 시작해야 해요."; return;
    }
    btn.disabled = true; msg.textContent = "저장 중…";
    try {
      const res = await call({ action: "add", item });
      if (!res.ok) {
        if (res.error === "unauthorized" || res.error === "locked") sessionStorage.removeItem("mh_code");
        throw new Error(res.error === "invalid" ? "입력값을 확인해 주세요." : "저장에 실패했어요. 다시 인증해 주세요.");
      }
      links.push(item);
      localStorage.setItem("mh_links", JSON.stringify(links));
      render(); setStatus(""); addForm.reset(); dlg.close();
    } catch (err) {
      msg.textContent = err.message || "오류가 발생했어요.";
    } finally { btn.disabled = false; }
  };

  load();
})();
