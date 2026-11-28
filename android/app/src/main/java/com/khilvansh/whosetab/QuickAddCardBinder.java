package com.khilvansh.whosetab;

import android.animation.ObjectAnimator;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.animation.AccelerateInterpolator;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.LinearInterpolator;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Shared binder for the compact bottom-right Quick-Add card used by both
 * QuickAddPopupActivity and PaymentOverlayManager.
 */
public class QuickAddCardBinder {

    private static final String TAG = "WhoseTab";
    private static final long AUTO_HIDE_MS = 25000L;

    private static final Set<String> KNOWN_COMMERCIAL_MERCHANTS = new HashSet<>(Arrays.asList(
        "amazon", "amazonpay", "amazonindia", "amazonseller", "flipkart", "myntra",
        "meesho", "ajio", "nykaa", "swiggy", "zomato", "blinkit", "zepto", "instamart",
        "bigbasket", "uber", "ola", "rapido", "irctc", "paytm", "googlepay", "phonepe",
        "paytmmoney", "merchant", "someone"
    ));

    private static final Set<String> GENERIC_ALIAS_TOKENS = new HashSet<>(Arrays.asList(
        "pay", "upi", "bank", "hdfc", "sbi", "icici", "axis", "kotak", "paytm",
        "amazon", "merchant", "payment", "transfer", "india", "limited", "ltd", "pvt"
    ));

    public interface DismissCallback {
        void onDismissRequested();
    }

    private static void animateOutAndDismiss(Context context, View root, boolean slideLeft, DismissCallback onDismiss) {
        if (root == null) {
            if (onDismiss != null) onDismiss.onDismissRequested();
            return;
        }
        float distance = root.getWidth() > 0 ? root.getWidth() + dpToPx(context, 28) : dpToPx(context, 340);
        float targetX = slideLeft ? -distance : distance;
        root.animate().cancel();
        root.animate()
            .translationX(targetX)
            .alpha(0f)
            .setDuration(210L)
            .setInterpolator(new AccelerateInterpolator())
            .withEndAction(() -> {
                if (onDismiss != null) onDismiss.onDismissRequested();
            })
            .start();
    }

