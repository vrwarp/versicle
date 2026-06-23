package com.vrwarp.versicle;

import android.os.Bundle;
import android.content.pm.ApplicationInfo;
import android.webkit.WebView;
import java.io.File;

import androidx.activity.EdgeToEdge;

import com.getcapacitor.BridgeActivity;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;

import android.content.Intent;
import android.util.Log;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;
import ee.forgr.capacitor.social.login.GoogleProvider;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;

public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {
    private void clearServiceWorkers(File dir) {
        if (dir == null || !dir.exists()) return;
        if (dir.isDirectory()) {
            if (dir.getName().equals("Service Worker")) {
                deleteDir(dir);
                return;
            }
            File[] files = dir.listFiles();
            if (files != null) {
                for (File file : files) {
                    clearServiceWorkers(file);
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

    @Override
    public void onCreate(Bundle savedInstanceState) {
        androidx.core.splashscreen.SplashScreen.installSplashScreen(this);

        // On debug builds, clear the WebView cache and the Service Worker directory
        // so that the service worker script (sw.js) is re-read from the updated APK
        // assets after each `cap sync`. Without this, the Android WebView's internal
        // HTTP/ScriptCache returns the stale sw.js and the old precache serves stale content.
        boolean isDebug = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (isDebug) {
            try {
                File appWebviewDir = new File(getApplicationInfo().dataDir, "app_webview");
                clearServiceWorkers(appWebviewDir);
            } catch (Exception e) {
                Log.e("MainActivity", "Failed to clear Service Worker directory", e);
            }
            new WebView(this).clearCache(true);
        }

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
