import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  ScrollView,
  Platform,
  Linking,
  TextInput,
  AppState,
  AppStateStatus,
} from 'react-native';
import dayjs from 'dayjs';
import { appNotificationDao, AppNotificationRaw } from '../database/appNotificationDao';
import { copyLogToClipboard } from '../services/smsHistoryService';

interface AppNotificationsScreenProps {
  onBack?: () => void;
}

export const AppNotificationsScreen: React.FC<AppNotificationsScreenProps> = ({
  onBack,
}) => {
  const [notifications, setNotifications] = useState<AppNotificationRaw[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<AppNotificationRaw | null>(null);

  const pageSize = 50; // 한 화면에 50건씩 페이징 처리

  const loadNotifications = useCallback(async () => {
    try {
      // 1. SQLite DB에 기존 저장된 푸시 알림 데이터 1차 로드
      const list = appNotificationDao.getRecentNotifications();
      setNotifications(list || []);

      // 2. 네이티브 백그라운드 파일 버퍼(app_notifications_buffer.json)에 기록된 푸시 알림 로그를 DB로 즉시 수록 동기화
      const updatedList = await appNotificationDao.syncNativeBufferToDb();
      setNotifications(updatedList || []);
    } catch (e) {
      console.warn('loadNotifications error:', e);
    }
  }, []);

  useEffect(() => {
    loadNotifications();

    // 백그라운드 방치 후 다음날 포그라운드 복귀 시 데이터 안전 재로드
    const sub = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        loadNotifications();
      }
    });

    return () => sub.remove();
  }, [loadNotifications]);

  const handleOpenDetail = (item: AppNotificationRaw) => {
    setSelectedNotification(item);
    setDetailModalVisible(true);
  };

  const handleCopySingleRaw = async () => {
    if (!selectedNotification) return;
    const copied = await copyLogToClipboard(selectedNotification.rawContent);
    if (copied) {
      Alert.alert('복사 완료 📋', '앱 푸시 원문 내용이 클립보드에 복사되었습니다.');
    } else {
      Alert.alert('알림', '클립보드 복사에 실패했습니다.');
    }
  };

  const handleToggleBookmark = (id: string, isBookmarked: boolean) => {
    try {
      appNotificationDao.toggleBookmark(id, isBookmarked);
      loadNotifications();
    } catch (e) {}
  };

  const handleDelete = (id: string) => {
    try {
      appNotificationDao.deleteNotification(id);
      loadNotifications();
    } catch (e) {}
  };

  const handleClearAll = () => {
    Alert.alert('전체 삭제', '보관(📌)된 항목을 제외한 모든 일반 푸시 로그를 삭제하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          try {
            appNotificationDao.clearAllNotifications();
            loadNotifications();
          } catch (e) {}
        },
      },
    ]);
  };

  // 검색어 필터링 적용
  const filteredNotifications = notifications.filter((n) => {
    if (!searchKeyword.trim()) return true;
    const kw = searchKeyword.trim().toLowerCase();
    return (
      (n.rawContent && n.rawContent.toLowerCase().includes(kw)) ||
      (n.title && n.title.toLowerCase().includes(kw)) ||
      (n.text && n.text.toLowerCase().includes(kw)) ||
      (n.packageName && n.packageName.toLowerCase().includes(kw))
    );
  });

  const totalPages = Math.ceil(filteredNotifications.length / pageSize) || 1;
  const safePage = Math.min(currentPage, totalPages);
  const paginatedNotifications = filteredNotifications.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  );

  const renderHeader = () => (
    <View style={styles.tableHeader}>
      <Text style={[styles.th, { flex: 0.9 }]}>보관</Text>
      <Text style={[styles.th, { flex: 1.1 }]}>수신 시각</Text>
      <Text style={[styles.th, { flex: 1.1 }]}>패키지/제목</Text>
      <Text style={[styles.th, { flex: 2.1 }]}>원문 내용 (터치 시 상세)</Text>
      <Text style={[styles.th, { flex: 0.6 }]}>삭제</Text>
    </View>
  );

  const renderItem = ({ item }: { item: AppNotificationRaw }) => (
    <TouchableOpacity
      style={[styles.tableRow, item.isBookmarked && styles.bookmarkedRow]}
      activeOpacity={0.7}
      delayPressIn={0}
      onPress={() => handleOpenDetail(item)}
    >
      <TouchableOpacity
        style={[styles.bookmarkBtn, { flex: 0.9 }]}
        activeOpacity={0.7}
        delayPressIn={0}
        onPress={(e) => {
          e.stopPropagation?.();
          handleToggleBookmark(item.id, !item.isBookmarked);
        }}
      >
        <Text style={[styles.bookmarkBtnText, item.isBookmarked && styles.bookmarkedBtnText]}>
          {item.isBookmarked ? '📌 보관됨' : '☐ 보관'}
        </Text>
      </TouchableOpacity>

      <Text style={[styles.tdTime, { flex: 1.1 }]}>{item.postTime}</Text>

      <View style={{ flex: 1.1 }}>
        <Text style={styles.tdPkg}>{item.packageName.split('.').pop() || item.packageName}</Text>
        <Text style={styles.tdTitle} numberOfLines={1}>
          {item.title || '(제목 없음)'}
        </Text>
      </View>

      <Text style={[styles.tdContent, { flex: 2.1 }]} numberOfLines={3}>
        {item.rawContent}
      </Text>

      <TouchableOpacity
        style={[styles.deleteBtn, { flex: 0.6 }]}
        activeOpacity={0.7}
        delayPressIn={0}
        onPress={(e) => {
          e.stopPropagation?.();
          handleDelete(item.id);
        }}
      >
        <Text style={styles.deleteBtnText}>삭제</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.headerBanner}>
        {onBack && (
          <TouchableOpacity
            style={styles.backBtn}
            activeOpacity={0.7}
            delayPressIn={0}
            onPress={onBack}
          >
            <Text style={styles.backBtnText}>◀ 뒤로</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.bannerTitle}>📨 수신된 앱 푸시 원문 로그 목록</Text>
        <TouchableOpacity
          style={styles.clearAllBtn}
          activeOpacity={0.7}
          delayPressIn={0}
          onPress={handleClearAll}
        >
          <Text style={styles.clearAllBtnText}>전체 비우기</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.notifAccessBanner}
        activeOpacity={0.7}
        onPress={() => {
          if (Platform.OS === 'android') {
            try {
              Linking.sendIntent('android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS');
            } catch (e) {
              // Ignore
            }
          }
        }}
      >
        <Text style={styles.notifAccessBannerText}>
          🔔 [필수 권한 설정] 스마트폰 '알림 접근 허용' 설정이 꺼져 있으면 앱 푸시 로그가 수집되지 않습니다. (터치하여 설정 상태 확인)
        </Text>
      </TouchableOpacity>

      {/* 실시간 검색창 영역 */}
      <View style={styles.searchBarBox}>
        <View style={styles.searchBarInputRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="🔍 알림 내용 또는 앱 명칭 검색..."
            placeholderTextColor="#9E9E9E"
            value={searchKeyword}
            onChangeText={(text) => {
              setSearchKeyword(text);
              setCurrentPage(1);
            }}
            disableFullscreenUI={true}
          />
          {searchKeyword.length > 0 && (
            <TouchableOpacity
              style={styles.searchClearBtn}
              onPress={() => {
                setSearchKeyword('');
                setCurrentPage(1);
              }}
            >
              <Text style={styles.searchClearBtnText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.noticeText}>
          ※ [📌 보관]에 체크된 항목은 전체 비우기 및 30일 삭제에서 제외되어 영구 보관됩니다. (검색 {filteredNotifications.length}건)
        </Text>
      </View>

      <View style={{ flex: 1 }}>
        <FlatList
          data={paginatedNotifications}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={renderHeader}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>
                {searchKeyword ? `'${searchKeyword}' 검색 결과가 없습니다.` : '보관된 앱 푸시 알림 로그가 없습니다.'}
              </Text>
              <Text style={styles.emptySubText}>
                상단의 [알림 접근 허용] 권한이 활성화되어 있으면 카드사/금융 앱 푸시 알림이 원문 그대로 실시간 수록됩니다.
              </Text>
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
            {safePage} / {totalPages} 페이지 (총 {filteredNotifications.length}건)
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

      {/* 앱 푸시 원문 상세 POPUP 모달 */}
      <Modal
        visible={detailModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDetailModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalHeaderTitle}>📨 수신된 앱 푸시 원문 상세</Text>
              <TouchableOpacity
                onPress={() => setDetailModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.modalCloseIcon}>✕</Text>
              </TouchableOpacity>
            </View>

            {selectedNotification && (
              <ScrollView style={styles.modalScrollBody} showsVerticalScrollIndicator={true}>
                <View style={styles.metaBox}>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>수신 일시</Text>
                    <Text style={styles.metaValue}>{selectedNotification.postTime}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>보관 상태</Text>
                    <Text style={[styles.metaValue, selectedNotification.isBookmarked ? { color: '#E65100', fontWeight: 'bold' } : { color: '#757575' }]}>
                      {selectedNotification.isBookmarked ? '📌 영구 보관 중' : '☐ 일반 (30일 보관)'}
                    </Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>발신 앱</Text>
                    <Text style={[styles.metaValue, { color: '#1565C0', fontWeight: 'bold' }]}>
                      {selectedNotification.packageName}
                    </Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>알림 제목</Text>
                    <Text style={[styles.metaValue, { color: '#212121', fontWeight: 'bold' }]}>
                      {selectedNotification.title || '(제목 없음)'}
                    </Text>
                  </View>
                  {selectedNotification.text ? (
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>기본 본문</Text>
                      <Text style={styles.metaValue}>{selectedNotification.text}</Text>
                    </View>
                  ) : null}
                  {selectedNotification.bigText && selectedNotification.bigText !== selectedNotification.text ? (
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>펼침 본문</Text>
                      <Text style={styles.metaValue}>{selectedNotification.bigText}</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.rawSection}>
                  <View style={styles.rawHeaderRow}>
                    <Text style={styles.rawSectionTitle}>📄 수신 원문 내용 전체 (FCM / Android)</Text>
                    <TouchableOpacity
                      style={styles.copyInlineBtn}
                      activeOpacity={0.7}
                      onPress={handleCopySingleRaw}
                    >
                      <Text style={styles.copyInlineBtnText}>📋 복사</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.rawBox}>
                    <Text style={styles.rawContentText} selectable={true}>
                      {selectedNotification.rawContent}
                    </Text>
                  </View>
                </View>
              </ScrollView>
            )}

            <View style={styles.modalBtnRow}>
              {selectedNotification && (
                <TouchableOpacity
                  style={[styles.modalActionBtn, selectedNotification.isBookmarked ? styles.modalUnbookmarkBtn : styles.modalBookmarkBtn]}
                  activeOpacity={0.7}
                  onPress={() => {
                    const next = !selectedNotification.isBookmarked;
                    handleToggleBookmark(selectedNotification.id, next);
                    setSelectedNotification({ ...selectedNotification, isBookmarked: next });
                  }}
                >
                  <Text style={selectedNotification.isBookmarked ? styles.modalUnbookmarkBtnText : styles.modalBookmarkBtnText}>
                    {selectedNotification.isBookmarked ? '📌 보관 해제' : '📌 영구 보관 설정'}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.modalActionBtn, styles.modalCloseBtn]}
                activeOpacity={0.7}
                onPress={() => setDetailModalVisible(false)}
              >
                <Text style={styles.modalCloseBtnText}>닫기</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  headerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  backBtn: {
    paddingRight: 10,
  },
  backBtnText: {
    fontSize: 14,
    color: '#2196F3',
    fontWeight: 'bold',
  },
  bannerTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#212121',
    flex: 1,
  },
  clearAllBtn: {
    backgroundColor: '#FFEBEE',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  clearAllBtnText: {
    fontSize: 12,
    color: '#D32F2F',
    fontWeight: 'bold',
  },
  notifAccessBanner: {
    backgroundColor: '#FFF3E0',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#FFE0B2',
  },
  notifAccessBannerText: {
    fontSize: 11,
    color: '#E65100',
    fontWeight: '600',
    lineHeight: 16,
  },
  searchBarBox: {
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
  },
  searchBarInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#90CAF9',
    paddingHorizontal: 10,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 6,
    fontSize: 13,
    color: '#212121',
  },
  searchClearBtn: {
    padding: 4,
  },
  searchClearBtnText: {
    fontSize: 14,
    color: '#757575',
    fontWeight: 'bold',
  },
  noticeText: {
    fontSize: 11,
    color: '#1565C0',
    lineHeight: 16,
  },
  listContent: {
    padding: 12,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#424242',
    paddingVertical: 10,
    paddingHorizontal: 6,
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
    backgroundColor: '#FFFFFF',
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 6,
    marginBottom: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EEEEEE',
  },
  bookmarkedRow: {
    backgroundColor: '#FFF8E1',
    borderColor: '#FFE082',
  },
  bookmarkBtn: {
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookmarkBtnText: {
    fontSize: 11,
    color: '#757575',
  },
  bookmarkedBtnText: {
    color: '#E65100',
    fontWeight: 'bold',
  },
  tdTime: {
    fontSize: 11,
    color: '#616161',
  },
  tdPkg: {
    fontSize: 11,
    color: '#1565C0',
    fontWeight: 'bold',
  },
  tdTitle: {
    fontSize: 11,
    color: '#212121',
  },
  tdContent: {
    fontSize: 11,
    color: '#424242',
  },
  deleteBtn: {
    backgroundColor: '#FFEBEE',
    paddingVertical: 6,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  deleteBtnText: {
    fontSize: 11,
    color: '#D32F2F',
    fontWeight: 'bold',
  },
  paginationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
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
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: '#9E9E9E',
    fontWeight: 'bold',
  },
  emptySubText: {
    fontSize: 11,
    color: '#9E9E9E',
    marginTop: 6,
    textAlign: 'center',
  },

  // 모달 스타일
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    width: '100%',
    maxHeight: '82%',
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  modalHeaderTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212121',
  },
  modalCloseIcon: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#757575',
    paddingHorizontal: 4,
  },
  modalScrollBody: {
    marginTop: 12,
  },
  metaBox: {
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    gap: 6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  metaLabel: {
    width: 70,
    fontSize: 12,
    color: '#6c757d',
    fontWeight: '600',
  },
  metaValue: {
    flex: 1,
    fontSize: 12,
    color: '#212529',
  },
  rawSection: {
    marginTop: 14,
  },
  rawHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  rawSectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#343a40',
  },
  copyInlineBtn: {
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  copyInlineBtnText: {
    fontSize: 11,
    color: '#1565C0',
    fontWeight: 'bold',
  },
  rawBox: {
    backgroundColor: '#263238',
    borderRadius: 8,
    padding: 12,
    minHeight: 120,
  },
  rawContentText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#ECEFF1',
    fontFamily: 'monospace',
  },
  modalBtnRow: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 10,
  },
  modalActionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBookmarkBtn: {
    backgroundColor: '#FFF3E0',
    borderWidth: 1,
    borderColor: '#FFB74D',
  },
  modalBookmarkBtnText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#E65100',
  },
  modalUnbookmarkBtn: {
    backgroundColor: '#ECEFF1',
    borderWidth: 1,
    borderColor: '#CFD8DC',
  },
  modalUnbookmarkBtnText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#546E7A',
  },
  modalCloseBtn: {
    backgroundColor: '#2196F3',
  },
  modalCloseBtnText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
});
