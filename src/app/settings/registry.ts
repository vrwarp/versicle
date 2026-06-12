/**
 * Settings panel registry (Phase 8 §B) — the store-registry pattern
 * (src/store/registry.ts) applied to the settings surface: declarative
 * descriptors, lazy `load()` per panel (React.lazy source), ONE place that
 * knows the tab set. `SettingsShell` renders the whole surface from this
 * table; adding a settings area = adding a row + a self-contained panel
 * module under ./panels/ (the DiagnosticsTab model — panels own their
 * state, handlers and store access; no container props).
 *
 * `/settings/:tab` route params resolve through {@link resolveSettingsTab},
 * so every id below is a deep-linkable URL segment.
 *
 * Labels are `labelKey: MessageKey` per the i18n ADR
 * (docs/adr/0001-i18n-strategy.md §2): the shell resolves them through
 * `formatMessage` (src/kernel/locale/messages.ts), so a future locale
 * touches the catalog, not this registry.
 */
import type { ComponentType } from 'react';
import type { MessageKey } from '@kernel/locale/messages';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BookOpen,
  Cloud,
  Database,
  LifeBuoy,
  Settings as SettingsIcon,
  Smartphone,
  Sparkles,
  Volume2,
} from 'lucide-react';

export type SettingsTabId =
  | 'general'
  | 'tts'
  | 'genai'
  | 'sync'
  | 'devices'
  | 'dictionary'
  | 'recovery'
  | 'diagnostics'
  | 'data';

export interface SettingsPanel {
  /** Route param (`/settings/:tab`) and Radix Tabs value. */
  id: SettingsTabId;
  /** Visible tab label — typed catalog key (i18n ADR §2). */
  labelKey: MessageKey;
  icon: LucideIcon;
  /** React.lazy source — the panel chunk loads on first activation. */
  load: () => Promise<{ default: ComponentType }>;
  /** Sidebar position (ascending). */
  order: number;
  /** Destructive-area styling (the Data Management tab). */
  danger?: boolean;
}

export const SETTINGS_PANELS: readonly SettingsPanel[] = [
  {
    id: 'general',
    labelKey: 'settings.tab.general',
    icon: SettingsIcon,
    load: () => import('./panels/GeneralPanel'),
    order: 10,
  },
  {
    id: 'tts',
    labelKey: 'settings.tab.tts',
    icon: Volume2,
    load: () => import('./panels/TTSPanel'),
    order: 20,
  },
  {
    id: 'genai',
    labelKey: 'settings.tab.genai',
    icon: Sparkles,
    load: () => import('./panels/GenAIPanel'),
    order: 30,
  },
  {
    id: 'sync',
    labelKey: 'settings.tab.sync',
    icon: Cloud,
    load: () => import('./panels/SyncPanel'),
    order: 40,
  },
  {
    id: 'devices',
    labelKey: 'settings.tab.devices',
    icon: Smartphone,
    load: () => import('./panels/DevicesPanel'),
    order: 50,
  },
  {
    id: 'dictionary',
    labelKey: 'settings.tab.dictionary',
    icon: BookOpen,
    load: () => import('./panels/DictionaryPanel'),
    order: 60,
  },
  {
    id: 'recovery',
    labelKey: 'settings.tab.recovery',
    icon: LifeBuoy,
    load: () => import('./panels/RecoveryPanel'),
    order: 70,
  },
  {
    id: 'diagnostics',
    labelKey: 'settings.tab.diagnostics',
    icon: Activity,
    load: () => import('./panels/DiagnosticsPanel'),
    order: 80,
  },
  {
    id: 'data',
    labelKey: 'settings.tab.data',
    icon: Database,
    load: () => import('./panels/DataPanel'),
    order: 90,
    danger: true,
  },
];

const PANEL_IDS = new Set<string>(SETTINGS_PANELS.map((p) => p.id));

/** Default tab for `/settings` and unknown deep-link params. */
export const DEFAULT_SETTINGS_TAB: SettingsTabId = 'general';

/** Resolve a route param to a registered tab id (unknown → general). */
export function resolveSettingsTab(param: string | undefined): SettingsTabId {
  return param && PANEL_IDS.has(param) ? (param as SettingsTabId) : DEFAULT_SETTINGS_TAB;
}
