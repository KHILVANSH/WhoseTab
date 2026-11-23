package com.khilvansh.whosetab;

import android.app.ActivityOptions;
import android.app.Notification;
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
import android.util.Log;
import androidx.core.app.NotificationCompat;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONObject;

public class PaytmNotificationListenerService extends NotificationListenerService {

    private static final String TAG = "WhoseTab";
    public static final String PREFS_NAME = "whosetab_prefs";
    public static final String KEY_OPEN_DELAY = "paytm_open_delay_ms";
    private static final String CHANNEL_ID_ALERTS = "paytm_snap_alerts";
    private static final String CHANNEL_ID_STATUS = "paytm_scanner_status";
    private static final int STATUS_NOTIFICATION_ID = 1001;

    // Matches ₹350, ₹ 350.50, Rs. 350, Rs350, INR 350, 350.00 debited/paid/sent
    private static final Pattern AMOUNT_PATTERN = Pattern.compile(
        "(?i)(?:paid|sent|transfer(?:red)? of|debited (?:by|from)?|rs\\.?|inr|₹)\\s*(?:rs\\.?|inr|₹)?\\s*([0-9]+(?:,[0-9]+)*(?:\\.[0-9]{1,2})?)"
    );

    private static final Pattern RECIPIENT_PATTERN = Pattern.compile(
        "(?i)(?:to|at|for)\\s+([A-Za-z0-9\\s&'\\.]+?)(?:\\s+(?:successfully|via|on|ref|upi|txn|is successful|from|using|\\.|$))"
    );

    private static final Pattern TXN_PATTERN = Pattern.compile(
        "(?i)(?:txn(?: id)?|ref(?: no)?|upi ref)[:\\s]+([A-Za-z0-9]+)"
    );

    private final Handler handler = new Handler(Looper.getMainLooper());
    private static boolean isServiceRunning = false;

    public static boolean isRunning() {
        return isServiceRunning;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannels();
        isServiceRunning = true;
        showBackgroundStatusNotification();
        Log.d(TAG, "PaytmNotificationListenerService started and running in background.");
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        isServiceRunning = false;
    }

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        isServiceRunning = true;
        showBackgroundStatusNotification();
        Log.d(TAG, "Notification Listener connected successfully!");
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;

        String pkg = sbn.getPackageName() != null ? sbn.getPackageName().toLowerCase() : "";
        Bundle extras = sbn.getNotification().extras;
        if (extras == null) return;

