package com.budgetapp.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import com.budgetapp.bridge.FinancialParserModule
import com.budgetapp.bridge.FinancialTextParser

class SmsReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
            val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
            if (messages.isEmpty()) return

            val fullBody = messages.joinToString("") { it.messageBody ?: "" }
            if (fullBody.isNotBlank()) {
                FinancialTextParser.loadExceptionsFromDb(context)
                val result = FinancialTextParser.parse(fullBody, System.currentTimeMillis(), "SMS")
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
