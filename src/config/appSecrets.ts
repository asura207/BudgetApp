export interface AppSecretsConfig {
  API_BASE_URL: string;
  BUGET_API_KEY: string;
  BUGET_HMAC_SECRET: string;
  HOLIDAY_API_KEY: string;
}

// 루트의 gitignored 외부 설정 파일(app.secrets.json)에서 API 키 및 서버 주소를 로드합니다.
// 신규 환경에서는 app.secrets.example.json을 복사하여 app.secrets.json을 생성해야 합니다.
const rawSecrets: Partial<AppSecretsConfig> = require('../../app.secrets.json');

export const APP_SECRETS: AppSecretsConfig = {
  API_BASE_URL: (rawSecrets.API_BASE_URL || '').trim().replace(/\/+$/, ''),
  BUGET_API_KEY: (rawSecrets.BUGET_API_KEY || '').trim(),
  BUGET_HMAC_SECRET: (rawSecrets.BUGET_HMAC_SECRET || '').trim(),
  HOLIDAY_API_KEY: (rawSecrets.HOLIDAY_API_KEY || '').trim(),
};

