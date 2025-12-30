package com.vrwarp.versicle;

import static org.junit.Assert.*;

import android.app.Application;
import android.content.pm.PackageInfo;

import androidx.test.core.app.ApplicationProvider;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.shadows.ShadowApplication;
import org.robolectric.shadows.ShadowWebView;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;

import com.getcapacitor.BridgeActivity;

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
    }

    @Test
    public void activityShouldCreate() {
        // Just verify creation to ensure the Activity class load and basic initialization works.
        // We avoid calling setup() (which triggers onStart/onResume) to prevent issues with
        // EdgeToEdge initialization in Robolectric environment.
        ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class).create();
        MainActivity activity = controller.get();

        assertNotNull(activity);
        assertTrue(activity instanceof BridgeActivity);
    }
}
