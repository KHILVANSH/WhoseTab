package com.khilvansh.whosetab;

import android.app.ActivityOptions;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.service.notification.NotificationListenerService;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import org.json.JSONObject;

public class ScannerForegroundService extends Service {

    private static final String TAG = "WhoseTab";
    public static final String CHANNEL_ID_STATUS = "paytm_scanner_status";
    public static final int STATUS_NOTIFICATION_ID = 1001;
    public static final String ACTION_REFRESH_STATUS = "com.khilvansh.whosetab.REFRESH_STATUS";
    public static final String ACTION_DEFER_UNLOCK_POPUP = "com.khilvansh.whosetab.DEFER_UNLOCK_POPUP";
    private static volatile boolean serviceRunning = false;
    private static volatile Boolean lastNotifAccessState = null;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private BroadcastReceiver unlockReceiver = null;

    public static boolean isRunning() {
        return serviceRunning;
    }

    public static void schedulePopupOnUnlock(Context context, JSONObject data) {
        if (context == null || data == null) return;
        PaymentDataStore.setPendingUnlockPopup(context, data);
        try {
            Intent intent = new Intent(context, ScannerForegroundService.class);
            intent.setAction(ACTION_DEFER_UNLOCK_POPUP);
            ContextCompat.startForegroundService(context.getApplicationContext(), intent);
        } catch (Exception e) {
            Log.e(TAG, "Unable to schedule unlock popup: " + e.getMessage());
        }
    }

    public static void ensureRunning(Context context) {
        if (context == null) return;
        boolean hasAccess = false;
        try {
            hasAccess = NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.getPackageName());
        } catch (Exception ignored) {}

        // Avoid redundant startForegroundService IPC and notification rebuilds when state hasn't changed
        if (serviceRunning && lastNotifAccessState != null && lastNotifAccessState == hasAccess) {
            return;
        }
        try {
            Intent intent = new Intent(context, ScannerForegroundService.class);
            intent.setAction(ACTION_REFRESH_STATUS);
            ContextCompat.startForegroundService(context.getApplicationContext(), intent);
        } catch (Exception e) {
            Log.e(TAG, "Unable to start ScannerForegroundService: " + e.getMessage());
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        serviceRunning = true;
        createStatusChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        createStatusChannel();
        boolean hasAccess = NotificationManagerCompat.getEnabledListenerPackages(this).contains(getPackageName());

        if (!serviceRunning || lastNotifAccessState == null || lastNotifAccessState != hasAccess) {
            lastNotifAccessState = hasAccess;
            Notification notification = buildStatusNotification(hasAccess);
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    startForeground(STATUS_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
                } else {
                    startForeground(STATUS_NOTIFICATION_ID, notification);
                }
                serviceRunning = true;
            } catch (Exception e) {
                Log.e(TAG, "startForeground failed: " + e.getMessage());
            }
        }

        if (intent != null && ACTION_DEFER_UNLOCK_POPUP.equals(intent.getAction())) {
            registerUnlockReceiverIfNeeded();
        }

        // Request Android to bind NotificationListenerService if granted but disconnected
        try {
            if (hasAccess && !PaytmNotificationListenerService.isRunning() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                NotificationListenerService.requestRebind(new ComponentName(this, PaytmNotificationListenerService.class));
            }
        } catch (Exception e) {
            Log.w(TAG, "requestRebind check skipped: " + e.getMessage());
        }

        return START_STICKY;
    }

    private synchronized void registerUnlockReceiverIfNeeded() {
        if (unlockReceiver != null) return;
        unlockReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                if (intent != null && Intent.ACTION_USER_PRESENT.equals(intent.getAction())) {
                    unregisterUnlockReceiver();
                    JSONObject pending = PaymentDataStore.consumePendingUnlockPopup(ScannerForegroundService.this);
                    if (pending != null) {
                        mainHandler.postDelayed(() -> showUnlockedQuickPopup(pending), 350);
                    }
                }
            }
        };
        IntentFilter filter = new IntentFilter(Intent.ACTION_USER_PRESENT);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(unlockReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(unlockReceiver, filter);
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to register ACTION_USER_PRESENT receiver: " + e.getMessage());
            unlockReceiver = null;
        }
    }

    private synchronized void unregisterUnlockReceiver() {
        if (unlockReceiver != null) {
            try {
                unregisterReceiver(unlockReceiver);
            } catch (Exception ignored) {}
            unlockReceiver = null;
        }
    }

    private void showUnlockedQuickPopup(JSONObject data) {
        if (MainActivity.isActivityForeground) {
            boolean isRepay = "repayment".equals(data.optString("type", ""));
            MainActivity.dispatchFromServiceIfVisible(data, isRepay);
            return;
        }
        try {
            Intent popupIntent = QuickAddPopupActivity.buildIntent(this, data);
            PendingIntent popupPi = PendingIntent.getActivity(
                this,
                (int) ((System.currentTimeMillis() + 17) & 0xFFFFFF),
                popupIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
            );
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                ActivityOptions options = ActivityOptions.makeBasic();
                options.setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
                popupPi.send(this, 0, null, null, null, null, options.toBundle());
            } else {
                startActivity(popupIntent);
            }
        } catch (Exception e) {
            PaymentOverlayManager.showPaymentToast(this, data);
        }
    }

    @Override
    public void onDestroy() {
        serviceRunning = false;
        lastNotifAccessState = null;
        unregisterUnlockReceiver();
        mainHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    private Notification buildStatusNotification(boolean hasAccess) {

        Intent openAppIntent = new Intent(this, MainActivity.class);
        openAppIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentPi = PendingIntent.getActivity(
            this,
            0,
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        Intent quickLogIntent = new Intent(this, MainActivity.class);
        quickLogIntent.setAction("com.khilvansh.whosetab.QUICK_ADD");
        quickLogIntent.putExtra("open_quick_expense", true);
        quickLogIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent quickPi = PendingIntent.getActivity(
            this,
            102,
            quickLogIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        String title = hasAccess ? "WhoseTab • Listening for payments" : "WhoseTab • Permission needed";
        String body = hasAccess
            ? "Monitoring Paytm, UPI and bank credit notifications"
            : "Tap to grant Notification Access for payment alerts";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID_STATUS)
            .setSmallIcon(R.drawable.ic_stat_whosetab)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(contentPi)
            .addAction(0, "Add Expense", quickPi);

        return builder.build();
    }

    private void createStatusChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm == null) return;
            NotificationChannel statusChannel = new NotificationChannel(
                CHANNEL_ID_STATUS,
                "Background Scanner Status",
                NotificationManager.IMPORTANCE_LOW
            );
            statusChannel.setDescription("Keeps WhoseTab running in the background with a status icon");
            statusChannel.setShowBadge(false);
            statusChannel.setSound(null, null);
            statusChannel.enableVibration(false);
            nm.createNotificationChannel(statusChannel);
        }
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Re-ensure service continues when user swipes away recents card
        ensureRunning(getApplicationContext());
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
