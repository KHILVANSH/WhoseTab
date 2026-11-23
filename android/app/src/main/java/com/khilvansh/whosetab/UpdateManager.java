package com.khilvansh.whosetab;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import java.io.File;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Scanner;
import org.json.JSONArray;
import org.json.JSONObject;

public class UpdateManager {

    public static final String GITHUB_REPO_API = "https://api.github.com/repos/KHILVANSH/WhoseTab/releases/latest";

    public interface UpdateCheckCallback {
        void onUpdateFound(String latestVersion, String apkUrl, String releaseNotes);
        void onUpToDate(String currentVersion);
        void onError(String errorMessage);
    }

    public static String getCurrentVersion(Context context) {
        try {
            PackageInfo pInfo = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return pInfo.versionName != null ? pInfo.versionName : "1.0.1";
        } catch (Exception e) {
            return "1.0.1";
        }
    }

    public static void checkSilentlyOnLaunch(Context context) {
        new Thread(() -> {
            try {
                checkForUpdates(context, new UpdateCheckCallback() {
                    @Override
                    public void onUpdateFound(String latestVersion, String apkUrl, String releaseNotes) {}
                    @Override
                    public void onUpToDate(String currentVersion) {}
                    @Override
                    public void onError(String errorMessage) {}
                });
            } catch (Exception ignored) {}
        }).start();
    }

    public static void checkForUpdates(Context context, UpdateCheckCallback callback) {
        new Thread(() -> {
            try {
                URL url = new URL(GITHUB_REPO_API);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setRequestProperty("Accept", "application/vnd.github.v3+json");
                conn.setRequestProperty("User-Agent", "WhoseTab-App");
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);

                int respCode = conn.getResponseCode();
                if (respCode != 200) {
                    callback.onError("GitHub returned HTTP " + respCode);
                    return;
                }

                Scanner scanner = new Scanner(conn.getInputStream());
                StringBuilder jsonText = new StringBuilder();
                while (scanner.hasNextLine()) {
                    jsonText.append(scanner.nextLine());
                }
                scanner.close();

                JSONObject release = new JSONObject(jsonText.toString());
                String tagName = release.optString("tag_name", "").replace("v", "").trim();
                String releaseNotes = release.optString("body", "Bug fixes and performance improvements.");
                JSONArray assets = release.optJSONArray("assets");

                String apkDownloadUrl = null;
                if (assets != null) {
                    for (int i = 0; i < assets.length(); i++) {
                        JSONObject asset = assets.getJSONObject(i);
                        String name = asset.optString("name", "");
                        if (name.endsWith(".apk")) {
                            apkDownloadUrl = asset.optString("browser_download_url");
                            break;
                        }
                    }
                }

                String currentVersion = getCurrentVersion(context);
                if (isNewerVersion(currentVersion, tagName) && apkDownloadUrl != null) {
                    callback.onUpdateFound(tagName, apkDownloadUrl, releaseNotes);
                } else {
                    callback.onUpToDate(currentVersion);
                }

            } catch (Exception e) {
                callback.onError(e.getMessage() != null ? e.getMessage() : "Failed to connect to GitHub");
            }
        }).start();
    }

    public static void downloadAndInstallApk(Context context, String apkUrl) {
        Toast.makeText(context, "Downloading WhoseTab update...", Toast.LENGTH_SHORT).show();

        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(apkUrl));
            request.setTitle("WhoseTab Update");
            request.setDescription("Downloading latest release APK");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, "WhoseTab-latest.apk");

            DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) return;
            long downloadId = manager.enqueue(request);

            context.registerReceiver(new BroadcastReceiver() {
                @Override
                public void onReceive(Context c, Intent intent) {
                    long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                    if (id == downloadId) {
                        try {
                            c.unregisterReceiver(this);
                        } catch (Exception ignored) {}
                        installDownloadedApk(c);
                    }
                }
            }, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), Context.RECEIVER_NOT_EXPORTED);

        } catch (Exception e) {
            Toast.makeText(context, "Download failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    public static void installDownloadedApk(Context context) {
        File apkFile = new File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "WhoseTab-latest.apk");
        if (!apkFile.exists()) return;

        Uri apkUri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apkFile);
        Intent installIntent = new Intent(Intent.ACTION_VIEW);
        installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(installIntent);
    }

    private static boolean isNewerVersion(String current, String latest) {
        if (latest.isEmpty()) return false;
        String[] cParts = current.split("\\.");
        String[] lParts = latest.split("\\.");
        int len = Math.max(cParts.length, lParts.length);

        for (int i = 0; i < len; i++) {
            int c = i < cParts.length ? Integer.parseInt(cParts[i].replaceAll("\\D+", "0")) : 0;
            int l = i < lParts.length ? Integer.parseInt(lParts[i].replaceAll("\\D+", "0")) : 0;
            if (l > c) return true;
            if (l < c) return false;
        }
        return false;
    }
}
