package com.khilvansh.whosetab;

import android.app.ActivityOptions;
import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.PowerManager;
import android.os.Process;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONObject;

public class PaytmNotificationListenerService extends NotificationListenerService {

    private static final String TAG = "WhoseTab";
    public static final String PREFS_NAME = "whosetab_prefs";
    public static final String KEY_OPEN_DELAY = "paytm_open_delay_ms";
    private static final String CHANNEL_ID_ALERTS = "paytm_snap_alerts_v2";

    // Package hints for ultra-fast early filtering (eliminates parsing social/media notifications)
    private static final String[] RELEVANT_PKG_HINTS = new String[] {
        "paytm", "phonepe", "nbu.paisa", "gpay", "upi", "bhim", "dreamplug",
        "amazon", "mobikwik", "freecharge", "fampay", "navi", "slice", "jupiter",
        "hdfc", "sbi", "icici", "axis", "kotak", "indus", "pnb", "canara", "bob", "bank",
        "messaging", "mms", "sms", "truecaller", "com.android.shell"
    };

    // Rate patterns like ₹17,867/g, ₹100/mo, etc.
    private static final Pattern PER_UNIT_RATE_PATTERN = Pattern.compile(
        "(?i)(?:₹|rs\\.?|inr)\\s*[0-9,.]+\\s*/\\s*(?:g|gm|kg|l|ltr|ml|mo|month|yr|year|unit|day|hr)"
    );

    // Outgoing verb paired with currency or amount
    private static final Pattern VERB_BEFORE_CURRENCY = Pattern.compile(
        "(?i)\\b(?:paid|sent|debited|transferred|spent|deducted)\\b.{0,14}(?:₹|rs\\.?|inr|[0-9])"
    );
    private static final Pattern CURRENCY_BEFORE_VERB = Pattern.compile(
        "(?i)(?:₹|rs\\.?|inr)\\s*[0-9,.]+.{0,24}\\b(?:paid|sent|debited|transferred|spent|deducted)\\b"
    );

    // Incoming repayment patterns
    private static final Pattern[] INCOMING_AMOUNT_PATTERNS = new Pattern[] {
        Pattern.compile("(?i)(?:received|credited(?: with| by)?|sent you)\\s*(?:₹|rs\\.?|inr)?\\s*([0-9]+(?:,[0-9]+)*(?:\\.[0-9]{1,2})?)"),
        Pattern.compile("(?i)(?:₹|rs\\.?|inr)\\s*([0-9]+(?:,[0-9]+)*(?:\\.[0-9]{1,2})?)\\s*(?:received|credited)")
    };

    // Outgoing payment amount extraction (rejects rate quotes like ₹17,867/g)
    private static final Pattern AMOUNT_PATTERN = Pattern.compile(
        "(?i)(?:paid|sent|transfer(?:red)?(?: of)?|debited (?:by|from|for)?|payment(?: of)?|rs\\.?|inr|₹)\\s*(?:rs\\.?|inr|₹)?\\s*([0-9]+(?:,[0-9]+)*(?:\\.[0-9]{1,2})?)(?!\\s*/\\s*(?:g|gm|kg|l|ltr|ml|mo|month|yr|year|unit|day|hr))"
    );

    private static final Pattern[] RECIPIENT_PATTERNS = new Pattern[] {
        Pattern.compile("(?i);\\s*([A-Za-z0-9\\s&'._@-]+?)(?=\\s+credited(?:\\s|\\.|;|$))"),
        Pattern.compile("(?i)(?:to|at|towards)\\s+(?:vpa\\s+)?([A-Za-z0-9\\s&'._/@*-]+?)(?=(?:\\s+(?:successfully|successful|via|on|in|into|from|using|with|ref|upi|txn|is successful|a/c|acct)|[.,;]|$))"),
        Pattern.compile("(?i)payment to\\s+(?:vpa\\s+)?([A-Za-z0-9\\s&'._/@*-]+?)(?=(?::|\\s+(?:successfully|successful|via|of|using)|[.,;]|$))")
    };

