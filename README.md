# My Home

내가 만든 웹앱 링크를 모아두는 즐겨찾기 사이트 (GitHub Pages용 정적 사이트).

## 배포
1. 이 폴더를 GitHub 저장소에 push
2. Settings → Pages → Branch: `main` / root 로 배포
3. `https://<아이디>.github.io/<저장소>/` 접속

## 인증 코드 만들기
인증 코드 = **GitHub Fine-grained Personal Access Token** 입니다.
1. GitHub → Settings → Developer settings → Fine-grained tokens → Generate
2. Repository access: 이 저장소만 선택
3. Permissions → **Contents: Read and write**
4. 발급된 토큰을 `+ 추가` 버튼의 인증 코드 칸에 입력

토큰은 코드에 저장되지 않고(탭을 닫으면 사라짐), 저장소에 쓰기 권한이 있는 사람만 추가할 수 있습니다.

## 구조
- `links.json` — 웹앱 목록 (추가 시 자동 커밋됨)
- `config.js` — 로컬 테스트용 owner/repo 설정