        CharSequence title = extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence text = extras.getCharSequence(Notification.EXTRA_TEXT);
        CharSequence bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
        CharSequence subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT);

        StringBuilder fullText = new StringBuilder();
        if (title != null) fullText.append(title).append(" ");
        if (text != null) fullText.append(text).append(" ");
        if (bigText != null) fullText.append(bigText).append(" ");
        if (subText != null) fullText.append(subText);

        String fullBody = fullText.toString().trim();
        if (fullBody.isEmpty()) return;

        // Check if from Paytm or payment notification
        boolean isPaytm = pkg.contains("paytm");
        boolean isPaymentRelated = fullBody.contains("₹") || fullBody.contains("Rs") || fullBody.contains("INR")
                || fullBody.toLowerCase().contains("paid") || fullBody.toLowerCase().contains("debited")
                || fullBody.toLowerCase().contains("sent to") || fullBody.toLowerCase().contains("upi");

        if (isPaytm || isPaymentRelated) {
            Log.d(TAG, "Payment candidate intercepted from pkg [" + pkg + "]: " + fullBody);
            JSONObject parsed = parseRawText(fullBody);
            if (parsed != null) {
                double amount = parsed.optDouble("amount", 0.0);
                String recipient = parsed.optString("recipient", "Merchant");
                String txnId = parsed.optString("txnId", "");
                String category = parsed.optString("suggestedCategory", "General");

                Log.d(TAG, "Parsed Paytm payment: ₹" + amount + " to " + recipient);
                // Store in persistent store immediately so it survives any lifecycle transitions
                PaymentDataStore.setPendingPayment(this, parsed);
                triggerAppOpen(amount, recipient, txnId, category, fullBody);
            }
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
            if (recipient.length() > 40) recipient = recipient.substring(0, 40);
        }

        String txnId = "";
        Matcher txnMatcher = TXN_PATTERN.matcher(fullBody);
        if (txnMatcher.find()) {
            txnId = txnMatcher.group(1).trim();
        }

        String lower = fullBody.toLowerCase();
        String category = "General";
        if (lower.contains("grocer") || lower.contains("kirana") || lower.contains("mart") || lower.contains("milk") || lower.contains("vegetable")) {
            category = "Groceries";
        } else if (lower.contains("food") || lower.contains("canteen") || lower.contains("cafe") || lower.contains("restaurant") || lower.contains("zomato") || lower.contains("swiggy")) {
            category = "FoodDining";
        } else if (lower.contains("chai") || lower.contains("tea") || lower.contains("samosa") || lower.contains("juice") || lower.contains("bakery")) {
            category = "SnacksChai";
        } else if (lower.contains("stationery") || lower.contains("book") || lower.contains("xerox") || lower.contains("print") || lower.contains("lab")) {
            category = "StationeryBooks";
        } else if (lower.contains("rent") || lower.contains("wifi") || lower.contains("broadband") || lower.contains("electricity")) {
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
        long delayMs = prefs.getLong(KEY_OPEN_DELAY, 0);

        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.putExtra("paytm_amount", amount);
        openIntent.putExtra("paytm_recipient", recipient);
        openIntent.putExtra("paytm_txnId", txnId);
        openIntent.putExtra("paytm_category", category);
        openIntent.putExtra("paytm_note", raw);
        openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK 
                | Intent.FLAG_ACTIVITY_CLEAR_TOP 
                | Intent.FLAG_ACTIVITY_SINGLE_TOP 
                | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);

        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            (int) System.currentTimeMillis(),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        // Heads-up Notification with FullScreenIntent
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID_ALERTS)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("WhoseTab — Paid ₹" + String.format("%.2f", amount))
            .setContentText("Tap to choose who you bought this for (" + recipient + ")")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setDefaults(Notification.DEFAULT_ALL)
            .setContentIntent(pendingIntent)
            .setFullScreenIntent(pendingIntent, true);

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify((int) System.currentTimeMillis(), builder.build());
        }

        // Schedule Activity Launch with Background Activity Launch (BAL) bypass on Android 14/15/16
        handler.postDelayed(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    // Android 14/15/16 BAL bypass
                    ActivityOptions options = ActivityOptions.makeBasic();
                    options.setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
                    try {
                        pendingIntent.send(this, 0, null, null, null, null, options.toBundle());
                        Log.d(TAG, "Sent pendingIntent with MODE_BACKGROUND_ACTIVITY_START_ALLOWED");
                    } catch (Exception ex) {
                        startActivity(openIntent, options.toBundle());
                    }
                } else {
                    startActivity(openIntent);
                }
            } catch (Exception e) {
                Log.e(TAG, "Background activity launch exception: " + e.getMessage());
                // Overlay fallback: start via activity
                try {
                    startActivity(openIntent);
                } catch (Exception ignored) {}
            }
        }, delayMs);
    }

    private void showBackgroundStatusNotification() {
        Intent appIntent = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(
            this, 0, appIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID_STATUS)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("WhoseTab Scanner Active")
            .setContentText("Listening for Paytm payments in background")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setContentIntent(pi);

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(STATUS_NOTIFICATION_ID, builder.build());
        }
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm == null) return;

            // Alerts channel (High priority for payment snap)
            NotificationChannel alertChannel = new NotificationChannel(
                CHANNEL_ID_ALERTS,
                "Payment Snap Alerts",
                NotificationManager.IMPORTANCE_HIGH
            );
            alertChannel.setDescription("Alerts and auto-opens WhoseTab when a payment occurs");
            alertChannel.enableVibration(true);
            alertChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(alertChannel);

            // Status channel (Low priority, persistent icon in status bar)
            NotificationChannel statusChannel = new NotificationChannel(
                CHANNEL_ID_STATUS,
                "Background Scanner Status",
                NotificationManager.IMPORTANCE_LOW
            );
            statusChannel.setDescription("Shows that WhoseTab is monitoring in background");
            statusChannel.setShowBadge(false);
            nm.createNotificationChannel(statusChannel);
        }
    }
}
