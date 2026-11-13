package com.budgetapp.bridge

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.regex.Pattern

data class ParsedPaymentResult(
    val isPayment: Boolean,
    val cardCompany: String,
    val amount: Int,
    val merchant: String,
    val dateStr: String,
    val createdAtStr: String,
    val installmentType: String,
    val installmentMonths: Int
)

data class DynamicExceptionRule(
    val keyword: String,
    val applyPush: Boolean,
    val applySms: Boolean
)

object FinancialTextParser {

    private val dynamicExceptions = mutableListOf<DynamicExceptionRule>()

    @JvmStatic
    fun setDynamicExceptionRules(rules: List<DynamicExceptionRule>) {
        synchronized(dynamicExceptions) {
            dynamicExceptions.clear()
            dynamicExceptions.addAll(rules.filter { it.keyword.isNotBlank() })
        }
    }

    @JvmStatic
    fun loadExceptionsFromDb(context: Context) {
        try {
            val dbPath = context.getDatabasePath("budget_app.db")
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
            setDynamicExceptionRules(rules)
        } catch (e: Exception) {
            // Ignore
        }
    }

    /**
     * 삼성 갤럭시 RCS 채팅+ JSON 구조(open_rich_card Layout)에서 텍스트(TextView) 영역을 자동 추출
     */
    fun extractTextFromRcsJson(rawBody: String): String {
        val trimmed = rawBody.trim()
        if (!trimmed.startsWith("{") || !trimmed.contains("widget")) {
            return rawBody
        }

        try {
            val extractedTexts = StringBuilder()
            val json = JSONObject(trimmed)

            fun traverseJson(obj: Any?) {
                when (obj) {
                    is JSONObject -> {
                        if (obj.optString("widget") == "TextView" && obj.has("text")) {
                            val text = obj.optString("text")
                            if (text.isNotBlank()) {
                                extractedTexts.append(text).append("\n")
                            }
                        }
                        for (key in obj.keys()) {
                            traverseJson(obj.get(key))
                        }
                    }
                    is JSONArray -> {
                        for (i in 0 until obj.length()) {
                            traverseJson(obj.get(i))
                        }
                    }
                }
            }

            traverseJson(json)
            val res = extractedTexts.toString().trim()
            return if (res.isNotBlank()) res else rawBody
        } catch (e: Exception) {
            return rawBody
        }
    }

