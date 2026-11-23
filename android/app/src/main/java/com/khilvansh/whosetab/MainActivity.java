package com.khilvansh.whosetab;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import org.json.JSONObject;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private WebAppInterface webAppInterface;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Immersive Dark Theme Navigation & Status Bar
        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(Color.parseColor("#0B0F19"));
        window.setNavigationBarColor(Color.parseColor("#0B0F19"));

        // Keep Screen Awake by default when working on mobile
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        webView = new WebView(this);
        webView.setKeepScreenOn(true);
        setContentView(webView);

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
                handleIntentData(getIntent());
            }
        });

        // Load offline application from assets
        webView.loadUrl("file:///android_asset/web/index.html");

        // Check for updates in background if enabled
        UpdateManager.checkSilentlyOnLaunch(this);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntentData(intent);
    }

    private void handleIntentData(Intent intent) {
        if (intent == null || webView == null) return;

        double amount = 0.0;
        String recipient = "";
        String note = "";
        String category = "General";

        // 1. From PaytmNotificationListenerService extras
        if (intent.hasExtra("paytm_amount")) {
            amount = intent.getDoubleExtra("paytm_amount", 0.0);
            recipient = intent.getStringExtra("paytm_recipient");
            note = intent.getStringExtra("paytm_note");
            category = intent.getStringExtra("paytm_category");
        }
        // 2. From Deep Link URI (whosetab://snap?amount=350&to=Sharma)
        else if (Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null) {
            Uri data = intent.getData();
            String amtStr = data.getQueryParameter("amount");
            if (amtStr != null) {
                try { amount = Double.parseDouble(amtStr.replace(",", "")); } catch (Exception ignored) {}
            }
            recipient = data.getQueryParameter("to");
            note = data.getQueryParameter("note");
        }
        // 3. From System Share Intent (ACTION_SEND)
        else if (Intent.ACTION_SEND.equals(intent.getAction()) && "text/plain".equals(intent.getType())) {
            String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (sharedText != null) {
                JSONObject parsed = PaytmNotificationListenerService.parseRawText(sharedText);
                if (parsed != null) {
                    amount = parsed.optDouble("amount", 0.0);
                    recipient = parsed.optString("recipient", "Merchant");
                    note = parsed.optString("rawText", "");
                }
            }
        }

        if (amount > 0) {
            final double finalAmount = amount;
            final String finalRecipient = recipient != null ? recipient : "Paytm Purchase";
            final String finalNote = note != null ? note : "";
            final String finalCategory = category != null ? category : "Groceries";

            webView.post(() -> {
                String js = String.format(
                    "javascript:if(window.app && window.app.openSnapModalWithPaytm){ window.app.openSnapModalWithPaytm({ amount: %f, recipient: '%s', note: '%s', suggestedCategory: '%s' }); }",
                    finalAmount,
                    finalRecipient.replace("'", "\\'"),
                    finalNote.replace("'", "\\'"),
                    finalCategory
                );
                webView.evaluateJavascript(js, null);
            });
        }
    }

    public void setKeepScreenOnEnabled(boolean enabled) {
        runOnUiThread(() -> {
            if (enabled) {
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                if (webView != null) webView.setKeepScreenOn(true);
            } else {
                getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                if (webView != null) webView.setKeepScreenOn(false);
            }
        });
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
