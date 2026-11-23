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

    @Override
    protected void onResume() {
        super.onResume();
        // Check if there is any pending payment awaiting consumption
        handleIntentData(getIntent());
    }

    private void handleIntentData(Intent intent) {
        if (webView == null) return;

        double amount = 0.0;
        String recipient = "";
        String note = "";
        String category = "General";
        String txnId = "";

        // 1. From PaytmNotificationListenerService extras
        if (intent != null && intent.hasExtra("paytm_amount")) {
            amount = intent.getDoubleExtra("paytm_amount", 0.0);
            recipient = intent.getStringExtra("paytm_recipient");
            note = intent.getStringExtra("paytm_note");
            category = intent.getStringExtra("paytm_category");
            txnId = intent.getStringExtra("paytm_txnId");
            // Clear processed intent extra to avoid duplicate handling
            intent.removeExtra("paytm_amount");
        }
        // 2. From Deep Link URI (whosetab://snap?amount=350&to=Sharma)
        else if (intent != null && Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null) {
            Uri data = intent.getData();
            String amtStr = data.getQueryParameter("amount");
            if (amtStr != null) {
                try { amount = Double.parseDouble(amtStr.replace(",", "")); } catch (Exception ignored) {}
            }
            recipient = data.getQueryParameter("to");
            note = data.getQueryParameter("note");
        }
        // 3. From System Share Intent (ACTION_SEND)
        else if (intent != null && Intent.ACTION_SEND.equals(intent.getAction()) && "text/plain".equals(intent.getType())) {
            String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (sharedText != null) {
                JSONObject parsed = PaytmNotificationListenerService.parseRawText(sharedText);
                if (parsed != null) {
                    amount = parsed.optDouble("amount", 0.0);
                    recipient = parsed.optString("recipient", "Merchant");
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
                paymentObj.put("recipient", recipient != null && !recipient.isEmpty() ? recipient : "Paytm Purchase");
                paymentObj.put("note", note != null ? note : "");
                paymentObj.put("suggestedCategory", category != null ? category : "Groceries");
                paymentObj.put("txnId", txnId != null ? txnId : "");
                paymentObj.put("timestamp", System.currentTimeMillis());

                PaymentDataStore.setPendingPayment(this, paymentObj);
                dispatchPaymentToWeb(paymentObj);
            } catch (Exception e) {
                android.util.Log.e("WhoseTab", "Error building payment json", e);
            }
        } else {
            // Check if store has a pending payment that hasn't been displayed yet
            JSONObject pending = PaymentDataStore.getPendingPayment(this);
            if (pending != null && pending.optDouble("amount", 0.0) > 0.0) {
                dispatchPaymentToWeb(pending);
            }
        }
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
