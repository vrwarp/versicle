package io.github.jofr.capacitor.mediasessionplugin;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.robolectric.Shadows.shadowOf;

import android.os.Looper;

import androidx.media3.common.Player;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * L1 (Robolectric, no device): guards the MediaSessionService lifecycle invariants that can be
 * verified headless. Notably the (f) "Session ID must be unique" regression — Media3 throws
 * IllegalStateException when a second MediaSession is built with the default empty id before the
 * first is released; the SESSION_COUNTER unique-id guard must keep that from happening. The real
 * foreground-notification POST and FLAG_FOREGROUND_SERVICE are verified at L3 (instrumented),
 * since driving Media3's full startForeground pipeline is not reliably reproducible headless.
 */
@RunWith(RobolectricTestRunner.class)
public class MediaSessionServiceTest {

    private static Set<String> actionSet(String... a) {
        Set<String> s = new HashSet<>();
        Collections.addAll(s, a);
        return s;
    }

    @Test
    public void twoServiceInstancesDoNotCollideOnSessionId() {
        // Reaching the asserts (no IllegalStateException "Session ID must be unique") IS the test:
        // before the unique-id guard, building a second session in the same process threw.
        MediaSessionService first = Robolectric.buildService(MediaSessionService.class).create().get();
        MediaSessionService second = Robolectric.buildService(MediaSessionService.class).create().get();
        assertNotNull(first.getPlayer());
        assertNotNull(second.getPlayer());
    }

    @Test
    public void servicePlayerExposedAndNoneMapsToIdle() {
        // Verifies the service<->player plumbing without driving the foreground notification:
        // a "playing" push would trigger DefaultMediaNotificationProvider.createNotification(),
        // which throws Resources$NotFoundException headless (a library module's Robolectric does
        // not merge media3-session's string resources). The real notification POST is asserted at
        // L3 (instrumented). "none" -> STATE_IDLE keeps shouldShowNotification() false, so no
        // notification is built here. The "playing"->STATE_READY mapping is covered by
        // ProxyPlayerStateRoutingTest at the player level.
        MediaSessionService service = Robolectric.buildService(MediaSessionService.class).create().get();
        WebViewProxyPlayer player = service.getPlayer();
        assertNotNull(player);

        player.updateState("", "", "", null, "none", 0.0, 0.0, 1.0, actionSet());
        shadowOf(Looper.getMainLooper()).idle();
        assertEquals(Player.STATE_IDLE, player.getPlaybackState());
    }
}
