# 📊 예산 가계부 (BudgetApp)

안드로이드 전용 오프라인 기반 스탠드얼론 가계부 앱입니다. 사용자의 문자(SMS, MMS, RCS) 및 앱 푸시(App Push) 알림을 네이티브 단에서 자동 파싱하여 실시간으로 가계부 지출 내역에 연동합니다. 또한, 매일 로컬 파일 및 원격 PostgreSQL DB로 자동 백업 기능을 제공하여 데이터 유실을 방지합니다.

---

## ✨ 주요 기능

1. **지능형 결제 내역 자동 파싱 (Native Module)**
   - 삼성 갤럭시 RCS 채팅+, SMS, MMS 대화함 스캔 및 결제 내역 추출.
   - 백그라운드 **앱 푸시 알림 리스너(`NotificationListenerService`)** 탑재. 현대카드, 삼성카드 등 주요 카드사 및 금융 앱의 결제 알림을 즉시 가계부에 등록.
   - 마케팅 알림, 시스템 알림(시스템 UI, 유튜브 뮤직, 플레이오, 구글플레이 등), 만보기/악성앱 경고 등 불필요한 알림은 자동 필터링 및 DB 소제 처리.
2. **캘린더 뷰 (월간 / 주간)**
   - 달력 UI에서 1일 사용 권장 예산 대비 지출액을 직관적으로 확인 (초과 시 빨간색, 예산 내 초록색).
   - 좌우 스와이프(제스처)를 통한 부드러운 지난주/다음주, 전날/다음날 이동 지원.
3. **독립적인 월별 예산 관리**
   - 글로벌 목표 예산을 기본으로 하되, 과거 달의 예산과 현재 달의 예산을 독립적으로 분리 저장하여 통계의 정확성 보장.
4. **정기 결제 및 공휴일 롤오버**
   - 한국천문연구원 API 연동으로 매년 법정 공휴일 자동 동기화.
   - 고정 지출일이 주말/공휴일인 경우, 다음 첫 번째 영업일(평일)로 결제일을 자동 이관하여 달력에 표시.
5. **강력한 데이터 백업 & 복원 시스템 (로컬/원격)**
   - **사용자 고유 키(6자리 영문/숫자)** 발급을 통한 다중 사용자 원격 DB(PostgreSQL) 분리 저장.
   - 매일 앱 최초 실행 시 로컬 `Download` 폴더 내 백업 파일(.txt) 자동 교체(Rotation) 및 원격 DB 자동 동기화. (설정에서 On/Off 가능)
   - 앱 재설치 시 **로컬 파일 업로드 복원** 및 **고유 키 입력 원격 복원** 두 가지 옵션 제공.

---

## 🛠 기술 스택

- **Frontend**: React Native CLI 0.73.6 (TypeScript)
- **Local DB / Storage**: `react-native-quick-sqlite` (C++ WAL mode SQLite), `react-native-mmkv`
- **Native Modules (Android/Kotlin)**: BroadcastReceiver, NotificationListenerService, MediaStore API
- **Remote DB & Backend (연동)**: Python FastAPI, PostgreSQL (`prompt_backend.md` 참고)

---

## 🚀 설치 및 로컬 실행 가이드

이 프로젝트는 안드로이드 전용(Android Standalone)으로 구성되어 있습니다.

