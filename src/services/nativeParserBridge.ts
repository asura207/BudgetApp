import { DeviceEventEmitter, EmitterSubscription } from 'react-native';
import { transactionDao } from '../database/transactionDao';
import { Transaction } from '../types/budget';

let lastEventKey = '';
let lastEventTime = 0;

export const subscribeNativePaymentEvents = (
  onInserted?: (tx: Transaction) => void
): EmitterSubscription => {
  return DeviceEventEmitter.addListener(
    'onPaymentParsed',
    (event: {
      date: string;
      amount: number;
      merchant: string;
      paymentType: string;
      cardCompany?: string;
      installmentType: string;
      installmentMonths: number;
      createdAt?: string;
    }) => {
      try {
        const now = Date.now();
        const eventKey = `${event.date}_${event.amount}_${event.merchant}_${event.createdAt || ''}`;

        // 2초 이내 동일 이벤트 발생 시 중복 등록 방지 (Deduplication)
        if (eventKey === lastEventKey && now - lastEventTime < 2000) {
          console.log('⚠️ 중복 결제 파싱 이벤트 차단:', eventKey);
          return;
        }

        lastEventKey = eventKey;
        lastEventTime = now;

        const tx: Transaction = {
          id: `${now}_${Math.random().toString(36).substring(2, 7)}`,
          date: event.date,
          categoryType: 'EXPENSE',
          amount: event.amount,
          merchant: event.merchant,
          paymentType: event.paymentType === 'CASH' ? 'CASH' : 'CARD',
          cardCompany: event.cardCompany || (event.paymentType === 'CARD' ? '카드' : undefined),
          installmentType:
            event.installmentType === 'INSTALLMENT' ? 'INSTALLMENT' : 'LUMP_SUM',
          installmentMonths: event.installmentMonths || 1,
          isRecurring: false,
          createdAt: event.createdAt,
        };

        transactionDao.insertTransaction(tx);
        if (onInserted) {
          onInserted(tx);
        }
      } catch (err) {
        console.warn('Native payment event insert failed:', err);
      }
    }
  );
};

export const syncMissedBackgroundEvents = async () => {
  try {
    const { NativeModules } = require('react-native');
    const { getNicknameCreatedAt } = require('../storage/mmkv');
    const { appNotificationDao } = require('../database/appNotificationDao');

    // 백그라운드 파일 버퍼(app_notifications_buffer.json)에 쌓인 푸시 로그를 먼저 DB로 수록 동기화
    await appNotificationDao.syncNativeBufferToDb();

    if (NativeModules.SmsHistoryParserModule && typeof NativeModules.SmsHistoryParserModule.syncSmsHistoryForDate === 'function') {
      const nicknameDate = getNicknameCreatedAt() || 'ALL';
      const result = await NativeModules.SmsHistoryParserModule.syncSmsHistoryForDate(nicknameDate);
      if (result && result.count > 0) {
        console.log(`🔄 백그라운드 유실 푸시/SMS 동기화 완료: ${result.count}건 복구`);
      }
    }
  } catch (e) {
    console.warn('Background event sync error:', e);
  }
};
