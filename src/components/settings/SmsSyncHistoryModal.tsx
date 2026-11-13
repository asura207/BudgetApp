import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  NativeModules,
  Pressable,
} from 'react-native';
import dayjs from 'dayjs';

const { SmsHistoryParserModule } = NativeModules;

interface SmsMessageItem {
  id: string;
  receivedTime: string;
  body: string;
  isTarget: boolean;
  cardCompany?: string;
  amount?: number;
  merchant?: string;
}

interface SmsSyncHistoryModalProps {
  visible: boolean;
  onClose: () => void;
}

export const SmsSyncHistoryModal: React.FC<SmsSyncHistoryModalProps> = ({
  visible,
  onClose,
}) => {
  const [messages, setMessages] = useState<SmsMessageItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // ROW 클릭 시 메시지 상세 POPUP 모달 상태
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedMsg, setSelectedMsg] = useState<SmsMessageItem | null>(null);

  const pageSize = 50; // 한 화면에 50건씩 페이징 처리

  useEffect(() => {
    if (visible) {
      setCurrentPage(1);
      loadInboxMessages();
    }
  }, [visible]);

  const loadInboxMessages = async () => {
    setIsLoading(true);
    try {
      if (SmsHistoryParserModule && typeof SmsHistoryParserModule.getInboxMessagesForInspection === 'function') {
        const rawList: any[] = await SmsHistoryParserModule.getInboxMessagesForInspection();

        const parsedItems: SmsMessageItem[] = (rawList || []).map((item, idx) => ({
          id: item.id || `msg_${idx}_${Date.now()}`,
          receivedTime: item.receivedTime || dayjs().format('YYYY-MM-DD HH:mm:ss'),
          body: item.body || '(문자 내용)',
          isTarget: Boolean(item.isTarget),
          cardCompany: item.cardCompany || '카드',
          amount: item.amount || 0,
          merchant: item.merchant || '사용처',
        }));

        setMessages(parsedItems);
      }
    } catch (e) {
      // Ignore
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectRow = (item: SmsMessageItem) => {
    setSelectedMsg(item);
    setDetailModalVisible(true);
  };

  const totalPages = Math.ceil(messages.length / pageSize) || 1;
  const safePage = Math.min(currentPage, totalPages);
  const paginatedMessages = messages.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  );

  const renderHeader = () => (
    <View style={styles.tableHeader}>
      <Text style={[styles.th, { flex: 1.2 }]}>수신 시각</Text>
      <Text style={[styles.th, { flex: 2.2 }]}>문자 / RCS 내용 (터치하여 상세)</Text>
      <Text style={[styles.th, { flex: 1.1 }]}>파싱 대상</Text>
    </View>
  );

  const renderItem = ({ item }: { item: SmsMessageItem }) => {
    return (
      <Pressable
        style={({ pressed }) => [styles.tableRow, pressed && { backgroundColor: '#E3F2FD' }]}
        onPress={() => handleSelectRow(item)}
      >
        <Text style={[styles.tdTime, { flex: 1.2 }]}>{item.receivedTime}</Text>
        <View style={{ flex: 2.2 }}>
          <Text style={styles.tdBody} numberOfLines={3}>
            {item.body}
          </Text>
          {item.isTarget && item.amount !== undefined && item.amount > 0 && (
            <Text style={styles.tdParsedDetail}>
              💳 {item.cardCompany} | {item.merchant} | {item.amount.toLocaleString()}원
            </Text>
          )}
        </View>
        <View style={{ flex: 1.1, alignItems: 'center' }}>
          <View style={[styles.badge, item.isTarget ? styles.targetBadge : styles.nonTargetBadge]}>
            <Text style={[styles.badgeText, item.isTarget ? styles.targetBadgeText : styles.nonTargetBadgeText]}>
              {item.isTarget ? '⭕ 파싱 대상' : '❌ 비대상'}
            </Text>
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>📋 수신함 결제 문자 동기화 파싱 내역</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.noticeText}>
            수신함 문자 중 카드 결제 조건에 부합하는 문자는 **[⭕ 파싱 대상]**으로 자동 수록되고, 일반/광고/예외 문자는 **[❌ 비대상]**으로 분류됩니다. (행 터치 시 상세 원문 조회)
          </Text>

          {isLoading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color="#2196F3" />
              <Text style={styles.loadingText}>수신함 결제 문자를 스캔 중입니다...</Text>
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <FlatList
                data={paginatedMessages}
                keyExtractor={(item) => item.id}
                ListHeaderComponent={renderHeader}
                renderItem={renderItem}
                contentContainerStyle={{ paddingVertical: 6 }}
                ListEmptyComponent={
                  <View style={styles.emptyBox}>
                    <Text style={styles.emptyText}>동기화 스캔된 결제 문자 내역이 없습니다.</Text>
                  </View>
                }
              />

              {/* 한 화면 50건 페이징 컨트롤러 */}
              <View style={styles.paginationRow}>
                <TouchableOpacity
                  style={[styles.pageBtn, safePage <= 1 && styles.disabledPageBtn]}
                  disabled={safePage <= 1}
                  onPress={() => setCurrentPage(Math.max(1, safePage - 1))}
                >
                  <Text style={[styles.pageBtnText, safePage <= 1 && styles.disabledPageBtnText]}>
                    ◀ 이전 50건
                  </Text>
                </TouchableOpacity>

                <Text style={styles.pageInfoText}>
                  {safePage} / {totalPages} 페이지 (총 {messages.length}건)
                </Text>

                <TouchableOpacity
                  style={[styles.pageBtn, safePage >= totalPages && styles.disabledPageBtn]}
                  disabled={safePage >= totalPages}
                  onPress={() => setCurrentPage(Math.min(totalPages, safePage + 1))}
                >
                  <Text style={[styles.pageBtnText, safePage >= totalPages && styles.disabledPageBtnText]}>
                    다음 50건 ▶
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <TouchableOpacity style={styles.bottomCloseBtn} onPress={onClose}>
            <Text style={styles.bottomCloseBtnText}>닫기</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 행(ROW) 터치 시 문자/RCS 상세 POPUP 모달 */}
      <Modal
        visible={detailModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDetailModalVisible(false)}
      >
        <View style={styles.detailOverlay}>
          <View style={styles.detailContainer}>
            <View style={styles.headerRow}>
              <Text style={styles.detailTitle}>📱 수신된 결제 문자 / RCS 원문 상세</Text>
              <TouchableOpacity onPress={() => setDetailModalVisible(false)}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {selectedMsg && (
              <View style={styles.detailContent}>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>수신 시각:</Text>
                  <Text style={styles.detailVal}>{selectedMsg.receivedTime}</Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>파싱 대상 여부:</Text>
                  <Text style={[styles.detailVal, selectedMsg.isTarget ? { color: '#2E7D32', fontWeight: 'bold' } : { color: '#C62828' }]}>
                    {selectedMsg.isTarget ? '⭕ 파싱 대상 (가계부 자동 수록)' : '❌ 비대상 (파싱 제외)'}
                  </Text>
                </View>

                {selectedMsg.isTarget && (
                  <>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>카드사 / 결제수단:</Text>
                      <Text style={styles.detailVal}>{selectedMsg.cardCompany || '카드'}</Text>
                    </View>

                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>가맹점 / 사용처:</Text>
                      <Text style={styles.detailVal}>{selectedMsg.merchant || '사용처'}</Text>
                    </View>

                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>결제 금액:</Text>
                      <Text style={[styles.detailVal, { color: '#D32F2F', fontWeight: 'bold' }]}>
                        {selectedMsg.amount ? `${selectedMsg.amount.toLocaleString()} 원` : '-'}
                      </Text>
                    </View>
                  </>
                )}

                <Text style={styles.rawTextHeader}>📩 문자 / RCS 원문 메시지 내용:</Text>
                <View style={styles.rawTextContainer}>
                  <Text style={styles.rawBodyText}>{selectedMsg.body}</Text>
                </View>
              </View>
            )}

            <TouchableOpacity
              style={styles.detailCloseBtn}
              onPress={() => setDetailModalVisible(false)}
            >
              <Text style={styles.detailCloseBtnText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 16,
  },
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    maxHeight: '92%',
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212121',
  },
  closeBtn: {
    padding: 4,
  },
  closeBtnText: {
    fontSize: 18,
    color: '#757575',
    fontWeight: 'bold',
  },
  noticeText: {
    fontSize: 11,
    color: '#616161',
    backgroundColor: '#E3F2FD',
    padding: 10,
    borderRadius: 6,
    marginBottom: 10,
    lineHeight: 16,
  },
  loadingBox: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 13,
    color: '#666666',
    marginTop: 10,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#37474F',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginBottom: 6,
  },
  th: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  tableRow: {
    flexDirection: 'row',
    backgroundColor: '#FAFAFA',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginBottom: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EEEEEE',
  },
  tdTime: {
    fontSize: 11,
    color: '#616161',
  },
  tdBody: {
    fontSize: 12,
    color: '#212121',
  },
  tdParsedDetail: {
    fontSize: 11,
    color: '#1565C0',
    fontWeight: 'bold',
    marginTop: 4,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  targetBadge: {
    backgroundColor: '#E8F5E9',
  },
  targetBadgeText: {
    fontSize: 11,
    color: '#2E7D32',
    fontWeight: 'bold',
  },
  nonTargetBadge: {
    backgroundColor: '#FFEBEE',
  },
  nonTargetBadgeText: {
    fontSize: 11,
    color: '#C62828',
    fontWeight: 'bold',
  },
  badgeText: {
    fontSize: 11,
  },
  paginationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    marginTop: 6,
  },
  pageBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#E3F2FD',
    borderRadius: 6,
  },
  disabledPageBtn: {
    backgroundColor: '#F5F5F5',
  },
  pageBtnText: {
    fontSize: 12,
    color: '#1976D2',
    fontWeight: 'bold',
  },
  disabledPageBtnText: {
    color: '#BDBDBD',
  },
  pageInfoText: {
    fontSize: 12,
    color: '#424242',
    fontWeight: '600',
  },
  emptyBox: {
    padding: 30,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: '#9E9E9E',
    fontWeight: 'bold',
  },
  bottomCloseBtn: {
    marginTop: 10,
    backgroundColor: '#2196F3',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  bottomCloseBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  /* 상세 POPUP 모달 스타일 */
  detailOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 20,
  },
  detailContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 18,
    maxHeight: '85%',
  },
  detailTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#212121',
  },
  detailContent: {
    marginTop: 12,
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5F5',
  },
  detailLabel: {
    fontSize: 13,
    color: '#616161',
  },
  detailVal: {
    fontSize: 13,
    color: '#212121',
  },
  rawTextHeader: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#1565C0',
    marginTop: 10,
  },
  rawTextContainer: {
    backgroundColor: '#263238',
    borderRadius: 8,
    padding: 12,
    marginTop: 4,
    maxHeight: 200,
  },
  rawBodyText: {
    color: '#80CBC4',
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 18,
  },
  detailCloseBtn: {
    marginTop: 16,
    backgroundColor: '#2196F3',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  detailCloseBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
