package com.khilvansh.whosetab;

import android.content.Context;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.view.WindowManager;
import org.json.JSONObject;

/**
 * Displays the floating Quick-Add WindowManager overlay for in-app previews
 * and non-restricted apps. Uses shared QuickAddCardBinder for consistent sync.
 */
public class PaymentOverlayManager {

    private static final String TAG = "WhoseTabOverlay";

    private static View currentOverlayView = null;
    private static WindowManager windowManager = null;
    private static final Handler mainHandler = new Handler(Looper.getMainLooper());

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
        if (currentOverlayView != null && windowManager != null) {
            try {
                windowManager.removeView(currentOverlayView);
            } catch (Exception ignored) {}
            currentOverlayView = null;
        }
    }

    private static void showOnMainThread(Context context, JSONObject data) {
        try {
            removeCurrentOverlay();

            windowManager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
            if (windowManager == null) return;

            LayoutInflater inflater = LayoutInflater.from(context);
            View root = inflater.inflate(R.layout.overlay_quick_add, null);

            QuickAddCardBinder.bind(context, root, data, PaymentOverlayManager::removeCurrentOverlay);

            int overlayType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;

            WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                QuickAddCardBinder.dpToPx(context, 304),
                WindowManager.LayoutParams.WRAP_CONTENT,
                overlayType,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                    | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                    | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT
            );
            params.gravity = Gravity.BOTTOM | Gravity.END;
            params.x = QuickAddCardBinder.dpToPx(context, 14);
            params.y = QuickAddCardBinder.dpToPx(context, 76);

            windowManager.addView(root, params);
            currentOverlayView = root;
        } catch (Exception e) {
            Log.e(TAG, "Failed to attach overlay window: " + e.getMessage());
        }
    }
}