### 1. 사전 요구사항 (Prerequisites)
- [Node.js](https://nodejs.org/) (v18 이상 권장)
- [Java Development Kit (JDK)](https://adoptium.net/) 17
- [Android Studio](https://developer.android.com/studio) 및 Android SDK (API 34 권장)
- 안드로이드 환경 변수(`ANDROID_HOME`, `JAVA_HOME`) 설정 완료

### 2. 패키지 설치
프로젝트 루트 디렉토리에서 아래 명령어를 실행하여 의존성 패키지를 설치합니다.
(피어 디펜던시 충돌을 방지하기 위해 `--legacy-peer-deps` 옵션 사용 권장)
```bash
npm install --legacy-peer-deps
```

### 3. 안드로이드 디바이스 연결 및 실행
안드로이드 물리 기기를 USB로 연결하거나, Android 에뮬레이터를 실행한 후 아래 명령어를 입력합니다.
```bash
npx react-native run-android
```

> **주의**: 앱 푸시 알림 수집 기능(`NotificationListenerService`)은 물리 기기에서 '알림 접근 허용' 권한을 활성화해야 정상 작동합니다.

### 4. 📲 안드로이드 기기에 바로 설치하기 (APK)
PC 개발 환경(Node, Android Studio 등)을 구축하기 번거롭다면, 본 저장소에 미리 빌드되어 준비된 완성본 설치 파일을 다운로드하여 스마트폰에 직접 설치하실 수 있습니다.

- **APK 다운로드 위치**: [install/app-release.apk](./install/app-release.apk)
- **설치 방법**:
  1. 위 파일을 안드로이드 스마트폰으로 다운로드합니다.
  2. 다운로드된 `app-release.apk` 파일을 터치하여 실행합니다.
  3. "출처를 알 수 없는 앱" 경고가 뜨면 `무시하고 설치(허용)`를 선택합니다.
  4. 설치가 완료되면 앱을 열고 **알림 접근 허용** 권한을 부여한 뒤 즉시 가계부 자동 기록을 시작합니다!

---

## 📦 릴리즈(Release) APK 빌드 가이드

앱 스토어 배포용 또는 실사용 설치용 릴리즈 APK를 추출하는 방법입니다.
프로젝트 루트에는 빌드 자동화 스크립트(`scripts/run-build.js`)가 내장되어 있습니다.

**Release 키스토어 정보 (내장됨)**
- 위치: `android/app/my-release-key.keystore`
- Key Alias: `my-key-alias`
- Key Password / Store Password: `!dnjstjq83`

**Windows 환경 빌드 명령어**
```bash
node scripts/run-build.js window assembleRelease
```
**Mac/Linux 환경 빌드 명령어**
```bash
node scripts/run-build.js mac assembleRelease
```
빌드가 완료되면 아래 경로에 `.apk` 파일이 생성됩니다.
➔ `android/app/build/outputs/apk/release/app-release.apk`

---

## 🌐 원격 DB(PostgreSQL) 연동 설정 

앱은 기기 자체 로컬 DB(SQLite)만으로도 100% 동작하지만, 휴대폰 분실 및 기기 변경에 대비해 원격 DB 동기화를 지원합니다.

1. **백엔드 서버 기동**: 
   루트 디렉토리의 `prompt_backend.md` 파일에 정의된 명세에 따라 **Python FastAPI 백엔드 서버**를 구동해야 합니다.
2. **API 엔드포인트 수정**:
   `src/services/backupService.ts` 내의 `fetch` URL을 실제 백엔드가 구동 중인 서버 IP 및 포트(예: `http://218.234.55.78:8000`)로 맞춰주세요. (CORS 허용 필수)
3. **앱 내 방화벽 해제**:
   `android/app/src/main/AndroidManifest.xml`에 `<application android:usesCleartextTraffic="true">`가 선언되어 있어 HTTP 통신이 가능합니다.

---

## 🤝 유지보수 및 주요 소스코드 위치

- **`src/services/backupService.ts`**: 로컬/원격 백업 및 복원, 매일 자동 백업 로테이션 스케줄러 로직.
- **`android/app/src/main/java/com/budgetapp/notification/AppNotificationListener.kt`**: 백그라운드 푸시 알림 수신, 필터링(가맹점 이름, 취소 건 등), 영구 보관(`is_bookmarked=1`) 처리.
- **`src/storage/mmkv.ts`**: 월별 목표 예산(`getMonthlyBudget`), 사용자 고유 키(`userKey`), 백업 토글 상태 등의 초고속 K-V 스토리지 래퍼.
- **`android/app/src/main/java/com/budgetapp/bridge/FinancialTextParser.kt`**: 안드로이드 네이티브 단에서 동작하는 정밀한 정규표현식(Regex) 기반 카드/은행사 결제 문구 파싱 엔진.
