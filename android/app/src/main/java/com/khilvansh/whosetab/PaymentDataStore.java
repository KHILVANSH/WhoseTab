package com.khilvansh.whosetab;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONObject;

public class PaymentDataStore {

    private static final String PREFS_NAME = "whosetab_prefs";
    private static final String KEY_PENDING_PAYMENT = "pending_paytm_payment";
    private static JSONObject inMemoryPayment = null;

    public static synchronized void setPendingPayment(Context context, JSONObject payment) {
        inMemoryPayment = payment;
        if (context != null && payment != null) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().putString(KEY_PENDING_PAYMENT, payment.toString()).apply();
        }
    }

    public static synchronized JSONObject getPendingPayment(Context context) {
        if (inMemoryPayment != null) {
            return inMemoryPayment;
        }
        if (context != null) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String saved = prefs.getString(KEY_PENDING_PAYMENT, null);
            if (saved != null) {
                try {
                    inMemoryPayment = new JSONObject(saved);
                    return inMemoryPayment;
                } catch (Exception ignored) {}
            }
        }
        return null;
    }

    public static synchronized JSONObject consumePendingPayment(Context context) {
        JSONObject payment = getPendingPayment(context);
        inMemoryPayment = null;
        if (context != null) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().remove(KEY_PENDING_PAYMENT).apply();
        }
        return payment;
    }

    public static synchronized void clearPendingPayment(Context context) {
        inMemoryPayment = null;
        if (context != null) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().remove(KEY_PENDING_PAYMENT).apply();
        }
    }
}