    public static void bind(Context context, View root, JSONObject data, DismissCallback onDismiss) {
        if (context == null || root == null || data == null) return;

        // Smooth entrance animation from right edge
        root.animate().cancel();
        root.setTranslationX(dpToPx(context, 48));
        root.setAlpha(0f);
        root.animate()
            .translationX(0f)
            .alpha(1f)
            .setDuration(220L)
            .setInterpolator(new DecelerateInterpolator())
            .start();

        View timerTrack = root.findViewById(R.id.overlayTimerTrack);
        View timerFill = root.findViewById(R.id.overlayTimerFill);
        final ObjectAnimator[] timerAnim = new ObjectAnimator[] { null };

        final AtomicBoolean dismissedFlag = new AtomicBoolean(false);
        final Handler timerHandler = new Handler(Looper.getMainLooper());
        final Runnable hideTask = () -> {
            if (dismissedFlag.compareAndSet(false, true)) {
                if (timerAnim[0] != null) timerAnim[0].cancel();
                animateOutAndDismiss(context, root, false, onDismiss);
            }
        };
        final Runnable startBarAnim = () -> {
            if (timerFill == null || timerTrack == null) return;
            timerFill.post(() -> {
                if (dismissedFlag.get()) return;
                if (timerAnim[0] != null) timerAnim[0].cancel();
                float w = timerTrack.getWidth();
                if (w > 0) timerFill.setPivotX(w);
                timerFill.setScaleX(1f);
                ObjectAnimator anim = ObjectAnimator.ofFloat(timerFill, "scaleX", 1f, 0f);
                anim.setDuration(AUTO_HIDE_MS);
                anim.setInterpolator(new LinearInterpolator());
                anim.start();
                timerAnim[0] = anim;
            });
        };
        final Runnable resetTimer = () -> {
            if (dismissedFlag.get()) return;
            timerHandler.removeCallbacks(hideTask);
            timerHandler.postDelayed(hideTask, AUTO_HIDE_MS);
            startBarAnim.run();
        };
        resetTimer.run();

        String type = data.optString("type", "expense");
        double amount = data.optDouble("amount", 0.0);
        boolean isRepayment = "repayment".equals(type);
        String counterparty = isRepayment
            ? data.optString("sender", "Someone")
            : data.optString("recipient", "Merchant").replaceAll("\\s+", " ").trim();
        String counterpartyHandle = data.optString("counterpartyHandle", "");

        TextView titleTv = root.findViewById(R.id.overlayTitle);
        TextView subtitleTv = root.findViewById(R.id.overlaySubtitle);
        TextView closeBtn = root.findViewById(R.id.overlayCloseBtn);
        LinearLayout contactsContainer = root.findViewById(R.id.overlayContactsContainer);
        LinearLayout chipsList = root.findViewById(R.id.overlayChipsList);
        TextView includeMeChip = root.findViewById(R.id.overlayIncludeMeChip);
        TextView openAppBtn = root.findViewById(R.id.overlayOpenAppBtn);
        TextView quickAddBtn = root.findViewById(R.id.overlayQuickAddBtn);

        root.addOnAttachStateChangeListener(new View.OnAttachStateChangeListener() {
            @Override
            public void onViewAttachedToWindow(View v) {}
            @Override
            public void onViewDetachedFromWindow(View v) {
                if (timerAnim[0] != null) timerAnim[0].cancel();
                timerHandler.removeCallbacksAndMessages(null);
            }
        });

        if (isRepayment) {
            titleTv.setText(String.format(Locale.US, "Received ₹%.2f", amount));
            titleTv.setTextColor(Color.parseColor("#34D399"));
            subtitleTv.setText("From " + counterparty);
            contactsContainer.setVisibility(View.GONE);
            openAppBtn.setText("Dismiss");
            quickAddBtn.setText("Confirm Settlement");
        } else {
            titleTv.setText(String.format(Locale.US, "Paid ₹%.2f", amount));
            titleTv.setTextColor(Color.parseColor("#FFFFFF"));
            subtitleTv.setText(counterparty);
        }

        final Set<String> selectedPersonIds = new LinkedHashSet<>();
        final List<JSONObject> contactObjects = new ArrayList<>();
        final boolean[] includeMe = new boolean[] { false };

        if (!isRepayment) {
            JSONArray synced = PaymentDataStore.getSyncedContacts(context);
            String matchedId = findBestContactMatch(synced, counterparty, counterpartyHandle);
            if (synced.length() == 0) {
                contactsContainer.setVisibility(View.GONE);
                quickAddBtn.setText("Split in App");
            } else {
                contactsContainer.setVisibility(View.VISIBLE);
                chipsList.removeAllViews();
                for (int i = 0; i < synced.length(); i++) {
                    JSONObject p = synced.optJSONObject(i);
                    if (p == null) continue;
                    String id = p.optString("id", "");
                    String name = p.optString("name", "");
                    if (id.isEmpty() || name.isEmpty()) continue;
                    contactObjects.add(p);

                    TextView chip = new TextView(context);
                    String shortName = name.contains(" ") ? name.substring(0, name.indexOf(' ')) : name;
                    chip.setText(shortName);
                    chip.setTextSize(12);
                    chip.setBackgroundResource(R.drawable.overlay_chip_bg);
                    chip.setGravity(Gravity.CENTER);
                    int hPad = dpToPx(context, 12);
                    chip.setPadding(hPad, 0, hPad, 0);

                    boolean isPreselected = id.equals(matchedId);
                    if (isPreselected) {
                        selectedPersonIds.add(id);
                        chip.setSelected(true);
                        chip.setTextColor(Color.parseColor("#FFFFFF"));
                    } else {
                        chip.setSelected(false);
                        chip.setTextColor(Color.parseColor("#E4E4E7"));
                    }

                    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT,
                        dpToPx(context, 32)
                    );
                    lp.setMarginEnd(dpToPx(context, 6));
                    chip.setLayoutParams(lp);

                    chip.setOnClickListener(v -> {
                        resetTimer.run();
                        if (selectedPersonIds.contains(id)) {
                            selectedPersonIds.remove(id);
                            chip.setSelected(false);
                            chip.setTextColor(Color.parseColor("#E4E4E7"));
                        } else {
                            selectedPersonIds.add(id);
                            chip.setSelected(true);
                            chip.setTextColor(Color.parseColor("#FFFFFF"));
                        }
                        updateQuickAddButtonLabel(quickAddBtn, selectedPersonIds, contactObjects);
                    });

                    chipsList.addView(chip);
                }

                updateQuickAddButtonLabel(quickAddBtn, selectedPersonIds, contactObjects);

                includeMeChip.setOnClickListener(v -> {
                    resetTimer.run();
                    includeMe[0] = !includeMe[0];
                    includeMeChip.setSelected(includeMe[0]);
                    includeMeChip.setTextColor(Color.parseColor(includeMe[0] ? "#FFFFFF" : "#D4D4D8"));
                });
            }
        }

