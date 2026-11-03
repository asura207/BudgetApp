당신은 모바일 풀스택 시니어 소프트웨어 엔지니어입니다.
아래의 명세와 기술 스택 요구사항에 맞춰, 안드로이드 전용 스탠드얼론 가계부 앱(React Native CLI + TypeScript)을 단계별로 설계 및 구현해 주세요.

---

### [1] 시스템 기본 아키텍처 및 제약사항

1. **플랫폼**: Android Standalone 앱 (외부 백엔드 서버 없이 기기 내부 로컬 저장소로만 동작)
2. **프레임워크**: React Native CLI (TypeScript)
3. **영속성 계층 (로컬 스토리지 & 파일 DB)**:
   - 앱이 비정상 종료되거나 강제 종료되어도 데이터가 초기화되지 않아야 함.
   - `react-native-mmkv`: 최초 닉네임 설정 여부, 한 달 예상 사용 금액, 뷰 모드(월간/주간), 공휴일 최종 동기화 일시 등 경량 환경설정 저장.
   - `react-native-quick-sqlite`: 일별 거래 내역(지출/적금), 정기 결제 룰, 공휴일/임시공휴일 마스터 데이터(`holidays`) 영구 저장.

---

### [2] 상세 기능 명세 (1~14번 요건 완벽 준수)

#### 1. 온보딩 및 진입 흐름

- 앱 구동 시 MMKV에서 '별명(닉네임)' 저장 여부 확인.
- 미존재 시: 최초 별명 설정 화면 표시 후 저장.
- 존재 시: 온보딩 생략 후 메인 화면(월간 달력)으로 즉시 라우팅.

#### 2. 메인 달력 화면 (월간 / 주간 뷰 모드)

- **기본 화면**: 한 달 기준 달력 (`react-native-calendars` 기반 커스텀 렌더링).
- **뷰 전환**: 월간(한 달 전체) ↔ 주간(해당 주의 월요일~일요일) 토글 지원.
- **월간 뷰 표기**:
  - 각 날짜 셀 하단에 해당 일자에 발생한 총 지출/금액 표기.
- **주간 뷰 표기**:
  - 월~일 순서대로 배치.
  - 각 날짜별 일일 예상 금액과 실제 사용 금액을 순서대로 명시.
  - 일일 예산 초과 여부를 시각적으로 표기.
  - "이번 주 남은 예산 잔액"을 상단에 실시간 카드 형태로 표기 (지출 추가/수정/삭제 시 즉시 재계산 반영).

#### 3. 예산 계산 및 상태 색상 처리

- 설정에서 입력받은 `한 달 예상 사용 금액`을 기준으로 일일 권장 사용 금액 산출:
  $$\text{일일 예상 금액} = \lfloor \frac{\text{한 달 예상 사용 금액}}{\text{해당 월의 총 일수}} \rfloor \quad (\text{소수점 이하 버림})$$
- 날짜별 실제 사용 금액 비교:
  - $\text{당일 사용 금액} \le \text{일일 예상 금액}$: **초록색**으로 표기.
  - $\text{당일 사용 금액} > \text{일일 예상 금액}$: **빨간색**으로 표기.

#### 4. 일별 상세 화면 (CRUD)

- 특정 날짜 클릭 시 해당 일자의 상세 거래 내역 목록 화면 진입.
- 리스트 항목 필드:
  - 구분: `지출` | `적금/저축`
  - 사용금액, 사용처, 지불유형(`카드` | `현금`), 할부여부
  - **비즈니스 룰**: 지불유형이 `현금`인 경우 할부여부는 자동으로 `일시불`로 강제 고정 및 표기.
- 각 결제건에 대한 **추가, 수정, 삭제** 기능 완벽 지원.

#### 5. 공휴일/임시공휴일 동기화 및 오프라인 로컬 캐싱 (중요)

- **초기 Fallback**: 앱 내 기본 법정공휴일 알고리즘/기본 데이터를 내장하여 네트워크 없이도 기본 공휴일 판정 가능하도록 구성.
- **외부 API 동기화 (한국천문연구원 특일 정보 API - getRestDeInfo)**:
  - 앱 시작 시(또는 설정 화면의 '공휴일 동기화' 버튼 클릭 시) 네트워크 연결 여부를 확인하고, 연결 상태일 경우 공공데이터포털 특일 정보 API를 호출하여 해당 연도의 공휴일 및 지정된 임시공휴일/대체공휴일 목록을 수신.
  - 수신된 공휴일 목록(`locdate`, `dateName`, `isHoliday`)을 SQLite `holidays` 테이블에 `INSERT OR REPLACE`로 영구 저장(오프라인 캐싱).
  - 동기화 완료 후 달력 UI 마킹 갱신 및 정기 결제일 롤오버 계산에 즉시 반영.
