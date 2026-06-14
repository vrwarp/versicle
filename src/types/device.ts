
export interface DeviceProfile {
    // Appearance
    theme: 'light' | 'dark' | 'sepia';
    fontSize: number;

    // TTS
    ttsVoiceURI: string | null;
    ttsRate: number;
    ttsPitch: number;
}

export interface DeviceInfo {
    // Identity
    id: string;          // Matches the key in the Record
    name: string;        // User-editable, e.g., "My iPhone"

    // Fingerprinting (Auto-generated)
    platform: string;    // e.g., "iOS", "Android", "Windows"
    browser: string;     // e.g., "Safari", "Chrome"
    model: string | null;// e.g., "iPhone", "Pixel 6" - if detectable
    userAgent: string;   // For debugging/fallback

    // Versioning
    appVersion: string;  // e.g., "2.1.0"

    // Activity
    lastActive: number;  // UTC Timestamp
    created: number;     // UTC Timestamp

    // The "Adoption" Payload
    profile: DeviceProfile;

    /**
     * Rolling daily GenAI spend this device published for the project-wide
     * quota sum (design §3.4). `day` is the midnight-PT day key
     * (`YYYY-MM-DD`, America/Los_Angeles) the count belongs to; shape mirrors
     * the kernel DailyUsage / QuotaDailyUsageRow (rows/app.ts:190).
     *
     * OPTIONAL so it is additive — existing synced records and the registry
     * merge-default `{}` stay valid; replicates with NO __schemaVersion bump
     * because it nests below the root `devices` synced key (syncedKeys is
     * root-only).
     */
    embedSpend?: { day: string; rpd: number; tpm?: number };
}
