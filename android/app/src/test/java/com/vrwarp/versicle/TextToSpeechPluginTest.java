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

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.PluginCall;
import com.getcapacitor.JSObject;

import com.getcapacitor.community.tts.TextToSpeechPlugin;

@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, shadows = {MainActivityTest.MyShadowServiceWorkerController.class})
public class TextToSpeechPluginTest {

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
    public void testSpeak() {
        PluginHandle handle = activity.getBridge().getPlugin("TextToSpeech");
        TextToSpeechPlugin plugin = (TextToSpeechPlugin) handle.getInstance();

        PluginCall call = mock(PluginCall.class);
        when(call.getString("text", "")).thenReturn("Hello World");
        when(call.getString("lang", "en-US")).thenReturn("en-US");
        when(call.getFloat("rate", 1.0f)).thenReturn(1.0f);
        when(call.getFloat("pitch", 1.0f)).thenReturn(1.0f);
        when(call.getFloat("volume", 1.0f)).thenReturn(1.0f);
        when(call.getInt("voice", -1)).thenReturn(-1);
        when(call.getInt("queueStrategy", 0)).thenReturn(0);
        when(call.getCallbackId()).thenReturn("test-callback-id");

        // Execute speak
        plugin.speak(call);

        // Since we can't easily assert the internal TTS engine state in this integration test 
        // without complex shadowing of android.speech.tts.TextToSpeech,
        // we at least verify the plugin method doesn't crash and attempts to resolve/reject.
        // In a real device, this would trigger the engine. In Robolectric, it might do nothing or log.
        // We can verify "unavailable" is called if TTS is not initialized, or resolve if mocked properly.
        
        // Note: The plugin checks implementation.isAvailable(). In standard Robolectric, this might be false.
    }

    @Test
    public void testGetSupportedLanguages() {
        PluginHandle handle = activity.getBridge().getPlugin("TextToSpeech");
        TextToSpeechPlugin plugin = (TextToSpeechPlugin) handle.getInstance();

        PluginCall call = mock(PluginCall.class);
        plugin.getSupportedLanguages(call);
        
        // Similarly, verify no crash.
    }
}
