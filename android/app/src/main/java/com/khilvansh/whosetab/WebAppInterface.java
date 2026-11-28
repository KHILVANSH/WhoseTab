package com.khilvansh.whosetab;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.core.app.NotificationManagerCompat;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

public class WebAppInterface {

    private final Activity activity;
    private final WebView webView;

    public WebAppInterface(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    // --- SCANNER STATUS & BACKGROUND CONTROL ---
    @JavascriptInterface
    public boolean isScannerRunning() {
        return PaytmNotificationListenerService.isRunning() && isNotificationAccessGranted();
    }

    @JavascriptInterface
    public void restartScannerService() {
        ScannerForegroundService.ensureRunning(activity);
    }

    // --- CONTACTS SYNC & NATIVE QUICK-ADD QUEUE ---
    @JavascriptInterface
    public void syncContacts(String contactsJson) {
        PaymentDataStore.setSyncedContacts(activity, contactsJson);
    }

    @JavascriptInterface
    public String consumeQueuedQuickExpenses() {
        JSONArray arr = PaymentDataStore.consumeQueuedQuickExpenses(activity);
        return arr != null ? arr.toString() : "[]";
    }

    @JavascriptInterface
    public void pickPhoneContact(String requestTag) {
        if (activity instanceof MainActivity) {
            ((MainActivity) activity).launchPhoneContactPicker(requestTag);
        }
    }

    @JavascriptInterface
    public void requestNearbyShops() {
        if (activity instanceof MainActivity) {
            ((MainActivity) activity).fetchNearbyShopsWithLocation();
        }
    }

    @JavascriptInterface
    public void searchShopsOnline(String query, double lat, double lng) {
        if (activity instanceof MainActivity) {
            ((MainActivity) activity).searchShopsOnline(query, lat, lng);
        }
    }

    @JavascriptInterface
    public void openGoogleMaps(String query, double lat, double lng) {
        activity.runOnUiThread(() -> {
            try {
                String encoded = Uri.encode(query != null ? query : "");
                Uri uri;
                if (lat != 0.0 || lng != 0.0) {
                    String qPart = encoded.isEmpty() ? (lat + "," + lng) : encoded;
                    uri = Uri.parse("geo:" + lat + "," + lng + "?q=" + qPart);
                } else if (!encoded.isEmpty()) {
                    uri = Uri.parse("geo:0,0?q=" + encoded);
                } else {
                    uri = Uri.parse("https://maps.google.com");
                }
                Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                intent.setPackage("com.google.android.apps.maps");
                if (intent.resolveActivity(activity.getPackageManager()) == null) {
                    intent.setPackage(null);
                }
                activity.startActivity(intent);
            } catch (Exception e) {
                try {
                    String webUrl = (lat != 0.0 || lng != 0.0)
                        ? "https://www.google.com/maps/search/?api=1&query=" + lat + "," + lng
                        : "https://www.google.com/maps/search/?api=1&query=" + Uri.encode(query != null ? query : "");
                    activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(webUrl)));
                } catch (Exception ignored) {}
            }
        });
    }

    @JavascriptInterface
    public String getRecentDetections() {
        JSONArray arr = PaymentDataStore.getRecentDetections(activity);
        return arr != null ? arr.toString() : "[]";
    }

    @JavascriptInterface
    public void clearRecentDetections() {
        PaymentDataStore.clearRecentDetections(activity);
    }

    @JavascriptInterface
    public void clearStalePaymentCache() {
        PaymentDataStore.purgeStaleState(activity);
    }

    @JavascriptInterface
    public void shareText(String text, String title) {
        if (text == null || text.trim().isEmpty()) return;
        activity.runOnUiThread(() -> {
            try {
                Intent share = new Intent(Intent.ACTION_SEND);
                share.setType("text/plain");
                share.putExtra(Intent.EXTRA_TEXT, text);
                activity.startActivity(Intent.createChooser(share, title != null ? title : "Share Balance"));
            } catch (Exception e) {
                Toast.makeText(activity, "Could not open share dialog", Toast.LENGTH_SHORT).show();
            }
        });
    }

    @JavascriptInterface
    public void openUpiPayApp(String upiId, String name, String amountStr) {
        if (upiId == null || upiId.trim().isEmpty()) {
            activity.runOnUiThread(() -> Toast.makeText(activity, "Add contact UPI ID first", Toast.LENGTH_SHORT).show());
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                Uri uri = Uri.parse("upi://pay")
                    .buildUpon()
                    .appendQueryParameter("pa", upiId.trim())
                    .appendQueryParameter("pn", name != null ? name.trim() : "Contact")
                    .appendQueryParameter("am", amountStr != null ? amountStr.trim() : "")
                    .appendQueryParameter("cu", "INR")
                    .build();
                Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                activity.startActivity(Intent.createChooser(intent, "Pay with UPI"));
            } catch (Exception e) {
                Toast.makeText(activity, "No UPI app available on device", Toast.LENGTH_SHORT).show();
            }
        });
    }

    // --- PAYMENT DETECTION MODE & TEST OVERLAY ---
    @JavascriptInterface
    public String getDetectionMode() {
        return PaymentDataStore.getDetectionMode(activity);
    }

    @JavascriptInterface
    public void setDetectionMode(String mode) {
        PaymentDataStore.setDetectionMode(activity, mode);
    }

    @JavascriptInterface
    public void testQuickAddOverlay() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(activity)) {
            activity.runOnUiThread(() ->
                Toast.makeText(activity, "Enable Draw Over Other Apps permission first", Toast.LENGTH_SHORT).show()
            );
            openOverlayPermissionSettings();
            return;
        }
        try {
            JSONObject sample = new JSONObject();
            sample.put("type", "expense");
            sample.put("amount", 120.0);
            sample.put("recipient", "Sample Tea Stall");
            sample.put("suggestedCategory", "SnacksChai");
            sample.put("rawText", "Test Quick-Add notification preview");
            sample.put("postTime", System.currentTimeMillis());
            PaymentOverlayManager.showPaymentToast(activity, sample);
        } catch (Exception ignored) {}
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
            Toast.makeText(activity, "Delay updated: " + (delayMs == 0 ? "Instant" : (delayMs / 1000) + "s"), Toast.LENGTH_SHORT).show()
        );
    }

    // --- SYSTEM THEME SYNC ---
    @JavascriptInterface
    public void setSystemBarTheme(boolean isDark) {
        if (activity instanceof MainActivity) {
            ((MainActivity) activity).updateSystemBarsTheme(isDark);
        }
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
            activity.runOnUiThread(() ->
                Toast.makeText(activity, "Enable Notification Access for WhoseTab in System Settings", Toast.LENGTH_LONG).show()
            );
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
    public boolean isPostNotificationsGranted() {
        return NotificationManagerCompat.from(activity).areNotificationsEnabled();
    }

    @JavascriptInterface
    public void requestPostNotificationsPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.runOnUiThread(() -> {
                if (androidx.core.content.ContextCompat.checkSelfPermission(activity, android.Manifest.permission.POST_NOTIFICATIONS)
                        != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    SharedPreferences prefs = activity.getSharedPreferences(PaytmNotificationListenerService.PREFS_NAME, Context.MODE_PRIVATE);
                    boolean alreadyAsked = prefs.getBoolean("asked_post_notifications", false);
                    boolean showRationale = androidx.core.app.ActivityCompat.shouldShowRequestPermissionRationale(activity, android.Manifest.permission.POST_NOTIFICATIONS);
                    if (alreadyAsked && !showRationale) {
                        try {
                            Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                                .putExtra(Settings.EXTRA_APP_PACKAGE, activity.getPackageName());
                            activity.startActivity(i);
                        } catch (Exception ignored) {}
                    } else {
                        prefs.edit().putBoolean("asked_post_notifications", true).apply();
                        androidx.core.app.ActivityCompat.requestPermissions(activity, new String[] { android.Manifest.permission.POST_NOTIFICATIONS }, 201);
                    }
                } else {
                    ScannerForegroundService.ensureRunning(activity);
                }
            });
        }
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

    @JavascriptInterface
    public boolean isIgnoringBatteryOptimizations() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) activity.getSystemService(Context.POWER_SERVICE);
            return pm != null && pm.isIgnoringBatteryOptimizations(activity.getPackageName());
        }
        return true;
    }

    @JavascriptInterface
    public void requestIgnoreBatteryOptimizations() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + activity.getPackageName()));
                activity.startActivity(intent);
            } catch (Exception e) {
                try {
                    Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                    activity.startActivity(fallback);
                } catch (Exception ignored) {}
            }
        }
    }

    // --- GITHUB RELEASE VERSION & AUTO-UPDATE SETTING ---
    @JavascriptInterface
    public String getAppVersion() {
        return UpdateManager.getCurrentVersion(activity);
    }

    @JavascriptInterface
    public boolean isAutoUpdateEnabled() {
        return PaymentDataStore.isAutoUpdateEnabled(activity);
    }

    @JavascriptInterface
    public void setAutoUpdateEnabled(boolean enabled) {
        PaymentDataStore.setAutoUpdateEnabled(activity, enabled);
    }

    // --- PENDING PAYMENT BRIDGE ---
    @JavascriptInterface
    public String getPendingPayment() {
        JSONObject obj = PaymentDataStore.getPendingPayment(activity);
        return obj != null ? obj.toString() : "";
    }

    @JavascriptInterface
    public void clearPendingPayment() {
        PaymentDataStore.clearPendingPayment(activity);
    }

    // --- PENDING REPAYMENT BRIDGE ---
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
                        "if(window.app && window.app.showUpdatePrompt){ window.app.showUpdatePrompt(%s, %s, %s); }",
                        JSONObject.quote(latestVersion),
                        JSONObject.quote(apkUrl),
                        JSONObject.quote(releaseNotes != null ? releaseNotes : "")
                    );
                    webView.evaluateJavascript(js, null);
                });
            }

            @Override
            public void onUpToDate(String currentVersion) {
                activity.runOnUiThread(() -> {
                    Toast.makeText(activity, "WhoseTab is up to date (v" + currentVersion + ")", Toast.LENGTH_SHORT).show();
                    webView.evaluateJavascript("if(window.app && window.app.onUpToDate){ window.app.onUpToDate(); }", null);
                });
            }

            @Override
            public void onError(String errorMessage) {
                activity.runOnUiThread(() -> {
                    Toast.makeText(activity, "Update check failed: " + errorMessage, Toast.LENGTH_SHORT).show();
                    webView.evaluateJavascript(
                        "if(window.app && window.app.onUpdateError){ window.app.onUpdateError(" + JSONObject.quote(errorMessage) + "); }",
                        null
                    );
                });
            }
        });
    }

    @JavascriptInterface
    public void downloadAndInstallUpdate(String apkUrl) {
        UpdateManager.downloadAndInstallApk(activity, apkUrl);
    }
}