- **수동 관리**: 설정 화면에서 사용자가 직접 특정 일자를 임시공휴일로 추가하거나 삭제할 수 있는 기능 유지.

#### 6. 정기 결제 관리 및 공휴일/영업일 롤오버 규칙

- 설정 화면에서 매달 반복되는 정기 내역 등록 (설정일자, 구분, 금액, 사용처, 지불유형, 할부여부).
- 등록 즉시 달력의 해당 날짜 합산에 자동 반영되며, 수정 전까지 매월 반복 적용.
- **공휴일/영업일 처리 로직**:
  - 구분이 `적금`, `ETF` 등인 경우: 주말/공휴일 여부와 무관하게 **지정된 원래 날짜**에 그대로 표기.
  - 그 외 일반 `지출`인 경우: SQLite `holidays` 테이블과 주말(토/일) 판정을 결합하여 결제 예정일이 비영업일인 경우 **다음 첫 번째 영업일(평일)**로 자동 이관하여 표기.

#### 7. SMS 및 카카오페이 결제 자동 파싱 (Native Module)

- 안드로이드 네이티브 서비스 구현:
  - `Telephony.SMS_RECEIVED` 브로드캐스트 리시버 (카드 승인 문자 파싱).
  - `NotificationListenerService` (카카오페이 앱 푸시 알림 텍스트 캡처).
- 수신된 승인 텍스트에서 정규표현식(Regex)을 통해 `[일시, 금액, 사용처, 일시불/할부, 구분]`을 자동 추출하여 로컬 SQLite DB에 트랜잭션으로 적재 및 UI 이벤트 전송.

#### 8. 통계 화면 (별도 탭/메뉴)

- **월별 통계**: 선택한 연도의 1~12월 지출 추이를 막대/라인 차트와 수치(합계/평균)로 제공.
- **연도별 통계**: 연도별 총지출 및 저축 추이를 비교 그래프와 테이블 숫자로 제공.
- 차트 라이브러리: `react-native-gifted-charts` 활용.

---

### [4] 프로젝트 구현 히스토리 및 개발자 가이드 (Agent 작업 핸드북)

이 섹션은 지금까지 수행된 주요 아키텍처 개편, 스키마 마이그레이션, 버그 해결 내역을 정리하여 **새로운 AI 에이전트가 이 프로젝트를 즉시 이해하고 작업을 이어받을 수 있도록 기술**되었습니다.

#### 1. 기술 스택 및 서명 키스토어
- **프레임워크**: React Native CLI 0.73.6 + TypeScript
- **데이터베이스 영속성**:
  - `react-native-mmkv`: 닉네임, 한 달 목표 예산, 수동 할부 기입금액 등 Key-Value 저장.
  - `react-native-quick-sqlite`: C++ WAL 모드가 적용된 로컬 SQLite DB (`budget_app.db`).
- **Release APK 빌드 서명**:
  - 키스토어 경로: `android/app/my-release-key.keystore`
  - 별칭(`keyAlias`): `my-key-alias`
  - 비밀번호(`storePassword` / `keyPassword`): `!dnjstjq83`
  - 빌드 명령어: `node scripts/run-build.js window assembleRelease`

#### 2. SQLite 로컬 DB 스키마 (`budget_app.db`)
- `transactions`: ID, 날짜(`YYYY-MM-DD`), 구분(`EXPENSE`|`SAVINGS`), 금액, 가맹점(`merchant`), 지불유형(`CARD`|`CASH`), 카드사명, 할부유형(`LUMP_SUM`|`INSTALLMENT`), 할부개월수, 정기결제여부, 등록일시.
- `recurring_rules`: ID, 설정일자, 매일여부, 반복유형(`DAILY`|`MONTHLY_DAY`|`WEEKLY_DAYS`), 요일배열JSON, 시작일자, 구분, 금액, 가맹점, 지불유형, 카드사명, 할부유형.
- `holidays`: 날짜(`locdate`), 공휴일명, 공휴일여부, 커스텀여부, 수정일시.
- `app_notifications_raw`: ID, 패키지명, 알림제목, 알림본문, 펼침본문, 원문전체(`raw_content`), 수신시각(`post_time`), 보관여부(`is_bookmarked`), 등록일시.
- `parse_exceptions`: ID, 예외단어(`keyword`), PUSH적용여부(`apply_push`), SMS적용여부(`apply_sms`), 등록일시.

