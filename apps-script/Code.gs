/**
 * My Home 백엔드 (Google Apps Script)
 * - 스프레드시트에 바인딩된 스크립트로 붙여넣어 사용합니다.
 * - 인증 코드는 코드에 쓰지 말고 [프로젝트 설정 > 스크립트 속성]에
 *   ADMIN_CODE 라는 이름으로 저장하세요. (20자 이상 랜덤 문자열 권장)
 */
var SHEET_NAME = 'links';
var HEADERS = ['title', 'description', 'url', 'linkText', 'thumbnail'];
var MAX_FAILS = 5;          // 연속 실패 허용 횟수
var LOCK_MINUTES = 5;       // 초과 시 잠금 시간(분)

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

// 목록 조회 (공개)
function doGet() {
  var rows = getSheet_().getDataRange().getValues();
  var list = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0] || !safeUrl_(r[2])) continue;
    list.push({
      title: String(r[0]), description: String(r[1] || ''), url: String(r[2]),
      linkText: String(r[3] || ''), thumbnail: safeUrl_(r[4]) ? String(r[4]) : ''
    });
  }
  return json_(list);
}

// 인증 확인 / 항목 추가
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

  if (body.action === 'add') {
    var it = body.item || {};
    var title = String(it.title || '').trim().slice(0, 100);
    var url = String(it.url || '').trim();
    var thumb = String(it.thumbnail || '').trim();
    if (!title || !safeUrl_(url)) return json_({ ok: false, error: 'invalid' });
    if (thumb && !safeUrl_(thumb)) return json_({ ok: false, error: 'invalid' });

    var sh = getSheet_();
    var row = [
      title,
      String(it.description || '').trim().slice(0, 500),
      url,
      String(it.linkText || '').trim().slice(0, 100),
      thumb
    ];
    // 수식 주입 방지: 텍스트 서식으로 저장
    var range = sh.getRange(sh.getLastRow() + 1, 1, 1, row.length);
    range.setNumberFormat('@');
    range.setValues([row]);
    return json_({ ok: true });
  }
  return json_({ ok: false, error: 'bad_request' });
}
