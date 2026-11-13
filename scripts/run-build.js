const { spawn, execSync } = require('child_process');
const path = require('path');
const { getEnvironmentConfig, setupLocalProperties } = require('./setup-env');

function main() {
  const targetEnv = process.argv[2];
  const taskName = process.argv[3] || 'app:installDebug';
  const { envKey, envConfig } = getEnvironmentConfig(targetEnv);

  console.log(`🚀 [${envKey.toUpperCase()}] 환경으로 컴파일 및 빌드를 시작합니다...`);

  // 1. android/local.properties 생성 및 갱신
  setupLocalProperties(envKey, envConfig);

  // 2. 프로세스 환경변수 주입
  const env = { ...process.env };
  env.JAVA_HOME = envConfig.JAVA_HOME;
  env.ANDROID_HOME = envConfig.ANDROID_HOME;
  env.ANDROID_SDK_ROOT = envConfig.ANDROID_HOME;

  // Android Preferences 중복 환경변수 충돌 방지
  delete env.ANDROID_PREFS_ROOT;
  delete env.ANDROID_SDK_HOME;
  delete env.JAVA_TOOL_OPTIONS;
  delete env.GRADLE_OPTS;
  env.ANDROID_USER_HOME = path.join(process.env.USERPROFILE || 'C:\\Users\\sir', '.android');

  const pathSeparator = process.platform === 'win32' ? ';' : ':';
  const nodeBin = path.dirname(process.execPath);
  const javaBin = path.join(envConfig.JAVA_HOME, 'bin');
  const androidTools = path.join(envConfig.ANDROID_HOME, 'platform-tools');
  const androidEmulator = path.join(envConfig.ANDROID_HOME, 'emulator');

  const additionalPaths = [nodeBin, javaBin, androidTools, androidEmulator];
  if (envConfig.platformTools) {
    additionalPaths.push(envConfig.platformTools);
  }

  // Windows 환경변수 대소문자(Path, PATH, path) 중복 방지 및 갱신
  const pathKey = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH') || 'PATH';
  const existingPath = process.env[pathKey] || '';

  delete env.PATH;
  delete env.Path;
  delete env.path;

  env[pathKey] = `${additionalPaths.join(pathSeparator)}${pathSeparator}${existingPath}`;

  console.log(`📌 주입된 환경변수:`);
  console.log(`   JAVA_HOME   : ${env.JAVA_HOME}`);
  console.log(`   ANDROID_HOME: ${env.ANDROID_HOME}`);

  // 3. 서명 충돌(INSTALL_FAILED_UPDATE_INCOMPATIBLE) 방지를 위한 기존 앱 자동 제거
  if (taskName === 'app:installDebug') {
    try {
      execSync('adb uninstall com.budgetapp', { env, stdio: 'ignore' });
    } catch (e) {
      // 설치되어 있지 않은 경우 무시
    }
  }

  // 4. Gradle 빌드
  const isWindows = process.platform === 'win32';
  const gradlewCmd = isWindows ? 'gradlew.bat' : './gradlew';
  const androidDir = path.resolve(__dirname, '../android');

  console.log(`\n▶️ 실행 명령어: ${gradlewCmd} ${taskName}\n`);

  const child = spawn(gradlewCmd, [taskName], {
    cwd: androidDir,
    env,
    stdio: 'inherit',
    shell: true,
  });

  child.on('close', (code) => {
    if (code === 0) {
      if (taskName === 'app:installDebug') {
        console.log(`\n📲 앱 설치 성공! 에뮬레이터 설정 및 앱을 구동합니다...`);
        try {
          execSync('adb shell settings put secure stylus_handwriting_enabled 0', { env, stdio: 'inherit' });
          execSync('adb shell settings put global stylus_handwriting_enabled 0', { env, stdio: 'inherit' });
          execSync('adb reverse tcp:8081 tcp:8081', { env, stdio: 'inherit' });
          execSync('adb shell am start -n com.budgetapp/.MainActivity', { env, stdio: 'inherit' });
          console.log(`\n🎉 [${envKey.toUpperCase()}] 빌드 및 앱 실행 완벽 완료!`);
        } catch (err) {
          console.warn(`⚠️ 앱 자동 실행 중 안내:`, err.message);
        }
      } else {
        console.log(`\n🎉 [${envKey.toUpperCase()}] 빌드 완료! (${taskName})`);
        if (taskName === 'assembleRelease' || taskName === 'app:assembleRelease') {
          console.log(`\n📦 빌드된 Release APK를 install 폴더로 복사합니다...`);
          try {
            const fs = require('fs');
            const sourceApk = path.join(__dirname, '../android/app/build/outputs/apk/release/app-release.apk');
            const installDir = path.join(__dirname, '../install');
            if (!fs.existsSync(installDir)) {
              fs.mkdirSync(installDir);
            }
            const destApk = path.join(installDir, 'app-release.apk');
            fs.copyFileSync(sourceApk, destApk);
            console.log(`✅ APK 복사 완료: install/app-release.apk`);
          } catch(err) {
            console.error(`❌ APK 복사 실패:`, err.message);
          }
        }
      }
    } else {
      console.error(`\n❌ 빌드 중 오류 발생 (종료 코드: ${code})`);
      process.exit(code || 1);
    }
  });
}

main();
