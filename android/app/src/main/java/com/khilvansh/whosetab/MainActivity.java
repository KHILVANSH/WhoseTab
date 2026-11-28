package com.khilvansh.whosetab;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.location.Address;
import android.location.Geocoder;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.ContactsContract;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends AppCompatActivity {

    public static volatile boolean isActivityForeground = false;
    private static volatile MainActivity activeInstance = null;

    private WebView webView;
    private WebAppInterface webAppInterface;
    private volatile boolean isWebPageLoaded = false;
    private float cutoutLeftDp = 0f;
    private float cutoutRightDp = 0f;
    private String pendingContactPickTag = "";

    private final ActivityResultLauncher<Intent> contactPickerLauncher =
        registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            if (result.getResultCode() != RESULT_OK || result.getData() == null || result.getData().getData() == null) {
                return;
            }
            Uri contactUri = result.getData().getData();
            String pickedName = "";
            String pickedPhone = "";
            String[] projection = new String[] {
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                ContactsContract.CommonDataKinds.Phone.NUMBER
            };
            try (Cursor cursor = getContentResolver().query(contactUri, projection, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int nameIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME);
                    int numIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
                    if (nameIdx >= 0) pickedName = cursor.getString(nameIdx);
                    if (numIdx >= 0) pickedPhone = cursor.getString(numIdx);
                }
            } catch (Exception ignored) {}

            String cleanName = pickedName != null ? pickedName.trim() : "";
            String rawPhone = pickedPhone != null ? pickedPhone.trim() : "";
            String digits = rawPhone.replaceAll("[^0-9]", "");
            if (digits.length() > 10 && digits.startsWith("91")) {
                digits = digits.substring(digits.length() - 10);
            }
            String normalizedPhone = digits.length() >= 10 ? digits : rawPhone;
            String tag = pendingContactPickTag != null ? pendingContactPickTag : "";
            pendingContactPickTag = "";

            if (webView != null && (!cleanName.isEmpty() || !normalizedPhone.isEmpty())) {
                String js = String.format(
                    "if(window.app && typeof window.app.onNativeContactPicked === 'function'){ window.app.onNativeContactPicked(%s, %s, %s); }",
                    JSONObject.quote(cleanName),
                    JSONObject.quote(normalizedPhone),
                    JSONObject.quote(tag)
                );
                webView.post(() -> webView.evaluateJavascript(js, null));
            }
        });

    public void launchPhoneContactPicker(String requestTag) {
        runOnUiThread(() -> {
            pendingContactPickTag = requestTag != null ? requestTag : "";
            try {
                Intent intent = new Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI);
                contactPickerLauncher.launch(intent);
            } catch (Exception e) {
                android.util.Log.e("WhoseTab", "Unable to launch phone contact picker: " + e.getMessage());
            }
        });
    }

    public static void notifyQuickExpensesUpdated() {
        MainActivity inst = activeInstance;
        if (inst != null) {
            inst.runOnUiThread(inst::drainNativeQuickExpenses);
        }
    }

    public static void dispatchUpdateAvailableToWeb(String version, String apkUrl, String notes) {
        MainActivity inst = activeInstance;
        if (inst != null && inst.webView != null) {
            inst.runOnUiThread(() -> {
                String js = String.format(
                    "(function() { " +
                    "  var u = { version: %s, apkUrl: %s, notes: %s }; " +
                    "  if (window.app && typeof window.app.showInAppUpdateToast === 'function') { " +
                    "    window.app.showInAppUpdateToast(u.version, u.apkUrl, u.notes); " +
                    "  } else { " +
                    "    window._pendingUpdateToast = u; " +
                    "  } " +
                    "})();",
                    JSONObject.quote(version != null ? version : ""),
                    JSONObject.quote(apkUrl != null ? apkUrl : ""),
                    JSONObject.quote(notes != null ? notes : "")
                );
                inst.webView.evaluateJavascript(js, null);
            });
        }
    }

    public static void dispatchFromServiceIfVisible(JSONObject payload, boolean isRepayment) {
        MainActivity inst = activeInstance;
        if (inst != null && isActivityForeground) {
            inst.runOnUiThread(() -> {
                if (isRepayment) {
                    PaymentDataStore.consumePendingRepayment(inst);
                    inst.dispatchRepaymentToWeb(payload);
                } else {
                    PaymentDataStore.consumePendingPayment(inst);
                    inst.dispatchPaymentToWeb(payload);
                }
            });
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        updateSystemBarsTheme(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }

        // Request POST_NOTIFICATIONS runtime permission on Android 13+ so background status bar icon is always visible
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                getSharedPreferences(PaytmNotificationListenerService.PREFS_NAME, MODE_PRIVATE)
                    .edit().putBoolean("asked_post_notifications", true).apply();
                ActivityCompat.requestPermissions(this, new String[] { Manifest.permission.POST_NOTIFICATIONS }, 201);
            }
        }

        // Start persistent foreground service immediately
        ScannerForegroundService.ensureRunning(this);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#09090B"));
        setContentView(webView);

        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, windowInsets) -> {
            Insets cut = windowInsets.getInsets(WindowInsetsCompat.Type.displayCutout());
            float density = getResources().getDisplayMetrics().density;
            if (density <= 0f) density = 1f;
            cutoutLeftDp = cut.left / density;
            cutoutRightDp = cut.right / density;
            applyCutoutCssVars();
            return windowInsets;
        });

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setSupportZoom(false);

        webAppInterface = new WebAppInterface(this, webView);
        webView.addJavascriptInterface(webAppInterface, "AndroidBridge");

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                return super.onConsoleMessage(consoleMessage);
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                isWebPageLoaded = true;
                applyCutoutCssVars();
                drainNativeQuickExpenses();
                handleIntentData(getIntent());
            }
        });

        webView.loadUrl("file:///android_asset/web/index.html");
        UpdateManager.checkSilentlyOnLaunch(this);
    }

    private void applyCutoutCssVars() {
        if (webView == null || !isWebPageLoaded) return;
        String js = String.format(
            Locale.US,
            "document.documentElement.style.setProperty('--cutout-left','%.1fpx');" +
            "document.documentElement.style.setProperty('--cutout-right','%.1fpx');",
            cutoutLeftDp,
            cutoutRightDp
        );
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    public void updateSystemBarsTheme(boolean isDark) {
        runOnUiThread(() -> {
            Window window = getWindow();
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            int bgColor = isDark ? Color.parseColor("#09090B") : Color.parseColor("#F8FAFC");
            window.setStatusBarColor(bgColor);
            window.setNavigationBarColor(bgColor);
            if (webView != null) {
                webView.setBackgroundColor(bgColor);
            }
            WindowInsetsControllerCompat controller = new WindowInsetsControllerCompat(window, window.getDecorView());
            controller.setAppearanceLightStatusBars(!isDark);
            controller.setAppearanceLightNavigationBars(!isDark);
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        drainNativeQuickExpenses();
        handleIntentData(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        isActivityForeground = true;
        activeInstance = this;
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
        }
        if (!ScannerForegroundService.isRunning()) {
            ScannerForegroundService.ensureRunning(this);
        }

        if (webView != null) {
            webView.post(() -> {
                drainNativeQuickExpenses();
                webView.evaluateJavascript(
                    "if(window.app){ " +
                    "  if(window.app.checkScannerStatus) window.app.checkScannerStatus(); " +
                    "  if(window.app.checkInitialSetup) window.app.checkInitialSetup(); " +
                    "  if(window.app.checkPendingPayment) window.app.checkPendingPayment(); " +
                    "}",
                    null
                );
            });
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == 201) {
            ScannerForegroundService.ensureRunning(this);
            if (webView != null) {
                webView.post(() -> webView.evaluateJavascript(
                    "if(window.app){ window.app.checkScannerStatus(); window.app.checkInitialSetup(); }", null
                ));
            }
        } else if (requestCode == 202) {
            boolean granted = false;
            if (grantResults != null) {
                for (int r : grantResults) {
                    if (r == PackageManager.PERMISSION_GRANTED) {
                        granted = true;
                        break;
                    }
                }
            }
            if (granted) {
                fetchNearbyShopsWithLocation();
            } else if (webView != null) {
                webView.post(() -> webView.evaluateJavascript(
                    "if(window.app && window.app.onNearbyShopsError){ window.app.onNearbyShopsError('Location permission denied. Search manually or open Google Maps.'); }",
                    null
                ));
            }
        }
    }

    // ================= GOOGLE MAPS / NEARBY SHOPS LOCATION HELPER =================
    @SuppressLint("MissingPermission")
    public void fetchNearbyShopsWithLocation() {
        boolean hasFine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean hasCoarse = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        if (!hasFine && !hasCoarse) {
            runOnUiThread(() -> ActivityCompat.requestPermissions(
                this,
                new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION },
                202
            ));
            return;
        }

        LocationManager lm = (LocationManager) getSystemService(LOCATION_SERVICE);
        if (lm == null) {
            dispatchNearbyError("Location service unavailable on device.");
            return;
        }

        Location best = null;
        try {
            for (String provider : lm.getProviders(true)) {
                Location l = lm.getLastKnownLocation(provider);
                if (l != null && (best == null || l.getTime() > best.getTime())) {
                    best = l;
                }
            }
        } catch (Exception ignored) {}

        long ageMs = best != null ? (System.currentTimeMillis() - best.getTime()) : Long.MAX_VALUE;
        if (best != null && ageMs < 10 * 60 * 1000L) {
            queryOverpassAndGeocoder(best.getLatitude(), best.getLongitude());
            return;
        }

        final Location fallbackLoc = best;
        final Handler timeoutHandler = new Handler(Looper.getMainLooper());
        final boolean[] resolved = new boolean[] { false };
        final LocationListener oneShot = new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                if (resolved[0]) return;
                resolved[0] = true;
                timeoutHandler.removeCallbacksAndMessages(null);
                try { lm.removeUpdates(this); } catch (Exception ignored) {}
                queryOverpassAndGeocoder(location.getLatitude(), location.getLongitude());
            }
        };

        try {
            String chosen = lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
                ? LocationManager.NETWORK_PROVIDER
                : (lm.isProviderEnabled(LocationManager.GPS_PROVIDER) ? LocationManager.GPS_PROVIDER : null);
            if (chosen != null) {
                lm.requestLocationUpdates(chosen, 0L, 0f, oneShot, Looper.getMainLooper());
                timeoutHandler.postDelayed(() -> {
                    if (resolved[0]) return;
                    resolved[0] = true;
                    try { lm.removeUpdates(oneShot); } catch (Exception ignored) {}
                    if (fallbackLoc != null) {
                        queryOverpassAndGeocoder(fallbackLoc.getLatitude(), fallbackLoc.getLongitude());
                    } else {
                        dispatchNearbyError("Turn on GPS/Location or type a shop name to search.");
                    }
                }, 4000L);
            } else if (fallbackLoc != null) {
                queryOverpassAndGeocoder(fallbackLoc.getLatitude(), fallbackLoc.getLongitude());
            } else {
                dispatchNearbyError("Location services are turned off.");
            }
        } catch (Exception e) {
            if (fallbackLoc != null) {
                queryOverpassAndGeocoder(fallbackLoc.getLatitude(), fallbackLoc.getLongitude());
            } else {
                dispatchNearbyError("Unable to read location.");
            }
        }
    }

    private void queryOverpassAndGeocoder(double lat, double lng) {
        new Thread(() -> {
            JSONArray out = new JSONArray();
            String areaFallback = "";
            try {
                Geocoder geocoder = new Geocoder(this, Locale.getDefault());
                List<Address> addrs = geocoder.getFromLocation(lat, lng, 2);
                if (addrs != null && !addrs.isEmpty()) {
                    Address a = addrs.get(0);
                    String sub = a.getSubLocality() != null ? a.getSubLocality() : a.getThoroughfare();
                    String city = a.getLocality();
                    areaFallback = ((sub != null ? sub : "") + (city != null ? ", " + city : "")).replaceAll("^,\\s*", "");
                }
            } catch (Exception ignored) {}

            try {
                String ql = String.format(
                    Locale.US,
                    "[out:json][timeout:6];(node(around:450,%.6f,%.6f)[name][~\"^(shop|amenity)$\"~\"^(supermarket|convenience|bakery|department_store|mall|general|stationery|chemist|cafe|restaurant|fast_food|pharmacy|ice_cream|canteen)$\"];way(around:450,%.6f,%.6f)[name][~\"^(shop|amenity)$\"~\".\"];);out center 12;",
                    lat, lng, lat, lng
                );
                URL url = new URL("https://overpass-api.de/api/interpreter");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setDoOutput(true);
                conn.setConnectTimeout(6000);
                conn.setReadTimeout(6000);
                conn.setRequestProperty("User-Agent", "WhoseTab-App");
                conn.getOutputStream().write(("data=" + URLEncoder.encode(ql, "UTF-8")).getBytes("UTF-8"));

                if (conn.getResponseCode() == 200) {
                    BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = br.readLine()) != null) sb.append(line);
                    br.close();
                    JSONObject resp = new JSONObject(sb.toString());
                    JSONArray els = resp.optJSONArray("elements");
                    if (els != null) {
                        for (int i = 0; i < els.length(); i++) {
                            JSONObject el = els.optJSONObject(i);
                            if (el == null) continue;
                            JSONObject tags = el.optJSONObject("tags");
                            if (tags == null) continue;
                            String name = tags.optString("name", "").trim();
                            if (name.isEmpty()) continue;
                            double pLat = el.has("lat") ? el.optDouble("lat", lat) : (el.has("center") ? el.optJSONObject("center").optDouble("lat", lat) : lat);
                            double pLng = el.has("lon") ? el.optDouble("lon", lng) : (el.has("center") ? el.optJSONObject("center").optDouble("lon", lng) : lng);
                            String street = tags.optString("addr:street", "");
                            String addr = !street.isEmpty() ? street : (!areaFallback.isEmpty() ? areaFallback : tags.optString("shop", tags.optString("amenity", "Shop")));
                            JSONObject shop = new JSONObject();
                            shop.put("name", name);
                            shop.put("address", addr);
                            shop.put("lat", pLat);
                            shop.put("lng", pLng);
                            shop.put("mapsUrl", buildGoogleMapsUrl(name, pLat, pLng));
                            out.put(shop);
                        }
                    }
                }
            } catch (Exception ignored) {}

            // Always offer current geocoded area pin if named places list was sparse
            if (out.length() == 0 && !areaFallback.isEmpty()) {
                try {
                    JSONObject pin = new JSONObject();
                    pin.put("name", areaFallback);
                    pin.put("address", "Current GPS area");
                    pin.put("lat", lat);
                    pin.put("lng", lng);
                    pin.put("mapsUrl", buildGoogleMapsUrl(areaFallback, lat, lng));
                    out.put(pin);
                } catch (Exception ignored) {}
            }

            final JSONArray finalOut = out;
            if (webView != null) {
                webView.post(() -> webView.evaluateJavascript(
                    String.format(Locale.US, "if(window.app && window.app.onNearbyShopsLoaded){ window.app.onNearbyShopsLoaded(%.6f, %.6f, %s); }", lat, lng, finalOut.toString()),
                    null
                ));
            }
        }).start();
    }

    public void searchShopsOnline(String query, double lat, double lng) {
        if (query == null || query.trim().isEmpty()) return;
        new Thread(() -> {
            JSONArray out = new JSONArray();
            try {
                StringBuilder urlStr = new StringBuilder("https://photon.komoot.io/api/?q=")
                    .append(URLEncoder.encode(query.trim(), "UTF-8"))
                    .append("&limit=8");
                if (lat != 0.0 || lng != 0.0) {
                    urlStr.append(String.format(Locale.US, "&lat=%.5f&lon=%.5f", lat, lng));
                }
                URL url = new URL(urlStr.toString());
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestProperty("User-Agent", "WhoseTab-App");
                conn.setConnectTimeout(6000);
                conn.setReadTimeout(6000);
                if (conn.getResponseCode() == 200) {
                    BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = br.readLine()) != null) sb.append(line);
                    br.close();
                    JSONObject root = new JSONObject(sb.toString());
                    JSONArray features = root.optJSONArray("features");
                    if (features != null) {
                        for (int i = 0; i < features.length(); i++) {
                            JSONObject feat = features.optJSONObject(i);
                            if (feat == null) continue;
                            JSONObject props = feat.optJSONObject("properties");
                            JSONObject geom = feat.optJSONObject("geometry");
                            if (props == null || geom == null) continue;
                            JSONArray coords = geom.optJSONArray("coordinates");
                            if (coords == null || coords.length() < 2) continue;
                            double pLng = coords.optDouble(0, 0.0);
                            double pLat = coords.optDouble(1, 0.0);
                            String name = props.optString("name", props.optString("street", "")).trim();
                            if (name.isEmpty()) continue;
                            StringBuilder addrSb = new StringBuilder();
                            String street = props.optString("street", "");
                            String district = props.optString("district", "");
                            String city = props.optString("city", "");
                            if (!street.isEmpty() && !street.equals(name)) addrSb.append(street);
                            if (!district.isEmpty()) {
                                if (addrSb.length() > 0) addrSb.append(", ");
                                addrSb.append(district);
                            }
                            if (!city.isEmpty()) {
                                if (addrSb.length() > 0) addrSb.append(", ");
                                addrSb.append(city);
                            }
                            JSONObject shop = new JSONObject();
                            shop.put("name", name);
                            shop.put("address", addrSb.toString());
                            shop.put("lat", pLat);
                            shop.put("lng", pLng);
                            shop.put("mapsUrl", buildGoogleMapsUrl(name, pLat, pLng));
                            out.put(shop);
                        }
                    }
                }
            } catch (Exception ignored) {}

            if (webView != null) {
                webView.post(() -> webView.evaluateJavascript(
                    "if(window.app && window.app.onShopSearchResults){ window.app.onShopSearchResults(" + out.toString() + "); }",
                    null
                ));
            }
        }).start();
    }

    private static String buildGoogleMapsUrl(String name, double lat, double lng) {
        if (lat != 0.0 || lng != 0.0) {
            return String.format(Locale.US, "https://www.google.com/maps/search/?api=1&query=%.6f,%.6f", lat, lng);
        }
        try {
            return "https://www.google.com/maps/search/?api=1&query=" + URLEncoder.encode(name, "UTF-8");
        } catch (Exception e) {
            return "https://maps.google.com";
        }
    }

    private void dispatchNearbyError(String msg) {
        if (webView != null) {
            webView.post(() -> webView.evaluateJavascript(
                "if(window.app && window.app.onNearbyShopsError){ window.app.onNearbyShopsError(" + JSONObject.quote(msg) + "); }",
                null
            ));
        }
    }

    @Override
    protected void onPause() {
        isActivityForeground = false;
        if (webView != null) {
            webView.onPause();
            webView.pauseTimers();
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (activeInstance == this) {
            activeInstance = null;
        }
        super.onDestroy();
    }

    private void drainNativeQuickExpenses() {
        if (webView == null || !isWebPageLoaded) return;
        webView.post(() -> webView.evaluateJavascript(
            "if(window.app && typeof window.app.drainQueuedNativeExpenses === 'function'){ window.app.drainQueuedNativeExpenses(); }",
            null
        ));
    }

    private void handleIntentData(Intent intent) {
        if (webView == null) return;

        // Notification action: Open Quick Expense
        if (intent != null && intent.getBooleanExtra("open_quick_expense", false)) {
            intent.removeExtra("open_quick_expense");
            webView.post(() -> webView.evaluateJavascript(
                "if(window.app && typeof window.app.openSnapModal === 'function'){ window.app.openSnapModal(); }",
                null
            ));
            return;
        }

        // 0. Repayment extras
        if (intent != null && intent.hasExtra("paytm_type") && "repayment".equals(intent.getStringExtra("paytm_type"))) {
            double rAmount = intent.getDoubleExtra("paytm_amount", 0.0);
            String rSender = intent.getStringExtra("paytm_sender");
            String rHandle = intent.getStringExtra("paytm_handle");
            String rNote = intent.getStringExtra("paytm_note");
            long rPostTime = intent.getLongExtra("paytm_postTime", 0L);
            intent.removeExtra("paytm_type");
            intent.removeExtra("paytm_amount");
            intent.removeExtra("paytm_sender");
            intent.removeExtra("paytm_handle");
            intent.removeExtra("paytm_note");
            intent.removeExtra("paytm_postTime");

            if (rAmount > 0) {
                try {
                    JSONObject rObj = new JSONObject();
                    rObj.put("type", "repayment");
                    rObj.put("amount", rAmount);
                    rObj.put("sender", rSender != null ? rSender : "Someone");
                    rObj.put("counterpartyHandle", rHandle != null ? rHandle : "");
                    rObj.put("note", rNote != null ? rNote : "");
                    rObj.put("postTime", rPostTime);
                    rObj.put("timestamp", System.currentTimeMillis());

                    String sig = PaymentDataStore.getRepaymentSignature(rObj);
                    if (PaymentDataStore.isRepaymentDismissed(this, sig)) {
                        return;
                    }

                    PaymentDataStore.consumePendingRepayment(this);
                    dispatchRepaymentToWeb(rObj);
                    return;
                } catch (Exception e) {
                    android.util.Log.e("WhoseTab", "Error building repayment json", e);
                }
            }
        }

        double amount = 0.0;
        String recipient = "";
        String handle = "";
        String note = "";
        String category = "General";
        String txnId = "";
        long postTime = 0L;

        // 0. Open Update Changelog Prompt from notification tap
        if (intent != null && intent.getBooleanExtra("open_update_modal", false)) {
            String uVer = intent.getStringExtra("update_version");
            String uUrl = intent.getStringExtra("update_apk_url");
            String uNotes = intent.getStringExtra("update_notes");
            intent.removeExtra("open_update_modal");
            if (uVer != null && !uVer.isEmpty() && webView != null) {
                final String fVer = uVer;
                final String fUrl = uUrl != null ? uUrl : "";
                final String fNotes = uNotes != null ? uNotes : "";
                webView.post(() -> webView.evaluateJavascript(
                    String.format(
                        "(function(){ var u={v:%s,u:%s,n:%s}; if(window.app&&window.app.showUpdatePrompt){ window.app.showUpdatePrompt(u.v,u.u,u.n); } else { window._pendingUpdateModal=u; } })();",
                        JSONObject.quote(fVer), JSONObject.quote(fUrl), JSONObject.quote(fNotes)
                    ),
                    null
                ));
                return;
            }
        }

        // 1. Outgoing Payment extras
        if (intent != null && intent.hasExtra("paytm_amount")) {
            amount = intent.getDoubleExtra("paytm_amount", 0.0);
            recipient = intent.getStringExtra("paytm_recipient");
            handle = intent.getStringExtra("paytm_handle");
            note = intent.getStringExtra("paytm_note");
            category = intent.getStringExtra("paytm_category");
            txnId = intent.getStringExtra("paytm_txnId");
            postTime = intent.getLongExtra("paytm_postTime", 0L);

            intent.removeExtra("paytm_amount");
            intent.removeExtra("paytm_recipient");
            intent.removeExtra("paytm_handle");
            intent.removeExtra("paytm_note");
            intent.removeExtra("paytm_category");
            intent.removeExtra("paytm_txnId");
            intent.removeExtra("paytm_postTime");
        }
        // 2. Deep Link URI
        else if (intent != null && Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null) {
            Uri data = intent.getData();
            String amtStr = data.getQueryParameter("amount");
            if (amtStr != null) {
                try { amount = Double.parseDouble(amtStr.replace(",", "")); } catch (Exception ignored) {}
            }
            recipient = data.getQueryParameter("to");
            note = data.getQueryParameter("note");
            intent.setData(null);
            intent.setAction(null);
        }
        // 3. System Share Intent (Google Maps Place OR Payment Text)
        else if (intent != null && Intent.ACTION_SEND.equals(intent.getAction()) && "text/plain".equals(intent.getType())) {
            String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
            intent.removeExtra(Intent.EXTRA_TEXT);
            intent.setAction(null);
            if (sharedText != null) {
                String lowerShared = sharedText.toLowerCase(Locale.US);
                if (lowerShared.contains("maps.app.goo.gl") || lowerShared.contains("maps.google.")
                        || lowerShared.contains("goo.gl/maps") || lowerShared.contains("google.com/maps")) {
                    String[] lines = sharedText.split("\\r?\\n");
                    String placeName = "";
                    String placeAddr = "";
                    String mapsUrl = "";
                    for (String ln : lines) {
                        String trimmed = ln.trim();
                        if (trimmed.isEmpty()) continue;
                        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
                            mapsUrl = trimmed;
                        } else if (placeName.isEmpty() && !trimmed.toLowerCase(Locale.US).startsWith("shared pin")) {
                            placeName = trimmed;
                        } else if (placeAddr.isEmpty() && !trimmed.equals(placeName)) {
                            placeAddr = trimmed;
                        }
                    }
                    if (!placeName.isEmpty() || !mapsUrl.isEmpty()) {
                        try {
                            JSONObject locObj = new JSONObject();
                            locObj.put("name", !placeName.isEmpty() ? placeName : "Shop Location");
                            locObj.put("address", placeAddr);
                            locObj.put("mapsUrl", !mapsUrl.isEmpty() ? mapsUrl : buildGoogleMapsUrl(placeName, 0.0, 0.0));
                            final String locJson = locObj.toString();
                            webView.post(() -> webView.evaluateJavascript(
                                "if(window.app && window.app.openSnapModalWithLocation){ window.app.openSnapModalWithLocation(" + locJson + "); }",
                                null
                            ));
                        } catch (Exception ignored) {}
                        return;
                    }
                }
                JSONObject parsed = PaytmNotificationListenerService.parseRawText("", sharedText, sharedText);
                if (parsed != null) {
                    amount = parsed.optDouble("amount", 0.0);
                    recipient = parsed.optString("recipient", "Merchant");
                    handle = parsed.optString("counterpartyHandle", "");
                    note = parsed.optString("rawText", "");
                    category = parsed.optString("suggestedCategory", "General");
                    txnId = parsed.optString("txnId", "");
                }
            }
        }

        if (amount > 0) {
            try {
                JSONObject paymentObj = new JSONObject();
                paymentObj.put("amount", amount);
                paymentObj.put("recipient", recipient != null && !recipient.isEmpty() ? recipient : "Merchant");
                paymentObj.put("counterpartyHandle", handle != null ? handle : "");
                paymentObj.put("note", note != null ? note : "");
                paymentObj.put("suggestedCategory", category != null ? category : "General");
                paymentObj.put("txnId", txnId != null ? txnId : "");
                paymentObj.put("postTime", postTime);
                paymentObj.put("timestamp", System.currentTimeMillis());

                String sig = PaymentDataStore.getSignature(paymentObj);
                if (PaymentDataStore.isPaymentDismissed(this, sig)) {
                    return;
                }

                PaymentDataStore.consumePendingPayment(this);
                dispatchPaymentToWeb(paymentObj);
            } catch (Exception e) {
                android.util.Log.e("WhoseTab", "Error building payment json", e);
            }
        } else {
            JSONObject pendingRepay = PaymentDataStore.consumePendingRepayment(this);
            if (pendingRepay != null && pendingRepay.optDouble("amount", 0.0) > 0.0) {
                String sig = PaymentDataStore.getRepaymentSignature(pendingRepay);
                if (!PaymentDataStore.isRepaymentDismissed(this, sig)) {
                    dispatchRepaymentToWeb(pendingRepay);
                    return;
                }
            }

            JSONObject pending = PaymentDataStore.consumePendingPayment(this);
            if (pending != null && pending.optDouble("amount", 0.0) > 0.0) {
                String sig = PaymentDataStore.getSignature(pending);
                if (!PaymentDataStore.isPaymentDismissed(this, sig)) {
                    dispatchPaymentToWeb(pending);
                }
            }
        }
    }

    private void dispatchRepaymentToWeb(JSONObject repayment) {
        if (repayment == null || webView == null) return;
        final String jsonStr = repayment.toString();

        webView.post(() -> {
            String js = String.format(
                "(function() { " +
                "  var data = %s; " +
                "  if (window.app && typeof window.app.handleRepaymentDetected === 'function') { " +
                "    window.app.handleRepaymentDetected(data); " +
                "  } else { " +
                "    window._pendingRepayment = data; " +
                "    window.addEventListener('DOMContentLoaded', function() { " +
                "      if (window.app && typeof window.app.handleRepaymentDetected === 'function') { " +
                "        window.app.handleRepaymentDetected(data); " +
                "      } " +
                "    }); " +
                "  } " +
                "})();",
                jsonStr
            );
            webView.evaluateJavascript(js, null);
        });
    }

    private void dispatchPaymentToWeb(JSONObject payment) {
        if (payment == null || webView == null) return;
        final String jsonStr = payment.toString();

        webView.post(() -> {
            String js = String.format(
                "(function() { " +
                "  var data = %s; " +
                "  if (window.app && typeof window.app.handleIncomingPayment === 'function') { " +
                "    window.app.handleIncomingPayment(data); " +
                "  } else { " +
                "    window._pendingPayment = data; " +
                "    window.addEventListener('DOMContentLoaded', function() { " +
                "      if (window.app && typeof window.app.handleIncomingPayment === 'function') { " +
                "        window.app.handleIncomingPayment(data); " +
                "      } " +
                "    }); " +
                "  } " +
                "})();",
                jsonStr
            );
            webView.evaluateJavascript(js, null);
        });
    }

    public WebView getWebView() {
        return webView;
    }

    @Override
    public void onBackPressed() {
        if (webView != null) {
            webView.evaluateJavascript(
                "(function() { " +
                "  if (window.app && typeof window.app.handleBackPress === 'function') { " +
                "    return window.app.handleBackPress(); " +
                "  } " +
                "  return false; " +
                "})();",
                result -> {
                    if (!"true".equalsIgnoreCase(result)) {
                        if (webView.canGoBack()) {
                            webView.goBack();
                        } else {
                            super.onBackPressed();
                        }
                    }
                }
            );
        } else {
            super.onBackPressed();
        }
    }
}
