package com.khilvansh.whosetab;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import androidx.core.app.NotificationCompat;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONObject;

public class PaytmNotificationListenerService extends NotificationListenerService {

    public static final String PAYTM_PACKAGE = "net.one97.paytm";
    public static final String PREFS_NAME = "whosetab_prefs";
    public static final String KEY_OPEN_DELAY = "paytm_open_delay_ms";
    private static final String CHANNEL_ID = "paytm_snap_channel";

    private static final Pattern AMOUNT_PATTERN = Pattern.compile(
        "(?i)(?:paid|sent|transfer of|debited by|rs\\.?|inr|₹)\\s*(?:rs\\.?|inr|₹)?\\s*([0-9]+(?:,[0-9]+)*(?:\\.[0-9]{1,2})?)"
    );

    private static final Pattern RECIPIENT_PATTERN = Pattern.compile(
        "(?i)(?:to|at|for)\\s+([A-Za-z0-9\\s&'\\.]+?)(?:\\s+(?:successfully|via|on|ref|upi|txn|is successful|\\.|$))"
    );

    private static final Pattern TXN_PATTERN = Pattern.compile(
        "(?i)(?:txn(?: id)?|ref(?: no)?|upi ref)[:\\s]+([A-Za-z0-9]+)"
    );

    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;

        String pkg = sbn.getPackageName();
        if (!PAYTM_PACKAGE.equals(pkg)) {
            return;
        }

        Bundle extras = sbn.getNotification().extras;
        if (extras == null) return;

        CharSequence title = extras.getCharSequence("android.title");
        CharSequence text = extras.getCharSequence("android.text");
        CharSequence bigText = extras.getCharSequence("android.bigText");

        StringBuilder fullText = new StringBuilder();
        if (title != null) fullText.append(title).append(" ");
        if (text != null) fullText.append(text).append(" ");
        if (bigText != null) fullText.append(bigText);

        JSONObject parsed = parseRawText(fullText.toString());
        if (parsed != null) {
            double amount = parsed.optDouble("amount", 0.0);
            String recipient = parsed.optString("recipient", "Merchant");
            String txnId = parsed.optString("txnId", "");
            String category = parsed.optString("suggestedCategory", "General");

            triggerAppOpen(amount, recipient, txnId, category, fullText.toString());
        }
    }

    public static JSONObject parseRawText(String fullBody) {
        if (fullBody == null || fullBody.trim().isEmpty()) return null;

        Matcher amtMatcher = AMOUNT_PATTERN.matcher(fullBody);
        if (!amtMatcher.find()) return null;

        double amount;
        try {
            amount = Double.parseDouble(amtMatcher.group(1).replace(",", ""));
        } catch (Exception e) {
            return null;
        }
        if (amount <= 0.0) return null;

        String recipient = "Merchant";
        Matcher recMatcher = RECIPIENT_PATTERN.matcher(fullBody);
        if (recMatcher.find()) {
            recipient = recMatcher.group(1).trim();
        }

        String txnId = "";
        Matcher txnMatcher = TXN_PATTERN.matcher(fullBody);
        if (txnMatcher.find()) {
            txnId = txnMatcher.group(1).trim();
        }

        String lower = fullBody.toLowerCase();
        String category = "General";
        if (lower.contains("grocer") || lower.contains("kirana") || lower.contains("mart") || lower.contains("milk")) {
            category = "Groceries";
        } else if (lower.contains("food") || lower.contains("canteen") || lower.contains("cafe") || lower.contains("zomato") || lower.contains("swiggy")) {
            category = "FoodDining";
        } else if (lower.contains("chai") || lower.contains("tea") || lower.contains("samosa") || lower.contains("juice")) {
            category = "SnacksChai";
        } else if (lower.contains("stationery") || lower.contains("book") || lower.contains("xerox") || lower.contains("lab")) {
            category = "StationeryBooks";
        } else if (lower.contains("rent") || lower.contains("wifi") || lower.contains("broadband")) {
            category = "RoomRentUtilities";
        }

        try {
            JSONObject obj = new JSONObject();
            obj.put("amount", amount);
            obj.put("recipient", recipient);
            obj.put("txnId", txnId);
            obj.put("suggestedCategory", category);
            obj.put("rawText", fullBody);
            return obj;
        } catch (Exception e) {
            return null;
        }
    }

    private void triggerAppOpen(double amount, String recipient, String txnId, String category, String raw) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        // Delay option in settings: 0 = instant, 1000 = 1s, 2000 = 2s, etc.
        long delayMs = prefs.getLong(KEY_OPEN_DELAY, 0);

        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.putExtra("paytm_amount", amount);
        openIntent.putExtra("paytm_recipient", recipient);
        openIntent.putExtra("paytm_txnId", txnId);
        openIntent.putExtra("paytm_category", category);
        openIntent.putExtra("paytm_note", raw);
        openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);

        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            (int) System.currentTimeMillis(),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        // Always show heads-up notification with FullScreenIntent
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentTitle("Paid ₹" + String.format("%.2f", amount) + " on Paytm")
            .setContentText("Tap to choose whose stuff you bought (" + recipient + ")")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setFullScreenIntent(pendingIntent, true);

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(101, builder.build());
        }

        // Schedule Activity Launch after user's configured delay
        handler.postDelayed(() -> {
            try {
                // If draw over apps is granted, activity opens seamlessly on top of Paytm
                startActivity(openIntent);
            } catch (Exception e) {
                // Background start restricted: notification will serve as the immediate 1-tap entry
            }
        }, delayMs);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Paytm Expense Snapper",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Alerts and auto-opens WhoseTab when a Paytm payment occurs");
            channel.enableVibration(true);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }
}