    private static final Pattern SENDER_FROM_PATTERN = Pattern.compile(
        "(?i)(?:from|by\\s+vpa)\\s+(?:vpa\\s+)?([A-Za-z0-9*@._-]+(?:\\s+[A-Za-z0-9*@._-]+)?)(?=(?:\\s+(?:deposited|credited|via|on|in|into|ref|upi|\\.)|[.,(]|$))"
    );
    private static final Pattern SENDER_SENT_YOU_PATTERN = Pattern.compile(
        "(?i)([A-Za-z0-9&'._-]+(?:\\s+[A-Za-z0-9&'._-]+)?)\\s+sent you"
    );
    private static final Pattern SENDER_UPI_SLASH_PATTERN = Pattern.compile(
        "(?i)upi/(?:[0-9]+)/([A-Za-z0-9*@._-]+)"
    );
    private static final Pattern SENDER_VPA_PATTERN = Pattern.compile(
        "(?i)vpa\\s+([A-Za-z0-9*@._-]+)"
    );
    private static final Pattern HANDLE_VPA_PATTERN = Pattern.compile(
        "([A-Za-z0-9.*_-]+@[A-Za-z]{2,})"
    );
    private static final Pattern HANDLE_PHONE_PATTERN = Pattern.compile(
        "(?:\\+91[-\\s]?)?([6-9][0-9]{9})\\b"
    );
    private static final Pattern BODY_NAME_CLEAN_NOISE = Pattern.compile(
        "(?i)\\b(?:paid|sent|successful|successfully|payment|upi|via|using|from|your|hdfc|sbi|icici|axis|kotak|bank|a/c|xx[0-9]+)\\b"
    );
    private static final Pattern TXN_PATTERN = Pattern.compile(
        "(?i)(?:txn(?: id)?|ref(?: no)?|upi ref|rrn)[:\\s#]+([A-Za-z0-9]+)"
    );

    private final Handler handler = new Handler(Looper.getMainLooper());
    private HandlerThread workerThread;
    private Handler workerHandler;
    private static volatile boolean isServiceRunning = false;

    // Cross-app 15s amount deduplication (prevents Paytm + HDFC SMS double-firing for one transaction)
    private static final Map<String, Long> recentAmountTimestamps = new ConcurrentHashMap<>();
    // Exact SBN instance deduplication
    private static final Map<String, Long> recentSbnEvents = new ConcurrentHashMap<>();

    public static boolean isRunning() {
        return isServiceRunning;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        workerThread = new HandlerThread("WhoseTabNotifWorker", Process.THREAD_PRIORITY_BACKGROUND);
        workerThread.start();
        workerHandler = new Handler(workerThread.getLooper());
        createAlertChannel();
        isServiceRunning = true;
        ScannerForegroundService.ensureRunning(this);
        Log.d(TAG, "PaytmNotificationListenerService created.");
    }

