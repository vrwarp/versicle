package com.vrwarp.versicle;

import static org.junit.Assert.*;

import android.app.Application;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.os.IBinder;

import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.shadows.ShadowApplication;
import org.robolectric.shadows.ShadowWebView;
import org.robolectric.annotation.Config;

import com.getcapacitor.BridgeActivity;

import io.github.jofr.capacitor.mediasessionplugin.MediaSessionService;

@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, sdk = 34)
public class MainActivityTest {

    @Before
    public void setup() {
        // Mock WebView package required by Capacitor Bridge
        PackageInfo packageInfo = new PackageInfo();
        packageInfo.packageName = "com.google.android.webview";
        packageInfo.versionName = "120.0.0.0";

        ShadowWebView.setCurrentWebViewPackage(packageInfo);

        // Fix for MediaSessionService binding in Robolectric
        try {
            MediaSessionService service = Robolectric.buildService(MediaSessionService.class).create().get();
            IBinder binder = service.onBind(new Intent());

            ShadowApplication shadowApplication = Shadows.shadowOf((Application) ApplicationProvider.getApplicationContext());
            shadowApplication.setComponentNameAndServiceForBindService(
                new ComponentName(ApplicationProvider.getApplicationContext(), MediaSessionService.class),
                binder
            );
        } catch (Exception e) {
            // Ignore service binding errors in test context if service class issues arise
            System.out.println("Warning: Failed to mock MediaSessionService: " + e.getMessage());
        }
    }

    @Test
    public void activityShouldStart() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                assertNotNull(activity);
                assertTrue(activity instanceof BridgeActivity);
                assertNotNull(activity.getBridge());
            });
        }
    }
}
