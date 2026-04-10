const fs = require('fs');
let code = fs.readFileSync('src/components/settings/SyncSettingsTab.tsx', 'utf8');
code = code.replace(
    /disabled={isSwitchingWorkspace !== null \|\| isDeletingWorkspace !== null}\n                                                        >/g,
    'disabled={isSwitchingWorkspace !== null || isDeletingWorkspace !== null}\n                                                            aria-label={`Delete workspace ${ws.name}`}\n                                                            title="Delete workspace"\n                                                        >'
);
fs.writeFileSync('src/components/settings/SyncSettingsTab.tsx', code);
