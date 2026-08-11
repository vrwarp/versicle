package com.vrwarp.versicle;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.content.pm.ApplicationInfo;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import java.io.File;

import androidx.activity.EdgeToEdge;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;

import android.content.Intent;
import android.util.Log;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;
import ee.forgr.capacitor.social.login.GoogleProvider;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;

public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {
    private static final String TAG = "MainActivity";

    /** SharedPreferences file holding the WebView-maintenance bookkeeping below. */
    private static final String WEBVIEW_PREFS = "versicle.webview";
    /** Last `PackageInfo.lastUpdateTime` the debug WebView-store reset ran for. */
    private static final String KEY_STORE_RESET_FOR_UPDATE = "storeResetForUpdateTime";

    /**
     * Chromium's `app_webview` stores (LevelDB + cache files) are opened once per PROCESS and stay
     * open for its whole lifetime, not per Activity. This flips on the first MainActivity created
     * in a process, so the debug reset below can tell "nothing has touched the WebView yet" from
     * "a WebView is already live in this process".
     */
    private static boolean webViewInitializedInProcess = false;

    /** Bounded automatic recovery from renderer death (see {@link RenderProcessGoneRecovery}). */
    private static final int MAX_RENDERER_RECOVERIES = 3;
    private static final long MIN_RENDERER_RECOVERY_INTERVAL_MS = 5_000L;
    private static int rendererRecoveries = 0;
    private static long lastRendererRecoveryAt = 0L;

    /**
     * Directory names under `app_webview` dropped by the debug-only store reset. "Service Worker"
     * holds the registration DB *and* the ScriptCache that serves sw.js; "HTTP Cache" is what the
     * old `new WebView(this).clearCache(true)` call cleared.
     */
    private static final String[] RESETTABLE_WEBVIEW_STORES = { "Service Worker", "HTTP Cache" };

    /** Visible for tests: the recovery listener handed to the bridge builder in onCreate. */
    WebViewListener renderProcessGoneListener;

    /** Visible for tests: the process-scoped state above outlives a Robolectric case. */
    static void resetProcessStateForTests() {
        webViewInitializedInProcess = false;
        rendererRecoveries = 0;
        lastRendererRecoveryAt = 0L;
    }

    private void clearWebViewStores(File dir) {
        if (dir == null || !dir.exists()) return;
        if (dir.isDirectory()) {
            for (String store : RESETTABLE_WEBVIEW_STORES) {
                if (dir.getName().equals(store)) {
                    deleteDir(dir);
                    return;
                }
            }
            File[] files = dir.listFiles();
            if (files != null) {
                for (File file : files) {
                    clearWebViewStores(file);
                }
            }
        }
    }

    private void deleteDir(File dir) {
        if (dir != null && dir.isDirectory()) {
            String[] children = dir.list();
            if (children != null) {
                for (String child : children) {
                    deleteDir(new File(dir, child));
                }
            }
        }
        if (dir != null) {
            dir.delete();
        }
    }

    /**
     * Debug-only: drop the WebView's Service Worker + HTTP cache stores so a freshly
     * `cap sync`-ed sw.js is re-read from the APK assets instead of being served out of
     * Chromium's ScriptCache (which otherwise keeps the old precache serving stale content).
     *
     * Both guards are load-bearing — this used to run unconditionally on every launch:
     *
     * 1. **First activity in the process only.** The process routinely outlives the Activity:
     *    `App.exitApp()` is `Activity.finish()`, which does not end the process, and Android
     *    keeps the emptied process cached (near-guaranteed while `MediaSession`'s
     *    `foregroundService: "always"` has been running). Re-launching then builds a new
     *    MainActivity inside a process where Chromium already holds these exact files open, and
     *    deleting them underneath it corrupts live LevelDB state — which takes the app down with
     *    no dialog on that launch, and works on the next one because the crash finally cleared
     *    the stale process.
     * 2. **Only after the APK actually changed.** The point is a post-`cap sync` reinstall, which
     *    is exactly what moves `PackageInfo.lastUpdateTime`. Doing it every launch also forced a
     *    full service-worker re-register plus re-precache on every cold start, and walked the
     *    whole `app_webview` tree on the main thread before the activity was even created.
     */
    private void resetWebViewStoresIfReinstalled() {
        if (webViewInitializedInProcess) {
            Log.i(TAG, "Skipping WebView store reset: a WebView is already live in this process");
            return;
        }
        try {
            long lastUpdateTime = getPackageManager().getPackageInfo(getPackageName(), 0).lastUpdateTime;
            SharedPreferences prefs = getSharedPreferences(WEBVIEW_PREFS, Context.MODE_PRIVATE);
            if (prefs.getLong(KEY_STORE_RESET_FOR_UPDATE, -1L) == lastUpdateTime) return;

            Log.i(TAG, "APK changed (lastUpdateTime=" + lastUpdateTime + "); resetting WebView stores");
            clearWebViewStores(new File(getApplicationInfo().dataDir, "app_webview"));
            prefs.edit().putLong(KEY_STORE_RESET_FOR_UPDATE, lastUpdateTime).apply();
        } catch (Exception e) {
            // Never fatal: a failed cache reset is a stale-asset annoyance, not a reason to
            // refuse to start. (The old code left `new WebView(this)` outside this catch, so a
            // momentarily unavailable WebView provider — e.g. while Play Store swaps the Android
            // System WebView package — threw straight out of onCreate and killed the launch.)
            Log.e(TAG, "Failed to reset WebView stores", e);
        }
    }

    /**
     * Keeps a WebView renderer death from taking the whole app down.
     *
     * `WebViewClient.onRenderProcessGone` must return true or the framework terminates the app
     * process outright, and Capacitor's BridgeWebViewClient returns false unless some registered
     * WebViewListener returns true — this app registered none. So a renderer OOM (boot runs the
     * library hydration, CRDT migrations and every background task at once, and Piper voice
     * models pin tens of MB) or an Android System WebView package update mid-session simply
     * ended the process with no dialog and no crash prompt: from the outside, the app "opened
     * and immediately exited".
     *
     * The dead WebView can never be used again, so it is detached and destroyed and the Activity
     * is recreated — a fresh Bridge and WebView reboot the web app. All state lives in
     * IndexedDB, so this is a reload, not data loss.
     *
     * Recovery is bounded: a renderer that dies again immediately (a genuinely unsurvivable
     * device-memory situation) would otherwise spin in a recreate loop, which is worse than
     * stopping. Past the budget the activity just finishes.
     */
    private final class RenderProcessGoneRecovery extends WebViewListener {
        @Override
        public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
            String cause = "unknown";
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail != null) {
                cause = detail.didCrash() ? "renderer crashed" : "renderer killed by the system (likely OOM)";
            }

            long now = android.os.SystemClock.elapsedRealtime();
            boolean withinBudget =
                rendererRecoveries < MAX_RENDERER_RECOVERIES &&
                (lastRendererRecoveryAt == 0L || now - lastRendererRecoveryAt >= MIN_RENDERER_RECOVERY_INTERVAL_MS);

            Log.e(TAG, "WebView render process gone (" + cause + "); recoveries=" + rendererRecoveries
                    + " -> " + (withinBudget ? "recreating activity" : "finishing activity"));

            ViewGroup parent = webView.getParent() instanceof ViewGroup ? (ViewGroup) webView.getParent() : null;
            if (parent != null) {
                parent.removeView(webView);
            }
            webView.destroy();

            if (isFinishing() || isDestroyed()) {
                return true;
            }

            if (withinBudget) {
                rendererRecoveries++;
                lastRendererRecoveryAt = now;
                restartAfterRendererLoss();
            } else {
                finish();
            }

            // True either way: the app decides what happens next, not the framework's
            // "terminate the process" default.
            return true;
        }
    }

    /**
     * How the app comes back after a renderer loss. Overridable so tests can observe the decision
     * without driving a real Activity relaunch.
     */
    void restartAfterRendererLoss() {
        recreate();
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        androidx.core.splashscreen.SplashScreen.installSplashScreen(this);

        boolean isDebug = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (isDebug) {
            resetWebViewStoresIfReinstalled();
        }
        webViewInitializedInProcess = true;

        // Registered on the builder rather than the bridge: BridgeActivity builds the Bridge (and
        // with it the WebView) inside super.onCreate() and copies the builder's listener list in
        // at that point, so this is the only way to be listening before the first page load.
        renderProcessGoneListener = new RenderProcessGoneRecovery();
        bridgeBuilder.addWebViewListener(renderProcessGoneListener);

        super.onCreate(savedInstanceState);
        EdgeToEdge.enable(this); // enable edge-to-edge mode
    }

    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode >= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MIN && requestCode < GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MAX) {
            PluginHandle pluginHandle = getBridge().getPlugin("SocialLogin");
            if (pluginHandle == null) {
                Log.i("Google Activity Result", "SocialLogin login handle is null");
                return;
            }
            Plugin plugin = pluginHandle.getInstance();
            if (!(plugin instanceof SocialLoginPlugin)) {
                Log.i("Google Activity Result", "SocialLogin plugin instance is not SocialLoginPlugin");
                return;
            }
            ((SocialLoginPlugin) plugin).handleGoogleLoginIntent(requestCode, data);
        }
    }

    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {}
}
