package com.budgetapp.bridge

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.sql.Connection
import java.sql.DriverManager
import java.util.Calendar
import java.util.concurrent.TimeUnit

class PostgresBackupModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "PostgresBackupModule"
    }

    @ReactMethod
    fun syncSettingsToPrefs(userJson: String, manualInstallmentsJson: String) {
        val prefs = reactContext.getSharedPreferences("BudgetAppPrefs", Context.MODE_PRIVATE)
        prefs.edit()
            .putString("USER_SETTINGS", userJson)
            .putString("MANUAL_INSTALLMENTS", manualInstallmentsJson)
            .apply()
    }

    @ReactMethod
    fun saveUserKeyForWorker(userKey: String) {
        val prefs = reactContext.getSharedPreferences("BudgetAppPrefs", Context.MODE_PRIVATE)
        prefs.edit().putString("USER_KEY", userKey).apply()
        
        scheduleDailyBackup()
    }
    
    private fun scheduleDailyBackup() {
        val currentDate = Calendar.getInstance()
        val dueDate = Calendar.getInstance()
        dueDate.set(Calendar.HOUR_OF_DAY, 1)
        dueDate.set(Calendar.MINUTE, 0)
        dueDate.set(Calendar.SECOND, 0)
        
        if (dueDate.before(currentDate)) {
            dueDate.add(Calendar.HOUR_OF_DAY, 24)
        }
        val timeDiff = dueDate.timeInMillis - currentDate.timeInMillis
        
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
            
        val dailyWorkRequest = PeriodicWorkRequestBuilder<PostgresBackupWorker>(24, TimeUnit.HOURS)
            .setInitialDelay(timeDiff, TimeUnit.MILLISECONDS)
            .setConstraints(constraints)
            .build()
            
        WorkManager.getInstance(reactContext).enqueueUniquePeriodicWork(
            "DailyPostgresBackup",
            ExistingPeriodicWorkPolicy.UPDATE,
            dailyWorkRequest
        )
    }

    @ReactMethod
    fun backupToRemoteDb(userKey: String, jsonData: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val result = PostgresBackupWorker.performBackupWithJson(userKey, jsonData)
                if (result == "SUCCESS") {
                    promise.resolve(true)
                } else {
                    promise.reject("BACKUP_ERROR", result)
                }
            } catch (e: Throwable) {
                promise.reject("BACKUP_ERROR", e.toString())
            }
        }
    }

    @ReactMethod
    fun restoreFromRemoteDb(userKey: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            var conn: Connection? = null
            try {
                conn = PostgresBackupWorker.getConnection()
                val resultData = JSONObject()

                // 1. User Settings
                conn.prepareStatement("SELECT * FROM user_settings WHERE user_key = ?").use { stmt ->
                    stmt.setString(1, userKey)
                    val rs = stmt.executeQuery()
                    if (rs.next()) {
                        val userObj = JSONObject()
                        userObj.put("nickname", rs.getString("nickname"))
                        userObj.put("monthlyBudget", rs.getInt("monthly_budget"))
                        userObj.put("viewMode", rs.getString("view_mode"))
                        resultData.put("user", userObj)
                    }
                }

                // 2. Transactions
                val txs = JSONArray()
                conn.prepareStatement("SELECT * FROM transactions WHERE user_key = ?").use { stmt ->
                    stmt.setString(1, userKey)
                    val rs = stmt.executeQuery()
                    while (rs.next()) {
                        val obj = JSONObject()
                        obj.put("id", rs.getString("id"))
                        obj.put("date", rs.getString("date"))
                        obj.put("categoryType", rs.getString("category_type"))
                        obj.put("amount", rs.getInt("amount"))
                        obj.put("merchant", rs.getString("merchant"))
                        obj.put("paymentType", rs.getString("payment_type"))
                        obj.put("cardCompany", rs.getString("card_company"))
                        obj.put("installmentType", rs.getString("installment_type"))
                        obj.put("installmentMonths", rs.getInt("installment_months"))
                        obj.put("isRecurring", rs.getBoolean("is_recurring"))
                        obj.put("createdAt", rs.getString("created_at"))
                        txs.put(obj)
                    }
                }
                resultData.put("transactions", txs)

                // 3. Recurring Rules
                val rr = JSONArray()
                conn.prepareStatement("SELECT * FROM recurring_rules WHERE user_key = ?").use { stmt ->
                    stmt.setString(1, userKey)
                    val rs = stmt.executeQuery()
                    while (rs.next()) {
                        val obj = JSONObject()
                        obj.put("id", rs.getString("id"))
                        obj.put("dayOfMonth", rs.getInt("day_of_month"))
                        obj.put("isDaily", rs.getBoolean("is_daily"))
                        obj.put("repeatType", rs.getString("repeat_type"))
                        val daysArrStr = rs.getString("days_of_week")
                        if (daysArrStr != null) {
                            obj.put("daysOfWeek", JSONArray(daysArrStr))
                        }
                        obj.put("startDate", rs.getString("start_date"))
                        obj.put("categoryType", rs.getString("category_type"))
                        obj.put("amount", rs.getInt("amount"))
                        obj.put("merchant", rs.getString("merchant"))
                        obj.put("paymentType", rs.getString("payment_type"))
                        obj.put("cardCompany", rs.getString("card_company"))
                        obj.put("installmentType", rs.getString("installment_type"))
                        rr.put(obj)
                    }
                }
                resultData.put("recurringRules", rr)

                // 4. Holidays
                val hols = JSONArray()
                conn.prepareStatement("SELECT * FROM holidays WHERE user_key = ?").use { stmt ->
                    stmt.setString(1, userKey)
                    val rs = stmt.executeQuery()
                    while (rs.next()) {
                        val obj = JSONObject()
                        obj.put("locdate", rs.getString("locdate"))
                        obj.put("dateName", rs.getString("date_name"))
                        obj.put("isHoliday", rs.getBoolean("is_holiday"))
                        obj.put("isCustom", rs.getBoolean("is_custom"))
                        hols.put(obj)
                    }
                }
                resultData.put("customHolidays", hols)

                // 5. App Notifications
                val notifs = JSONArray()
                conn.prepareStatement("SELECT * FROM app_notifications_raw WHERE user_key = ?").use { stmt ->
                    stmt.setString(1, userKey)
                    val rs = stmt.executeQuery()
                    while (rs.next()) {
                        val obj = JSONObject()
                        obj.put("id", rs.getString("id"))
                        obj.put("packageName", rs.getString("package_name"))
                        obj.put("title", rs.getString("title"))
                        obj.put("text", rs.getString("text"))
                        obj.put("bigText", rs.getString("big_text"))
                        obj.put("rawContent", rs.getString("raw_content"))
                        obj.put("postTime", rs.getString("post_time"))
                        obj.put("isBookmarked", rs.getBoolean("is_bookmarked"))
                        obj.put("createdAt", rs.getString("created_at"))
                        notifs.put(obj)
                    }
                }
                resultData.put("rawAppNotifications", notifs)

                // 6. Parse Exceptions
                val ex = JSONArray()
                conn.prepareStatement("SELECT * FROM parse_exceptions WHERE user_key = ?").use { stmt ->
                    stmt.setString(1, userKey)
                    val rs = stmt.executeQuery()
                    while (rs.next()) {
                        val obj = JSONObject()
                        obj.put("keyword", rs.getString("keyword"))
                        obj.put("applyPush", rs.getBoolean("apply_push"))
                        obj.put("applySms", rs.getBoolean("apply_sms"))
                        ex.put(obj)
                    }
                }
                resultData.put("parseExceptions", ex)

                // 7. Manual Installments
                val manualInst = JSONObject()
                conn.prepareStatement("SELECT * FROM manual_installments WHERE user_key = ?").use { stmt ->
                    stmt.setString(1, userKey)
                    val rs = stmt.executeQuery()
                    while (rs.next()) {
                        manualInst.put(rs.getString("year_month"), rs.getInt("amount"))
                    }
                }
                resultData.put("manualInstallments", manualInst)

                promise.resolve(resultData.toString())
            } catch (e: Throwable) {
                android.util.Log.e("PostgresBackupModule", "Restore Error", e)
                promise.reject("RESTORE_ERROR", e.message, e)
            } finally {
                conn?.close()
            }
        }
    }
}
