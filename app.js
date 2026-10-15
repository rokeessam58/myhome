(() => {
  const cfg = window.SITE_CONFIG;
  // GitHub Pages 주소에서 owner/repo 자동 감지
  if (!cfg.owner && location.hostname.endsWith(".github.io")) {
    cfg.owner = location.hostname.split(".")[0];
    cfg.repo = location.pathname.split("/")[1] || `${cfg.owner}.github.io`;
  }
  const api = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}`;

  const $ = (id) => document.getElementById(id);
  const grid = $("grid"), dlg = $("dlg");
  const authForm = $("authForm"), addForm = $("addForm");
  let links = [];
  let token = "";

  // ---------- 목록 표시 ----------
  const hostOf = (u) => { try { return new URL(u).hostname; } catch { return u; } };
  const shot = (u) => `https://image.thum.io/get/width/600/crop/375/${u}`;

  function render() {
    grid.innerHTML = "";
    $("empty").hidden = links.length > 0;
    for (const l of links) {
      const card = document.createElement("article");
      card.className = "card";

      const img = document.createElement("img");
      img.className = "thumb"; img.loading = "lazy"; img.alt = "";
      img.src = l.thumbnail || shot(l.url);
      img.onerror = () => img.removeAttribute("src"); // 실패 시 그라데이션 배경

      const body = document.createElement("div");
      body.className = "body";
      const h = document.createElement("h3"); h.textContent = l.title;
      const p = document.createElement("p"); p.textContent = l.description || "";
      const t = document.createElement("span"); t.className = "link";
      t.textContent = l.linkText || hostOf(l.url);
      const a = document.createElement("a");
      a.className = "btn primary open"; a.textContent = "열기";
      a.href = l.url; a.target = "_blank"; a.rel = "noopener noreferrer";

      body.append(h, p, t, a);
      card.append(img, body);
      grid.append(card);
    }
  }

  async function load() {
    try {
      const r = await fetch(`${cfg.dataFile}?t=${Date.now()}`);
      links = await r.json();
    } catch { links = []; }
    render();
  }

  // ---------- 모달 ----------
  function openDialog() {
    authForm.hidden = false; addForm.hidden = true;
    $("authMsg").textContent = ""; $("addMsg").textContent = "";
    $("token").value = "";
    // 이번 탭에서 이미 인증했다면 바로 입력 폼
    const saved = sessionStorage.getItem("mh_token");
    if (saved) { token = saved; authForm.hidden = true; addForm.hidden = false; }
    dlg.showModal();
  }
  $("addBtn").onclick = openDialog;
  dlg.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => dlg.close()));

  const gh = (path, opts = {}) =>
    fetch(`${api}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        ...(opts.headers || {}),
      },
    });

  // ---------- 1단계: 인증 ----------
  authForm.onsubmit = async (e) => {
    e.preventDefault();
    token = $("token").value.trim();
    const msg = $("authMsg"); msg.textContent = "확인 중…";
    if (!cfg.owner) { msg.textContent = "config.js에 owner/repo를 설정해 주세요."; return; }
    try {
      const r = await gh("");
      const j = await r.json();
      if (!r.ok || !j.permissions?.push) throw new Error();
      sessionStorage.setItem("mh_token", token);
      authForm.hidden = true; addForm.hidden = false;
    } catch {
      token = ""; msg.textContent = "인증 코드가 올바르지 않아요.";
    }
  };

  // ---------- 2단계: 저장 (links.json을 GitHub에 커밋) ----------
  const b64enc = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  const b64dec = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), (c) => c.charCodeAt(0)));

  addForm.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(addForm));
    const item = {
      title: f.title.trim(), description: f.description.trim(),
      url: f.url.trim(), linkText: f.linkText.trim(), thumbnail: f.thumbnail.trim(),
    };
    const btn = $("saveBtn"), msg = $("addMsg");
    btn.disabled = true; msg.textContent = "저장 중…";
    try {
      // 최신본을 받아 항목을 추가한 뒤 커밋 (동시 수정 충돌 방지)
      const cur = await gh(`/contents/${cfg.dataFile}?ref=${cfg.branch}`);
      if (cur.status === 401) { sessionStorage.removeItem("mh_token"); throw new Error("인증이 만료됐어요. 다시 시도해 주세요."); }
      const curJson = await cur.json();
      const list = JSON.parse(b64dec(curJson.content));
      list.push(item);
      const put = await gh(`/contents/${cfg.dataFile}`, {
        method: "PUT",
        body: JSON.stringify({
          message: `add: ${item.title}`,
          content: b64enc(JSON.stringify(list, null, 2) + "\n"),
          sha: curJson.sha,
          branch: cfg.branch,
        }),
      });
      if (!put.ok) throw new Error("저장에 실패했어요. 토큰 권한을 확인해 주세요.");
      links = list; render(); addForm.reset(); dlg.close();
    } catch (err) {
      msg.textContent = err.message || "오류가 발생했어요.";
    } finally { btn.disabled = false; }
  };

  load();
})();