    fun parse(
        rawBody: String,
        fallbackTimeMillis: Long = System.currentTimeMillis(),
        sourceType: String = "SMS",
        packageName: String = ""
    ): ParsedPaymentResult {
        // 삼성 RCS JSON 포맷인 경우 TextView 텍스트 영역 추출
        val bodyToParse = extractTextFromRcsJson(rawBody)

        if (bodyToParse.isBlank()) {
            return ParsedPaymentResult(false, "", 0, "", "", "", "LUMP_SUM", 1)
        }

        // 0-1. 프로모션/쿠폰/명세서 마케팅 문구 제외 ("드렸어요", "혜택", "쿠폰", "결제예정", "명세서", "이용대금")
        if (bodyToParse.contains("드렸어요") || bodyToParse.contains("혜택") || bodyToParse.contains("쿠폰") || bodyToParse.contains("결제예정") || bodyToParse.contains("명세서") || bodyToParse.contains("이용대금")) {
            return ParsedPaymentResult(false, "", 0, "", "", "", "LUMP_SUM", 1)
        }

        // 0-2. 동적으로 DB에서 불러온 영역별 예외 문구가 포함된 메시지는 파싱에서 즉시 제외
        val sourceUpper = sourceType.uppercase(Locale.getDefault())
        synchronized(dynamicExceptions) {
            for (rule in dynamicExceptions) {
                if (sourceUpper == "PUSH" && rule.applyPush && bodyToParse.contains(rule.keyword)) {
                    return ParsedPaymentResult(false, "", 0, "", "", "", "LUMP_SUM", 1)
                }
                if (sourceUpper != "PUSH" && rule.applySms && bodyToParse.contains(rule.keyword)) {
                    return ParsedPaymentResult(false, "", 0, "", "", "", "LUMP_SUM", 1)
                }
            }
        }

        // 0-3. 토스(viva.republica.toss) 앱 푸시 중 KB국민카드 결제 알림 특화 파싱
        if (packageName == "viva.republica.toss" && bodyToParse.contains("KB국민카드") && bodyToParse.contains("결제")) {
            val lines = bodyToParse.split("\n", "\r").map { it.trim() }.filter { it.isNotBlank() }
            if (lines.size >= 2) {
                val amountMatcher = Pattern.compile("([0-9,]+)\\s*원\\s*결제").matcher(lines[0])
                var amount = 0
                if (amountMatcher.find()) {
                    amount = amountMatcher.group(1)?.replace(",", "")?.toIntOrNull() ?: 0
                }
                
                if (amount > 0) {
                    val detailsLine = lines[1] // 예: "KB국민카드 | 반다이남코코리아㈜(3개월 할부)"
                    val parts = detailsLine.split("|").map { it.trim() }
                    if (parts.size >= 2) {
                        var merchantPart = parts[1]
                        var installmentType = "LUMP_SUM"
                        var installmentMonths = 1
                        
                        // 할부 파싱
                        val instMatcher = Pattern.compile("\\(([^)]+)\\)").matcher(merchantPart)
                        while (instMatcher.find()) {
                            val insideText = instMatcher.group(1) ?: ""
                            if (insideText.contains("일시불")) {
                                installmentType = "LUMP_SUM"
                                merchantPart = merchantPart.replace(instMatcher.group(0) ?: "", "").trim()
                            } else if (insideText.contains("할부")) {
                                val monthMatcher = Pattern.compile("([0-9]+)\\s*개월").matcher(insideText)
                                if (monthMatcher.find()) {
                                    installmentType = "INSTALLMENT"
                                    installmentMonths = monthMatcher.group(1)?.toIntOrNull() ?: 1
                                }
                                merchantPart = merchantPart.replace(instMatcher.group(0) ?: "", "").trim()
                            }
                        }
                        
                        val dateStr = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date(fallbackTimeMillis))
                        val createdAtStr = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(Date(fallbackTimeMillis))
                        
                        return ParsedPaymentResult(
                            isPayment = true,
                            cardCompany = "국민카드",
                            amount = amount,
                            merchant = merchantPart,
                            dateStr = dateStr,
                            createdAtStr = createdAtStr,
                            installmentType = installmentType,
                            installmentMonths = installmentMonths
                        )
                    }
                }
            }
        }

        // 1. 카드사 및 승인/취소 문구 체크 (카드사 + 승인/자동결제/결제/접수/취소)
        val hasKeyword = bodyToParse.contains("승인") || bodyToParse.contains("자동결제") || bodyToParse.contains("결제") || bodyToParse.contains("접수") || bodyToParse.contains("취소")
        val cardCompany = when {
            bodyToParse.contains("삼성") -> "삼성카드"
            bodyToParse.contains("현대") -> "현대카드"
            bodyToParse.contains("롯데") -> "롯데카드"
            bodyToParse.contains("신한") -> "신한카드"
            bodyToParse.contains("국민") || bodyToParse.contains("KB") -> "국민카드"
            bodyToParse.contains("하나") -> "하나카드"
            bodyToParse.contains("우리") -> "우리카드"
            bodyToParse.contains("농협") || bodyToParse.contains("NH") -> "NH농협카드"
            bodyToParse.contains("카카오") -> "카카오뱅크"
            bodyToParse.contains("카드") -> "기타카드"
            else -> ""
        }

        if (cardCompany.isEmpty() || !hasKeyword) {
            return ParsedPaymentResult(false, "", 0, "", "", "", "LUMP_SUM", 1)
        }

