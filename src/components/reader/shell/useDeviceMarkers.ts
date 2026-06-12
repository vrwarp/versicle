/**
 * useDeviceMarkers — other devices' reading positions resolved to spine
 * hrefs for TOC badges (Phase 6 §5 table "DeviceMarkers (TOCPanel-local)",
 * prep/phase6-reader-engine.md PR-9). Extracted verbatim from the legacy
 * ReaderView; mounted next to the TOCPanel so the computation only exists
 * while the TOC is visible (the legacy `showToc` gate, structurally).
 */
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { ReaderEngine } from '@domains/reader/engine/ReaderEngine';
import type { DeviceMarker } from '../panels/TOCPanel';
import { useReadingStateStore } from '@store/useReadingStateStore';
import { useDeviceStore } from '@store/useDeviceStore';
import { getDeviceId } from '@lib/device-id';

export function useDeviceMarkers(
  bookId: string | undefined,
  engine: ReaderEngine | null,
): Record<string, DeviceMarker[]> {
  const devices = useDeviceStore(state => state.devices);
  const currentDeviceId = getDeviceId();

  // Optimization: Subscribe only to OTHER devices' progress to avoid re-renders on own progress update
  const otherDevicesProgress = useReadingStateStore(useShallow(state => {
    if (!bookId) return {};
    const bookProgress = state.progress?.[bookId];
    if (!bookProgress) return {};

    const result: Record<string, import('~types/user-data').UserProgress> = {};
    for (const [deviceId, prog] of Object.entries(bookProgress)) {
      if (deviceId !== currentDeviceId) {
        result[deviceId] = prog;
      }
    }
    return result;
  }));

  return useMemo(() => {
    const markers: Record<string, DeviceMarker[]> = {};
    if (!bookId || !engine) return markers;

    Object.entries(otherDevicesProgress).forEach(([devId, prog]) => {
      if (!prog.currentCfi) return;

      try {
        // Resolve CFI to Spine Item to get href
        const section = engine.resolveSection(prog.currentCfi);
        if (section && section.href) {
          // We match against the raw href from spine.
          // Ideally TOC items matching this href (or base of it) should show the marker.
          const href = section.href;
          if (!markers[href]) markers[href] = [];

          const device = devices[devId];
          markers[href].push({
            id: devId,
            name: device?.name || 'Unknown Device',
            platform: device?.platform || 'desktop'
          });
        }
      } catch {
        // Ignore invalid CFIs
      }
    });
    return markers;
  }, [bookId, otherDevicesProgress, engine, devices]);
}
