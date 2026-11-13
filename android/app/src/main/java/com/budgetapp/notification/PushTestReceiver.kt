package com.budgetapp.notification

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.budgetapp.bridge.FinancialParserModule
import com.budgetapp.bridge.FinancialTextParser

class PushTestReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == "com.budgetapp.TEST_PUSH") {
            val rawText = intent.getStringExtra("text") ?: intent.getStringExtra("body") ?: ""
            val text = rawText.replace("'", "").replace("\"", "").trim()

            if (text.isNotBlank()) {
                FinancialTextParser.loadExceptionsFromDb(context)
                val result = FinancialTextParser.parse(text, System.currentTimeMillis(), "PUSH")
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
            }
        }
    }
}