        // 2. 금액 추출 (누적금액 줄은 제외)
        val lines = bodyToParse.split("\n", "\r").map { it.trim() }.filter { it.isNotBlank() }
        var amount = 0

        val amountPattern = Pattern.compile("([0-9,]+)\\s*원")
        for (line in lines) {
            if (line.contains("누적")) continue // 누적 잔액 줄은 건너뜀
            val matcher = amountPattern.matcher(line)
            if (matcher.find()) {
                val rawAmount = matcher.group(1)?.replace(",", "") ?: "0"
                val parsed = rawAmount.toIntOrNull() ?: 0
                if (parsed > 0) {
                    amount = parsed
                    break
                }
            }
        }

        if (amount <= 0) {
            return ParsedPaymentResult(false, "", 0, "", "", "", "LUMP_SUM", 1)
        }

        // 3. 할부 개월 수 추출
        var installmentType = "LUMP_SUM"
        var installmentMonths = 1
        val installmentPattern = Pattern.compile("(일시불|([0-9]+)개월)")
        val instMatcher = installmentPattern.matcher(bodyToParse)
        if (instMatcher.find()) {
            val instText = instMatcher.group(1) ?: "일시불"
            if (instText != "일시불") {
                installmentType = "INSTALLMENT"
                installmentMonths = instMatcher.group(2)?.toIntOrNull() ?: 1
            }
        }

        // 4. 날짜 및 시간 파싱 (예: 10/13 11:55 또는 10/12접수 또는 10/12)
        val safeFallbackTime = if (fallbackTimeMillis > 0) fallbackTimeMillis else System.currentTimeMillis()
        val fallbackCal = Calendar.getInstance().apply { timeInMillis = safeFallbackTime }
        val fallbackYear = fallbackCal.get(Calendar.YEAR)
        val fallbackMonth = fallbackCal.get(Calendar.MONTH) + 1

