당신은 모바일 풀스택 시니어 소프트웨어 엔지니어이자 파이썬 백엔드(FastAPI) 설계 전문가입니다.
현재 모바일 프론트엔드(React Native) 앱에서 발생하는 **PostgreSQL JDBC 직접 연결 방식의 안드로이드 호환성 문제(`NoClassDefFoundError: ManagementFactory` 및 `SCRAM-SHA-256 Auth Type 10` 오류)**를 우회하기 위해, 데이터베이스 트랜잭션을 전담할 **Python FastAPI 기반 미들웨어 백엔드 서버**를 구축하려고 합니다.

아래 명세와 요구사항에 맞춰 Python API 서버 구동 스크립트(또는 프로젝트 구조)를 작성해 주세요.

---

### [1] 백엔드 기술 스택
1. **Framework**: Python FastAPI
2. **Server**: Uvicorn
3. **Database Client**: `psycopg2` (또는 `asyncpg`)
4. **Target DB**: PostgreSQL (호스트: `218.234.55.78:5432`, DB명: `buget`, 계정: `buget`, 비밀번호: `buget123$%^`)

---

### [2] 데이터베이스 스키마
모바일 앱이 전송하는 JSON 페이로드를 받아 저장할 대상 테이블 구조입니다. (모든 테이블은 `user_key`를 복합 기본키로 갖습니다.)

- `transactions`
- `recurring_rules`
- `holidays`
- `app_notifications_raw` (여기서는 `is_bookmarked` 필드가 true 인 항목만 넘어옵니다)
- `parse_exceptions`
- `manual_installments`
- `user_settings`

> 참고: 테이블 생성은 모바일 쪽이 아닌 이 백엔드 서버 기동 시 `CREATE TABLE IF NOT EXISTS`를 통해 자동으로 준비되도록 구성해 주세요.

---

### [3] API 엔드포인트 명세

#### 1. 백업(업로드) API
- **Endpoint**: `POST /api/backup/{user_key}`
- **Request Body**: JSON Payload (앱에서 추출된 전체 백업 객체)
- **로직 동작**:
  1. 클라이언트가 넘긴 `user_key`에 해당하는 위 7개 테이블의 기존 데이터를 일괄 `DELETE` (사용자 데이터 초기화).
  2. 수신된 JSON Payload 내부의 각 배열/객체를 순회하며 `INSERT` 쿼리 수행.
  3. 모든 처리는 하나의 Transaction(`BEGIN` ~ `COMMIT`)으로 묶여야 하며, 실패 시 자동 `ROLLBACK` 되어야 함.
- **Response**: `{ "success": true, "message": "백업 성공" }`

#### 2. 복구(다운로드) API
- **Endpoint**: `GET /api/restore/{user_key}`
- **로직 동작**:
  1. `user_key` 조건으로 7개 테이블에서 데이터를 각각 `SELECT`.
  2. 조회된 데이터를 모바일 앱이 요구하는 원본 JSON 트리 구조와 동일하게 재조립.
- **Response**: 전체 데이터가 담긴 JSON 객체 반환.

---

### [4] 주요 요구사항 및 예외 처리
- 모바일(React Native) 앱에서 바로 호출 가능하도록 **CORS(Cross-Origin Resource Sharing)** 설정을 반드시 허용(Allow All `*`)해 주세요.
- Pydantic 모델을 이용하여 모바일에서 전송되는 JSON의 유효성(Validation)을 검증해도 좋고, 동적 `dict` 파싱으로 가볍게 처리해도 무방합니다.
- 데이터베이스 트랜잭션 중 발생한 에러(Exception)는 `HTTP 500`과 함께 에러 메시지를 JSON 형태로 모바일 앱에 반환하여, 앱 화면 팝업에서 무슨 에러인지 식별할 수 있게 해주세요.

---

위 명세에 맞춰 1개의 단일 파일(예: `main.py`)로 구동 가능한 완전한 FastAPI 코드를 생성해 주시면 됩니다.
생성 완료 후, 이 서버를 실행할 포트(예: 8000번)와 최종 API 기본 주소(Base URL)를 저에게 알려주세요.
