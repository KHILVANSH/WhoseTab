package com.khilvansh.whosetab;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.service.notification.NotificationListenerService;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

public class ScannerForegroundService extends Service {

    private static final String TAG = "WhoseTab";
    public static final String CHANNEL_ID_STATUS = "paytm_scanner_status";
    public static final int STATUS_NOTIFICATION_ID = 1001;
    public static final String ACTION_REFRESH_STATUS = "com.khilvansh.whosetab.REFRESH_STATUS";

    public static void ensureRunning(Context context) {
        if (context == null) return;
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
        createStatusChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        createStatusChannel();
        Notification notification = buildStatusNotification();

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(STATUS_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else {
                startForeground(STATUS_NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            Log.e(TAG, "startForeground failed: " + e.getMessage());
        }

        // Request Android to bind NotificationListenerService if granted but disconnected
        try {
            boolean hasAccess = NotificationManagerCompat.getEnabledListenerPackages(this).contains(getPackageName());
            if (hasAccess && !PaytmNotificationListenerService.isRunning() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                NotificationListenerService.requestRebind(new ComponentName(this, PaytmNotificationListenerService.class));
            }
        } catch (Exception e) {
            Log.w(TAG, "requestRebind check skipped: " + e.getMessage());
        }

        return START_STICKY;
    }

    private Notification buildStatusNotification() {
        boolean hasAccess = NotificationManagerCompat.getEnabledListenerPackages(this).contains(getPackageName());

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
