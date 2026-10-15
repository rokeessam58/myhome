/**
 * My Home 백엔드 (Google Apps Script)
 * - 스프레드시트에 바인딩된 스크립트로 붙여넣어 사용합니다.
 * - 인증 코드는 코드에 쓰지 말고 [프로젝트 설정 > 스크립트 속성]에
 *   ADMIN_CODE 라는 이름으로 저장하세요. (20자 이상 랜덤 문자열 권장)
 *
 * 지원 action: verify / add / update / delete
 */
var SHEET_NAME = 'links';
var HEADERS = ['title', 'description', 'url', 'linkText', 'thumbnail'];
var MAX_FAILS = 5;          // 연속 실패 허용 횟수
var LOCK_MINUTES = 5;       // 초과 시 잠금 시간(분)
var MAX_DELETE = 100;       // 한 번에 삭제할 수 있는 최대 개수

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) sh.appendRow(HEADERS);
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function safeUrl_(u) {
  return /^https?:\/\//i.test(String(u || '').trim());
}

// 입력값 검증 + 정리. 문제가 있으면 null
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

// 시트의 해당 행이 클라이언트가 보던 항목과 같은지 확인 (시트가 그 사이 바뀌었는지 검사)
function matches_(sh, row, expect) {
  if (!expect || !(row >= 2 && row <= sh.getLastRow())) return false;
  var v = sh.getRange(row, 1, 1, HEADERS.length).getValues()[0];
  return String(v[0]) === String(expect.title) && String(v[2]) === String(expect.url);
}

// 목록 조회 (공개). row = 시트 행 번호
function doGet() {
  var rows = getSheet_().getDataRange().getValues();
  var list = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0] || !safeUrl_(r[2])) continue;
    list.push({
      row: i + 1,
      title: String(r[0]), description: String(r[1] || ''), url: String(r[2]),
      linkText: String(r[3] || ''), thumbnail: safeUrl_(r[4]) ? String(r[4]) : ''
    });
  }
  return json_(list);
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

    if (body.action === 'add') {
      var row = cleanItem_(body.item);
      if (!row) return json_({ ok: false, error: 'invalid' });
      writeRow_(sh, sh.getLastRow() + 1, row);
      return json_({ ok: true });
    }

    if (body.action === 'update') {
      var target = Number(body.row);
      var next = cleanItem_(body.item);
      if (!next) return json_({ ok: false, error: 'invalid' });
      if (!matches_(sh, target, body.expect)) return json_({ ok: false, error: 'stale' });
      writeRow_(sh, target, next);
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

    return json_({ ok: false, error: 'bad_request' });
  } finally {
    lock.releaseLock();
  }
}

// 수식 주입 방지: 텍스트 서식으로 저장
function writeRow_(sh, rowNum, values) {
  var range = sh.getRange(rowNum, 1, 1, values.length);
  range.setNumberFormat('@');
  range.setValues([values]);
}
