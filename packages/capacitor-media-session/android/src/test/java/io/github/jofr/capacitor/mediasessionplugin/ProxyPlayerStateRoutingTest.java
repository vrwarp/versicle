package io.github.jofr.capacitor.mediasessionplugin;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.robolectric.Shadows.shadowOf;

import android.os.Looper;

import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;

import com.getcapacitor.JSObject;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * L1 (Robolectric, no device): pins the two logic surfaces that have actually broken — the
 * playbackState -> Media3 State mapping (behind the notification flicker / STATE_IDLE flap)
 * and the supportedActions -> COMMAND_* -> onMediaAction routing fan-out. Drives the proxy
 * through the PUBLIC androidx.media3.common.Player API (the same calls Media3's notification /
 * MediaController issue), never the protected handle* methods, and never a real headless
 * MediaController (refuted). Verifies (b) routing, (c) metadata/timeline/commands, (d) the
 * STATE_IDLE flap guard. Runs in the existing `./gradlew test`.
 */
@RunWith(RobolectricTestRunner.class)
public class ProxyPlayerStateRoutingTest {

    private WebViewProxyPlayer player;
    private final List<String> actions = new ArrayList<>();
    private final List<JSObject> data = new ArrayList<>();

    private static Set<String> actionSet(String... a) {
        return new HashSet<>(Arrays.asList(a));
    }

    /** invalidateState() in updateState()/handle* posts asynchronously; drain it before reading. */
    private void idle() {
        shadowOf(Looper.getMainLooper()).idle();
    }

    private String lastAction() {
        return actions.get(actions.size() - 1);
    }

    private JSObject lastData() {
        return data.get(data.size() - 1);
    }

    @Before
    public void setUp() {
        player = new WebViewProxyPlayer();
        player.setActionCallback((action, payload) -> {
            actions.add(action);
            data.add(payload);
        });
    }

    // ---- (c)/(d): playbackState -> Media3 State mapping -------------------------------------

    @Test
    public void playingMapsToReadyWithMetadataTimelineAndCommands() {
        player.updateState("Chapter 1", "Author", "Book", null,
                "playing", 600.0, 5.0, 1.0,
                actionSet("play", "pause", "seekto", "nexttrack", "previoustrack", "stop"));
        idle();

        assertEquals(Player.STATE_READY, player.getPlaybackState());
        assertTrue(player.getPlayWhenReady());
        // Non-empty timeline is a precondition of Media3's shouldShowNotification().
        assertEquals(1, player.getCurrentTimeline().getWindowCount());

        Player.Commands cmds = player.getAvailableCommands();
        assertTrue(cmds.contains(Player.COMMAND_PLAY_PAUSE));
        assertTrue(cmds.contains(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM));
        assertTrue(cmds.contains(Player.COMMAND_SEEK_TO_NEXT));
        assertTrue(cmds.contains(Player.COMMAND_SEEK_TO_PREVIOUS));
        assertTrue(cmds.contains(Player.COMMAND_STOP));

        MediaMetadata meta = player.getMediaMetadata();
        assertEquals("Chapter 1", String.valueOf(meta.title));
        assertEquals("Author", String.valueOf(meta.artist));
        assertEquals("Book", String.valueOf(meta.albumTitle));
    }

    @Test
    public void noneMapsToIdle_theFlapGuard() {
        // The notification-flicker regression: transient inter-utterance 'none' must be the only
        // thing that yields STATE_IDLE (which makes Media3 shouldShowNotification() == false).
        player.updateState("", "", "", null, "none", 0.0, 0.0, 1.0, actionSet());
        idle();
        assertEquals(Player.STATE_IDLE, player.getPlaybackState());
    }

    @Test
    public void pausedMapsToReadyNotPlaying() {
        player.updateState("Chapter 1", "Author", "Book", null,
                "paused", 600.0, 5.0, 1.0, actionSet("play", "pause"));
        idle();
        assertEquals(Player.STATE_READY, player.getPlaybackState());
        assertFalse(player.getPlayWhenReady());
    }

    @Test
    public void commandsAreGatedOnRegisteredActions() {
        player.updateState("t", "a", "b", null, "playing", 10.0, 0.0, 1.0, actionSet("play"));
        idle();
        Player.Commands cmds = player.getAvailableCommands();
        assertTrue(cmds.contains(Player.COMMAND_PLAY_PAUSE));
        // Not registered -> not advertised -> the OS shows no seek/next affordance.
        assertFalse(cmds.contains(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM));
        assertFalse(cmds.contains(Player.COMMAND_SEEK_TO_NEXT));
        assertFalse(cmds.contains(Player.COMMAND_STOP));
    }

    // ---- (b): public Player command -> onMediaAction routing --------------------------------

    @Test
    public void playPauseRouteToOnMediaAction() {
        // Start paused so play() is a real playWhenReady change (false -> true).
        player.updateState("t", "a", "b", null, "paused", 60.0, 0.0, 1.0,
                actionSet("play", "pause"));
        idle();

        player.play();
        idle();
        assertEquals("play", lastAction());

        player.pause();
        idle();
        assertEquals("pause", lastAction());
    }

    @Test
    public void seekToRoutesToSeektoWithSeconds() {
        player.updateState("t", "a", "b", null, "playing", 600.0, 0.0, 1.0,
                actionSet("play", "pause", "seekto"));
        idle();

        player.seekTo(30_000L);
        idle();
        assertEquals("seekto", lastAction());
        assertEquals(30.0, lastData().optDouble("seekTime", -1.0), 1e-9);
    }

    @Test
    public void stopRoutesToStop() {
        player.updateState("t", "a", "b", null, "playing", 600.0, 0.0, 1.0,
                actionSet("play", "pause", "stop"));
        idle();

        player.stop();
        idle();
        assertEquals("stop", lastAction());
    }
}
