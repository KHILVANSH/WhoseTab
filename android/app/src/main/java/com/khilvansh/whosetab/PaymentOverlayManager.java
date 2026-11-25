package com.khilvansh.whosetab;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Displays a compact floating Quick-Add toast overlay at the bottom-right corner
 * of the screen when a payment is detected in the background.
 */
public class PaymentOverlayManager {

    private static final String TAG = "WhoseTabOverlay";
    private static final long AUTO_HIDE_MS = 22000L;

    private static View currentOverlayView = null;
    private static WindowManager windowManager = null;
    private static final Handler mainHandler = new Handler(Looper.getMainLooper());
    private static Runnable autoDismissRunnable = null;

    public static void showPaymentToast(Context context, JSONObject paymentData) {
        if (context == null || paymentData == null) return;
        final Context appCtx = context.getApplicationContext();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(appCtx)) {
            Log.w(TAG, "Cannot draw overlay: SYSTEM_ALERT_WINDOW not granted");
            return;
        }

        mainHandler.post(() -> showOnMainThread(appCtx, paymentData));
    }

    public static void dismiss() {
        mainHandler.post(PaymentOverlayManager::removeCurrentOverlay);
    }

    private static void removeCurrentOverlay() {
        if (autoDismissRunnable != null) {
            mainHandler.removeCallbacks(autoDismissRunnable);
            autoDismissRunnable = null;
        }
        if (currentOverlayView != null && windowManager != null) {
            try {
                windowManager.removeView(currentOverlayView);
            } catch (Exception ignored) {}
            currentOverlayView = null;
        }
    }

    private static void resetAutoHideTimer() {
        if (autoDismissRunnable != null) {
            mainHandler.removeCallbacks(autoDismissRunnable);
        }
        autoDismissRunnable = PaymentOverlayManager::removeCurrentOverlay;
        mainHandler.postDelayed(autoDismissRunnable, AUTO_HIDE_MS);
    }

    private static void showOnMainThread(Context context, JSONObject data) {
        try {
            removeCurrentOverlay();

            windowManager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
            if (windowManager == null) return;

            LayoutInflater inflater = LayoutInflater.from(context);
            View root = inflater.inflate(R.layout.overlay_quick_add, null);

            String type = data.optString("type", "expense");
            double amount = data.optDouble("amount", 0.0);
            boolean isRepayment = "repayment".equals(type);
            String counterparty = isRepayment
                ? data.optString("sender", "Someone")
                : data.optString("recipient", "Merchant");

            TextView titleTv = root.findViewById(R.id.overlayTitle);
            TextView subtitleTv = root.findViewById(R.id.overlaySubtitle);
            TextView closeBtn = root.findViewById(R.id.overlayCloseBtn);
            LinearLayout contactsContainer = root.findViewById(R.id.overlayContactsContainer);
            LinearLayout chipsList = root.findViewById(R.id.overlayChipsList);
            TextView includeMeChip = root.findViewById(R.id.overlayIncludeMeChip);
            TextView openAppBtn = root.findViewById(R.id.overlayOpenAppBtn);
            TextView quickAddBtn = root.findViewById(R.id.overlayQuickAddBtn);

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

            // Populate quick-add contacts
            if (!isRepayment) {
                JSONArray synced = PaymentDataStore.getSyncedContacts(context);
                if (synced.length() == 0) {
                    contactsContainer.setVisibility(View.GONE);
                    quickAddBtn.setText("Split in App");
                } else {
                    contactsContainer.setVisibility(View.VISIBLE);
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
                        chip.setTextColor(Color.parseColor("#E4E4E7"));
                        chip.setBackgroundResource(R.drawable.overlay_chip_bg);
                        chip.setGravity(Gravity.CENTER);
                        int hPad = dpToPx(context, 12);
                        chip.setPadding(hPad, 0, hPad, 0);

                        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                            LinearLayout.LayoutParams.WRAP_CONTENT,
                            dpToPx(context, 32)
                        );
                        lp.setMarginEnd(dpToPx(context, 6));
                        chip.setLayoutParams(lp);

                        chip.setOnClickListener(v -> {
                            resetAutoHideTimer();
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
                        resetAutoHideTimer();
                        includeMe[0] = !includeMe[0];
                        includeMeChip.setSelected(includeMe[0]);
                        includeMeChip.setTextColor(Color.parseColor(includeMe[0] ? "#FFFFFF" : "#D4D4D8"));
                    });
                }
            }

            // Close / Dismiss
            closeBtn.setOnClickListener(v -> {
                dismissPayment(context, data, isRepayment);
                removeCurrentOverlay();
            });

            // Left Button ("Open App" for expenses, "Dismiss" for repayment)
            openAppBtn.setOnClickListener(v -> {
                if (isRepayment) {
                    dismissPayment(context, data, true);
                    removeCurrentOverlay();
                } else {
                    removeCurrentOverlay();
                    launchMainAppWithData(context, data, false);
                }
            });

            // Right Primary Button
            quickAddBtn.setOnClickListener(v -> {
                if (isRepayment) {
                    removeCurrentOverlay();
                    launchMainAppWithData(context, data, true);
                    return;
                }

                if (contactObjects.isEmpty()) {
                    removeCurrentOverlay();
                    launchMainAppWithData(context, data, false);
                    return;
                }

                if (selectedPersonIds.isEmpty()) {
                    // Prompt cleanly or open app if user wants full chooser
                    Toast.makeText(context, "Select a contact chip above or tap Open App", Toast.LENGTH_SHORT).show();
                    resetAutoHideTimer();
                    return;
                }

                // Commit quick-add expense to queue and clear pending payment
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
                        long cents = perCents + (!includeMe[0] && idx < remainderCents ? 1 : (includeMe[0] && idx < (remainderCents) ? 1 : 0));
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

                    String namesJoined = android.text.TextUtils.join(", ", chosenNames);
                    Toast.makeText(
                        context,
                        String.format(Locale.US, "Added ₹%.2f to %s", amount, namesJoined),
                        Toast.LENGTH_SHORT
                    ).show();
                } catch (Exception e) {
                    Log.e(TAG, "Error queueing quick expense", e);
                }

                removeCurrentOverlay();
            });

            // Swipe horizontally to dismiss
            final float[] downX = new float[1];
            root.setOnTouchListener((v, event) -> {
                resetAutoHideTimer();
                if (event.getAction() == MotionEvent.ACTION_DOWN) {
                    downX[0] = event.getRawX();
                } else if (event.getAction() == MotionEvent.ACTION_UP) {
                    float deltaX = event.getRawX() - downX[0];
                    if (Math.abs(deltaX) > dpToPx(context, 90)) {
                        dismissPayment(context, data, isRepayment);
                        removeCurrentOverlay();
                        return true;
                    }
                }
                return false;
            });

            int overlayType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;

            WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                dpToPx(context, 304),
                WindowManager.LayoutParams.WRAP_CONTENT,
                overlayType,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                    | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                    | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT
            );
            params.gravity = Gravity.BOTTOM | Gravity.END;
            params.x = dpToPx(context, 14);
            params.y = dpToPx(context, 76);

            windowManager.addView(root, params);
            currentOverlayView = root;
            resetAutoHideTimer();
        } catch (Exception e) {
            Log.e(TAG, "Failed to attach overlay window: " + e.getMessage());
        }
    }

    private static void updateQuickAddButtonLabel(TextView btn, Set<String> selectedIds, List<JSONObject> contacts) {
        if (selectedIds.isEmpty()) {
            btn.setText("Quick Add");
            btn.setAlpha(0.7f);
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
            openIntent.putExtra("paytm_note", data.optString("rawText", ""));
            openIntent.putExtra("paytm_postTime", data.optLong("postTime", 0L));
        } else {
            openIntent.putExtra("paytm_amount", data.optDouble("amount", 0.0));
            openIntent.putExtra("paytm_recipient", data.optString("recipient", "Merchant"));
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

    private static int dpToPx(Context context, int dp) {
        DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        return Math.round(dp * metrics.density);
    }
}
