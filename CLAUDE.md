# 생활비 가계부 — CLAUDE.md

## 작업 원칙

- 기능 변경/추가 요청이 오면 바로 구현하지 말고, 기획 의도를 먼저 묻고 이해한 내용을 확인받은 후 진행
- 아키텍처/구조 변경(시트 구조, 저장 방식, 데이터 모델 등)은 반드시 먼저 설명하고 동의받은 후 진행
- 버그 수정 범위를 벗어나는 변경은 제안만 하고 대기

## 프로젝트 개요

커플이 함께 쓰는 생활비 가계부. 생활비통장에 예산을 넣고 한 사람(본인)이 지출하는 구조라서, 정산(1/n 계산) 기능은 없음 — 예산 대비 어디에 썼는지 파악하는 게 핵심 목적.

단일 HTML 파일(`index.html`) + GAS 백엔드(`Code.gs`)로 구성. 별도 서버 없이 브라우저에서 바로 열어서 사용. 데이터는 localStorage에 저장되고, GAS URL이 설정되면 구글 시트와 자동 동기화 (wedding-plan 프로젝트와 동일 패턴).

역할: 입력은 본인만, 조회는 본인+남친 — 단, 링크 자체는 아는 사람 누구나 동일하게 접근 가능해서 서버 단 권한 분리는 없음(사용자가 명시적으로 필요 없다고 확인함).

## 파일 구조

```
index.html   — 전체 앱 (HTML + CSS + JS 단일 파일)
Code.gs      — Google Apps Script 백엔드 (구글 시트 읽기/쓰기)
```

## 데이터 구조 (`D` 객체, localStorage key: `lc_data`)

```js
D = {
  expenses: [ { id, date:'YYYY-MM-DD', amount:Number, name:'', cat:'', sub:'' } ],
  budgets: { 'YYYY-MM': amount },   // 월별 예산, 카테고리별 한도는 없음
  cats: {
    variable: ['식비','생필품','데이트','교통','기타'],       // 단일 레벨
    fixed: ['월세','관리비','구독료','보험','기타고정비']      // 고정비만 세부카테고리 있음
  },
  _savedAt: number
}
```

- 변동비 지출: `cat`에 변동비 카테고리명, `sub`는 빈 문자열
- 고정비 지출: `cat`은 항상 `'고정비'` 고정값, 실제 분류는 `sub`(세부카테고리)에 저장 — 대시보드 분포 차트에서는 `sub` 기준으로 조각을 나눠서 표시함 (고정비를 한 덩어리로 뭉치면 세부가 안 보인다는 요구사항 때문)
- 카테고리 색상은 `D.cats.variable`/`D.cats.fixed` 배열의 **순서(index)**로 결정됨 (`--cc1`..`--cc6`, `--fc1`..`--fc5` CSS 변수를 순환). 카테고리 삭제 후 재추가하면 색이 바뀔 수 있음 — 의도된 동작

## 예산 게이지 (시그니처 요소)

이번 달 예산 대비 지출 진행률을 단순 바가 아니라, **오늘까지의 날짜 페이스**와 비교해서 보여줌:
- `pace = 오늘 날짜 / 이번 달 총 일수 * 100`
- 지출 진행률이 페이스보다 빠르면 경고색(warn), 느리면 안전색(pos), 예산 초과 시 위험색(over)
- 과거 달을 볼 땐 페이스 비교 없이 그 달의 최종 결과만 표시 (월 이동 = 결산 화면 역할 겸용)

## 동기화 방식 (wedding-plan과 동일 패턴)

- `save()` — `D._savedAt = Date.now()`, localStorage 저장, `gasSyncDebounced()` 호출 (300ms 디바운스 후 POST, no-cors + text/plain)
- `beforeunload` → `keepalive:true` fetch로 새로고침/닫기 전 강제 전송
- `loadFromGas(force)` — GAS GET 후 타임스탬프 비교, `force=true`면 무조건 적용
- GAS URL은 `localStorage`의 `lc_gas_url`에 별도 저장 (공유 데이터와 분리), 설정 화면에서 입력

## 남은 작업 (미착수)

- **GAS 배포 안 됨** — `Code.gs`를 Apps Script 프로젝트로 만들고 웹 앱으로 배포한 뒤, 배포 URL을 `index.html`의 `DEFAULT_GAS_URL`에 넣어야 기기 간 동기화가 실제로 동작함. 그 전까지는 각 브라우저의 localStorage에만 저장됨
- 지출 항목 수정 기능 없음 — 현재는 삭제 후 재입력만 가능(MVP 범위에서 의도적으로 제외)