    @Override
    public void onDestroy() {
        isServiceRunning = false;
        handler.removeCallbacksAndMessages(null);
        if (workerThread != null) {
            workerThread.quitSafely();
            workerThread = null;
        }
        workerHandler = null;
        super.onDestroy();
    }

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        isServiceRunning = true;
        ScannerForegroundService.ensureRunning(this);
        Log.d(TAG, "Notification Listener connected successfully!");
    }

    @Override
    public void onListenerDisconnected() {
        super.onListenerDisconnected();
        isServiceRunning = false;
        Log.w(TAG, "Notification Listener disconnected.");
    }

    private static boolean isDuplicateSbn(String sbnInstanceKey) {
        if (sbnInstanceKey == null || sbnInstanceKey.isEmpty()) return false;
        Long ts = recentSbnEvents.get(sbnInstanceKey);
        long now = System.currentTimeMillis();
        if (ts != null && (now - ts < 300000L)) {
            return true;
        }
        recentSbnEvents.put(sbnInstanceKey, now);
        if (recentSbnEvents.size() > 80) {
            recentSbnEvents.entrySet().removeIf(e -> now - e.getValue() > 300000L);
        }
        return false;
    }

    private static boolean isRecentAmountDuplicate(double amount, boolean isRepayment) {
        String key = (isRepayment ? "R_" : "E_") + Math.round(amount * 100);
        Long ts = recentAmountTimestamps.get(key);
        long now = System.currentTimeMillis();
        // 15 seconds collapses simultaneous Paytm notification + HDFC/SBI bank SMS
        if (ts != null && (now - ts < 15000L)) {
            return true;
        }
        recentAmountTimestamps.put(key, now);
        if (recentAmountTimestamps.size() > 50) {
            recentAmountTimestamps.entrySet().removeIf(e -> now - e.getValue() > 60000L);
        }
        return false;
    }

    private static boolean isRelevantPackage(String pkgLower) {
        if (pkgLower == null || pkgLower.isEmpty()) return false;
        for (String hint : RELEVANT_PKG_HINTS) {
            if (pkgLower.contains(hint)) return true;
        }
        return false;
    }

    private static boolean hasCheapCurrencyOrActionCue(CharSequence title, CharSequence text) {
        String t = title != null ? title.toString().toLowerCase(Locale.US) : "";
        String b = text != null ? text.toString().toLowerCase(Locale.US) : "";
        String c = t + " " + b;
        return c.contains("₹") || c.contains("rs.") || c.contains("rs ") || c.contains("inr")
            || c.contains("credited") || c.contains("debited") || c.contains("paid") || c.contains("sent");
    }

    public static String extractCounterpartyHandle(String text) {
        if (text == null || text.trim().isEmpty()) return "";
        Matcher vpaMatcher = HANDLE_VPA_PATTERN.matcher(text);
        if (vpaMatcher.find() && vpaMatcher.group(1) != null) {
            return vpaMatcher.group(1).trim();
        }
        // Strip transaction reference/order/account numbers so they aren't misread as phone numbers
        String stripped = text.replaceAll("(?i)\\b(?:ref(?:\\s*no)?|txn(?:\\s*id)?|utr|rrn|order(?:\\s*id)?|a/c|acct|account|card)[:\\s#-]*[0-9]{6,}", " ");
        Matcher phoneMatcher = HANDLE_PHONE_PATTERN.matcher(stripped);
        if (phoneMatcher.find() && phoneMatcher.group(1) != null) {
            return phoneMatcher.group(1).trim();
        }
        return "";
    }

    public static boolean isMarketingOrSpam(String text) {
        if (text == null || text.trim().isEmpty()) return true;
        String lower = text.toLowerCase(Locale.US);

        String[] hardBlocks = new String[] {
            "buy gold", "paytm gold", "gold price", "drop in gold", "per gram",
            "scratch card", "win up to", "won up to", "pre-approved", "pre approved",
            "credit card", "credit score", "cibil", "mutual fund", "sip ",
            "stocks", "ipo ", "sensex", "nifty", "fixed deposit",
            "buy now", "shop now", "invest now", "apply now", "order now", "book now", "recharge now",
            "otp", "one time password", "verification code", "do not share", "secret code",
            "rate drop", "massive drop", "price drop", "special offer", "limited period",
            "save up to", "earn up to", "up to ₹", "up to rs", "flat rs", "flat ₹", "flat inr",
            "refund"
        };
        for (String kw : hardBlocks) {
            if (lower.contains(kw)) return true;
        }

        if (PER_UNIT_RATE_PATTERN.matcher(text).find()) {
            return true;
        }

        boolean hasExplicitDebit = lower.contains("paid") || lower.contains("debited") || VERB_BEFORE_CURRENCY.matcher(text).find();
        if (!hasExplicitDebit) {
            String[] softBlocks = new String[] {
                "cashback", "cash back", "coupon", "voucher", "promo code", "use code",
                "% off", "off on", "discount", "free delivery", "loan", "insurance", "postpaid"
            };
            for (String kw : softBlocks) {
                if (lower.contains(kw)) return true;
            }
        }

        return false;
    }

    public static boolean isIncomingPayment(String fullText) {
        if (fullText == null || fullText.trim().isEmpty()) return false;
        String lower = fullText.toLowerCase(Locale.US);

        if (lower.contains("cashback") || lower.contains("cash back") || lower.contains("reward") || lower.contains("refund")) {
            return false;
        }

        if (lower.contains("debited") || lower.contains("sent to") || lower.contains("paid to")
                || lower.contains("payment to") || lower.contains("money sent") || lower.contains("trf to")) {
            return false;
        }

        String[] creditKeywords = new String[] {
            "received", "credited", "sent you", "credit alert"
        };
        boolean hasCredit = false;
        for (String kw : creditKeywords) {
            if (lower.contains(kw)) {
                hasCredit = true;
                break;
            }
        }
        if (!hasCredit) return false;

        return !isMarketingOrSpam(fullText);
    }

    private static String extractSender(String text) {
        if (text == null || text.trim().isEmpty()) return null;

        Matcher m1 = SENDER_FROM_PATTERN.matcher(text);
        if (m1.find() && m1.group(1) != null) {
            String s = m1.group(1).replaceAll("(?i)(?:Deposited|via|credited).*$", "").trim();
            if (s.length() > 1 && !s.matches("(?i)^(hdfc|sbi|icici|axis|kotak|bank|account|a/c|vpa|inr|rs|upi|[0-9.]+)$")) {
                return s;
            }
        }

        Matcher m2 = SENDER_SENT_YOU_PATTERN.matcher(text);
        if (m2.find() && m2.group(1) != null) {
            String s = m2.group(1).replaceAll("(?i)^Google\\s+Pay\\s+", "").trim();
            if (s.length() > 1) return s;
        }

        Matcher m3 = SENDER_UPI_SLASH_PATTERN.matcher(text);
        if (m3.find() && m3.group(1) != null) {
            return m3.group(1).trim();
        }

        Matcher m4 = SENDER_VPA_PATTERN.matcher(text);
        if (m4.find() && m4.group(1) != null) {
            return m4.group(1).trim();
        }

        return null;
    }

    public static JSONObject parseIncomingPayment(CharSequence titleSeq, CharSequence textSeq, String fullBody) {
        if (fullBody == null || !isIncomingPayment(fullBody)) return null;

        double amount = 0.0;
        for (Pattern pat : INCOMING_AMOUNT_PATTERNS) {
            Matcher m = pat.matcher(fullBody);
            if (m.find() && m.group(1) != null) {
                try {
                    amount = Double.parseDouble(m.group(1).replace(",", ""));
                    if (amount > 0) break;
                } catch (Exception ignored) {}
            }
        }
        if (amount <= 0.0) return null;

        String title = titleSeq != null ? titleSeq.toString() : "";
        String text = textSeq != null ? textSeq.toString() : "";

        String sender = extractSender(text);
        if (sender == null) sender = extractSender(title);
        if (sender == null) sender = extractSender(fullBody);
        if (sender == null || sender.isEmpty()) sender = "Someone";
        if (sender.length() > 40) sender = sender.substring(0, 40);

        String handle = extractCounterpartyHandle(fullBody);

        try {
            JSONObject obj = new JSONObject();
            obj.put("type", "repayment");
            obj.put("amount", amount);
            obj.put("sender", sender);
            obj.put("counterpartyHandle", handle);
            obj.put("rawText", fullBody);
            obj.put("timestamp", System.currentTimeMillis());
            return obj;
        } catch (Exception e) {
            return null;
        }
    }

    public static boolean hasPaymentActionIndicator(String text) {
        if (text == null || text.trim().isEmpty()) return false;
        String lower = text.toLowerCase(Locale.US);

        String[] actionIndicators = new String[] {
            "paid", "payment of", "payment to", "payment successful", "payment is successful",
            "debited", "sent to", "money sent", "you sent", "trf to",
            "transferred", "transfer of", "transfer successful", "txn successful"
        };
        for (String ind : actionIndicators) {
            if (lower.contains(ind)) return true;
        }

        return VERB_BEFORE_CURRENCY.matcher(text).find() || CURRENCY_BEFORE_VERB.matcher(text).find();
    }

    public static JSONObject parseRawText(String title, String text, String fullBody) {
        if (fullBody == null || fullBody.trim().isEmpty()) return null;
        if (isMarketingOrSpam(fullBody)) return null;
        if (!hasPaymentActionIndicator(fullBody)) return null;

        Matcher amtMatcher = AMOUNT_PATTERN.matcher(fullBody);
        if (!amtMatcher.find()) return null;

        double amount;
        try {
            amount = Double.parseDouble(amtMatcher.group(1).replace(",", ""));
        } catch (Exception e) {
            return null;
        }
        if (amount <= 0.0) return null;

        String recipient = "Merchant";
        for (Pattern pat : RECIPIENT_PATTERNS) {
            Matcher recMatcher = pat.matcher(fullBody);
            if (recMatcher.find() && recMatcher.group(1) != null) {
                String candidate = recMatcher.group(1).trim();
                if (candidate.length() > 1 && !candidate.equalsIgnoreCase("rs")
                        && !candidate.equalsIgnoreCase("inr") && !candidate.equals("₹")
                        && !candidate.equalsIgnoreCase("vpa") && !candidate.matches("^[0-9.,\\s]+$")) {
                    recipient = candidate;
                    break;
                }
            }
        }

        if ("Merchant".equals(recipient)) {
            Matcher upiNameM = SENDER_UPI_SLASH_PATTERN.matcher(fullBody);
            if (upiNameM.find() && upiNameM.group(1) != null) {
                String c = upiNameM.group(1).trim();
                if (c.length() > 1) recipient = c;
            }
        }

        if ("Merchant".equals(recipient) && text != null && !text.trim().isEmpty()) {
            String cleanedText = text.trim()
                .replaceAll("(?i)(?:₹|rs\\.?|inr)\\s*[0-9,.]+", "");
            cleanedText = BODY_NAME_CLEAN_NOISE.matcher(cleanedText).replaceAll("")
                .replaceAll("[•|·-]{1,}", " ")
                .replaceAll("\\s+", " ")
                .trim();
            if (cleanedText.length() >= 2 && cleanedText.length() <= 40 && !cleanedText.matches("^[0-9.,\\s]+$")) {
                recipient = cleanedText;
            }
        }

        recipient = recipient.replaceAll("\\s+", " ").trim();
        if (recipient.length() > 40) recipient = recipient.substring(0, 40).trim();

        String handle = extractCounterpartyHandle(fullBody);

        String txnId = "";
        Matcher txnMatcher = TXN_PATTERN.matcher(fullBody);
        if (txnMatcher.find()) {
            txnId = txnMatcher.group(1).trim();
        }

        String lower = fullBody.toLowerCase(Locale.US);
        String category = "General";
        if (lower.contains("amazon") || lower.contains("flipkart") || lower.contains("myntra")
                || lower.contains("meesho") || lower.contains("ajio") || lower.contains("nykaa")
                || lower.contains("delivery") || lower.contains("parcel") || lower.contains("delhivery")) {
            category = "Shopping";
        } else if (lower.contains("grocer") || lower.contains("kirana") || lower.contains("mart") || lower.contains("milk") || lower.contains("vegetable") || lower.contains("zepto") || lower.contains("blinkit")) {
            category = "Groceries";
        } else if (lower.contains("food") || lower.contains("canteen") || lower.contains("cafe") || lower.contains("restaurant") || lower.contains("zomato") || lower.contains("swiggy") || lower.contains("sweets")) {
            category = "FoodDining";
        } else if (lower.contains("chai") || lower.contains("tea") || lower.contains("samosa") || lower.contains("juice") || lower.contains("bakery") || lower.contains("coffee")) {
            category = "SnacksChai";
        } else if (lower.contains("stationery") || lower.contains("book") || lower.contains("xerox") || lower.contains("print") || lower.contains("lab")) {
            category = "StationeryBooks";
        } else if (lower.contains("rent") || lower.contains("wifi") || lower.contains("broadband") || lower.contains("electricity")) {
            category = "RoomRentUtilities";
        }

        try {
            JSONObject obj = new JSONObject();
            obj.put("type", "expense");
            obj.put("amount", amount);
            obj.put("recipient", recipient);
            obj.put("counterpartyHandle", handle);
            obj.put("txnId", txnId);
            obj.put("suggestedCategory", category);
            obj.put("rawText", fullBody);
            return obj;
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;

        String pkg = sbn.getPackageName() != null ? sbn.getPackageName().toLowerCase(Locale.US) : "";
        if (pkg.equals(getPackageName().toLowerCase(Locale.US))) return;

        Notification notification = sbn.getNotification();
        if (notification == null) return;

        // Fast flag checks before touching any Bundle strings or regexes (saves CPU/battery)
        int flags = notification.flags;
        if ((flags & (Notification.FLAG_GROUP_SUMMARY | Notification.FLAG_ONGOING_EVENT)) != 0) {
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            String cat = notification.category;
            if (Notification.CATEGORY_PROMO.equals(cat)
                    || Notification.CATEGORY_RECOMMENDATION.equals(cat)
                    || Notification.CATEGORY_TRANSPORT.equals(cat)
                    || Notification.CATEGORY_PROGRESS.equals(cat)
                    || Notification.CATEGORY_ALARM.equals(cat)
                    || Notification.CATEGORY_CALL.equals(cat)
                    || Notification.CATEGORY_SYSTEM.equals(cat)
                    || Notification.CATEGORY_SERVICE.equals(cat)
                    || Notification.CATEGORY_SOCIAL.equals(cat)) {
                return;
            }
        }

        Bundle extras = notification.extras;
        if (extras == null) return;

        // Ignore download / upload progress bar notifications
        if (extras.getInt(Notification.EXTRA_PROGRESS_MAX, 0) > 0 || extras.getBoolean(Notification.EXTRA_PROGRESS_INDETERMINATE, false)) {
            return;
        }

        CharSequence titleSeq = extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence textSeq = extras.getCharSequence(Notification.EXTRA_TEXT);

        // If package isn't a known payment/bank/SMS app, require cheap currency/payment keyword before parsing
        boolean knownApp = isRelevantPackage(pkg);
        if (!knownApp && !hasCheapCurrencyOrActionCue(titleSeq, textSeq)) {
            return;
        }

        CharSequence subTextSeq = extras.getCharSequence(Notification.EXTRA_SUB_TEXT);
        if (subTextSeq != null) {
            String sub = subTextSeq.toString().toLowerCase(Locale.US);
            if (sub.contains("gold") || sub.contains("offer") || sub.contains("deal")
                    || sub.contains("mall") || sub.contains("reward")) {
                return;
            }
        }

        CharSequence bigTextSeq = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
        CharSequence[] linesSeq = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);

        final String sbnKey = sbn.getKey();
        final long postTime = sbn.getPostTime() > 0 ? sbn.getPostTime() : System.currentTimeMillis();
        final String pkgFinal = pkg;

        Runnable task = () -> processCandidateNotification(pkgFinal, sbnKey, postTime, titleSeq, textSeq, bigTextSeq, linesSeq);
        if (workerHandler != null) {
            workerHandler.post(task);
        } else {
            task.run();
        }
    }

    private void processCandidateNotification(
        String pkg, String sbnKey, long postTime,
        CharSequence titleSeq, CharSequence textSeq, CharSequence bigTextSeq, CharSequence[] linesSeq
    ) {
        String titleStr = titleSeq != null ? titleSeq.toString().trim() : "";
        String textBodyStr = (bigTextSeq != null && bigTextSeq.length() > 0)
            ? bigTextSeq.toString().trim()
            : (textSeq != null ? textSeq.toString().trim() : "");

        StringBuilder fullText = new StringBuilder();
        if (!titleStr.isEmpty()) fullText.append(titleStr).append(' ');
        if (!textBodyStr.isEmpty()) fullText.append(textBodyStr).append(' ');
        if (linesSeq != null) {
            for (CharSequence line : linesSeq) {
                if (line != null && line.length() > 0) {
                    fullText.append(line).append(' ');
                }
            }
        }
        String fullBody = fullText.toString().trim();
        if (fullBody.isEmpty()) return;

        String sbnInstance = sbnKey + "_" + postTime;
        if (isDuplicateSbn(sbnInstance)) return;

        if (isMarketingOrSpam(fullBody)) {
            Log.d(TAG, "Ignored non-payment notification [" + pkg + "]: " + fullBody);
            return;
        }

        // 1. Check INCOMING REPAYMENT first
        JSONObject incoming = parseIncomingPayment(titleSeq, textSeq, fullBody);
        if (incoming != null) {
            try { incoming.put("postTime", postTime); } catch (Exception ignored) {}
            double amount = incoming.optDouble("amount", 0.0);
            String sig = PaymentDataStore.getRepaymentSignature(incoming);
            if (PaymentDataStore.isRepaymentDismissed(this, sig) || isRecentAmountDuplicate(amount, true)) {
                return;
            }

            Log.d(TAG, "Detected incoming repayment: ₹" + amount + " from " + incoming.optString("sender"));
            PaymentDataStore.setPendingRepayment(this, incoming);
            PaymentDataStore.addRecentDetection(this, incoming);
            handler.post(() -> handleDetectedEvent(incoming, true));
            return;
        }

        // 2. Check OUTGOING PAYMENT (Shop, P2P, Bank SMS)
        if (!hasPaymentActionIndicator(fullBody)) {
            return;
        }

        JSONObject parsed = parseRawText(titleStr, textBodyStr, fullBody);
        if (parsed != null) {
            try { parsed.put("postTime", postTime); } catch (Exception ignored) {}
            double amount = parsed.optDouble("amount", 0.0);
            String sig = PaymentDataStore.getSignature(parsed);
            if (PaymentDataStore.isPaymentDismissed(this, sig) || isRecentAmountDuplicate(amount, false)) {
                return;
            }

            Log.d(TAG, "Detected payment [" + pkg + "]: ₹" + amount + " to " + parsed.optString("recipient"));
            PaymentDataStore.setPendingPayment(this, parsed);
            PaymentDataStore.addRecentDetection(this, parsed);
            handler.post(() -> handleDetectedEvent(parsed, false));
        }
    }

    private void handleDetectedEvent(JSONObject data, boolean isRepayment) {
        if (!ScannerForegroundService.isRunning()) {
            ScannerForegroundService.ensureRunning(this);
        }

        if (MainActivity.isActivityForeground) {
            MainActivity.dispatchFromServiceIfVisible(data, isRepayment);
            return;
        }

        double amount = data.optDouble("amount", 0.0);
        String counterparty = isRepayment
            ? data.optString("sender", "Someone")
            : data.optString("recipient", "Merchant");
        String handle = data.optString("counterpartyHandle", "");

        Intent openIntent = new Intent(this, MainActivity.class);
        if (isRepayment) {
            openIntent.putExtra("paytm_type", "repayment");
            openIntent.putExtra("paytm_sender", counterparty);
        } else {
            openIntent.putExtra("paytm_recipient", counterparty);
            openIntent.putExtra("paytm_txnId", data.optString("txnId", ""));
            openIntent.putExtra("paytm_category", data.optString("suggestedCategory", "General"));
        }
        openIntent.putExtra("paytm_handle", handle);
        openIntent.putExtra("paytm_amount", amount);
        openIntent.putExtra("paytm_note", data.optString("rawText", ""));
        openIntent.putExtra("paytm_postTime", data.optLong("postTime", 0L));
        openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP
                | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);

        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            (int) (System.currentTimeMillis() & 0xFFFFFF),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        String notifTitle = isRepayment
            ? String.format(Locale.US, "Received ₹%.2f from %s", amount, counterparty)
            : String.format(Locale.US, "Paid ₹%.2f to %s", amount, counterparty);
        String notifBody = isRepayment
            ? "Tap to link sender and update balance"
            : "Tap to add to a person's tab";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID_ALERTS)
            .setSmallIcon(R.drawable.ic_stat_whosetab)
            .setContentTitle(notifTitle)
            .setContentText(notifBody)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent);

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify((int) (System.currentTimeMillis() & 0xFFFFFF), builder.build());
        }

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        long delayMs = prefs.getLong(KEY_OPEN_DELAY, 0);
        String mode = PaymentDataStore.getDetectionMode(this);

        if ("notification".equals(mode)) {
            return;
        }

        boolean canOverlay = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this);

        handler.postDelayed(() -> {
            if ("overlay".equals(mode) && canOverlay) {
                if (!isDeviceUnlockedAndInteractive(this)) {
                    ScannerForegroundService.schedulePopupOnUnlock(PaytmNotificationListenerService.this, data);
                    return;
                }
                try {
                    Intent popupIntent = QuickAddPopupActivity.buildIntent(this, data);
                    PendingIntent popupPi = PendingIntent.getActivity(
                        this,
                        (int) ((System.currentTimeMillis() + 7) & 0xFFFFFF),
                        popupIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
                    );
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                        ActivityOptions options = ActivityOptions.makeBasic();
                        options.setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
                        popupPi.send(this, 0, null, null, null, null, options.toBundle());
                    } else {
                        startActivity(popupIntent);
                    }
                    return;
                } catch (Exception e) {
                    Log.w(TAG, "QuickAddPopupActivity launch fallback: " + e.getMessage());
                    PaymentOverlayManager.showPaymentToast(PaytmNotificationListenerService.this, data);
                    return;
                }
            }

            if (!isDeviceUnlockedAndInteractive(this)) {
                ScannerForegroundService.schedulePopupOnUnlock(PaytmNotificationListenerService.this, data);
                return;
            }

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    ActivityOptions options = ActivityOptions.makeBasic();
                    options.setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
                    try {
                        pendingIntent.send(this, 0, null, null, null, null, options.toBundle());
                    } catch (Exception ex) {
                        startActivity(openIntent, options.toBundle());
                    }
                } else {
                    startActivity(openIntent);
                }
            } catch (Exception e) {
                try {
                    startActivity(openIntent);
                } catch (Exception ignored) {}
            }
        }, delayMs);
    }

    private static boolean isDeviceUnlockedAndInteractive(Context context) {
        if (context == null) return false;
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        if (pm != null && !pm.isInteractive()) {
            return false;
        }
        KeyguardManager km = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
        return km == null || !km.isKeyguardLocked();
    }

    private void createAlertChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm == null) return;
            NotificationChannel alertChannel = new NotificationChannel(
                CHANNEL_ID_ALERTS,
                "Payment Alerts",
                NotificationManager.IMPORTANCE_HIGH
            );
            alertChannel.setDescription("Alerts when a payment or repayment is detected");
            alertChannel.enableVibration(true);
            alertChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(alertChannel);
        }
    }
}
