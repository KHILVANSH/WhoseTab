package com.khilvansh.whosetab;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

public class PaymentDataStore {

    public static final String PREFS_NAME = "whosetab_prefs";
    private static final String KEY_PENDING_PAYMENT = "pending_paytm_payment";
    private static final String KEY_DISMISSED_PAYMENTS = "dismissed_paytm_instances_v2";
    private static JSONObject inMemoryPayment = null;

    private static final String KEY_PENDING_REPAYMENT = "pending_paytm_repayment";
    private static final String KEY_DISMISSED_REPAYMENTS = "dismissed_repayment_instances_v2";
    private static JSONObject inMemoryRepayment = null;

    private static final String KEY_SYNCED_CONTACTS = "synced_contacts_json";
    private static final String KEY_QUEUED_QUICK_EXPENSES = "queued_quick_expenses_json";
    private static final String KEY_RECENT_DETECTIONS = "recent_detected_events_json";
    private static final String KEY_PENDING_UNLOCK_POPUP = "pending_unlock_popup_json";
    public static final String KEY_DETECTION_MODE = "payment_detection_mode"; // "overlay" | "open_app" | "notification"
    private static final String KEY_AUTO_UPDATE_ENABLED = "auto_update_notifications_enabled";
    private static final String KEY_NOTIFIED_UPDATE_VERSION = "last_notified_update_version";

    /**
     * Instance-scoped signature so dismissing one ₹20 payment never blocks
     * a legitimate second ₹20 payment to the same shop later.
     */
    public static synchronized String getSignature(JSONObject payment) {
        if (payment == null) return "";
        String txnId = payment.optString("txnId", "");
        if (!txnId.isEmpty()) return "txn_" + txnId;

        double amt = payment.optDouble("amount", 0.0);
        String rec = payment.optString("recipient", "");
        long ts = payment.optLong("postTime", payment.optLong("timestamp", 0L));
        // Round to 2-second bucket if postTime missing so slightly shifted lookups still match instance
        long bucket = ts > 0 ? ts : (System.currentTimeMillis() / 2000L);
        return String.format(java.util.Locale.US, "%.2f_%s_%d", amt, rec, bucket);
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
        if (updated.size() > 80) {
            Set<String> trimmed = new HashSet<>();
            int count = 0;
            for (String s : updated) {
                trimmed.add(s);
                count++;
                if (count >= 60) break;
            }
            updated = trimmed;
        }
        prefs.edit().putStringSet(KEY_DISMISSED_PAYMENTS, updated).apply();
    }