#### 3. 핵심 모듈 및 파이프라인 구조
- **파싱 엔진 (`FinancialTextParser.kt`)**:
  - 삼성 RCS 채팅+ JSON 구조(`open_rich_card` Layout) 자동 추출 및 SMS/MMS/푸시 텍스트 통합 파싱.
  - 마케팅 문구(`"드렸어요"`, `"혜택"`, `"쿠폰"`, `"결제예정"`, `"명세서"`, `"이용대금"`) 원천 제외.
  - 결제 취소건(`"취소"`, `"승인취소"`, `"결제취소"`, `"매출취소"`) 자동 감지: 금액을 음수(`-amount`)로 차감 변환하고 가맹점 앞에 `"[취소] "` 태그 부여.
  - 가맹점 명칭 정제: 상호명 끝에 붙은 접미사 `"원"`(예: `제이엔에스(주)원` ➔ `제이엔에스(주)`) 스마트 제거 및 시각 패턴(`20:55`, `21:26`)이 가맹점으로 잘못 인식되는 현상 완전 방지.
- **백그라운드 푸시 리스너 (`AppNotificationListener.kt`)**:
  - Android `NotificationListenerService` 기반 푸시 알림 수신.
  - 파일 버퍼(`filesDir/app_notifications_buffer.json`) 및 SQLite DB(`app_notifications_raw`) 이중 보관.
  - `com.android.systemui`, YouTube Music, 구글 플레이 스토어, LGU+ AI통화비서, android 플레이오, 카카오페이/토스 걸음 수 만보기, 토스 악성 앱 경고 수집 원천 제외 및 DB 자동 소제.
- **수신함 문자 동기화 (`SmsHistoryParserModule.kt`)**:
  - 삼성 RCS 저장소(`content://im/rcs_read_im`), SMS 수신함(`content://sms/inbox`), MMS 저장소(`content://mms`) 탐색.
  - 50건 페이징 컨트롤러 및 항목 클릭 시 원문 상세 POPUP 모달 출력.
- **백업 및 복구 (`backupService.ts`)**:
  - 백업 파일명: `backup_YYYYMMDDhhmmss.txt` (클립보드 복사는 제거, Android Scoped Storage `MediaStore.Downloads` API로 Download 폴더에만 직접 파일 저장).
  - 복구: 안드로이드 서류 탐색기(`SmsHistoryParserModule.pickBackupFileAndRead()`)를 이용한 파일 업로드 선택 복구. (JSON 텍스트 붙여넣기 영역은 제거됨).
  - 백업 파일 수록 항목: 사용자 설정, 거래 내역, 정기 결제, 커스텀 공휴일, 수동 할부금, **수신된 앱 푸시 원문 로그 전체(`rawAppNotifications`)**.

#### 4. UI 및 레이아웃 제약조건
- **월간 달력 셀 배치 (`MainCalendarScreen.tsx`)**:
  - 날짜 숫자 아래 **상단 1줄은 [지출 영역]**, **하단 2줄은 [적금/저축 영역]**으로 위치 고정(`slotRow`).
  - 지출이 없는 날짜도 상단 1줄을 빈 슬롯(공백)으로 유지하여 저축 금액이 위로 치우치지 않음.
  - 고액 금액(백만 원 이상)은 `100만`, `1.0억` 축약 포맷팅과 `adjustsFontSizeToFit` 자동 폰트 스케일링을 적용하여 셀 안에서 `...` 잘림이 발생하지 않음.
- **푸시 알림 로그 화면 (`AppNotificationsScreen.tsx`)**:
  - 상단에 **`🔍 알림 내용 또는 앱 명칭 검색...`** 실시간 검색창 지원.
  - 각 행에 **`[📌 보관]` 체크박스** 탑재: 보관 체크된 항목은 `[전체 비우기]` 또는 30일 자정 자동 청소 시에도 삭제되지 않고 영구 보관됨.
  - 한 화면 50건 페이징 지원 및 상단에 안드로이드 `알림 접근 허용` 설정 바로가기 배너 표시.
