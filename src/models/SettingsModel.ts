import { BaseModel } from './BaseModel';

export class SettingsModel extends BaseModel {
    // Settings are primarily in localStorage via Zustand persist.
    // This model will eventually wrap that.
    // For now, it serves as a placeholder for the architecture.

    async getSettings() {
        // Placeholder
        return {};
    }
}

export const settingsModel = new SettingsModel();
