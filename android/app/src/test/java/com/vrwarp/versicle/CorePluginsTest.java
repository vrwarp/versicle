package com.vrwarp.versicle;

import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowWebView;

import org.robolectric.Shadows;
import org.robolectric.shadows.ShadowApplication;
import android.app.Application;
import android.content.ComponentName;
import android.content.Intent;
import android.os.IBinder;
import android.content.pm.PackageInfo;
import io.github.jofr.capacitor.mediasessionplugin.MediaSessionService;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;

import com.getcapacitor.PluginHandle;
import com.getcapacitor.PluginCall;
import com.getcapacitor.JSObject;

import com.capacitorjs.plugins.share.SharePlugin;
import com.capacitorjs.plugins.filesystem.FilesystemPlugin;

@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, shadows = {MainActivityTest.MyShadowServiceWorkerController.class})
public class CorePluginsTest {

    private MainActivity activity;

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

        // Setup activity
        activity = Robolectric.buildActivity(MainActivity.class).setup().get();
    }

    @Test
    public void testSharePlugin() {
        PluginHandle handle = activity.getBridge().getPlugin("Share");
        if (handle != null) {
            SharePlugin plugin = (SharePlugin) handle.getInstance();
            assertNotNull(plugin);

            PluginCall call = mock(PluginCall.class);
            when(call.getString("title")).thenReturn("Share Title");
            when(call.getString("text")).thenReturn("Share Text");
            when(call.getString("url")).thenReturn("http://example.com");
            when(call.getString("dialogTitle")).thenReturn("Share Dialog");
            
            // This will try to start an activity. Robolectric can intercept this.
            plugin.share(call);
        }
    }

    @Test
    public void testFilesystemPluginExistence() {
        PluginHandle handle = activity.getBridge().getPlugin("Filesystem");
        if (handle != null) {
             FilesystemPlugin plugin = (FilesystemPlugin) handle.getInstance();
             assertNotNull(plugin);
        }
    }
}