- **지출 통계 화면 (`StatisticsScreen.tsx`)**:
  - `월별 지출 추이` 탭 상단에 **`💰 예산 및 지출 요약 카드`** 표시 (목표 예산, 사용한 금액, 남은 예산 잔액 실시간 자동 계산).

#### 5. 절대 준수 수칙 (CRITICAL MANDATORY RULES FOR ALL AGENTS)
1. **정밀 최소 편집 (Surgical Edit Only)**:
   사용자가 지정하고 요청한 기능/파일 이외의 **기존 정상 동작 코드를 절대로 원복하거나 수정하지 마십시오.**
2. **사이드 이펙트 무조건 차단**:
   - `parse_exceptions` 또는 정기 결제 내역 추가/수정 시, `applySms = false`인 예외 단어(예: `"네이버페이"`)를 DB에서 일괄 삭제하지 마십시오.
   - `loadExceptions` 등 화면 진입 시 DB 거래 이력을 함부로 `DELETE` 하지 마십시오.
3. **쉘 파일 수정 금지**:
   파일 수정 시 반드시 `write_file`, `replace_file_content`, `multi_replace_file_content` 도구만 사용하고 `sed`나 `cat` 등 쉘 편집을 절대 사용하지 마십시오.
4. **익일(다음날) 재실행 안정성 보장**:
   - C++ SQLite 핸들은 `getDb()` 내부에서 `SELECT 1;` 헬스체크 및 자동 재연결(Re-open)을 수행해야 합니다.
   - `AppState` 포그라운드 복귀 이벤트를 수신하여 안전하게 DB 및 UI 상태를 갱신해야 합니다.
   - 루트 컴포넌트(`App.tsx`)는 `ErrorBoundary`로 래핑되어 있어 어떠한 예외 상황에서도 검은 화면 멈춤이 발생하지 않아야 합니다.

---

### [5] 기능 변경/추가/삭제 실시간 기록 수칙 (Live Change History Rule)

**★ 중요 원칙**: 모든 AI 에이전트는 사용자의 요청으로 기능이 추가, 수정, 삭제되거나 최적화가 수행될 때마다 **이 [5]번 섹션에 해당 내역을 즉시 기록 업데이트**해야 합니다.

#### 1. 앱 푸시 로그 수집 필터링 및 이력 조회 최신 변경사항 (2026-10 반영 완료)
- **푸시 로그 전체 조회 개부**:
  - 기존 300건 제한(`LIMIT 300`)을 완전히 해제하여 30일 이내에 저장된 **전체 푸시 알림을 50건 페이징 컨트롤러**로 모두 조회할 수 있도록 변경.
- **현대카드 푸시 저장 보완**:
  - 현대카드(`com.hyundaicard.appcard`) 수신 알림이 React Native QuickSQLite DB 경로(`filesDir/budget_app.db`) 및 Android 네이티브 경로 양쪽에 이중 보관되어 100% 저장/노출되도록 보완.
- **무효 앱 푸시 수집 원천 제외 & 기존 DB 이력 소제**:
  1. `com.android.systemui`: 시스템 알림 제외.
  2. `com.google.android.apps.youtube.music`: 유튜브 뮤직 재생 알림 제외.
  3. `com.android.vending`: 구글 플레이 스토어 앱 업데이트 알림 제외.
  4. `com.lguplus.aicallagent`: LGU+ AI통화비서 알림 수집 제외 & DB 소제.
  5. `android` + `"플레이오"`: android 시스템 알림 중 '플레이오' 포함 알림 수집 제외 & DB 소제.
  6. `kakaopay` + `"걸음"` / `"만보기"`: 카카오페이 만보기 알림 제외.
  7. `viva.republica.toss` + `"악성 앱"` / `"악성앱"` / `"악성"`: 토스 보안 경고 알림 제외.
- **동일 앱 당일 중복 푸시 수집 차단**:
  - 동일 발신 앱(`package_name`), 동일 postTime 일자(`YYYY-MM-DD`), 동일 제목(`title`)이 기존 DB에 수록되어 있으면 중복 수집을 원천 스킵 처리.