        closeBtn.setOnClickListener(v -> {
            if (!dismissedFlag.compareAndSet(false, true)) return;
            timerHandler.removeCallbacksAndMessages(null);
            dismissPayment(context, data, isRepayment);
            animateOutAndDismiss(context, root, false, onDismiss);
        });

        openAppBtn.setOnClickListener(v -> {
            if (!dismissedFlag.compareAndSet(false, true)) return;
            timerHandler.removeCallbacksAndMessages(null);
            if (isRepayment) {
                dismissPayment(context, data, true);
                animateOutAndDismiss(context, root, false, onDismiss);
            } else {
                if (onDismiss != null) onDismiss.onDismissRequested();
                launchMainAppWithData(context, data, false);
            }
        });

        quickAddBtn.setOnClickListener(v -> {
            timerHandler.removeCallbacks(hideTask);
            if (isRepayment) {
                if (!dismissedFlag.compareAndSet(false, true)) return;
                if (onDismiss != null) onDismiss.onDismissRequested();
                launchMainAppWithData(context, data, true);
                return;
            }

            if (contactObjects.isEmpty()) {
                if (!dismissedFlag.compareAndSet(false, true)) return;
                if (onDismiss != null) onDismiss.onDismissRequested();
                launchMainAppWithData(context, data, false);
                return;
            }

            if (selectedPersonIds.isEmpty()) {
                Toast.makeText(context, "Select a contact chip above or tap Open App", Toast.LENGTH_SHORT).show();
                resetTimer.run();
                return;
            }

            if (!dismissedFlag.compareAndSet(false, true)) return;
            timerHandler.removeCallbacksAndMessages(null);

            try {
                int numPeople = selectedPersonIds.size();
                int divisor = includeMe[0] ? (numPeople + 1) : numPeople;
                long totalCents = Math.round(amount * 100);
                long perCents = Math.floorDiv(totalCents, divisor);
                long remainderCents = totalCents - (perCents * divisor);

                double myShare = includeMe[0] ? (perCents / 100.0) : 0.0;
                JSONArray splits = new JSONArray();
                List<String> chosenNames = new ArrayList<>();

                int idx = 0;
                for (String pid : selectedPersonIds) {
                    long cents = perCents + (idx < remainderCents ? 1 : 0);
                    JSONObject splitObj = new JSONObject();
                    splitObj.put("personId", pid);
                    splitObj.put("amountOwed", cents / 100.0);
                    splits.put(splitObj);
                    idx++;

                    for (JSONObject c : contactObjects) {
                        if (pid.equals(c.optString("id"))) {
                            chosenNames.add(c.optString("name"));
                            break;
                        }
                    }
                }

                JSONObject expenseObj = new JSONObject();
                expenseObj.put("id", "e_" + System.currentTimeMillis());
                expenseObj.put("title", counterparty);
                expenseObj.put("counterpartyName", counterparty);
                expenseObj.put("counterpartyHandle", counterpartyHandle);
                expenseObj.put("entryKind", includeMe[0] ? "split" : "lent");
                expenseObj.put("totalAmount", amount);
                expenseObj.put("paidById", "me");
                expenseObj.put("splitType", includeMe[0] ? "EqualSplit" : "BoughtForPerson");
                expenseObj.put("splits", splits);
                expenseObj.put("category", data.optString("suggestedCategory", "General"));
                expenseObj.put("paymentSource", "Paytm");
                expenseObj.put("myShare", myShare);
                expenseObj.put("rawText", data.optString("rawText", ""));
                expenseObj.put("timestamp", System.currentTimeMillis());

                PaymentDataStore.addQueuedQuickExpense(context, expenseObj);
                dismissPayment(context, data, false);

                MainActivity.notifyQuickExpensesUpdated();

                String namesJoined = android.text.TextUtils.join(", ", chosenNames);
                Toast.makeText(
                    context,
                    String.format(Locale.US, "Added ₹%.2f to %s", amount, namesJoined),
                    Toast.LENGTH_SHORT
                ).show();
            } catch (Exception e) {
                Log.e(TAG, "Error queueing quick expense", e);
            }

            animateOutAndDismiss(context, root, false, onDismiss);
        });

