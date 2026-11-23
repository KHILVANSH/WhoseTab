package com.khilvansh.whosetab;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONObject;

public class PaymentDataStore {

    private static final String PREFS_NAME = "whosetab_prefs";
    private static final String KEY_PENDING_PAYMENT = "pending_paytm_payment";
    private static final String KEY_DISMISSED_PAYMENTS = "dismissed_paytm_signatures";
    private static JSONObject inMemoryPayment = null;

    public static synchronized String getSignature(JSONObject payment) {
        if (payment == null) return "";
        String txnId = payment.optString("txnId", "");
        if (!txnId.isEmpty()) return txnId;
        double amt = payment.optDouble("amount", 0.0);
        String rec = payment.optString("recipient", "");
        String note = payment.optString("rawText", payment.optString("note", ""));
        return String.format("%.2f_%s_%d", amt, rec, note.hashCode());
    }

    public static synchronized boolean isPaymentDismissed(Context context, String signature) {
        if (signature == null || signature.isEmpty() || context == null) return false;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        Set<String> dismissed = prefs.getStringSet(KEY_DISMISSED_PAYMENTS, null);
        return dismissed != null && dismissed.contains(signature);
    }

    public static synchronized void markPaymentDismissed(Context context, String signature) {
        if (signature == null || signature.isEmpty() || context == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        Set<String> dismissed = prefs.getStringSet(KEY_DISMISSED_PAYMENTS, null);
        Set<String> updated = new HashSet<>(dismissed != null ? dismissed : new HashSet<>());
        updated.add(signature);
        if (updated.size() > 60) {
            // Keep recent signatures
            Set<String> trimmed = new HashSet<>();
            int count = 0;
            for (String s : updated) {
                trimmed.add(s);
                count++;
                if (count >= 50) break;
            }
            updated = trimmed;
        }
        prefs.edit().putStringSet(KEY_DISMISSED_PAYMENTS, updated).apply();
    }

    public static synchronized void setPendingPayment(Context context, JSONObject payment) {
        if (payment == null) return;
        String sig = getSignature(payment);
        if (context != null && isPaymentDismissed(context, sig)) {
            // Already dismissed by the user — do not recreate pending payment
            return;
        }

        inMemoryPayment = payment;
        if (context != null) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().putString(KEY_PENDING_PAYMENT, payment.toString()).apply();
        }
    }

    public static synchronized JSONObject getPendingPayment(Context context) {
        if (inMemoryPayment != null) {
            String sig = getSignature(inMemoryPayment);
            if (context != null && isPaymentDismissed(context, sig)) {
                clearPendingPayment(context);
                return null;
            }
            return inMemoryPayment;
        }
        if (context != null) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String saved = prefs.getString(KEY_PENDING_PAYMENT, null);
            if (saved != null) {
                try {
                    JSONObject obj = new JSONObject(saved);
                    String sig = getSignature(obj);
                    if (isPaymentDismissed(context, sig)) {
                        clearPendingPayment(context);
                        return null;
                    }
                    inMemoryPayment = obj;
                    return inMemoryPayment;
                } catch (Exception ignored) {}
            }
        }
        return null;
    }

    public static synchronized JSONObject consumePendingPayment(Context context) {
        JSONObject payment = getPendingPayment(context);
        if (payment != null && context != null) {
            String sig = getSignature(payment);
            markPaymentDismissed(context, sig);
        }
        inMemoryPayment = null;
        if (context != null) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().remove(KEY_PENDING_PAYMENT).apply();
        }
        return payment;
    }

    public static synchronized void clearPendingPayment(Context context) {
        if (inMemoryPayment != null && context != null) {
            String sig = getSignature(inMemoryPayment);
            markPaymentDismissed(context, sig);
        }
        inMemoryPayment = null;
        if (context != null) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String saved = prefs.getString(KEY_PENDING_PAYMENT, null);
            if (saved != null) {
                try {
                    JSONObject obj = new JSONObject(saved);
                    markPaymentDismissed(context, getSignature(obj));
                } catch (Exception ignored) {}
            }
            prefs.edit().remove(KEY_PENDING_PAYMENT).apply();
        }
    }
}
