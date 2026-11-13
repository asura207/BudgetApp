package com.budgetapp.bridge

import android.app.Activity
import android.content.ContentResolver
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.budgetapp.notification.AppNotificationListener
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import java.io.File
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class SmsHistoryParserModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    private var filePickerPromise: Promise? = null
    private val PICK_FILE_REQUEST_CODE = 9988

    init {
        reactContext.addActivityEventListener(this)
    }

    override fun getName(): String {
        return "SmsHistoryParserModule"
    }

    override fun onActivityResult(activity: Activity?, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == PICK_FILE_REQUEST_CODE) {
            val promise = filePickerPromise ?: return
            filePickerPromise = null

            if (resultCode == Activity.RESULT_OK && data?.data != null) {
                try {
                    val uri: Uri = data.data!!
                    val contentResolver: ContentResolver = reactContext.contentResolver
                    val inputStream = contentResolver.openInputStream(uri)
                    val textContent = inputStream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
                    promise.resolve(textContent)
                } catch (e: Exception) {
                    promise.reject("FILE_READ_ERROR", "파일을 읽는 중 오류가 발생했습니다: ${e.message}", e)
                }
            } else {
                promise.reject("PICK_CANCELLED", "파일 선택이 취소되었습니다.")
            }
        }
    }

    override fun onNewIntent(intent: Intent?) {}

    @ReactMethod
    fun getAppNotificationsBuffer(promise: Promise) {
        try {
            synchronized(AppNotificationListener.bufferLock) {
                val bufferFile = File(reactContext.filesDir, "app_notifications_buffer.json")
                if (bufferFile.exists()) {
                    val jsonStr = bufferFile.readText(Charsets.UTF_8)
                    promise.resolve(jsonStr)
                } else {
                    promise.resolve("[]")
                }
            }
        } catch (e: Exception) {
            promise.reject("BUFFER_READ_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun clearAppNotificationsBuffer(targetId: String, promise: Promise) {
        try {
            synchronized(AppNotificationListener.bufferLock) {
                val bufferFile = File(reactContext.filesDir, "app_notifications_buffer.json")
                if (bufferFile.exists()) {
                    if (targetId == "CLEAR_ALL") {
                        bufferFile.writeText("[]")
                    } else {
                        val rawJson = bufferFile.readText(Charsets.UTF_8)
                        val jsonArray = org.json.JSONArray(rawJson)
                        val newArray = org.json.JSONArray()

                        for (i in 0 until jsonArray.length()) {
                            val obj = jsonArray.optJSONObject(i) ?: continue
                            val id = obj.optString("id", "")
                            if (id != targetId) {
                                newArray.put(obj)
                            }
                        }
                        bufferFile.writeText(newArray.toString())
                    }
                }
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("BUFFER_CLEAR_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun pickBackupFileAndRead(promise: Promise) {
        val currentActivity = currentActivity
        if (currentActivity == null) {
            promise.reject("ACTIVITY_NULL", "화면 상태를 찾을 수 없습니다.")
            return
        }

        filePickerPromise = promise
        try {
            val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                type = "*/*"
                addCategory(Intent.CATEGORY_OPENABLE)
            }
            currentActivity.startActivityForResult(
                Intent.createChooser(intent, "백업 파일 선택 (backup_*.txt)"),
                PICK_FILE_REQUEST_CODE
            )
        } catch (e: Exception) {
            filePickerPromise = null
            promise.reject("PICKER_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun copyToClipboard(text: String, promise: Promise) {
        try {
            val clipboard = reactContext.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
            val clip = android.content.ClipData.newPlainText("BudgetApp Debug Log", text)
            clipboard.setPrimaryClip(clip)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CLIPBOARD_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun saveBackupFileToDownload(jsonContent: String, fileName: String, isDailyAutoBackup: Boolean, promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = reactContext.contentResolver
                val contentUri = MediaStore.Downloads.EXTERNAL_CONTENT_URI
                
                // 기존 백업 파일 삭제 로직 (isDailyAutoBackup 이 true 이면 이전 파일 삭제)
                if (isDailyAutoBackup) {
                    try {
                        val selection = "${MediaStore.MediaColumns.DISPLAY_NAME} LIKE ?"
                        val selectionArgs = arrayOf("backup_%.txt")
                        resolver.delete(contentUri, selection, selectionArgs)
                    } catch (e: Exception) {
                        // ignore deletion errors
                    }
                }

                // Android 10 (API 29) 이상: Scoped Storage 표준 MediaStore.Downloads API 사용
                val contentValues = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
                    put(MediaStore.MediaColumns.MIME_TYPE, "text/plain")
                    put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                }

                val uri = resolver.insert(contentUri, contentValues)
                    ?: throw IOException("Failed to create MediaStore record in Downloads")

                resolver.openOutputStream(uri)?.use { outputStream ->
                    outputStream.write(jsonContent.toByteArray(Charsets.UTF_8))
                    outputStream.flush()
                }

                promise.resolve("Download/$fileName")
            } else {
                // Android 9 이하 레거시
                val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                if (!downloadsDir.exists()) {
                    downloadsDir.mkdirs()
                }
                
                if (isDailyAutoBackup) {
                    try {
                        downloadsDir.listFiles { file ->
                            file.isFile && file.name.startsWith("backup_") && file.name.endsWith(".txt")
                        }?.forEach { it.delete() }
                    } catch (e: Exception) {
                        // ignore
                    }
                }
                
                val file = File(downloadsDir, fileName)
                file.writeText(jsonContent, Charsets.UTF_8)

                android.media.MediaScannerConnection.scanFile(
                    reactContext,
                    arrayOf(file.absolutePath),
                    arrayOf("text/plain"),
                    null
                )

                promise.resolve(file.absolutePath)
            }
        } catch (e: Exception) {
            try {
                val file = File(reactContext.externalCacheDir, fileName)
                file.writeText(jsonContent, Charsets.UTF_8)
                promise.resolve(file.absolutePath)
            } catch (ex: Exception) {
                promise.reject("FILE_SAVE_ERROR", ex.message, ex)
            }
        }
    }

    private fun loadDynamicExceptionsFromDb() {
        try {
            val dbPath = reactContext.getDatabasePath("budget_app.db")
            if (!dbPath.exists()) return

            val db = android.database.sqlite.SQLiteDatabase.openOrCreateDatabase(dbPath, null)
            val cursor = db.rawQuery("SELECT keyword, apply_push, apply_sms FROM parse_exceptions;", null)
            val rules = mutableListOf<DynamicExceptionRule>()
            cursor?.use {
                val kwIdx = it.getColumnIndex("keyword")
                val pushIdx = it.getColumnIndex("apply_push")
                val smsIdx = it.getColumnIndex("apply_sms")

                while (it.moveToNext()) {
                    val kw = if (kwIdx != -1) it.getString(kwIdx) ?: "" else ""
                    val applyPush = if (pushIdx != -1) it.getInt(pushIdx) == 1 else true
                    val applySms = if (smsIdx != -1) it.getInt(smsIdx) == 1 else true

                    if (kw.isNotBlank()) {
                        rules.add(DynamicExceptionRule(kw, applyPush, applySms))
                    }
                }
            }
            db.close()
            FinancialTextParser.setDynamicExceptionRules(rules)
        } catch (e: Exception) {
            // Ignore
        }
    }

    @ReactMethod
    fun getInboxMessagesForInspection(promise: Promise) {
        loadDynamicExceptionsFromDb()
        val resultList: WritableArray = Arguments.createArray()
        val processedBodies = HashSet<String>()
        val contentResolver: ContentResolver = reactContext.contentResolver
        val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())

        // 1. 삼성 RCS IM 저장소 (content://im/rcs_read_im)
        try {
            val rcsUri = Uri.parse("content://im/rcs_read_im")
            val rcsCursor = contentResolver.query(rcsUri, null, null, null, "date DESC LIMIT 100")
            rcsCursor?.use { c ->
                val bodyIdx = if (c.getColumnIndex("body") != -1) c.getColumnIndex("body") else c.getColumnIndex("text")
                val dateIdx = if (c.getColumnIndex("date") != -1) c.getColumnIndex("date") else c.getColumnIndex("date_sent")

                while (c.moveToNext()) {
                    val rawBody = if (bodyIdx != -1) c.getString(bodyIdx) ?: "" else ""
                    var msgTime = if (dateIdx != -1) c.getLong(dateIdx) else 0L

                    if (rawBody.isBlank()) continue
                    if (processedBodies.contains(rawBody)) continue
                    processedBodies.add(rawBody)

                    if (msgTime in 1..9999999999L) msgTime *= 1000L
                    val fallbackTime = if (msgTime > 0) msgTime else System.currentTimeMillis()
                    val timeStr = sdf.format(Date(fallbackTime))
                    val res = FinancialTextParser.parse(rawBody, fallbackTime, "SMS")

                    val map: WritableMap = Arguments.createMap()
                    map.putString("id", "rcs_${msgTime}_${processedBodies.size}")
                    map.putString("receivedTime", timeStr)
                    map.putString("body", FinancialTextParser.extractTextFromRcsJson(rawBody))
                    map.putBoolean("isTarget", res.isPayment)
                    map.putString("cardCompany", res.cardCompany)
                    map.putInt("amount", res.amount)
                    map.putString("merchant", res.merchant)
                    resultList.pushMap(map)
                }
            }
        } catch (e: Exception) {}

        // 2. SMS 수신함 (content://sms/inbox)
        try {
            val smsUri = Uri.parse("content://sms/inbox")
            val smsCursor = contentResolver.query(smsUri, arrayOf("body", "date"), null, null, "date DESC LIMIT 150")
            smsCursor?.use { cursor ->
                val bodyIdx = cursor.getColumnIndex("body")
                val dateIdx = cursor.getColumnIndex("date")

                while (cursor.moveToNext()) {
                    val body = if (bodyIdx != -1) cursor.getString(bodyIdx) ?: "" else ""
                    var smsTime = if (dateIdx != -1) cursor.getLong(dateIdx) else 0L

                    if (body.isBlank()) continue
                    if (processedBodies.contains(body)) continue
                    processedBodies.add(body)

                    if (smsTime in 1..9999999999L) smsTime *= 1000L
                    val fallbackTime = if (smsTime > 0) smsTime else System.currentTimeMillis()
                    val timeStr = sdf.format(Date(fallbackTime))
                    val res = FinancialTextParser.parse(body, fallbackTime, "SMS")

                    val map: WritableMap = Arguments.createMap()
                    map.putString("id", "sms_${smsTime}_${processedBodies.size}")
                    map.putString("receivedTime", timeStr)
                    map.putString("body", body)
                    map.putBoolean("isTarget", res.isPayment)
                    map.putString("cardCompany", res.cardCompany)
                    map.putInt("amount", res.amount)
                    map.putString("merchant", res.merchant)
                    resultList.pushMap(map)
                }
            }
        } catch (e: Exception) {}

        // 3. DB에 저장된 실제 결제 내역을 보조 원천으로 안심 보장
        try {
            val dbPath = reactContext.getDatabasePath("budget_app.db")
            if (dbPath.exists()) {
                val db = android.database.sqlite.SQLiteDatabase.openOrCreateDatabase(dbPath, null)
                val cursor = db.rawQuery("SELECT date, amount, merchant, card_company, created_at FROM transactions ORDER BY date DESC LIMIT 100;", null)
                cursor?.use {
                    val dateIdx = it.getColumnIndex("date")
                    val amtIdx = it.getColumnIndex("amount")
                    val merIdx = it.getColumnIndex("merchant")
                    val cardIdx = it.getColumnIndex("card_company")
                    val createdIdx = it.getColumnIndex("created_at")

                    while (it.moveToNext()) {
                        val d = if (dateIdx != -1) it.getString(dateIdx) ?: "" else ""
                        val amt = if (amtIdx != -1) it.getInt(amtIdx) else 0
                        val mer = if (merIdx != -1) it.getString(merIdx) ?: "" else ""
                        val card = if (cardIdx != -1) it.getString(cardIdx) ?: "삼성카드" else "삼성카드"
                        val created = if (createdIdx != -1) it.getString(createdIdx) ?: d else d

                        val bodyText = "$card 승인 $mer ${amt}원"
                        if (!processedBodies.contains(bodyText)) {
                            processedBodies.add(bodyText)
                            val map: WritableMap = Arguments.createMap()
                            map.putString("id", "db_${created}_${processedBodies.size}")
                            map.putString("receivedTime", created)
                            map.putString("body", bodyText)
                            map.putBoolean("isTarget", true)
                            map.putString("cardCompany", card)
                            map.putInt("amount", amt)
                            map.putString("merchant", mer)
                            resultList.pushMap(map)
                        }
                    }
                }
                db.close()
            }
        } catch (e: Exception) {}

        promise.resolve(resultList)
    }

    @ReactMethod
    fun syncSmsHistoryWithLog(targetDateStr: String, promise: Promise) {
        // DB에 등록된 영역별 파싱 예외 단어 동적 적용
        loadDynamicExceptionsFromDb()

        val logBuilder = StringBuilder()
        logBuilder.append("=== BudgetApp SMS & MMS Sync Diagnostic Log ===\n")
        logBuilder.append("Device: ").append(Build.MANUFACTURER ?: "").append(" ").append(Build.MODEL ?: "").append("\n")
        logBuilder.append("Android SDK: ").append(Build.VERSION.SDK_INT.toString()).append("\n")

        // 가입(닉네임 설정) 달의 1일 시작일 계산 (예: 2026-10-13 -> 2026-10-01)
        val monthStartDateStr = if (targetDateStr.length >= 7) "${targetDateStr.substring(0, 7)}-01" else SimpleDateFormat("yyyy-MM-01", Locale.getDefault()).format(Date())
        logBuilder.append("Target Date Filter: ").append(targetDateStr).append(" (Strictly Syncing from ").append(monthStartDateStr).append(" onwards)\n\n")

        try {
            val contentResolver: ContentResolver = reactContext.contentResolver

            var parsedCount = 0
            var scannedCount = 0
            val processedBodies = HashSet<String>()

            // 1. 삼성 갤럭시 RCS 전용 저장소 조회 (content://im/rcs_read_im)
            logBuilder.append("--- 1. Querying Samsung RCS IM Storage (content://im/rcs_read_im) ---\n")
            try {
                val rcsUri = Uri.parse("content://im/rcs_read_im")
                val rcsCursor = contentResolver.query(
                    rcsUri,
                    null,
                    null,
                    null,
                    "date DESC LIMIT 150"
                )

                if (rcsCursor == null) {
                    logBuilder.append("Cursor is NULL for content://im/rcs_read_im\n")
                } else {
                    logBuilder.append("RCS IM row count: ").append(rcsCursor.count.toString()).append("\n")
                    rcsCursor.use { c ->
                        val bodyIndex = if (c.getColumnIndex("body") != -1) c.getColumnIndex("body") else c.getColumnIndex("text")
                        val dateIndex = if (c.getColumnIndex("date") != -1) c.getColumnIndex("date") else c.getColumnIndex("date_sent")

                        while (c.moveToNext()) {
                            val body = if (bodyIndex != -1) c.getString(bodyIndex) ?: "" else ""
                            var msgTime = if (dateIndex != -1) c.getLong(dateIndex) else 0L

                            if (body.isBlank()) continue
                            if (processedBodies.contains(body)) continue
                            processedBodies.add(body)
                            scannedCount++

                            if (msgTime in 1..9999999999L) {
                                msgTime *= 1000L
                            }

                            val fallbackTime = if (msgTime > 0) msgTime else System.currentTimeMillis()

                            val result = FinancialTextParser.parse(body, fallbackTime, "SMS")
                            if (result.isPayment) {
                                val matchDate = targetDateStr.isBlank() || targetDateStr == "ALL" ||
                                        (monthStartDateStr.isNotBlank() && result.dateStr >= monthStartDateStr) ||
                                        result.dateStr == targetDateStr

                                logBuilder.append("[RCS IM Match Found] Date: ").append(result.dateStr)
                                    .append(" | Card: ").append(result.cardCompany)
                                    .append(" | Amount: ").append(result.amount.toString())
                                    .append(" | Merchant: ").append(result.merchant)
                                    .append(" | DateFilterMatch: ").append(matchDate.toString()).append("\n")

                                if (matchDate) {
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
                                    parsedCount++
                                }
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                logBuilder.append("Error querying content://im/rcs_read_im: ").append(e.message ?: "").append("\n")
            }

            // 2. MMS 수신함 독립 조회
            logBuilder.append("\n--- 2. Querying MMS (content://mms) ---\n")
            try {
                val mmsUri = Uri.parse("content://mms")
                val mmsCursor = contentResolver.query(
                    mmsUri,
                    arrayOf("_id", "date"),
                    null,
                    null,
                    "date DESC LIMIT 150"
                )

                if (mmsCursor != null) {
                    logBuilder.append("MMS row count: ").append(mmsCursor.count.toString()).append("\n")
                    mmsCursor.use { cursor ->
                        val idIndex = cursor.getColumnIndex("_id")
                        val dateIndex = cursor.getColumnIndex("date")

                        while (cursor.moveToNext()) {
                            val mmsId = if (idIndex != -1) cursor.getString(idIndex) ?: "" else continue
                            var mmsTime = if (dateIndex != -1) cursor.getLong(dateIndex) else 0L

                            if (mmsTime in 1..9999999999L) {
                                mmsTime *= 1000L
                            }

                            val partUri = Uri.parse("content://mms/part")
                            val partCursor = contentResolver.query(
                                partUri,
                                arrayOf("text", "ct"),
                                "mid = ?",
                                arrayOf(mmsId),
                                null
                            )

                            val bodyBuilder = StringBuilder()
                            partCursor?.use { pCursor ->
                                val textIdx = pCursor.getColumnIndex("text")
                                val ctIdx = pCursor.getColumnIndex("ct")
                                while (pCursor.moveToNext()) {
                                    val ct = if (ctIdx != -1) pCursor.getString(ctIdx) ?: "" else ""
                                    if (ct == "text/plain") {
                                        val text = if (textIdx != -1) pCursor.getString(textIdx) ?: "" else ""
                                        bodyBuilder.append(text).append("\n")
                                    }
                                }
                            }

                            val body = bodyBuilder.toString().trim()
                            if (body.isNotBlank() && !processedBodies.contains(body)) {
                                processedBodies.add(body)
                                scannedCount++

                                val fallbackTime = if (mmsTime > 0) mmsTime else System.currentTimeMillis()
                                val result = FinancialTextParser.parse(body, fallbackTime, "SMS")
                                if (result.isPayment) {
                                    val matchDate = targetDateStr.isBlank() || targetDateStr == "ALL" ||
                                            (monthStartDateStr.isNotBlank() && result.dateStr >= monthStartDateStr) ||
                                            result.dateStr == targetDateStr

                                    logBuilder.append("[MMS Match Found] Date: ").append(result.dateStr)
                                        .append(" | Card: ").append(result.cardCompany)
                                        .append(" | Amount: ").append(result.amount.toString())
                                        .append(" | Merchant: ").append(result.merchant)
                                        .append(" | DateFilterMatch: ").append(matchDate.toString()).append("\n")

                                    if (matchDate) {
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
                                        parsedCount++
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                logBuilder.append("Error querying MMS: ").append(e.message ?: "").append("\n")
            }

            // 3. SMS 수신함 독립 조회 (content://sms/inbox)
            logBuilder.append("\n--- 3. Querying SMS Inbox (content://sms/inbox) ---\n")
            try {
                val smsUri = Uri.parse("content://sms/inbox")
                val smsCursor = contentResolver.query(
                    smsUri,
                    arrayOf("body", "date"),
                    null,
                    null,
                    "date DESC LIMIT 200"
                )

                if (smsCursor != null) {
                    logBuilder.append("SMS row count: ").append(smsCursor.count.toString()).append("\n")
                    smsCursor.use { cursor ->
                        val bodyIndex = cursor.getColumnIndex("body")
                        val dateIndex = cursor.getColumnIndex("date")

                        while (cursor.moveToNext()) {
                            val body = if (bodyIndex != -1) cursor.getString(bodyIndex) ?: "" else ""
                            var smsTime = if (dateIndex != -1) cursor.getLong(dateIndex) else 0L

                            if (body.isBlank()) continue
                            if (processedBodies.contains(body)) continue
                            processedBodies.add(body)
                            scannedCount++

                            if (smsTime in 1..9999999999L) {
                                smsTime *= 1000L
                            }

                            val fallbackTime = if (smsTime > 0) smsTime else System.currentTimeMillis()
                            val result = FinancialTextParser.parse(body, fallbackTime, "SMS")

                            if (result.isPayment) {
                                val matchDate = targetDateStr.isBlank() || targetDateStr == "ALL" ||
                                        (monthStartDateStr.isNotBlank() && result.dateStr >= monthStartDateStr) ||
                                        result.dateStr == targetDateStr

                                logBuilder.append("[SMS Match Found] Date: ").append(result.dateStr)
                                    .append(" | Card: ").append(result.cardCompany)
                                    .append(" | Amount: ").append(result.amount.toString())
                                    .append(" | Merchant: ").append(result.merchant)
                                    .append(" | DateFilterMatch: ").append(matchDate.toString()).append("\n")

                                if (matchDate) {
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
                                    parsedCount++
                                }
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                logBuilder.append("Error querying SMS: ").append(e.message ?: "").append("\n")
            }

            // 4. 삼성 기본 '메세지' 어플 대화 저장소 조회
            val conversationUris = listOf(
                Pair("content://mms-sms/complete-conversations", Uri.parse("content://mms-sms/complete-conversations")),
                Pair("content://mms-sms/conversations", Uri.parse("content://mms-sms/conversations"))
            )

            for (pair in conversationUris) {
                val uriName = pair.first
                val uri = pair.second

                logBuilder.append("\n--- 4. Querying Messages App Storage (").append(uriName).append(") ---\n")
                try {
                    val cursor = contentResolver.query(
                        uri,
                        arrayOf("body", "date"),
                        null,
                        null,
                        "date DESC LIMIT 200"
                    )

                    if (cursor == null) {
                        logBuilder.append("Cursor is NULL for ").append(uriName).append("\n")
                        continue
                    }

                    logBuilder.append("Conversation row count: ").append(cursor.count.toString()).append("\n")
                    cursor.use { c ->
                        val bodyIndex = c.getColumnIndex("body")
                        val dateIndex = c.getColumnIndex("date")

                        while (c.moveToNext()) {
                            val body = if (bodyIndex != -1) c.getString(bodyIndex) ?: "" else ""
                            var msgTime = if (dateIndex != -1) c.getLong(dateIndex) else 0L

                            if (body.isBlank()) continue
                            if (processedBodies.contains(body)) continue
                            processedBodies.add(body)
                            scannedCount++

                            if (msgTime in 1..9999999999L) {
                                msgTime *= 1000L
                            }

                            val fallbackTime = if (msgTime > 0) msgTime else System.currentTimeMillis()
                            val result = FinancialTextParser.parse(body, fallbackTime, "SMS")

                            if (result.isPayment) {
                                val matchDate = targetDateStr.isBlank() || targetDateStr == "ALL" ||
                                        (monthStartDateStr.isNotBlank() && result.dateStr >= monthStartDateStr) ||
                                        result.dateStr == targetDateStr

                                logBuilder.append("[Conv Match Found] Date: ").append(result.dateStr)
                                    .append(" | Card: ").append(result.cardCompany)
                                    .append(" | Amount: ").append(result.amount.toString())
                                    .append(" | Merchant: ").append(result.merchant)
                                    .append(" | DateFilterMatch: ").append(matchDate.toString()).append("\n")

                                if (matchDate) {
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
                                    parsedCount++
                                }
                            }
                        }
                    }
                } catch (e: Exception) {
                    logBuilder.append("Error querying ").append(uriName).append(": ").append(e.message ?: "").append("\n")
                }
            }

            // 푸시 알림 히스토리 분석 (Status Bar 활성 알림)
            val pushCount = AppNotificationListener.syncPushHistoryForDate(targetDateStr)
            
            // 5. 로컬 DB의 app_notifications_raw 테이블 조회 (과거 수집된 보관 푸시 재파싱)
            logBuilder.append("\n--- 5. Querying app_notifications_raw (Saved Push Logs) ---\n")
            var savedPushCount = 0
            try {
                val dbPath = reactContext.getDatabasePath("budget_app.db")
                if (dbPath.exists()) {
                    val db = android.database.sqlite.SQLiteDatabase.openDatabase(dbPath.absolutePath, null, android.database.sqlite.SQLiteDatabase.OPEN_READONLY)
                    val cursor = db.rawQuery("SELECT package_name, raw_content, post_time FROM app_notifications_raw WHERE is_bookmarked = 1", null)
                    cursor?.use { c ->
                        val pkgIdx = c.getColumnIndex("package_name")
                        val contentIdx = c.getColumnIndex("raw_content")
                        val timeIdx = c.getColumnIndex("post_time")
                        val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())

                        while (c.moveToNext()) {
                            val pkgName = if (pkgIdx != -1) c.getString(pkgIdx) ?: "" else ""
                            val content = if (contentIdx != -1) c.getString(contentIdx) ?: "" else ""
                            val timeStr = if (timeIdx != -1) c.getString(timeIdx) ?: "" else ""

                            if (content.isBlank() || processedBodies.contains(content)) continue
                            processedBodies.add(content)
                            scannedCount++

                            val msgTime = try { sdf.parse(timeStr)?.time ?: System.currentTimeMillis() } catch (e: Exception) { System.currentTimeMillis() }
                            
                            val result = FinancialTextParser.parse(content, msgTime, "PUSH", pkgName)
                            if (result.isPayment) {
                                val matchDate = targetDateStr.isBlank() || targetDateStr == "ALL" ||
                                        (monthStartDateStr.isNotBlank() && result.dateStr >= monthStartDateStr) ||
                                        result.dateStr == targetDateStr

                                if (matchDate) {
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
                                    savedPushCount++
                                }
                            }
                        }
                    }
                    db.close()
                }
            } catch (e: Exception) {
                logBuilder.append("Error querying app_notifications_raw: ").append(e.message ?: "").append("\n")
            }

            logBuilder.append("\nPush Notification Sync Count (Active): ").append(pushCount.toString()).append("\n")
            logBuilder.append("Push Notification Sync Count (Saved): ").append(savedPushCount.toString()).append("\n")
            logBuilder.append("Total Parsed Card Transactions: ").append((parsedCount + pushCount + savedPushCount).toString()).append("\n")
            logBuilder.append("=========================================\n")

            val resultMap: WritableMap = Arguments.createMap().apply {
                putInt("count", parsedCount + pushCount + savedPushCount)
                putInt("scannedCount", scannedCount)
                putString("debugLog", logBuilder.toString())
            }

            promise.resolve(resultMap)
        } catch (e: Exception) {
            logBuilder.append("\nFatal Sync Error: ").append(e.message ?: "").append("\n")
            promise.reject("SMS_SYNC_ERROR", logBuilder.toString(), e)
        }
    }

    @ReactMethod
    fun syncSmsHistoryForDate(targetDateStr: String, promise: Promise) {
        syncSmsHistoryWithLog(targetDateStr, promise)
    }
}
