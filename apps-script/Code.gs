/**
 * 상록T의 도구 모음 백엔드 (Google Apps Script)
 * - 스프레드시트에 바인딩된 스크립트로 붙여넣어 사용합니다.
 * - 인증 코드는 코드에 쓰지 말고 [프로젝트 설정 > 스크립트 속성]에
 *   ADMIN_CODE 라는 이름으로 저장하세요. (20자 이상 랜덤 문자열 권장)
 *
 * 시트 구성
 *  - links  : title, description, url, linkText, thumbnail, group, order
 *  - groups : name  (행 순서 = 그룹 표시 순서)  ← 자동 생성됩니다
 *
 * 지원 action: verify / add / update / delete / layout
 */
var SHEET_NAME = 'links';
var GROUP_SHEET = 'groups';
var HEADERS = ['title', 'description', 'url', 'linkText', 'thumbnail', 'group', 'order'];
var MAX_FAILS = 5;          // 연속 실패 허용 횟수
var LOCK_MINUTES = 5;       // 초과 시 잠금 시간(분)
var MAX_DELETE = 100;       // 한 번에 삭제할 수 있는 최대 개수
var MAX_GROUPS = 30;
var GROUP_NAME_MAX = 30;
var MAX_LAYOUT_ITEMS = 500;

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
  } else {
    var h = sh.getRange(1, 1, 1, HEADERS.length).getValues()[0];
    if (h[5] !== 'group' || h[6] !== 'order') {
      sh.getRange(1, 6, 1, 2).setValues([['group', 'order']]); // 기존 시트 업그레이드
    }
  }
  return sh;
}

function getGroupSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(GROUP_SHEET) || ss.insertSheet(GROUP_SHEET);
  if (sh.getLastRow() === 0) sh.appendRow(['name']);
  return sh;
}

function readGroups_() {
  var sh = getGroupSheet_();
  var n = sh.getLastRow();
  if (n < 2) return [];
  var out = [], seen = {};
  var vals = sh.getRange(2, 1, n - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    var name = String(vals[i][0]).trim();
    if (name && !seen[name]) { seen[name] = true; out.push(name); }
  }
  return out;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function safeUrl_(u) {
  return /^https?:\/\//i.test(String(u || '').trim());
}

// 링크 입력값 검증 + 정리 (title, description, url, linkText, thumbnail). 문제가 있으면 null
function cleanItem_(it) {
  it = it || {};
  var title = String(it.title || '').trim().slice(0, 100);
  var url = String(it.url || '').trim();
  var thumb = String(it.thumbnail || '').trim();
  if (!title || !safeUrl_(url)) return null;
  if (thumb && !safeUrl_(thumb)) return null;
  return [
    title,
    String(it.description || '').trim().slice(0, 500),
    url,
    String(it.linkText || '').trim().slice(0, 100),
    thumb
  ];
}

// 존재하는 그룹 이름이면 그대로, 아니면 '' (기타)
function cleanGroup_(g, groups) {
  g = String(g || '').trim();
  return groups.indexOf(g) >= 0 ? g : '';
}

// 시트의 해당 행이 클라이언트가 보던 항목과 같은지 확인 (시트가 그 사이 바뀌었는지 검사)
function matches_(sh, row, expect) {
  if (!expect || !(row >= 2 && row <= sh.getLastRow())) return false;
  var v = sh.getRange(row, 1, 1, 5).getValues()[0];
  return String(v[0]) === String(expect.title) && String(v[2]) === String(expect.url);
}

function maxOrder_(sh) {
  var n = sh.getLastRow();
  if (n < 2) return 0;
  var vals = sh.getRange(2, 7, n - 1, 1).getValues(), m = 0;
  for (var i = 0; i < vals.length; i++) m = Math.max(m, Number(vals[i][0]) || 0);
  return m;
}

// 수식 주입 방지: 텍스트 서식으로 저장. order가 null이면 기존 순서 유지
function writeRow_(sh, rowNum, values5, group, order) {
  var r = sh.getRange(rowNum, 1, 1, 6);
  r.setNumberFormat('@');
  r.setValues([values5.concat([group])]);
  if (order !== null) {
    var o = sh.getRange(rowNum, 7);
    o.setNumberFormat('0');
    o.setValue(order);
  }
}

// 목록 조회 (공개). row = 시트 행 번호
function doGet() {
  var rows = getSheet_().getDataRange().getValues();
  var links = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0] || !safeUrl_(r[2])) continue;
    links.push({
      row: i + 1,
      title: String(r[0]), description: String(r[1] || ''), url: String(r[2]),
      linkText: String(r[3] || ''), thumbnail: safeUrl_(r[4]) ? String(r[4]) : '',
      group: String(r[5] || ''), order: Number(r[6]) || 0
    });
  }
  return json_({ groups: readGroups_(), links: links });
}