#### 2. 데이터 복구 단계별 순서 규칙 (2026-10 반영 완료)
- **1순위 (1-1)**: 백업 파일(`backup_*.txt`) 내에 저장된 거래 내역, 정기 결제, 공휴일, 수동 할부금, 앱 푸시 원문 로그를 DB에 1순위로 즉시 복원.
- **2순위 (1-2)**: 백업 복원 완료 후, 스마트폰 수신함(RCS, SMS, MMS) 및 활성 앱 푸시를 스캔하여 **기존 복원된 DB에 존재하지 않는 신규 결제건만 찾아 DB에 추가 기록**.

#### 3. 현대카드 bigText 파싱, 버퍼 소제, 주간/일간뷰 스와이프 제스처 (2026-10 반영 완료)
- **현대카드 bigText 특화 파싱**:
  - 현대카드 앱 푸시/문자 승인 알림 수신 시 2번째 줄(`Line 2`)에 위치한 가맹점 명칭(예: `남한강휴게주유소식당가`)을 가맹점으로 정확하게 추출하도록 정밀 파서 특화 패턴 추가.
- **앱 푸시 로그 삭제 시 파일 버퍼(`app_notifications_buffer.json`) 동시 동기 소제**:
  - `clearAppNotificationsBuffer(targetId)` 네이티브 모듈 연동으로 푸시 로그 삭제 후 재동기화 시 삭제된 로그가 재수록되지 않고 완벽하게 제거됨.
- **주간뷰 / 일간뷰 좌우 슬라이드(스와이프) 제스처 이동**:
  - `PanResponder`를 도입하여 주간뷰(오른쪽 스와이프=지난주, 왼쪽 스와이프=다음주) 및 일간뷰(오른쪽 스와이프=전날, 왼쪽 스와이프=다음날) 터치 슬라이드 이동 완벽 연동.


#### 4. 통계 > 연도별 비교 적금/저축 합계 누락 수정 및 당일 이하 합산 규칙 적용 (2026-10 반영 완료)
- **연도별 비교(`StatisticsScreen.tsx`) 적금/저축 및 정기결제 합산 보완**:
  - `yearlyComparisonData`, `getSavingsStatsForYear`, `getCardCompanyStatsForYear`에서 `transactions` 테이블뿐만 아니라 `recurring_rules`(정기 결제/적금)의 연간(1~12월) 도래 내역을 함께 집계하도록 수정하여 연도별 비교 탭에서 적금/저축 합계가 `0`으로 표기되던 현상 해결.
- **적금/저축 합계 조회 당일(`todayStr`) 포함 이전 일 기록만 합산**:
  - 일반 거래(`transactions`) 및 정기 적금(`recurring_rules`) 모두 시작일 이후부터 **조회 당일 포함 이전 일(`<= todayStr`)**의 기록만 합산되도록 필터링 적용.
- **월간/주간/일간뷰 좌우 슬라이드(스와이프) 제스처 안정화 보완**:
  - `DailyDetailScreen.tsx`: `useRef` 내부의 `currentDateStr` 클로저 고착(Stale Closure)으로 인해 2회차 이상 연속 스와이프가 동작하지 않던 버그를 함수형 상태 업데이트(`setCurrentDateStr((prev) => ...)`)로 해결.
  - `MainCalendarScreen.tsx` & `DailyDetailScreen.tsx`: 날짜 셀(`TouchableOpacity`), 거래 카드(`Pressable`), 스크롤 뷰(`ScrollView`/`FlatList`) 위에서 슬라이드할 때 터치가 뺏기거나 취소되지 않도록 `onMoveShouldSetPanResponderCapture`, `onPanResponderTerminationRequest`, `onPanResponderTerminate`를 모두 적용하고, 월간 뷰 달력(`Calendar`)에도 `monthlyPanResponder` 및 `key={currentYearMonth}` 동기화를 추가하여 좌우 월 이동 스와이프를 완벽 지원.
- **백업 파일 복구 시 앱 푸시 로그 영구보관(`is_bookmarked`) 체크 상태 복원 보완**:
  - `backupService.ts`: `restoreFromBackupJson`에서 `app_notifications_raw` 테이블 인서트 시 누락되어 있던 `is_bookmarked` 컬럼 값을 함께 저장하고, 이미 DB에 동일 알림이 존재하던 경우에도 `isBookmarked === true`인 항목은 `UPDATE ... SET is_bookmarked = 1`로 갱신하여 영구보관 체크 상태가 해제되지 않고 그대로 복원되도록 수정.