        final float[] downX = new float[1];
        root.setOnTouchListener((v, event) -> {
            if (dismissedFlag.get()) return false;
            resetTimer.run();
            int action = event.getActionMasked();
            if (action == MotionEvent.ACTION_DOWN) {
                downX[0] = event.getRawX();
            } else if (action == MotionEvent.ACTION_MOVE) {
                float dx = event.getRawX() - downX[0];
                if (Math.abs(dx) > dpToPx(context, 8)) {
                    root.setTranslationX(dx);
                    float progress = Math.min(1f, Math.abs(dx) / dpToPx(context, 180));
                    root.setAlpha(Math.max(0.25f, 1f - progress * 0.7f));
                }
            } else if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
                float dx = event.getRawX() - downX[0];
                if (Math.abs(dx) > dpToPx(context, 75)) {
                    if (dismissedFlag.compareAndSet(false, true)) {
                        timerHandler.removeCallbacksAndMessages(null);
                        dismissPayment(context, data, isRepayment);
                        animateOutAndDismiss(context, root, dx < 0, onDismiss);
                    }
                    return true;
                } else {
                    root.animate().translationX(0f).alpha(1f).setDuration(160L).setInterpolator(new DecelerateInterpolator()).start();
                }
            }
            return false;
        });
    }

    private static String findBestContactMatch(JSONArray contacts, String rawCounterparty, String rawHandle) {
        if (contacts == null || contacts.length() == 0) return null;
        String cp = rawCounterparty != null ? rawCounterparty.trim() : "";
        String handle = rawHandle != null ? rawHandle.trim() : "";
        String combinedRaw = (cp + " " + handle).trim().toLowerCase(Locale.US);
        String cleanCp = cp.toLowerCase(Locale.US).replaceAll("[^a-z0-9]", "");
        String cleanHandle = handle.toLowerCase(Locale.US).replaceAll("[^a-z0-9]", "");

        // 1. Exact phone 10-digit suffix match (only if handle itself is phone/VPA-digits)
        String handleDigits = handle.replaceAll("[^0-9]", "");
        if (handleDigits.length() >= 10) {
            String last10 = handleDigits.substring(handleDigits.length() - 10);
            for (int i = 0; i < contacts.length(); i++) {
                JSONObject c = contacts.optJSONObject(i);
                if (c == null) continue;
                String phoneDigits = c.optString("phone", "").replaceAll("[^0-9]", "");
                if (phoneDigits.length() >= 10 && phoneDigits.endsWith(last10)) {
                    return c.optString("id", "");
                }
            }
        }

        // 2. Masked VPA suffix match (e.g. *7113@wahdfcbank -> phone ends with 7113 if unique)
        if (handle.startsWith("*") || combinedRaw.contains("@")) {
            java.util.regex.Matcher m4 = java.util.regex.Pattern.compile("\\*?([0-9]{4})@").matcher(combinedRaw);
            if (m4.find()) {
                String tail4 = m4.group(1);
                String uniqueMatchId = null;
                int matches = 0;
                for (int i = 0; i < contacts.length(); i++) {
                    JSONObject c = contacts.optJSONObject(i);
                    if (c == null) continue;
                    String phoneDigits = c.optString("phone", "").replaceAll("[^0-9]", "");
                    if (phoneDigits.endsWith(tail4)) {
                        uniqueMatchId = c.optString("id", "");
                        matches++;
                    }
                }
                if (matches == 1) return uniqueMatchId;
            }
        }

        // 3. Exact UPI ID match
        for (int i = 0; i < contacts.length(); i++) {
            JSONObject c = contacts.optJSONObject(i);
            if (c == null) continue;
            String upi = c.optString("upi", "").toLowerCase(Locale.US).trim();
            if (upi.length() >= 5 && (combinedRaw.contains(upi) || (!handle.isEmpty() && upi.equalsIgnoreCase(handle)))) {
                return c.optString("id", "");
            }
        }

        // Never fuzzy-match well-known e-commerce / delivery / commercial brands to personal contacts
        if (KNOWN_COMMERCIAL_MERCHANTS.contains(cleanCp)) {
            return null;
        }

        // 4. Learned payment aliases match (requires >= 4 chars & non-generic token)
        for (int i = 0; i < contacts.length(); i++) {
            JSONObject c = contacts.optJSONObject(i);
            if (c == null) continue;
            JSONArray aliases = c.optJSONArray("aliases");
            if (aliases == null) continue;
            for (int j = 0; j < aliases.length(); j++) {
                String alias = aliases.optString(j, "").trim().toLowerCase(Locale.US);
                String cleanAlias = alias.replaceAll("[^a-z0-9]", "");
                if (cleanAlias.length() < 4 || GENERIC_ALIAS_TOKENS.contains(cleanAlias) || KNOWN_COMMERCIAL_MERCHANTS.contains(cleanAlias)) {
                    continue;
                }
                if (cleanAlias.equals(cleanCp) || (!cleanHandle.isEmpty() && cleanAlias.equals(cleanHandle))) {
                    return c.optString("id", "");
                }
            }
        }

        // 5. Name / First name / Phonetic match
        if (cleanCp.length() < 3) return null;
        String phoneticCp = cleanCp.replace("h", "");

        for (int i = 0; i < contacts.length(); i++) {
            JSONObject c = contacts.optJSONObject(i);
            if (c == null) continue;
            String id = c.optString("id", "");
            String name = c.optString("name", "");
            String cleanName = name.toLowerCase(Locale.US).replaceAll("[^a-z0-9]", "");
            if (cleanName.length() < 3) continue;

            if (cleanName.equals(cleanCp)) {
                return id;
            }
            String first = name.toLowerCase(Locale.US).split("\\s+")[0].replaceAll("[^a-z0-9]", "");
            if (first.length() >= 4 && !GENERIC_ALIAS_TOKENS.contains(first) && cleanCp.equals(first)) {
                return id;
            }
            String phoneticName = cleanName.replace("h", "");
            if (phoneticName.length() >= 4 && phoneticName.equals(phoneticCp)) {
                return id;
            }
        }
        return null;
    }

    private static void updateQuickAddButtonLabel(TextView btn, Set<String> selectedIds, List<JSONObject> contacts) {
        if (selectedIds.isEmpty()) {
            btn.setText("Quick Add");
            btn.setAlpha(0.75f);
            return;
        }
        btn.setAlpha(1.0f);
        if (selectedIds.size() == 1) {
            String pid = selectedIds.iterator().next();
            for (JSONObject c : contacts) {
                if (pid.equals(c.optString("id"))) {
                    String name = c.optString("name", "Tab");
                    String first = name.contains(" ") ? name.substring(0, name.indexOf(' ')) : name;
                    btn.setText("Add to " + first);
                    return;
                }
            }
        }
        btn.setText("Add (" + selectedIds.size() + ")");
    }

    private static void dismissPayment(Context context, JSONObject data, boolean isRepayment) {
        if (isRepayment) {
            PaymentDataStore.markRepaymentDismissed(context, PaymentDataStore.getRepaymentSignature(data));
            PaymentDataStore.clearPendingRepayment(context);
        } else {
            PaymentDataStore.markPaymentDismissed(context, PaymentDataStore.getSignature(data));
            PaymentDataStore.clearPendingPayment(context);
        }
    }

    private static void launchMainAppWithData(Context context, JSONObject data, boolean isRepayment) {
        Intent openIntent = new Intent(context, MainActivity.class);
        if (isRepayment) {
            openIntent.putExtra("paytm_type", "repayment");
            openIntent.putExtra("paytm_amount", data.optDouble("amount", 0.0));
            openIntent.putExtra("paytm_sender", data.optString("sender", "Someone"));
            openIntent.putExtra("paytm_handle", data.optString("counterpartyHandle", ""));
            openIntent.putExtra("paytm_note", data.optString("rawText", ""));
            openIntent.putExtra("paytm_postTime", data.optLong("postTime", 0L));
        } else {
            openIntent.putExtra("paytm_amount", data.optDouble("amount", 0.0));
            openIntent.putExtra("paytm_recipient", data.optString("recipient", "Merchant"));
            openIntent.putExtra("paytm_handle", data.optString("counterpartyHandle", ""));
            openIntent.putExtra("paytm_txnId", data.optString("txnId", ""));
            openIntent.putExtra("paytm_category", data.optString("suggestedCategory", "General"));
            openIntent.putExtra("paytm_note", data.optString("rawText", ""));
            openIntent.putExtra("paytm_postTime", data.optLong("postTime", 0L));
        }
        openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP
                | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        context.startActivity(openIntent);
    }

    public static int dpToPx(Context context, int dp) {
        DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        return Math.round(dp * metrics.density);
    }
}
