/**
 * Shared utility for playing earcons (audio feedback) via the Web Audio API.
 * Uses oscillators to generate simple chimes.
 */
export function playEarconOscillators(
    audioContext: AudioContext,
    type: 'bookmark_captured' | 'bookmark_failed',
    destinationNode?: AudioNode
) {
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }

    const now = audioContext.currentTime;

    const osc1 = audioContext.createOscillator();
    const osc2 = audioContext.createOscillator();
    const gain = audioContext.createGain();

    const targetNode = destinationNode || audioContext.destination;

    if (type === 'bookmark_captured') {
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(440, now);
        osc1.frequency.exponentialRampToValueAtTime(880, now + 0.1);

        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(660, now + 0.15);
        osc2.frequency.exponentialRampToValueAtTime(1100, now + 0.25);

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.5, now + 0.05);
        gain.gain.linearRampToValueAtTime(0, now + 0.1);
        gain.gain.setValueAtTime(0, now + 0.15);
        gain.gain.linearRampToValueAtTime(0.5, now + 0.2);
        gain.gain.linearRampToValueAtTime(0, now + 0.3);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(targetNode);

        osc1.start(now);
        osc1.stop(now + 0.1);
        osc2.start(now + 0.15);
        osc2.stop(now + 0.3);
    } else {
        osc1.type = 'square';
        osc1.frequency.setValueAtTime(200, now);
        osc1.frequency.exponentialRampToValueAtTime(150, now + 0.3);

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.5, now + 0.1);
        gain.gain.linearRampToValueAtTime(0, now + 0.3);

        osc1.connect(gain);
        gain.connect(targetNode);

        osc1.start(now);
        osc1.stop(now + 0.3);
    }
}
