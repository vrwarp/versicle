package io.github.jofr.capacitor.mediasessionplugin;

import android.content.Intent;
import android.os.Binder;
import android.os.IBinder;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationManagerCompat;
import androidx.media3.common.Player;
import androidx.media3.session.MediaSession;

import java.util.concurrent.atomic.AtomicInteger;

public class MediaSessionService extends androidx.media3.session.MediaSessionService {
    private static final String TAG = "MediaSessionService";

    // Media3 requires every live MediaSession in the process to have a unique id; the
    // default is the empty string, which collides (IllegalStateException "Session ID must
    // be unique") if a second service instance builds a session before the previous one is
    // released — a service-recreate race on device, and routine across tests sharing a JVM.
    private static final AtomicInteger SESSION_COUNTER = new AtomicInteger(0);

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
        // Make the silently-swallowed Android 12+ foreground-service-start denial visible. Media3
        // catches ForegroundServiceStartNotAllowedException internally and (with no listener)
        // posts NOTHING — so "no notification" and "FGS denied" look identical in logcat without
        // this hook. NOTE: under capacitor.config foregroundService:"always" the service is bound
        // at app launch (foreground), so onCreate runs in the foreground; this listener fires if a
        // LATER startForeground promotion is refused (e.g. first play / a re-create while the app
        // is backgrounded), not necessarily at launch.
        setListener(new androidx.media3.session.MediaSessionService.Listener() {
            @Override
            public void onForegroundServiceStartNotAllowedException() {
                Log.e(TAG, "FGS-DENIED: Android 12+ refused startForegroundService (background start). "
                        + "The media notification will NOT appear. "
                        + "playbackState=" + (player != null ? player.getPlaybackState() : -1)
                        + " playWhenReady=" + (player != null && player.getPlayWhenReady()));
            }
        });

        // Top (a) cause on Android 13+: POST_NOTIFICATIONS not granted -> the FGS notification is
        // suppressed even though startForeground succeeds. Logged once so it is not a silent cause.
        Log.i(TAG, "onCreate: notificationsEnabled=" + NotificationManagerCompat.from(this).areNotificationsEnabled());

        String sessionId = "VersicleMediaSession-" + SESSION_COUNTER.getAndIncrement();
        Log.i(TAG, "onCreate: building MediaSession id=" + sessionId);
        this.player = new WebViewProxyPlayer();
        try {
            this.mediaSession = new MediaSession.Builder(this, player)
                    .setId(sessionId)
                    .build();
            // Register the session with the service. This is what attaches Media3's
            // MediaNotificationManager (and its internal notification controller) to the
            // session, which drives onUpdateNotification -> startForeground. Without it,
            // addSession() would only run when an external MediaController connects via
            // SERVICE_INTERFACE / onStartCommand handles a media button — neither of which
            // this plugin triggers (it binds with an actionless intent + a LocalBinder),
            // so the media notification / lock-screen controls never appear.
            addSession(mediaSession);
            Log.i(TAG, "onCreate: addSession() done — notification pipeline attached; FGS-denial listener set");
        } catch (IllegalStateException e) {
            // The (f) failure surfaces here as a clear line rather than a bare FATAL stack.
            Log.e(TAG, "onCreate: building/adding MediaSession id=" + sessionId
                    + " FAILED (likely a prior session not released — 'Session ID must be unique')", e);
            throw e;
        }
    }

    /**
     * Media3 calls this whenever it (re)posts or updates the foreground media notification — the
     * actual "the notification was posted" signal (complements FGS-DENIED, which is the failure
     * side). If getState looks correct but no notification appears and this never logs, the post
     * itself was suppressed (channel/POST_NOTIFICATIONS/OEM). startInForegroundRequired==true means
     * Media3 is promoting the service to the foreground.
     */
    @Override
    public void onUpdateNotification(MediaSession session, boolean startInForegroundRequired) {
        Log.i(TAG, "onUpdateNotification: posting media notification (startInForegroundRequired="
                + startInForegroundRequired + ")");
        super.onUpdateNotification(session, startInForegroundRequired);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Preserve Media3's media-button / foreground handling, but do not let the OS
        // resurrect a sessionless zombie: this proxy mirrors WebView-produced audio and
        // has no native resume path, so a restarted service would sit idle.
        Log.i(TAG, "onStartCommand: action=" + (intent != null ? intent.getAction() : "null")
                + " flags=" + flags + " startId=" + startId + " -> START_NOT_STICKY");
        super.onStartCommand(intent, flags, startId);
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(@Nullable Intent rootIntent) {
        // WebView-produced audio cannot resume from a backgrounded/killed service, so
        // when the task is swiped away and we are not actively playing, stop the service
        // rather than leaving a dead notification behind.
        boolean stopping = player == null
                || player.getPlaybackState() == Player.STATE_IDLE
                || !player.getPlayWhenReady();
        Log.i(TAG, "onTaskRemoved: playbackState=" + (player != null ? player.getPlaybackState() : -1)
                + " playWhenReady=" + (player != null && player.getPlayWhenReady())
                + " -> " + (stopping ? "stopSelf()" : "keep running"));
        if (stopping) {
            stopSelf();
        }
        super.onTaskRemoved(rootIntent);
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        boolean media3Path = androidx.media3.session.MediaSessionService.SERVICE_INTERFACE.equals(action);
        Log.i(TAG, "onBind: action=" + action + " -> " + (media3Path ? "super (Media3 controller stub)" : "LocalBinder"));
        if (media3Path) {
            return super.onBind(intent);
        }
        return binder;
    }

    @Nullable
    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        Log.i(TAG, "onGetSession: controller=" + (controllerInfo != null ? controllerInfo.getPackageName() : "null"));
        return mediaSession;
    }

    @Override
    public void onDestroy() {
        Log.i(TAG, "Service onDestroy() fired. Releasing MediaSession.");
        clearListener();
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
