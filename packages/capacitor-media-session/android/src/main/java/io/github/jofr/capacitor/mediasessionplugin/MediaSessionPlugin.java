package io.github.jofr.capacitor.mediasessionplugin;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.IBinder;
import android.util.Base64;
import android.util.Log;

import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.common.SimpleBasePlayer;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@CapacitorPlugin(name = "MediaSession")
public class MediaSessionPlugin extends Plugin {
    private static final String TAG = "MediaSessionPlugin";

    private boolean startServiceOnlyDuringPlayback = true;

    private String title = "";
    private String artist = "";
    private String album = "";
    private byte[] artworkData = null;
    private String playbackState = "none";
    private double duration = 0.0;
    private double position = 0.0;
    private double playbackRate = 1.0;
    private final Set<String> supportedActions = new HashSet<>();

    private MediaSessionService service = null;

    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName componentName, IBinder iBinder) {
            Log.i(TAG, "ServiceConnection: onServiceConnected fired. Binding proxy player.");
            MediaSessionService.LocalBinder binder = (MediaSessionService.LocalBinder) iBinder;
            service = binder.getService();
            service.getPlayer().setActionCallback((action, data) -> actionCallback(action, data));
            updateProxyPlayerState();
        }

        @Override
        public void onServiceDisconnected(ComponentName componentName) {
            Log.w(TAG, "ServiceConnection: onServiceDisconnected fired. Service lost.");
        }
    };

    @Override
    public void load() {
        super.load();

        final String foregroundServiceConfig = getConfig().getString("foregroundService", "");
        if (foregroundServiceConfig.equals("always")) {
            startServiceOnlyDuringPlayback = false;
        }
        Log.i(TAG, "load(): foregroundService config='" + foregroundServiceConfig
                + "' startServiceOnlyDuringPlayback=" + startServiceOnlyDuringPlayback
                + " -> " + (startServiceOnlyDuringPlayback ? "service starts on first playback" : "binding service now"));

        if (!startServiceOnlyDuringPlayback) {
            startMediaService();
        }
    }

    public void startMediaService() {
        Log.i(TAG, "startMediaService: bindService(MediaSessionService, BIND_AUTO_CREATE)");
        Intent intent = new Intent(getActivity(), MediaSessionService.class);
        getContext().bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE);
    }

    /**
     * Long-edge cap (px) for media-session artwork. Oversized bitmaps crossing
     * the Binder to the platform MediaSession have been observed to crash
     * com.android.bluetooth's AVRCP layer; the system downscales artwork for
     * the notification/lock screen anyway, so a 512px cap is lossless in practice.
     */
    static final int MAX_ARTWORK_EDGE_PX = 512;
    static final int ARTWORK_JPEG_QUALITY = 85;

    /**
     * Pure dimension math (unit-tested): scale {@code width}x{@code height} so the
     * long edge is at most {@code maxEdge}, preserving aspect ratio and never
     * upscaling. Returns {@code [width, height]} unchanged when already within bounds.
     */
    static int[] computeScaledDimensions(int width, int height, int maxEdge) {
        if (width <= 0 || height <= 0) return new int[] { width, height };
        int longEdge = Math.max(width, height);
        if (longEdge <= maxEdge) return new int[] { width, height };
        double scale = (double) maxEdge / (double) longEdge;
        int w = Math.max(1, (int) Math.round(width * scale));
        int h = Math.max(1, (int) Math.round(height * scale));
        return new int[] { w, h };
    }

    private byte[] bitmapToByteArray(Bitmap bitmap) {
        if (bitmap == null) {
            Log.w(TAG, "Artwork: decode produced a null bitmap (unsupported/corrupt source)");
            return null;
        }
        int[] dims = computeScaledDimensions(bitmap.getWidth(), bitmap.getHeight(), MAX_ARTWORK_EDGE_PX);
        Bitmap scaled = (dims[0] == bitmap.getWidth() && dims[1] == bitmap.getHeight())
                ? bitmap
                : Bitmap.createScaledBitmap(bitmap, dims[0], dims[1], true);
        ByteArrayOutputStream stream = new ByteArrayOutputStream();
        // JPEG, not PNG: book covers are opaque (no alpha to preserve), and JPEG keeps
        // the encoded artwork comfortably under the Binder transaction limit.
        scaled.compress(Bitmap.CompressFormat.JPEG, ARTWORK_JPEG_QUALITY, stream);
        if (scaled != bitmap) scaled.recycle();
        byte[] out = stream.toByteArray();
        Log.d(TAG, "Artwork: " + bitmap.getWidth() + "x" + bitmap.getHeight() + " -> "
                + dims[0] + "x" + dims[1] + " JPEG q" + ARTWORK_JPEG_QUALITY + " = " + (out.length / 1024) + "KB");
        return out;
    }

    private byte[] urlToArtworkData(String url) throws IOException {
        final boolean blobUrl = url.startsWith("blob:");
        if (blobUrl) {
            Log.i(TAG, "Converting Blob URLs to Bitmap for media artwork is not yet supported");
        }

        final boolean httpUrl = url.startsWith("http");
        if (httpUrl) {
            HttpURLConnection connection = (HttpURLConnection) (new URL(url)).openConnection();
            connection.setConnectTimeout(3000); // 3 seconds
            connection.setReadTimeout(3000);    // 3 seconds
            connection.setDoInput(true);
            connection.connect();

            try (InputStream inputStream = connection.getInputStream()) {
                Bitmap bitmap = BitmapFactory.decodeStream(inputStream);
                return bitmapToByteArray(bitmap);
            }
        }

        int base64Index = url.indexOf(";base64,");
        if (base64Index != -1) {
            String base64Data = url.substring(base64Index + 8);
            byte[] decoded = Base64.decode(base64Data, Base64.DEFAULT);
            Bitmap bitmap = BitmapFactory.decodeByteArray(decoded, 0, decoded.length);
            return bitmapToByteArray(bitmap);
        }

        return null;
    }

    private void updateProxyPlayerState() {
        if (service == null || service.getPlayer() == null) {
            // State arrived before the service bound — it is dropped (the next state push after
            // onServiceConnected re-syncs). If metadata/playback never appear, look for this line.
            Log.w(TAG, "updateProxyPlayerState: service not bound yet — dropping state update (playbackState="
                    + playbackState + ", title=" + title + ")");
            return;
        }

        getActivity().runOnUiThread(() -> {
            service.getPlayer().updateState(
                title, artist, album, artworkData,
                playbackState, duration, position,
                playbackRate, supportedActions
            );
        });
    }

    @PluginMethod
    public void setMetadata(PluginCall call) throws JSONException, IOException {
        Log.d(TAG, "JS Bridge -> setMetadata() called: title=" + call.getString("title", "null"));
        title = call.getString("title", title);
        artist = call.getString("artist", artist);
        album = call.getString("album", album);

        final JSArray artworkArray = call.getArray("artwork");
        if (artworkArray != null) {
            final List<JSONObject> artworkList = artworkArray.toList();
            for (JSONObject artwork : artworkList) {
                String src = artwork.getString("src");
                if (src != null) {
                    this.artworkData = urlToArtworkData(src);
                }
            }
        }

        if (this.artworkData != null) {
            int sizeKb = this.artworkData.length / 1024;
            Log.i(TAG, "Artwork decoded. Size: " + sizeKb + " KB");
            if (sizeKb > 500) {
                Log.w(TAG, "WARNING: Artwork size exceeds 500KB. High risk of Binder IPC timeout!");
            }
        } else {
            Log.d(TAG, "No artwork data resolved.");
        }

        updateProxyPlayerState();
        call.resolve();
    }

    @PluginMethod
    public void setPlaybackState(PluginCall call) {
        String newState = call.getString("playbackState", playbackState);
        Log.d(TAG, "JS Bridge -> setPlaybackState() called. New state: " + newState + " | Old state: " + playbackState);
        playbackState = newState;

        final boolean playback = playbackState.equals("playing") || playbackState.equals("paused");

        if (service == null && playback) {
            startMediaService();
        } else if (service != null) {
            updateProxyPlayerState();
        }

        call.resolve();
    }

    @PluginMethod
    public void setPositionState(PluginCall call) {
        Log.d(TAG, "JS Bridge -> setPositionState() called. Position: " + call.getDouble("position", 0.0));
        duration = call.getDouble("duration", 0.0);
        position = call.getDouble("position", 0.0);
        playbackRate = call.getFloat("playbackRate", 1.0F);

        updateProxyPlayerState();
        call.resolve();
    }

    @PluginMethod
    public void setActionHandler(PluginCall call) {
        String action = call.getString("action");
        if (action != null) {
            supportedActions.add(action);
            Log.d(TAG, "JS Bridge -> setActionHandler('" + action + "'). supportedActions=" + supportedActions);
            updateProxyPlayerState();
        }
        call.resolve();
    }

    public boolean hasActionHandler(String action) {
        return supportedActions.contains(action);
    }

    public void actionCallback(String action) {
        actionCallback(action, new JSObject());
    }

    public void actionCallback(String action, JSObject data) {
        if (supportedActions.contains(action)) {
            // hasListeners distinguishes "JS never attached the onMediaAction listener" (a startup
            // race) from "JS got it but the engine call failed" — the two indistinguishable halves
            // of a control that does nothing.
            Log.i(TAG, "Native -> JS Bridge: Emitting onMediaAction -> " + action
                    + " (jsListenerAttached=" + hasListeners("onMediaAction") + ")");
            data.put("action", action);
            notifyListeners("onMediaAction", data);
        } else {
            Log.w(TAG, "onMediaAction DROPPED: action '" + action + "' not in supportedActions="
                    + supportedActions + " (registration race or never registered) — control will do nothing");
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (service != null) {
            try {
                getContext().unbindService(serviceConnection);
            } catch (IllegalArgumentException e) {
                // Ignored: Service was not registered
            }
            service = null;
        }
        super.handleOnDestroy();
    }
    
    // Package-private getters for ProxyPlayer to build its state
    String getTitle() { return title; }
    String getArtist() { return artist; }
    String getAlbum() { return album; }
    byte[] getArtworkData() { return artworkData; }
    String getPlaybackState() { return playbackState; }
    double getDuration() { return duration; }
    double getPosition() { return position; }
    double getPlaybackRate() { return playbackRate; }
}
