package com.vrwarp.versicle;

import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

import android.app.Application;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.os.IBinder;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import androidx.test.core.app.ApplicationProvider;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowApplication;
import org.robolectric.shadows.ShadowWebView;

import java.io.File;
import java.io.IOException;

import io.github.jofr.capacitor.mediasessionplugin.MediaSessionService;

/**
 * Launch-time survival tests for {@link MainActivity}.
 *
 * Both behaviours here exist because the app could vanish on launch and come back fine on the
 * very next try — the two ways that happened were the debug WebView-store reset running against
 * a process whose Chromium stack was already live, and an unhandled renderer death letting the
 * framework terminate the whole process.
 */
@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, shadows = {MainActivityTest.MyShadowServiceWorkerController.class})
public class MainActivityWebViewRecoveryTest {

    private static final String WEBVIEW_PREFS = "versicle.webview";
    private static final String KEY_STORE_RESET_FOR_UPDATE = "storeResetForUpdateTime";

    /** Records the restart decision instead of driving a real Activity relaunch. */
    public static class RecordingMainActivity extends MainActivity {
        boolean restarted = false;

        @Override
        void restartAfterRendererLoss() {
            restarted = true;
        }
    }

    @Before
    public void setup() {
        MainActivity.resetProcessStateForTests();

        Context context = ApplicationProvider.getApplicationContext();
        context.getSharedPreferences(WEBVIEW_PREFS, Context.MODE_PRIVATE).edit().clear().commit();

        // The debug-only store reset is gated on FLAG_DEBUGGABLE; the tests here are about that
        // path, so mark the application debuggable.
        context.getApplicationInfo().flags |= ApplicationInfo.FLAG_DEBUGGABLE;

        // Mock WebView package required by Capacitor Bridge
        PackageInfo packageInfo = new PackageInfo();
        packageInfo.packageName = "com.google.android.webview";
        packageInfo.versionName = "120.0.0.0";
        ShadowWebView.setCurrentWebViewPackage(packageInfo);

        // MediaSessionPlugin binds MediaSessionService on load (foregroundService: "always"),
        // so Robolectric needs a binder to hand back.
        MediaSessionService service = Robolectric.buildService(MediaSessionService.class).create().get();
        IBinder binder = service.onBind(new Intent());
        ShadowApplication shadowApplication = Shadows.shadowOf((Application) context);
        shadowApplication.setComponentNameAndServiceForBindService(
            new ComponentName(context, MediaSessionService.class),
            binder
        );
    }

    private File serviceWorkerDir() {
        Context context = ApplicationProvider.getApplicationContext();
        return new File(context.getApplicationInfo().dataDir, "app_webview/Default/Service Worker");
    }

    private File seedServiceWorkerStore() throws IOException {
        File dir = new File(serviceWorkerDir(), "ScriptCache");
        assertTrue("could not create the fake Service Worker store", dir.mkdirs());
        File entry = new File(dir, "sw-script.dat");
        assertTrue("could not create the fake ScriptCache entry", entry.createNewFile());
        return entry;
    }

    private void recordStoreResetForCurrentInstall() throws Exception {
        Context context = ApplicationProvider.getApplicationContext();
        long lastUpdateTime = context.getPackageManager()
            .getPackageInfo(context.getPackageName(), 0).lastUpdateTime;
        SharedPreferences prefs = context.getSharedPreferences(WEBVIEW_PREFS, Context.MODE_PRIVATE);
        prefs.edit().putLong(KEY_STORE_RESET_FOR_UPDATE, lastUpdateTime).commit();
    }

    @Test
    public void resetsWebViewStoresOnTheFirstLaunchAfterAnInstall() throws Exception {
        File entry = seedServiceWorkerStore();

        Robolectric.buildActivity(MainActivity.class).setup();

        assertFalse("the stale Service Worker store should have been dropped", entry.exists());
        assertFalse(serviceWorkerDir().exists());
    }

    @Test
    public void doesNotResetWebViewStoresAgainForTheSameInstall() throws Exception {
        recordStoreResetForCurrentInstall();
        File entry = seedServiceWorkerStore();

        Robolectric.buildActivity(MainActivity.class).setup();

        assertTrue(
            "the reset already ran for this APK; re-running it costs a full SW re-register every launch",
            entry.exists()
        );
    }

    @Test
    public void doesNotResetWebViewStoresWhenAWebViewIsAlreadyLiveInTheProcess() throws Exception {
        // First launch of the process: nothing to reset (already recorded for this APK).
        recordStoreResetForCurrentInstall();
        Robolectric.buildActivity(MainActivity.class).setup();

        // A second Activity in the SAME process, with the version gate now open. Chromium holds
        // app_webview open for the life of the process, so deleting underneath it is what killed
        // the relaunch after App.exitApp() left the process alive.
        ApplicationProvider.getApplicationContext()
            .getSharedPreferences(WEBVIEW_PREFS, Context.MODE_PRIVATE).edit().clear().commit();
        File entry = seedServiceWorkerStore();

        Robolectric.buildActivity(MainActivity.class).setup();

        assertTrue(
            "must not delete WebView stores out from under a Chromium stack that is already running",
            entry.exists()
        );
    }

    @Test
    public void rendererDeathRestartsTheAppInsteadOfLettingTheFrameworkKillIt() {
        RecordingMainActivity activity = Robolectric.buildActivity(RecordingMainActivity.class).setup().get();
        assertNotNull("the render-process-gone listener must be installed", activity.renderProcessGoneListener);

        WebView deadWebView = new WebView(activity);
        RenderProcessGoneDetail detail = mock(RenderProcessGoneDetail.class);
        when(detail.didCrash()).thenReturn(false);

        boolean handled = activity.renderProcessGoneListener.onRenderProcessGone(deadWebView, detail);

        assertTrue("returning false lets Android terminate the whole app process", handled);
        assertTrue("the dead WebView must be destroyed — it can never be used again",
            Shadows.shadowOf(deadWebView).wasDestroyCalled());
        assertTrue("the app should come back rather than disappear", activity.restarted);
        assertFalse(activity.isFinishing());
    }

    @Test
    public void rendererDeathStopsRestartingOnceTheRecoveryBudgetIsSpent() {
        RecordingMainActivity activity = Robolectric.buildActivity(RecordingMainActivity.class).setup().get();
        RenderProcessGoneDetail detail = mock(RenderProcessGoneDetail.class);
        when(detail.didCrash()).thenReturn(true);

        activity.renderProcessGoneListener.onRenderProcessGone(new WebView(activity), detail);
        assertTrue(activity.restarted);

        activity.restarted = false;
        boolean handled = activity.renderProcessGoneListener.onRenderProcessGone(new WebView(activity), detail);

        assertTrue("still handled — the framework must not take the process down", handled);
        assertFalse("a renderer dying again immediately must not spin in a recreate loop", activity.restarted);
        assertTrue(activity.isFinishing());
    }
}