function doPost(e) {
  var cache = CacheService.getScriptCache();
  if (Number(cache.get('fails') || 0) >= MAX_FAILS) {
    return json_({ ok: false, error: 'locked' });
  }

  var body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return json_({ ok: false, error: 'bad_request' }); }

  var code = PropertiesService.getScriptProperties().getProperty('ADMIN_CODE');
  if (!code || body.code !== code) {
    var n = Number(cache.get('fails') || 0) + 1;
    cache.put('fails', String(n), LOCK_MINUTES * 60);
    return json_({ ok: false, error: 'unauthorized' });
  }
  cache.remove('fails');

  if (body.action === 'verify') return json_({ ok: true });

  // 쓰기 작업은 동시에 하나만 (행 번호가 밀리는 것 방지)
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = getSheet_();
    var groups = readGroups_();

    if (body.action === 'add') {
      var row = cleanItem_(body.item);
      if (!row) return json_({ ok: false, error: 'invalid' });
      writeRow_(sh, sh.getLastRow() + 1, row, cleanGroup_((body.item || {}).group, groups), maxOrder_(sh) + 1);
      return json_({ ok: true });
    }

    if (body.action === 'update') {
      var target = Number(body.row);
      var next = cleanItem_(body.item);
      if (!next) return json_({ ok: false, error: 'invalid' });
      if (!matches_(sh, target, body.expect)) return json_({ ok: false, error: 'stale' });
      var cur = String(sh.getRange(target, 6).getValue() || '');
      var g = (body.item || {}).group === undefined ? cur : cleanGroup_(body.item.group, groups);
      // 그룹이 바뀌면 새 그룹의 맨 뒤로
      writeRow_(sh, target, next, g, g !== cur ? maxOrder_(sh) + 1 : null);
      return json_({ ok: true });
    }

    if (body.action === 'delete') {
      var items = body.items;
      if (!Array.isArray(items) || !items.length || items.length > MAX_DELETE) {
        return json_({ ok: false, error: 'bad_request' });
      }
      var seen = {}, rows = [];
      for (var i = 0; i < items.length; i++) {
        var r = Number(items[i].row);
        if (seen[r]) continue;
        // 하나라도 맞지 않으면 아무것도 지우지 않음
        if (!matches_(sh, r, items[i])) return json_({ ok: false, error: 'stale' });
        seen[r] = true; rows.push(r);
      }
      rows.sort(function (a, b) { return b - a; }); // 아래 행부터 삭제
      for (var k = 0; k < rows.length; k++) sh.deleteRow(rows[k]);
      return json_({ ok: true, deleted: rows.length });
    }

    // 그룹 목록·순서와 링크별 (그룹, 순서)를 한 번에 저장
    if (body.action === 'layout') {
      var names = body.groups, list = body.items;
      if (!Array.isArray(names) || !Array.isArray(list) ||
          names.length > MAX_GROUPS || list.length > MAX_LAYOUT_ITEMS) {
        return json_({ ok: false, error: 'bad_request' });
      }
      var clean = [], used = {};
      for (var a = 0; a < names.length; a++) {
        var nm = String(names[a]).trim();
        if (!nm || nm.length > GROUP_NAME_MAX || used[nm]) return json_({ ok: false, error: 'invalid' });
        used[nm] = true; clean.push(nm);
      }
      for (var b = 0; b < list.length; b++) {
        if (!matches_(sh, Number(list[b].row), list[b])) return json_({ ok: false, error: 'stale' });
      }

      var gsh = getGroupSheet_();
      if (gsh.getLastRow() > 1) gsh.getRange(2, 1, gsh.getLastRow() - 1, 1).clearContent();
      if (clean.length) {
        var gr = gsh.getRange(2, 1, clean.length, 1);
        gr.setNumberFormat('@');
        gr.setValues(clean.map(function (x) { return [x]; }));
      }

      var last = sh.getLastRow();
      if (last >= 2) {
        var rng = sh.getRange(2, 6, last - 1, 2);
        var vals = rng.getValues();
        for (var c = 0; c < list.length; c++) {
          var idx = Number(list[c].row) - 2;
          vals[idx][0] = used[list[c].group] ? list[c].group : '';
          vals[idx][1] = Number(list[c].order) || 0;
        }
        sh.getRange(2, 6, last - 1, 1).setNumberFormat('@');
        sh.getRange(2, 7, last - 1, 1).setNumberFormat('0');
        rng.setValues(vals);
      }
      return json_({ ok: true });
    }

    return json_({ ok: false, error: 'bad_request' });
  } finally {
    lock.releaseLock();
  }
}
