import React, { useEffect } from 'react';
import { StatusBar, StyleSheet, AppState, AppStateStatus, DeviceEventEmitter } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AppNavigator } from './src/navigation/AppNavigator';
import { subscribeNativePaymentEvents } from './src/services/nativeParserBridge';
import { ErrorBoundary } from './src/components/common/ErrorBoundary';
import { getDb } from './src/database/db';
import { backupService } from './src/services/backupService';

const App = () => {
  useEffect(() => {
    // 0. 매일 앱이 실행되거나 포그라운드로 올라올 때 1일 1회 로컬 파일 및 원격 DB 자동 백업 실행
    backupService.runDailyAutoBackup();

    // 1. 네이티브 자동 파싱 결제 이벤트 구독
    const subscription = subscribeNativePaymentEvents((tx) => {
      console.log('✅ SMS/푸시 결제 파싱 자동 등록 완료:', tx);
    });

    // 2. 앱이 백그라운드에서 다음날(익일) 포그라운드로 복귀할 때 상태 자동 갱신 및 DB 연결 복구
    const appStateSub = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        try {
          // DB C++ 핸들 유효성 점검 및 필요시 자동 재오픈
          getDb();
          // 화면의 날짜 및 계산 상태 실시간 재로드 트리거
          DeviceEventEmitter.emit('TRANSACTION_UPDATED');
          // 복귀 시 일일 백업 체크
          backupService.runDailyAutoBackup();
        } catch (e) {
          console.warn('AppState foreground resume error:', e);
        }
      }
    });

    return () => {
      subscription.remove();
      appStateSub.remove();
    };
  }, []);

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
          <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
          <AppNavigator />
        </SafeAreaView>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
});

export default App;
