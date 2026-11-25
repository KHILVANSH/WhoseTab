package com.khilvansh.whosetab;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
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
            return pInfo.versionName != null ? pInfo.versionName : "1.1.0";
        } catch (Exception e) {
            return "1.1.0";
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
        if (!(context instanceof Activity)) {
            Toast.makeText(context, "Cannot update from background context", Toast.LENGTH_SHORT).show();
            return;
        }
        Activity activity = (Activity) context;

        // Verify unknown sources install permission on Android 8.0+ before downloading
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!activity.getPackageManager().canRequestPackageInstalls()) {
                Toast.makeText(activity, "Please allow WhoseTab to install updates", Toast.LENGTH_LONG).show();
                Intent permissionIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName()));
                permissionIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(permissionIntent);
                return;
            }
        }

        Toast.makeText(activity, "Downloading update...", Toast.LENGTH_SHORT).show();

        new Thread(() -> {
            InputStream input = null;
            OutputStream output = null;
            HttpURLConnection connection = null;

            try {
                URL url = new URL(apkUrl);
                connection = (HttpURLConnection) url.openConnection();
                connection.setInstanceFollowRedirects(true);
                connection.setRequestProperty("User-Agent", "WhoseTab-App");
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                connection.connect();

                int responseCode = connection.getResponseCode();
                // Follow redirects manually if needed (GitHub releases to AWS S3)
                if (responseCode == HttpURLConnection.HTTP_MOVED_TEMP || responseCode == HttpURLConnection.HTTP_MOVED_PERM || responseCode == 307 || responseCode == 308) {
                    String newUrl = connection.getHeaderField("Location");
                    connection.disconnect();
                    url = new URL(newUrl);
                    connection = (HttpURLConnection) url.openConnection();
                    connection.setRequestProperty("User-Agent", "WhoseTab-App");
                    connection.setConnectTimeout(15000);
                    connection.setReadTimeout(30000);
                    connection.connect();
                    responseCode = connection.getResponseCode();
                }

                if (responseCode != HttpURLConnection.HTTP_OK) {
                    throw new Exception("Server returned HTTP " + responseCode);
                }

                int fileLength = connection.getContentLength();
                File targetDir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (targetDir != null && !targetDir.exists()) {
                    targetDir.mkdirs();
                }
                File apkFile = new File(targetDir, "WhoseTab-latest.apk");
                if (apkFile.exists()) {
                    apkFile.delete();
                }

                input = connection.getInputStream();
                output = new FileOutputStream(apkFile);

                byte[] buffer = new byte[8192];
                long total = 0;
                int count;
                long lastProgressTime = 0;

                while ((count = input.read(buffer)) != -1) {
                    total += count;
                    output.write(buffer, 0, count);

                    long now = System.currentTimeMillis();
                    if (fileLength > 0 && (now - lastProgressTime > 120)) {
                        lastProgressTime = now;
                        final int percent = (int) (total * 100 / fileLength);
                        final double currentMb = total / (1024.0 * 1024.0);
                        final double totalMb = fileLength / (1024.0 * 1024.0);
                        activity.runOnUiThread(() -> {
                            if (activity instanceof MainActivity) {
                                String js = String.format(java.util.Locale.US,
                                    "if(window.app && window.app.onDownloadProgress){ window.app.onDownloadProgress(%d, '%.1f', '%.1f'); }",
                                    percent, currentMb, totalMb
                                );
                                ((MainActivity) activity).getWebView().evaluateJavascript(js, null);
                            }
                        });
                    }
                }

                output.flush();
                output.close();
                output = null;
                input.close();
                input = null;

                // Download 100% complete! Trigger system installation prompt immediately on the active foreground Activity!
                activity.runOnUiThread(() -> {
                    if (activity instanceof MainActivity) {
                        ((MainActivity) activity).getWebView().evaluateJavascript("if(window.app && window.app.onDownloadCompleted){ window.app.onDownloadCompleted(); }", null);
                    }
                    installDownloadedApk(activity);
                });

            } catch (Exception e) {
                final String err = e.getMessage() != null ? e.getMessage() : "Download error";
                activity.runOnUiThread(() -> {
                    Toast.makeText(activity, "Update download failed: " + err, Toast.LENGTH_LONG).show();
                    if (activity instanceof MainActivity) {
                        String js = String.format("if(window.app && window.app.onDownloadError){ window.app.onDownloadError('%s'); }", err.replace("'", "\\'"));
                        ((MainActivity) activity).getWebView().evaluateJavascript(js, null);
                    }
                });
            } finally {
                try {
                    if (output != null) output.close();
                    if (input != null) input.close();
                } catch (Exception ignored) {}
                if (connection != null) connection.disconnect();
            }
        }).start();
    }

    public static void installDownloadedApk(Context context) {
        File apkFile = new File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "WhoseTab-latest.apk");
        if (!apkFile.exists()) {
            Toast.makeText(context, "Update file not found", Toast.LENGTH_SHORT).show();
            return;
        }

        // On Android 8.0+, verify unknown sources permission for this app
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!context.getPackageManager().canRequestPackageInstalls()) {
                Toast.makeText(context, "Please allow WhoseTab to install updates", Toast.LENGTH_LONG).show();
                Intent permissionIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName()));
                permissionIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(permissionIntent);
                return;
            }
        }

        Uri apkUri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apkFile);
        Intent installIntent = new Intent(Intent.ACTION_VIEW);
        installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
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