    public static synchronized void setPendingPayment(Context context, JSONObject payment) {
        if (payment == null) return;
        String sig = getSignature(payment);
        if (context != null && isPaymentDismissed(context, sig)) {
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
            markPaymentDismissed(context, getSignature(payment));
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
            markPaymentDismissed(context, getSignature(inMemoryPayment));
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

    // ================= PENDING REPAYMENT (INCOMING SETTLEMENTS) =================
    public static synchronized String getRepaymentSignature(JSONObject repayment) {
        if (repayment == null) return "";
        double amt = repayment.optDouble("amount", 0.0);
        String sender = repayment.optString("sender", "");
        long ts = repayment.optLong("postTime", repayment.optLong("timestamp", 0L));
        long bucket = ts > 0 ? ts : (System.currentTimeMillis() / 2000L);
        return String.format(java.util.Locale.US, "repay_%.2f_%s_%d", amt, sender, bucket);
    }

    public static synchronized boolean isRepaymentDismissed(Context context, String signature) {
        if (signature == null || signature.isEmpty() || context == null) return false;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        Set<String> dismissed = prefs.getStringSet(KEY_DISMISSED_REPAYMENTS, null);
        return dismissed != null && dismissed.contains(signature);
    }

    public static synchronized void markRepaymentDismissed(Context context, String signature) {
        if (signature == null || signature.isEmpty() || context == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        Set<String> dismissed = prefs.getStringSet(KEY_DISMISSED_REPAYMENTS, null);
        Set<String> updated = new HashSet<>(dismissed != null ? dismissed : new HashSet<>());
        updated.add(signature);
        if (updated.size() > 80) {
            Set<String> trimmed = new HashSet<>();
            int count = 0;
            for (String s : updated) {
                trimmed.add(s);
                count++;
                if (count >= 60) break;
            }
            updated = trimmed;
        }
        prefs.edit().putStringSet(KEY_DISMISSED_REPAYMENTS, updated).apply();
    }

    public static synchronized void setPendingRepayment(Context context, JSONObject repayment) {
        if (repayment == null) return;
        String sig = getRepaymentSignature(repayment);
        if (context != null && isRepaymentDismissed(context, sig)) {
            return;
        }
        inMemoryRepayment = repayment;
        if (context != null) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().putString(KEY_PENDING_REPAYMENT, repayment.toString()).apply();
        }
    }

    public static synchronized JSONObject getPendingRepayment(Context context) {
        if (inMemoryRepayment != null) {
            String sig = getRepaymentSignature(inMemoryRepayment);
            if (context != null && isRepaymentDismissed(context, sig)) {
                clearPendingRepayment(context);
                return null;
            }
            return inMemoryRepayment;
        }
        if (context != null) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String saved = prefs.getString(KEY_PENDING_REPAYMENT, null);
            if (saved != null) {
                try {
                    JSONObject obj = new JSONObject(saved);
                    String sig = getRepaymentSignature(obj);
                    if (isRepaymentDismissed(context, sig)) {
                        clearPendingRepayment(context);
                        return null;
                    }
                    inMemoryRepayment = obj;
                    return inMemoryRepayment;
                } catch (Exception ignored) {}
            }
        }
        return null;
    }

    public static synchronized JSONObject consumePendingRepayment(Context context) {
        JSONObject repayment = getPendingRepayment(context);
        if (repayment != null && context != null) {
            markRepaymentDismissed(context, getRepaymentSignature(repayment));
        }
        inMemoryRepayment = null;
        if (context != null) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().remove(KEY_PENDING_REPAYMENT).apply();
        }
        return repayment;
    }

