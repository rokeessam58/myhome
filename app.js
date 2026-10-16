// 공개 페이지: 그룹별로 링크 카드를 보여줍니다. (편집 기능은 admin.html)
(() => {
  const { apiUrl } = window.SITE_CONFIG;
  const $ = (id) => document.getElementById(id);
  const list = $("list");

  const isHttp = (u) => /^https?:\/\//i.test(u || "");

  // 예전 응답(배열)과 새 응답({groups, links}) 모두 처리
  const normalize = (d) =>
    Array.isArray(d) ? { groups: [], links: d } : { groups: d.groups || [], links: d.links || [] };

  function setStatus(text) {
    $("empty").textContent = text;
    $("empty").hidden = !text;
  }

  function cardEl(l) {
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
    const a = document.createElement("a");
    a.className = "btn primary open"; a.textContent = "열기";
    a.href = l.url; a.target = "_blank"; a.rel = "noopener noreferrer";

    body.append(h, p, t, a);
    card.append(img, body);
    return card;
  }

  // 그룹 순서 → 그룹 안에서는 order, 같으면 시트 행 순서. 그룹이 없는 링크는 맨 아래 "기타"
  function render(d) {
    list.innerHTML = "";
    const links = d.links
      .filter((l) => isHttp(l.url))
      .sort((a, b) => (a.order || 0) - (b.order || 0) || (a.row || 0) - (b.row || 0));
    const known = new Set(d.groups);
    const sections = [];
    for (const name of d.groups) {
      const items = links.filter((l) => l.group === name);
      if (items.length) sections.push({ title: name, items });
    }
    const rest = links.filter((l) => !known.has(l.group));
    if (rest.length) sections.push({ title: d.groups.length ? "기타" : "", items: rest });

    for (const s of sections) {
      const sec = document.createElement("section");
      sec.className = "gsec";
      if (s.title) {
        const h = document.createElement("h2");
        h.className = "gtitle"; h.textContent = s.title;
        sec.append(h);
      }
      const grid = document.createElement("div");
      grid.className = "grid";
      s.items.forEach((l) => grid.append(cardEl(l)));
      sec.append(grid);
      list.append(sec);
    }
    return links.length;
  }

  async function load() {
    if (!apiUrl) { setStatus("config.js에 apiUrl을 설정해 주세요."); return; }
    // 캐시된 목록이 있으면 먼저 보여주고(콜드 스타트 대비), 없으면 로딩 문구 표시
    let shown = 0;
    try {
      const cached = JSON.parse(localStorage.getItem("mh_data") || "null");
      if (cached) shown = render(normalize(cached));
    } catch {}
    setStatus(shown ? "" : "불러오는 중...");
    try {
      const raw = await (await fetch(apiUrl)).json();
      if (!Array.isArray(raw) && !Array.isArray(raw.links)) throw new Error("bad data");
      localStorage.setItem("mh_data", JSON.stringify(raw));
      const n = render(normalize(raw));
      setStatus(n ? "" : "아직 등록된 웹앱이 없어요.");
    } catch {
      // 실패해도 캐시된 목록이 있으면 그대로 두고, 없을 때만 안내
      setStatus(shown ? "" : "목록을 불러오지 못했어요. 새로고침해 주세요.");
    }
  }

  load();
})();