        var dateStr = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date(safeFallbackTime))
        var createdAtStr = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(Date(safeFallbackTime))

        val dateTimePattern = Pattern.compile("([0-9]{1,2})\\/([0-9]{1,2})(?:\\s+([0-9]{1,2}):([0-9]{2}))?")
        val dtMatcher = dateTimePattern.matcher(bodyToParse)
        if (dtMatcher.find()) {
            val month = dtMatcher.group(1)?.toIntOrNull() ?: 0
            val day = dtMatcher.group(2)?.toIntOrNull() ?: 0
            val hour = dtMatcher.group(3)?.toIntOrNull() ?: 0
            val minute = dtMatcher.group(4)?.toIntOrNull() ?: 0

            if (month in 1..12 && day in 1..31 && hour in 0..23 && minute in 0..59) {
                var parsedYear = fallbackYear
                if (month == 12 && fallbackMonth == 1) {
                    parsedYear = fallbackYear - 1
                } else if (month == 1 && fallbackMonth == 12) {
                    parsedYear = fallbackYear + 1
                }
                dateStr = String.format(Locale.getDefault(), "%04d-%02d-%02d", parsedYear, month, day)
                createdAtStr = String.format(Locale.getDefault(), "%04d-%02d-%02d %02d:%02d:00", parsedYear, month, day, hour, minute)
            }
        }

        // 5. 사용처(가맹점) 추출
        var merchant = ""

        // 패턴 A-1: 현대카드 전용 특화 패턴 (Line 1 = 승인/금액/날짜, Line 2 = 사용처, Line 3 = 누적)
        if (cardCompany == "현대카드" || bodyToParse.contains("현대")) {
            for (i in 0 until lines.size) {
                val l = lines[i]
                if (l.contains("승인") || l.contains("취소") || l.contains("이용")) {
                    if (i + 1 < lines.size) {
                        val candidateLine = lines[i + 1].trim()
                        if (candidateLine.isNotBlank() && !candidateLine.contains("누적") && !candidateLine.contains("/")) {
                            merchant = candidateLine
                            break
                        }
                    }
                }
            }
        }

        // 패턴 A-2: 날짜/시간이 적힌 줄에서 날짜, 시간, 누적금액, 숫자원 단어를 제외한 단어를 사용처로 추출
        if (merchant.isBlank()) {
            val lineWithTime = lines.find { it.contains("/") }
            if (lineWithTime != null) {
                val parts = lineWithTime.split("\\s+".toRegex())
                val candidate = parts.lastOrNull { p ->
                    val word = p.trim()
                    word.isNotBlank() &&
                            !word.contains("/") &&
                            !Pattern.compile("^[0-9]{1,2}:[0-9]{2}$").matcher(word).matches() &&
                            !Pattern.compile("^[0-9,,-]+원$").matcher(word).matches() &&
                            !word.contains("누적") &&
                            !word.contains("일시불") &&
                            !word.contains("개월")
                }
                if (!candidate.isNullOrBlank()) {
                    merchant = candidate
                }
            }
        }

        // 패턴 B: 자동결제 / 접수 / 승인 / 취소 줄 다음 줄에서 사용처 추출
        if (merchant.isBlank()) {
            for (i in 0 until lines.size) {
                val l = lines[i]
                if (l.contains("자동결제") || l.contains("접수") || l.contains("승인") || l.contains("취소")) {
                    if (i + 1 < lines.size) {
                        val nextLine = lines[i + 1]
                        if (!nextLine.contains("원") && !nextLine.contains("누적") && !nextLine.contains("/") && !Pattern.compile("^[0-9]{1,2}:[0-9]{2}$").matcher(nextLine).find()) {
                            merchant = nextLine
                            break
                        }
                    }
                }
            }
        }

        // 패턴 C: 전체 단어 중 시각(20:55)이나 숫자금액이 아닌 사용처 단어 추출
        if (merchant.isBlank()) {
            val words = bodyToParse.split("\\s+".toRegex())
            merchant = words.lastOrNull { w ->
                val word = w.trim()
                word.isNotBlank() &&
                        !word.contains("승인") &&
                        !word.contains("접수") &&
                        !word.contains("취소") &&
                        !word.contains("누적") &&
                        !word.contains("카드") &&
                        !Pattern.compile("^[0-9]{1,2}:[0-9]{2}$").matcher(word).matches() &&
                        !Pattern.compile("^[0-9,,-]+원$").matcher(word).matches()
            } ?: "카드 결제"
        }

        // 가맹점 명칭 정제 (예: "LGU+ 통신(452325)" -> "LGU+ 통신", "제이엔에스(주)원" -> "제이엔에스(주)")
        merchant = merchant.replace("\\([0-9]+\\)".toRegex(), "").trim()
        if (merchant.endsWith("원") && !merchant.endsWith("만원") && merchant.length > 1) {
            merchant = merchant.substring(0, merchant.length - 1).trim()
        }

        if (merchant.contains("드렸어요") || merchant.contains("결제금액") || merchant.contains("q.samsungcard.com")) {
            return ParsedPaymentResult(false, "", 0, "", "", "", "LUMP_SUM", 1)
        }
        if (merchant.isBlank() || Pattern.compile("^[0-9]{1,2}:[0-9]{2}$").matcher(merchant).matches()) {
            merchant = "카드 결제"
        }

        // 6. 결제 취소(승인취소, 결제취소 등)인 경우 금액을 음수(-amount)로 변환하고 사용처에 [취소] 표기
        var finalAmount = amount
        var finalMerchant = merchant
        if (bodyToParse.contains("취소")) {
            finalAmount = -Math.abs(amount)
            if (!finalMerchant.startsWith("[취소]")) {
                finalMerchant = "[취소] $finalMerchant"
            }
        }

        return ParsedPaymentResult(
            isPayment = true,
            cardCompany = cardCompany,
            amount = finalAmount,
            merchant = finalMerchant,
            dateStr = dateStr,
            createdAtStr = createdAtStr,
            installmentType = installmentType,
            installmentMonths = installmentMonths
        )
    }
}
