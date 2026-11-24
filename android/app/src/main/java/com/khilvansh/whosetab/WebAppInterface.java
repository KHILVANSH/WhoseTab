package com.khilvansh.whosetab;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.core.app.NotificationManagerCompat;
import java.util.Set;
import org.json.JSONObject;

public class WebAppInterface {

    private final Activity activity;
    private final WebView webView;

    public WebAppInterface(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    // --- SCANNER STATUS ---
    @JavascriptInterface
    public boolean isScannerRunning() {
        return PaytmNotificationListenerService.isRunning() && isNotificationAccessGranted();
    }

    // --- PAYTM OPEN DELAY SETTINGS ---
    @JavascriptInterface
    public long getOpenDelay() {
        SharedPreferences prefs = activity.getSharedPreferences(PaytmNotificationListenerService.PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getLong(PaytmNotificationListenerService.KEY_OPEN_DELAY, 0);
    }

    @JavascriptInterface
    public void setOpenDelay(long delayMs) {
        SharedPreferences prefs = activity.getSharedPreferences(PaytmNotificationListenerService.PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putLong(PaytmNotificationListenerService.KEY_OPEN_DELAY, delayMs).apply();
        activity.runOnUiThread(() -> 
            Toast.makeText(activity, "Paytm launch delay: " + (delayMs == 0 ? "Instant" : (delayMs / 1000.0) + "s"), Toast.LENGTH_SHORT).show()
        );
    }

    // --- PERMISSION CHECKS & SYSTEM SETTINGS ---
    @JavascriptInterface
    public boolean isNotificationAccessGranted() {
        Set<String> packageNames = NotificationManagerCompat.getEnabledListenerPackages(activity);
        return packageNames.contains(activity.getPackageName());
    }

    @JavascriptInterface
    public void openNotificationAccessSettings() {
        try {
            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            activity.startActivity(intent);
        } catch (Exception e) {
            Toast.makeText(activity, "Please enable notification access for WhoseTab in System Settings", Toast.LENGTH_LONG).show();
        }
    }

    @JavascriptInterface
    public boolean isOverlayPermissionGranted() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return Settings.canDrawOverlays(activity);
        }
        return true;
    }

    @JavascriptInterface
    public void openOverlayPermissionSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + activity.getPackageName()));
                activity.startActivity(intent);
            } catch (Exception e) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
                activity.startActivity(intent);
            }
        }
    }

    // --- GITHUB AUTO-UPDATE (CLEAN & DIRECT) ---
    @JavascriptInterface
    public String getAppVersion() {
        return UpdateManager.getCurrentVersion(activity);
    }

    // --- PENDING PAYMENT BRIDGE (PERSISTENT & SAFE) ---
    @JavascriptInterface
    public String getPendingPayment() {
        JSONObject obj = PaymentDataStore.getPendingPayment(activity);
        return obj != null ? obj.toString() : "";
    }

    @JavascriptInterface
    public void clearPendingPayment() {
        PaymentDataStore.clearPendingPayment(activity);
    }

    // --- PENDING REPAYMENT BRIDGE (INCOMING SETTLEMENTS) ---
    @JavascriptInterface
    public String getPendingRepayment() {
        JSONObject obj = PaymentDataStore.getPendingRepayment(activity);
        return obj != null ? obj.toString() : "";
    }

    @JavascriptInterface
    public void clearPendingRepayment() {
        PaymentDataStore.clearPendingRepayment(activity);
    }

    @JavascriptInterface
    public void dismissRepayment(String signature) {
        PaymentDataStore.markRepaymentDismissed(activity, signature);
    }

    // --- PACKAGE INSTALL PERMISSION ---
    @JavascriptInterface
    public boolean canRequestPackageInstalls() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return activity.getPackageManager().canRequestPackageInstalls();
        }
        return true;
    }

    @JavascriptInterface
    public void openUnknownSourcesSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName()));
                activity.startActivity(intent);
            } catch (Exception ignored) {}
        }
    }

    @JavascriptInterface
    public void checkForUpdates() {
        UpdateManager.checkForUpdates(activity, new UpdateManager.UpdateCheckCallback() {
            @Override
            public void onUpdateFound(String latestVersion, String apkUrl, String releaseNotes) {
                activity.runOnUiThread(() -> {
                    String js = String.format(
                        "javascript:if(window.app && window.app.showUpdatePrompt){ window.app.showUpdatePrompt('%s', '%s', '%s'); }",
                        latestVersion,
                        apkUrl,
                        releaseNotes.replace("'", "\\'").replace("\n", " ")
                    );
                    webView.evaluateJavascript(js, null);
                });
            }

            @Override
            public void onUpToDate(String currentVersion) {
                activity.runOnUiThread(() -> {
                    Toast.makeText(activity, "WhoseTab is up to date (v" + currentVersion + ")", Toast.LENGTH_SHORT).show();
                    webView.evaluateJavascript("javascript:if(window.app && window.app.onUpToDate){ window.app.onUpToDate(); }", null);
                });
            }

            @Override
            public void onError(String errorMessage) {
                activity.runOnUiThread(() -> {
                    Toast.makeText(activity, "Update check failed: " + errorMessage, Toast.LENGTH_SHORT).show();
                    webView.evaluateJavascript("javascript:if(window.app && window.app.onUpdateError){ window.app.onUpdateError('" + errorMessage.replace("'", "\\'") + "'); }", null);
                });
            }
        });
    }

    @JavascriptInterface
    public void downloadAndInstallUpdate(String apkUrl) {
        UpdateManager.downloadAndInstallApk(activity, apkUrl);
    }
}
