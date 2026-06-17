package io.github.jofr.capacitor.mediasessionplugin;

import android.content.Intent;
import android.os.Binder;
import android.os.IBinder;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.media3.common.Player;
import androidx.media3.session.MediaSession;

public class MediaSessionService extends androidx.media3.session.MediaSessionService {
    private static final String TAG = "MediaSessionService";

    private MediaSession mediaSession;
    private WebViewProxyPlayer player;

    private final IBinder binder = new LocalBinder();

    public final class LocalBinder extends Binder {
        MediaSessionService getService() {
            return MediaSessionService.this;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        Log.i(TAG, "Service onCreate() fired. Building MediaSession.");
        this.player = new WebViewProxyPlayer();
        this.mediaSession = new MediaSession.Builder(this, player).build();
        // Register the session with the service. This is what attaches Media3's
        // MediaNotificationManager (and its internal notification controller) to the
        // session, which drives onUpdateNotification -> startForeground. Without it,
        // addSession() would only run when an external MediaController connects via
        // SERVICE_INTERFACE / onStartCommand handles a media button — neither of which
        // this plugin triggers (it binds with an actionless intent + a LocalBinder),
        // so the media notification / lock-screen controls never appear.
        addSession(mediaSession);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Preserve Media3's media-button / foreground handling, but do not let the OS
        // resurrect a sessionless zombie: this proxy mirrors WebView-produced audio and
        // has no native resume path, so a restarted service would sit idle.
        super.onStartCommand(intent, flags, startId);
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(@Nullable Intent rootIntent) {
        // WebView-produced audio cannot resume from a backgrounded/killed service, so
        // when the task is swiped away and we are not actively playing, stop the service
        // rather than leaving a dead notification behind.
        if (player == null
                || player.getPlaybackState() == Player.STATE_IDLE
                || !player.getPlayWhenReady()) {
            stopSelf();
        }
        super.onTaskRemoved(rootIntent);
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (androidx.media3.session.MediaSessionService.SERVICE_INTERFACE.equals(action)) {
            return super.onBind(intent);
        }
        return binder;
    }

    @Nullable
    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return mediaSession;
    }

    @Override
    public void onDestroy() {
        Log.i(TAG, "Service onDestroy() fired. Releasing MediaSession.");
        if (mediaSession != null) {
            mediaSession.getPlayer().release();
            mediaSession.release();
            mediaSession = null;
        }
        super.onDestroy();
    }

    public WebViewProxyPlayer getPlayer() {
        return player;
    }
}
