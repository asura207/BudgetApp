package com.budgetapp.bridge

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.sql.Connection
import java.sql.DriverManager

class PostgresBackupWorker(appContext: Context, workerParams: WorkerParameters) :
    CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        val prefs = applicationContext.getSharedPreferences("BudgetAppPrefs", Context.MODE_PRIVATE)
        val userKey = prefs.getString("USER_KEY", null) ?: return Result.failure()
        
        return try {
            val success = performBackupNative(applicationContext, userKey)
            if (success) Result.success() else Result.retry()
        } catch (e: Throwable) {
            Result.retry()
        }
    }
    
    companion object {
        fun getConnection(): Connection {
            Class.forName("org.postgresql.Driver")
            return DriverManager.getConnection("jdbc:postgresql://218.234.55.78:5432/buget", "buget", "buget123$%^")
        }
        
        fun performBackupNative(context: Context, userKey: String): Boolean {
            var conn: Connection? = null
            var sqliteDb: android.database.sqlite.SQLiteDatabase? = null
            try {
                conn = getConnection()
                conn.autoCommit = false
                
                val dbPath = File(context.filesDir, "budget_app.db")
                if (!dbPath.exists()) return false
                sqliteDb = android.database.sqlite.SQLiteDatabase.openDatabase(dbPath.absolutePath, null, android.database.sqlite.SQLiteDatabase.OPEN_READONLY)
                
                // Clear existing remote data for this user
                arrayOf("transactions", "recurring_rules", "holidays", "app_notifications_raw", "parse_exceptions", "manual_installments").forEach { table ->
                    conn.prepareStatement("DELETE FROM $table WHERE user_key = ?").use { stmt ->
                        stmt.setString(1, userKey)
                        stmt.executeUpdate()
                    }
                }
                
                // 1. Transactions
                sqliteDb.rawQuery("SELECT * FROM transactions", null)?.use { rs ->
                    val stmt = conn.prepareStatement("INSERT INTO transactions (user_key, id, date, category_type, amount, merchant, payment_type, card_company, installment_type, installment_months, is_recurring, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                    while (rs.moveToNext()) {
                        stmt.setString(1, userKey)
                        stmt.setString(2, rs.getString(rs.getColumnIndexOrThrow("id")))
                        stmt.setString(3, rs.getString(rs.getColumnIndexOrThrow("date")))
                        stmt.setString(4, rs.getString(rs.getColumnIndexOrThrow("category_type")))
                        stmt.setInt(5, rs.getInt(rs.getColumnIndexOrThrow("amount")))
                        stmt.setString(6, rs.getString(rs.getColumnIndexOrThrow("merchant")))
                        stmt.setString(7, rs.getString(rs.getColumnIndexOrThrow("payment_type")))
                        stmt.setString(8, rs.getString(rs.getColumnIndexOrThrow("card_company")))
                        stmt.setString(9, rs.getString(rs.getColumnIndexOrThrow("installment_type")))
                        stmt.setInt(10, rs.getInt(rs.getColumnIndexOrThrow("installment_months")))
                        stmt.setBoolean(11, rs.getInt(rs.getColumnIndexOrThrow("is_recurring")) == 1)
                        stmt.setString(12, rs.getString(rs.getColumnIndexOrThrow("created_at")))
                        stmt.addBatch()
                    }
                    stmt.executeBatch()
                    stmt.close()
                }

                // 2. Recurring Rules
                sqliteDb.rawQuery("SELECT * FROM recurring_rules", null)?.use { rs ->
                    val stmt = conn.prepareStatement("INSERT INTO recurring_rules (user_key, id, day_of_month, is_daily, repeat_type, days_of_week, start_date, category_type, amount, merchant, payment_type, card_company, installment_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                    while (rs.moveToNext()) {
                        stmt.setString(1, userKey)
                        stmt.setString(2, rs.getString(rs.getColumnIndexOrThrow("id")))
                        stmt.setInt(3, rs.getInt(rs.getColumnIndexOrThrow("day_of_month")))
                        stmt.setBoolean(4, rs.getInt(rs.getColumnIndexOrThrow("is_daily")) == 1)
                        stmt.setString(5, rs.getString(rs.getColumnIndexOrThrow("repeat_type")))
                        stmt.setString(6, rs.getString(rs.getColumnIndexOrThrow("days_of_week")))
                        stmt.setString(7, rs.getString(rs.getColumnIndexOrThrow("start_date")))
                        stmt.setString(8, rs.getString(rs.getColumnIndexOrThrow("category_type")))
                        stmt.setInt(9, rs.getInt(rs.getColumnIndexOrThrow("amount")))
                        stmt.setString(10, rs.getString(rs.getColumnIndexOrThrow("merchant")))
                        stmt.setString(11, rs.getString(rs.getColumnIndexOrThrow("payment_type")))
                        stmt.setString(12, rs.getString(rs.getColumnIndexOrThrow("card_company")))
                        stmt.setString(13, rs.getString(rs.getColumnIndexOrThrow("installment_type")))
                        stmt.addBatch()
                    }
                    stmt.executeBatch()
                    stmt.close()
                }

                // 3. Holidays
                sqliteDb.rawQuery("SELECT * FROM holidays WHERE is_custom = 1", null)?.use { rs ->
                    val stmt = conn.prepareStatement("INSERT INTO holidays (user_key, locdate, date_name, is_holiday, is_custom) VALUES (?, ?, ?, ?, ?)")
                    while (rs.moveToNext()) {
                        stmt.setString(1, userKey)
                        stmt.setString(2, rs.getString(rs.getColumnIndexOrThrow("locdate")))
                        stmt.setString(3, rs.getString(rs.getColumnIndexOrThrow("date_name")))
                        stmt.setBoolean(4, rs.getInt(rs.getColumnIndexOrThrow("is_holiday")) == 1)
                        stmt.setBoolean(5, rs.getInt(rs.getColumnIndexOrThrow("is_custom")) == 1)
                        stmt.addBatch()
                    }
                    stmt.executeBatch()
                    stmt.close()
                }

                // 4. App Notifications (보관된 푸시 알림만 백업)
                sqliteDb.rawQuery("SELECT * FROM app_notifications_raw WHERE is_bookmarked = 1", null)?.use { rs ->
                    val stmt = conn.prepareStatement("INSERT INTO app_notifications_raw (user_key, id, package_name, title, text, big_text, raw_content, post_time, is_bookmarked, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                    while (rs.moveToNext()) {
                        stmt.setString(1, userKey)
                        stmt.setString(2, rs.getString(rs.getColumnIndexOrThrow("id")))
                        stmt.setString(3, rs.getString(rs.getColumnIndexOrThrow("package_name")))
                        stmt.setString(4, rs.getString(rs.getColumnIndexOrThrow("title")))
                        stmt.setString(5, rs.getString(rs.getColumnIndexOrThrow("text")))
                        stmt.setString(6, rs.getString(rs.getColumnIndexOrThrow("big_text")))
                        stmt.setString(7, rs.getString(rs.getColumnIndexOrThrow("raw_content")))
                        stmt.setString(8, rs.getString(rs.getColumnIndexOrThrow("post_time")))
                        stmt.setBoolean(9, rs.getInt(rs.getColumnIndexOrThrow("is_bookmarked")) == 1)
                        stmt.setString(10, rs.getString(rs.getColumnIndexOrThrow("created_at")))
                        stmt.addBatch()
                    }
                    stmt.executeBatch()
                    stmt.close()
                }

                // 5. Parse Exceptions
                sqliteDb.rawQuery("SELECT * FROM parse_exceptions", null)?.use { rs ->
                    val stmt = conn.prepareStatement("INSERT INTO parse_exceptions (user_key, keyword, apply_push, apply_sms) VALUES (?, ?, ?, ?)")
                    while (rs.moveToNext()) {
                        stmt.setString(1, userKey)
                        stmt.setString(2, rs.getString(rs.getColumnIndexOrThrow("keyword")))
                        stmt.setBoolean(3, rs.getInt(rs.getColumnIndexOrThrow("apply_push")) == 1)
                        stmt.setBoolean(4, rs.getInt(rs.getColumnIndexOrThrow("apply_sms")) == 1)
                        stmt.addBatch()
                    }
                    stmt.executeBatch()
                    stmt.close()
                }

                // 6. Manual Installments from SharedPreferences
                val prefs = context.getSharedPreferences("BudgetAppPrefs", Context.MODE_PRIVATE)
                val manualInstJson = prefs.getString("MANUAL_INSTALLMENTS", "{}")
                val manualInst = JSONObject(manualInstJson)
                if (manualInst.length() > 0) {
                    val stmt = conn.prepareStatement("INSERT INTO manual_installments (user_key, year_month, amount) VALUES (?, ?, ?)")
                    for (key in manualInst.keys()) {
                        stmt.setString(1, userKey)
                        stmt.setString(2, key)
                        stmt.setInt(3, manualInst.getInt(key))
                        stmt.addBatch()
                    }
                    stmt.executeBatch()
                    stmt.close()
                }

                // 7. User Settings from SharedPreferences
                val userJsonStr = prefs.getString("USER_SETTINGS", "{}")
                val userJson = JSONObject(userJsonStr ?: "{}")
                if (userJson.length() > 0) {
                    val stmt = conn.prepareStatement("INSERT INTO user_settings (user_key, nickname, monthly_budget, view_mode) VALUES (?, ?, ?, ?)")
                    stmt.setString(1, userKey)
                    stmt.setString(2, userJson.optString("nickname", ""))
                    stmt.setInt(3, userJson.optInt("monthlyBudget", 0))
                    stmt.setString(4, userJson.optString("viewMode", "MONTHLY"))
                    stmt.executeUpdate()
                    stmt.close()
                }

                conn.commit()
                return true
            } catch (e: Throwable) {
                conn?.rollback()
                android.util.Log.e("PostgresBackupWorker", "Worker Backup Error", e)
                return false
            } finally {
                try { sqliteDb?.close() } catch (e: Exception) {}
                try { conn?.close() } catch (e: Exception) {}
            }
        }

        fun performBackupWithJson(userKey: String, jsonData: String): Boolean {
            var conn: Connection? = null
            try {
                conn = getConnection()
                conn.autoCommit = false

                val data = JSONObject(jsonData)
                
                // Clear existing data for this user
                arrayOf("transactions", "recurring_rules", "holidays", "app_notifications_raw", "parse_exceptions", "manual_installments", "user_settings").forEach { table ->
                    conn.prepareStatement("DELETE FROM $table WHERE user_key = ?").use { stmt ->
                        stmt.setString(1, userKey)
                        stmt.executeUpdate()
                    }
                }

                // 1. Transactions
                val txs = data.optJSONArray("transactions") ?: JSONArray()
                if (txs.length() > 0) {
                    val stmt = conn.prepareStatement("INSERT INTO transactions (user_key, id, date, category_type, amount, merchant, payment_type, card_company, installment_type, installment_months, is_recurring, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                    for (i in 0 until txs.length()) {
                        val tx = txs.getJSONObject(i)
                        stmt.setString(1, userKey)
                        stmt.setString(2, tx.getString("id"))
                        stmt.setString(3, tx.getString("date"))
                        stmt.setString(4, tx.getString("categoryType"))
                        stmt.setInt(5, tx.getInt("amount"))
                        stmt.setString(6, tx.getString("merchant"))
                        stmt.setString(7, tx.getString("paymentType"))
                        stmt.setString(8, tx.optString("cardCompany", null))
                        stmt.setString(9, tx.getString("installmentType"))
                        stmt.setInt(10, tx.optInt("installmentMonths", 1))
                        stmt.setBoolean(11, tx.optBoolean("isRecurring", false))
                        stmt.setString(12, tx.optString("createdAt", null))
                        stmt.addBatch()
                    }
                    stmt.executeBatch()
                    stmt.close()
                }

                // 2. Recurring Rules
                val rr = data.optJSONArray("recurringRules") ?: JSONArray()
                if (rr.length() > 0) {
                    val stmt = conn.prepareStatement("INSERT INTO recurring_rules (user_key, id, day_of_month, is_daily, repeat_type, days_of_week, start_date, category_type, amount, merchant, payment_type, card_company, installment_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                    for (i in 0 until rr.length()) {
                        val r = rr.getJSONObject(i)
                        stmt.setString(1, userKey)
                        stmt.setString(2, r.getString("id"))
                        stmt.setInt(3, r.getInt("dayOfMonth"))
                        stmt.setBoolean(4, r.optBoolean("isDaily", false))
                        stmt.setString(5, r.optString("repeatType", null))
                        stmt.setString(6, r.optJSONArray("daysOfWeek")?.toString())
                        stmt.setString(7, r.optString("startDate", null))
                        stmt.setString(8, r.getString("categoryType"))
                        stmt.setInt(9, r.getInt("amount"))
                        stmt.setString(10, r.getString("merchant"))
                        stmt.setString(11, r.getString("paymentType"))
                        stmt.setString(12, r.optString("cardCompany", null))
                        stmt.setString(13, r.getString("installmentType"))
                        stmt.addBatch()
                    }
                    stmt.executeBatch()
                    stmt.close()
                }

                // 3. Holidays
                val hols = data.optJSONArray("customHolidays") ?: JSONArray()
                if (hols.length() > 0) {
                    val stmt = conn.prepareStatement("INSERT INTO holidays (user_key, locdate, date_name, is_holiday, is_custom) VALUES (?, ?, ?, ?, ?)")
                    for (i in 0 until hols.length()) {
                        val h = hols.getJSONObject(i)
                        stmt.setString(1, userKey)
                        stmt.setString(2, h.getString("locdate"))
                        stmt.setString(3, h.getString("dateName"))
                        stmt.setBoolean(4, h.optBoolean("isHoliday", true))
                        stmt.setBoolean(5, h.optBoolean("isCustom", false))
                        stmt.addBatch()
                    }
                    stmt.executeBatch()
                    stmt.close()
                }

                // 4. App Notifications (보관된 푸시만 백업)
                val notifs = data.optJSONArray("rawAppNotifications") ?: JSONArray()
                if (notifs.length() > 0) {
                    val stmt = conn.prepareStatement("INSERT INTO app_notifications_raw (user_key, id, package_name, title, text, big_text, raw_content, post_time, is_bookmarked, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                    for (i in 0 until notifs.length()) {
                        val n = notifs.getJSONObject(i)
                        if (n.optBoolean("isBookmarked", false)) {
                            stmt.setString(1, userKey)
                            stmt.setString(2, n.getString("id"))
                            stmt.setString(3, n.optString("packageName", ""))
                            stmt.setString(4, n.optString("title", ""))
                            stmt.setString(5, n.optString("text", ""))
                            stmt.setString(6, n.optString("bigText", ""))
                            stmt.setString(7, n.getString("rawContent"))
                            stmt.setString(8, n.getString("postTime"))
                            stmt.setBoolean(9, true)
                            stmt.setString(10, n.optString("createdAt", null))
                            stmt.addBatch()
                        }
                    }
                    stmt.executeBatch()
                    stmt.close()
                }

                // 5. Parse Exceptions
                val ex = data.optJSONArray("parseExceptions") ?: JSONArray()
                if (ex.length() > 0) {
                    val stmt = conn.prepareStatement("INSERT INTO parse_exceptions (user_key, keyword, apply_push, apply_sms) VALUES (?, ?, ?, ?)")
                    for (i in 0 until ex.length()) {
                        val e = ex.getJSONObject(i)
                        stmt.setString(1, userKey)
                        stmt.setString(2, e.getString("keyword"))
                        stmt.setBoolean(3, e.optBoolean("applyPush", true))
                        stmt.setBoolean(4, e.optBoolean("applySms", true))
                        stmt.addBatch()
                    }
                    stmt.executeBatch()
                    stmt.close()
                }

                // 6. Manual Installments
                val manualInst = data.optJSONObject("manualInstallments")
                if (manualInst != null && manualInst.length() > 0) {
                    val stmt = conn.prepareStatement("INSERT INTO manual_installments (user_key, year_month, amount) VALUES (?, ?, ?)")
                    for (key in manualInst.keys()) {
                        stmt.setString(1, userKey)
                        stmt.setString(2, key)
                        stmt.setInt(3, manualInst.getInt(key))
                        stmt.addBatch()
                    }
                    stmt.executeBatch()
                    stmt.close()
                }

                // 7. User Settings
                val user = data.optJSONObject("user")
                if (user != null) {
                    val stmt = conn.prepareStatement("INSERT INTO user_settings (user_key, nickname, monthly_budget, view_mode) VALUES (?, ?, ?, ?)")
                    stmt.setString(1, userKey)
                    stmt.setString(2, user.optString("nickname", ""))
                    stmt.setInt(3, user.optInt("monthlyBudget", 0))
                    stmt.setString(4, user.optString("viewMode", "MONTHLY"))
                    stmt.executeUpdate()
                    stmt.close()
                }

                conn.commit()
                return true
            } catch (e: Throwable) {
                conn?.rollback()
                android.util.Log.e("PostgresBackupWorker", "JSON Backup Error", e)
                return false
            } finally {
                try { conn?.close() } catch (e: Exception) {}
            }
        }
    }
}