    public static synchronized void clearPendingRepayment(Context context) {
        if (inMemoryRepayment != null && context != null) {
            markRepaymentDismissed(context, getRepaymentSignature(inMemoryRepayment));
        }
        inMemoryRepayment = null;
        if (context != null) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String saved = prefs.getString(KEY_PENDING_REPAYMENT, null);
            if (saved != null) {
                try {
                    JSONObject obj = new JSONObject(saved);
                    markRepaymentDismissed(context, getRepaymentSignature(obj));
                } catch (Exception ignored) {}
            }
            prefs.edit().remove(KEY_PENDING_REPAYMENT).apply();
        }
    }

    // ================= CONTACTS SYNC & NATIVE QUICK-ADD QUEUE =================
    public static synchronized void setSyncedContacts(Context context, String contactsJson) {
        if (context == null || contactsJson == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_SYNCED_CONTACTS, contactsJson).apply();
    }

    public static synchronized JSONArray getSyncedContacts(Context context) {
        if (context == null) return new JSONArray();
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_SYNCED_CONTACTS, "[]");
        try {
            return new JSONArray(raw);
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    public static synchronized void addQueuedQuickExpense(Context context, JSONObject expense) {
        if (context == null || expense == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_QUEUED_QUICK_EXPENSES, "[]");
        try {
            JSONArray arr = new JSONArray(raw);
            arr.put(expense);
            prefs.edit().putString(KEY_QUEUED_QUICK_EXPENSES, arr.toString()).apply();
        } catch (Exception ignored) {}
    }

    public static synchronized JSONArray consumeQueuedQuickExpenses(Context context) {
        if (context == null) return new JSONArray();
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_QUEUED_QUICK_EXPENSES, "[]");
        prefs.edit().putString(KEY_QUEUED_QUICK_EXPENSES, "[]").apply();
        try {
            return new JSONArray(raw);
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    public static synchronized String getDetectionMode(Context context) {
        if (context == null) return "overlay";
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getString(KEY_DETECTION_MODE, "overlay");
    }

    public static synchronized void setDetectionMode(Context context, String mode) {
        if (context == null || mode == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_DETECTION_MODE, mode).apply();
    }

    // ================= RECENT DETECTED PAYMENTS RING BUFFER =================
    public static synchronized void addRecentDetection(Context context, JSONObject detection) {
        if (context == null || detection == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_RECENT_DETECTIONS, "[]");
        try {
            JSONArray existing = new JSONArray(raw);
            boolean isRepay = "repayment".equals(detection.optString("type"));
            String newSig = isRepay ? getRepaymentSignature(detection) : getSignature(detection);

            JSONArray updated = new JSONArray();
            JSONObject copy = new JSONObject(detection.toString());
            if (!copy.has("sig")) copy.put("sig", newSig);
            if (!copy.has("timestamp")) copy.put("timestamp", System.currentTimeMillis());
            updated.put(copy);

            for (int i = 0; i < existing.length() && updated.length() < 15; i++) {
                JSONObject item = existing.optJSONObject(i);
                if (item == null) continue;
                String itemSig = item.optString("sig", "");
                if (!newSig.isEmpty() && newSig.equals(itemSig)) continue;
                updated.put(item);
            }
            prefs.edit().putString(KEY_RECENT_DETECTIONS, updated.toString()).apply();
        } catch (Exception ignored) {}
    }

    public static synchronized JSONArray getRecentDetections(Context context) {
        if (context == null) return new JSONArray();
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_RECENT_DETECTIONS, "[]");
        try {
            return new JSONArray(raw);
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    public static synchronized void clearRecentDetections(Context context) {
        if (context == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_RECENT_DETECTIONS, "[]").apply();
    }

    /**
     * Purges queued/pending payment caches when resetting or upgrading entries.
     */
    public static synchronized void purgeStaleState(Context context) {
        inMemoryPayment = null;
        inMemoryRepayment = null;
        if (context == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .remove(KEY_PENDING_PAYMENT)
            .remove(KEY_PENDING_REPAYMENT)
            .remove(KEY_PENDING_UNLOCK_POPUP)
            .remove(KEY_DISMISSED_PAYMENTS)
            .remove(KEY_DISMISSED_REPAYMENTS)
            .putString(KEY_QUEUED_QUICK_EXPENSES, "[]")
            .putString(KEY_RECENT_DETECTIONS, "[]")
            .apply();
    }

    public static synchronized void setPendingUnlockPopup(Context context, JSONObject data) {
        if (context == null || data == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_PENDING_UNLOCK_POPUP, data.toString()).apply();
    }

    public static synchronized JSONObject consumePendingUnlockPopup(Context context) {
        if (context == null) return null;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_PENDING_UNLOCK_POPUP, null);
        prefs.edit().remove(KEY_PENDING_UNLOCK_POPUP).apply();
        if (raw == null || raw.isEmpty()) return null;
        try {
            return new JSONObject(raw);
        } catch (Exception e) {
            return null;
        }
    }

    public static boolean isAutoUpdateEnabled(Context context) {
        if (context == null) return true;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getBoolean(KEY_AUTO_UPDATE_ENABLED, true);
    }

    public static void setAutoUpdateEnabled(Context context, boolean enabled) {
        if (context == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putBoolean(KEY_AUTO_UPDATE_ENABLED, enabled).apply();
    }

    public static String getLastNotifiedUpdateVersion(Context context) {
        if (context == null) return "";
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getString(KEY_NOTIFIED_UPDATE_VERSION, "");
    }

    public static void setLastNotifiedUpdateVersion(Context context, String version) {
        if (context == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_NOTIFIED_UPDATE_VERSION, version != null ? version : "").apply();
    }
}
