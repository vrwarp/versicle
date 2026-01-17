
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
}
