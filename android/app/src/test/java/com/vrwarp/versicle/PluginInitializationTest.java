package com.vrwarp.versicle;

import static org.junit.Assert.*;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowApplication;
import org.robolectric.shadows.ShadowWebView;
import org.robolectric.android.controller.ActivityController;

import android.app.Application;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.os.IBinder;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

import io.github.jofr.capacitor.mediasessionplugin.MediaSessionService;

import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;

@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, shadows = {MainActivityTest.MyShadowServiceWorkerController.class})
public class PluginInitializationTest {

    @Before
    public void setup() {
        // Initialize FirebaseApp for testing
        if (FirebaseApp.getApps(androidx.test.core.app.ApplicationProvider.getApplicationContext()).isEmpty()) {
            FirebaseOptions options = new FirebaseOptions.Builder()
                .setApiKey("test-api-key")
                .setApplicationId("test-app-id")
                .setProjectId("test-project-id")
                .build();
            FirebaseApp.initializeApp(androidx.test.core.app.ApplicationProvider.getApplicationContext(), options);
        }

        // Mock WebView package required by Capacitor Bridge
        PackageInfo packageInfo = new PackageInfo();
        packageInfo.packageName = "com.google.android.webview";
        packageInfo.versionName = "120.0.0.0";
        ShadowWebView.setCurrentWebViewPackage(packageInfo);

        // Fix for MediaSessionService binding
        MediaSessionService service = Robolectric.buildService(MediaSessionService.class).create().get();
        IBinder binder = service.onBind(new Intent());
        ShadowApplication shadowApplication = Shadows.shadowOf((Application) androidx.test.core.app.ApplicationProvider.getApplicationContext());
        shadowApplication.setComponentNameAndServiceForBindService(
            new ComponentName(androidx.test.core.app.ApplicationProvider.getApplicationContext(), MediaSessionService.class),
            binder
        );
    }

    @Test
    public void verifyCriticalPluginsInitialized() {
        ActivityController<MainActivity> controller = Robolectric.buildActivity(MainActivity.class).setup();
        MainActivity activity = controller.get();

        // Verify TextToSpeech plugin
        PluginHandle ttsPlugin = activity.getBridge().getPlugin("TextToSpeech");
        assertNotNull("TextToSpeech plugin should be initialized", ttsPlugin);
        
        // Verify MediaSession plugin
        PluginHandle mediaSessionPlugin = activity.getBridge().getPlugin("MediaSession");
        assertNotNull("MediaSession plugin should be initialized", mediaSessionPlugin);

        // Verify FirebaseAuthentication plugin
        PluginHandle authPlugin = activity.getBridge().getPlugin("FirebaseAuthentication");
        assertNotNull("FirebaseAuthentication plugin should be initialized", authPlugin);
    }
}
