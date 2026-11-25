package com.khilvansh.whosetab;

import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.service.notification.NotificationListenerService;
import androidx.core.app.NotificationManagerCompat;

public class BootAndUpdateReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                || "android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            ScannerForegroundService.ensureRunning(context);
            try {
                boolean hasAccess = NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.getPackageName());
                if (hasAccess && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    NotificationListenerService.requestRebind(new ComponentName(context, PaytmNotificationListenerService.class));
                }
            } catch (Exception ignored) {}
        }
    }
}
