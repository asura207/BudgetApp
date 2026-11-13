package com.budgetapp.notification

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.budgetapp.bridge.FinancialParserModule
import com.budgetapp.bridge.FinancialTextParser
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

class AppNotificationListener : NotificationListenerService() {

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        instance = this
        android.util.Log.d("AppNotificationListener", "NotificationListenerService connected!")
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        if (instance == this) {
            instance = null
        }
        android.util.Log.d("AppNotificationListener", "NotificationListenerService disconnected!")
    }

    override fun onDestroy() {
        super.onDestroy()
        if (instance == this) {
            instance = null
        }
    }

    private fun isExcludedAppNotification(packageName: String, title: String, fullContent: String): Boolean {
        val pkgLower = packageName.lowercase(Locale.getDefault())

        // 1. systemui 수집 제외
        if (packageName == "com.android.systemui") return true

        // 2. YouTube Music (com.google.android.apps.youtube.music) 수집 제외
        if (packageName == "com.google.android.apps.youtube.music") return true

        // 3. Google Play 스토어 (com.android.vending) 수집 제외
        if (packageName == "com.android.vending") return true

        // 4. LGU+ AI통화비서 (com.lguplus.aicallagent) 수집 제외
        if (packageName == "com.lguplus.aicallagent") return true

        // 5. android 발신 앱 중 알림 제목/내용에 '플레이오' 포함 수집 제외
        if (packageName == "android" && (title.contains("플레이오") || fullContent.contains("플레이오"))) return true

        // 6. Toss / KakaoPay (com.kakaopay.app) 걸음 수 알림 수집 제외
        if ((pkgLower.contains("toss") || pkgLower.contains("kakaopay")) && (title.contains("걸음") || fullContent.contains("걸음") || title.contains("만보기"))) {
            return true
        }

        // 7. Toss (viva.republica.toss) 악성 앱 경고 알림 수집 제외
        if (pkgLower.contains("toss") && (title.contains("악성") || fullContent.contains("악성"))) {
            return true
        }

        return false
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val sbnObj = sbn ?: return
        val packageName = sbnObj.packageName ?: ""

        val extras = sbnObj.notification.extras
        val title = extras.getCharSequence("android.title")?.toString() ?: ""
        val text = extras.getCharSequence("android.text")?.toString() ?: ""
        val bigText = extras.getCharSequence("android.bigText")?.toString() ?: ""
        val fullContent = "$title\n$text\n$bigText".trim()

        if (fullContent.isBlank()) return

        // 제외 대상 앱 알림 수집 즉시 원천 스킵
        if (isExcludedAppNotification(packageName, title, fullContent)) return

        // 3. 모든 카드사/금융 푸시 알림 실시간 결제 파싱 (PUSH 영역)
        FinancialTextParser.loadExceptionsFromDb(this)
        val result = FinancialTextParser.parse(fullContent, sbnObj.postTime, "PUSH", packageName)
        if (result.isPayment) {
            FinancialParserModule.emitPaymentEvent(
                dateStr = result.dateStr,
                amount = result.amount,
                merchant = result.merchant,
                paymentType = "CARD",
                cardCompany = result.cardCompany,
                installmentType = result.installmentType,
                installmentMonths = result.installmentMonths,
                createdAtStr = result.createdAtStr
            )
        }

        // 1. 수신된 모든 앱 푸시 원문을 파일 버퍼 & 로컬 SQLite DB(app_notifications_raw)에 이중 보관
        saveRawNotification(packageName, title, text, bigText, fullContent, sbnObj.postTime, result.isPayment)
    }

    private fun saveRawNotification(
        packageName: String,
        title: String,
        text: String,
        bigText: String,
        fullContent: String,
        postTimeMs: Long,
        isPayment: Boolean
    ) {
        if (isExcludedAppNotification(packageName, title, fullContent)) return

        val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())
        val safePostTime = if (postTimeMs > 0) postTimeMs else System.currentTimeMillis()
        val postTimeStr = sdf.format(Date(safePostTime))
        val postDateStr = postTimeStr.substring(0, 10)
        val id = "${safePostTime}_${(1000..9999).random()}"

        // 1. JSON 파일 버퍼에 100% 보장 저장 (동기화 및 중복 누적 방지)
        synchronized(bufferLock) {
            try {
                val bufferFile = File(filesDir, "app_notifications_buffer.json")
                val jsonArray = if (bufferFile.exists()) {
                    try { JSONArray(bufferFile.readText()) } catch (e: Exception) { JSONArray() }
                } else {
                    JSONArray()
                }

                for (i in 0 until jsonArray.length()) {
                    val existing = jsonArray.optJSONObject(i) ?: continue
                    val exPkg = existing.optString("package_name", "")
                    val exPostTime = existing.optString("post_time", "")
                    val exRaw = existing.optString("raw_content", "")
                    val exTitle = existing.optString("title", "")

                    if (exPkg == packageName && exPostTime == postTimeStr && exRaw == fullContent) {
                        return
                    }
                    if (!isPayment && title.isNotBlank() && exPkg == packageName && exPostTime.startsWith(postDateStr) && exTitle == title) {
                        return
                    }
                }

                val item = JSONObject().apply {
                    put("id", id)
                    put("package_name", packageName)
                    put("title", title)
                    put("text", text)
                    put("big_text", bigText)
                    put("raw_content", fullContent)
                    put("post_time", postTimeStr)
                    put("is_bookmarked", isPayment)
                }

                jsonArray.put(item)
                while (jsonArray.length() > 2000) {
                    jsonArray.remove(0)
                }
                bufferFile.writeText(jsonArray.toString())
            } catch (e: Exception) {
                android.util.Log.e("AppNotificationListener", "Buffer write error: ${e.message}")
            }
        }
    }

    companion object {
        val bufferLock = Any()
        private var instance: AppNotificationListener? = null

        fun isServiceConnected(): Boolean {
            return instance != null
        }

        fun syncPushHistoryForDate(targetDateStr: String): Int {
            val listener = instance ?: return 0
            var count = 0
            try {
                FinancialTextParser.loadExceptionsFromDb(listener)

                val activeNotifs = listener.activeNotifications ?: return 0

                val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
                val targetDate = try {
                    if (targetDateStr.isBlank() || targetDateStr == "ALL") Date() else (sdf.parse(targetDateStr) ?: Date())
                } catch (e: Exception) {
                    Date()
                }

                val cal = Calendar.getInstance()
                cal.time = targetDate
                cal.set(Calendar.DAY_OF_MONTH, 1)
                cal.set(Calendar.HOUR_OF_DAY, 0)
                cal.set(Calendar.MINUTE, 0)
                cal.set(Calendar.SECOND, 0)
                cal.set(Calendar.MILLISECOND, 0)
                val monthStartTime = cal.timeInMillis

                for (sbn in activeNotifs) {
                    val packageName = sbn.packageName ?: ""

                    val postTime = sbn.postTime
                    val extras = sbn.notification.extras
                    val title = extras.getCharSequence("android.title")?.toString() ?: ""
                    val text = extras.getCharSequence("android.text")?.toString() ?: ""
                    val bigText = extras.getCharSequence("android.bigText")?.toString() ?: ""
                    val fullContent = "$title\n$text\n$bigText".trim()

                    if (fullContent.isNotBlank()) {
                        // 제외 대상 앱 푸시 알림 스킵
                        if (listener.isExcludedAppNotification(packageName, title, fullContent)) continue

                        // 파싱 및 결제 이벤트 등록 (해당 월 1일 이후 또는 전체 동기화 대상)
                        var isPayment = false
                        if (targetDateStr.isBlank() || targetDateStr == "ALL" || postTime >= monthStartTime) {
                            val result = FinancialTextParser.parse(fullContent, postTime, "PUSH", packageName)
                            isPayment = result.isPayment
                            if (result.isPayment) {
                                FinancialParserModule.emitPaymentEvent(
                                    dateStr = result.dateStr,
                                    amount = result.amount,
                                    merchant = result.merchant,
                                    paymentType = "CARD",
                                    cardCompany = result.cardCompany,
                                    installmentType = result.installmentType,
                                    installmentMonths = result.installmentMonths,
                                    createdAtStr = result.createdAtStr
                                )
                                count++
                            }
                        }

                        // 수신함 결제 내역 실시간 동기화 실행 시 무조건 현재 떠 있는 모든 알림 목록을 보관
                        listener.saveRawNotification(
                            packageName,
                            title,
                            text,
                            bigText,
                            fullContent,
                            postTime,
                            isPayment
                        )
                    }
                }
            } catch (e: Exception) {
                android.util.Log.e("AppNotificationListener", "syncPushHistoryForDate error: ${e.message}", e)
            }
            return count
        }
    }
}
