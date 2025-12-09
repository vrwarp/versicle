package com.vrwarp.versicle;

import static org.junit.Assert.*;

import android.content.pm.PackageInfo;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.shadows.ShadowWebView;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;

import com.getcapacitor.BridgeActivity;

@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE)
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
    public void activityShouldStart() {
        ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class).setup();
        MainActivity activity = controller.get();

        assertNotNull(activity);
        assertTrue(activity instanceof BridgeActivity);
    }

    @Test
    public void bridgeShouldBeInitialized() {
        ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class).setup();
        MainActivity activity = controller.get();

        // Check if bridge is initialized
        assertNotNull(activity.getBridge());
    }
}
