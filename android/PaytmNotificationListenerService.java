package com.khilvansh.whosetab;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Intercepts notifications from Paytm (net.one97.paytm) and extracts
 * the paid amount and merchant name, launching WhoseTab.
 */
public class PaytmNotificationListenerService extends NotificationListenerService {

    private static final String PAYTM_PACKAGE = "net.one97.paytm";
    private static final Pattern AMOUNT_PATTERN = Pattern.compile(
        "(?i)(?:paid|sent|transfer of|rs\\.?|inr|₹)\\s*(?:rs\\.?|inr|₹)?\\s*([0-9]+(?:,[0-9]+)*(?:\\.[0-9]{1,2})?)"
    );
    private static final Pattern RECIPIENT_PATTERN = Pattern.compile(
        "(?i)(?:to|at|for)\\s+([A-Za-z0-9\\s&'\\.]+?)(?:\\s+(?:successfully|via|on|ref|upi|txn|is successful|\\.|$))"
    );

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || !PAYTM_PACKAGE.equals(sbn.getPackageName())) {
            return;
        }

        Bundle extras = sbn.getNotification().extras;
        if (extras == null) return;

        CharSequence title = extras.getCharSequence("android.title");
        CharSequence text = extras.getCharSequence("android.text");
        String fullBody = (title != null ? title + " " : "") + (text != null ? text : "");

        Matcher amtMatcher = AMOUNT_PATTERN.matcher(fullBody);
        if (amtMatcher.find()) {
            String amountStr = amtMatcher.group(1).replace(",", "");
            String recipient = "Merchant";

            Matcher recMatcher = RECIPIENT_PATTERN.matcher(fullBody);
            if (recMatcher.find()) {
                recipient = recMatcher.group(1).trim();
            }

            // Launch WhoseTab Deep Link: whosetab://snap?amount=...&to=...
            Intent openIntent = new Intent(Intent.ACTION_VIEW);
            openIntent.setData(Uri.parse("whosetab://snap?amount=" + amountStr + "&to=" + Uri.encode(recipient)));
            openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(openIntent);
        }
    }
}
