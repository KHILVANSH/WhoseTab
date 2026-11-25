package com.khilvansh.whosetab;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import androidx.appcompat.app.AppCompatActivity;
import org.json.JSONObject;

/**
 * Compact floating Activity card anchored to the bottom-right corner.
 * Because it is an Activity window rather than TYPE_APPLICATION_OVERLAY,
 * Android renders it smoothly even on top of apps using HIDE_OVERLAY_WINDOWS (such as Paytm).
 */
public class QuickAddPopupActivity extends AppCompatActivity {

    public static final String EXTRA_PAYMENT_JSON = "extra_payment_json";

    public static Intent buildIntent(Context context, JSONObject data) {
        Intent intent = new Intent(context, QuickAddPopupActivity.class);
        intent.putExtra(EXTRA_PAYMENT_JSON, data.toString());
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_NO_ANIMATION
                | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS);
        return intent;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureFloatingWindow();
        setContentView(R.layout.overlay_quick_add);
        bindFromIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        bindFromIntent(intent);
    }

    private void configureFloatingWindow() {
        Window window = getWindow();
        if (window == null) return;
        window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        window.addFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH);

        boolean isLandscape = getResources().getConfiguration().orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE;
        WindowManager.LayoutParams lp = window.getAttributes();
        lp.gravity = Gravity.BOTTOM | Gravity.END;
        lp.x = QuickAddCardBinder.dpToPx(this, isLandscape ? 20 : 14);
        lp.y = QuickAddCardBinder.dpToPx(this, isLandscape ? 20 : 76);
        lp.width = QuickAddCardBinder.dpToPx(this, 304);
        lp.height = WindowManager.LayoutParams.WRAP_CONTENT;
        lp.dimAmount = 0f;
        window.setAttributes(lp);
    }

    @Override
    public void onConfigurationChanged(android.content.res.Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        configureFloatingWindow();
    }

    private void bindFromIntent(Intent intent) {
        if (intent == null) {
            finish();
            return;
        }
        String jsonStr = intent.getStringExtra(EXTRA_PAYMENT_JSON);
        if (jsonStr == null || jsonStr.isEmpty()) {
            finish();
            return;
        }
        try {
            JSONObject data = new JSONObject(jsonStr);
            View root = findViewById(R.id.overlayCardRoot);
            if (root == null) {
                finish();
                return;
            }
            QuickAddCardBinder.bind(this, root, data, () -> {
                if (!isFinishing()) {
                    finish();
                    overridePendingTransition(0, 0);
                }
            });
        } catch (Exception e) {
            finish();
        }
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        if (event != null && event.getAction() == MotionEvent.ACTION_OUTSIDE) {
            finish();
            overridePendingTransition(0, 0);
            return true;
        }
        return super.onTouchEvent(event);
    }
}
