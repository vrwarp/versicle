import React from 'react';
import { useTTSStore } from '../../store/useTTSStore';
import { CompassPill } from './CompassPill';
import { SatelliteFAB } from './SatelliteFAB';

export const AudioReaderHUD: React.FC = () => {
  const queue = useTTSStore(state => state.queue);

  // Visibility Logic: Only show if there is audio queued.
  if (!queue || queue.length === 0) {
    return null;
  }

  // The HUD is positioned at the bottom.
  // We need to ensure it doesn't block the bottom footer controls of the ReaderView on mobile.
  // ReaderView footer is sticky/fixed at bottom, usually z-10.
  // The HUD is z-40.
  // If the HUD is present, we might want to lift it slightly if we are in ReaderView,
  // OR just ensure it doesn't span the full width in a way that blocks the side buttons.
  // The CompassPill is max-w-sm and centered. The Navigation buttons are at the edges.
  // However, the container is "left-0 right-0 px-4".
  // If the pointer-events-none works, only the children (Pill/FAB) should block.
  // The error indicated the CONTAINER was blocking.
  // This implies pointer-events-none might not be propagating or interpreted as expected if the browser thinks the element covers the tap target.
  // Wait, the error said: ... from <div ... pointer-events-none ...> ... subtree intercepts pointer events.
  // If a parent has pointer-events: none, it should pass through.
  // BUT if a child has pointer-events: auto (which Pill/FAB do), then clicking ON the child blocks.
  // Maybe the Pill is physically covering the Next/Prev buttons?
  // Pill is bottom-6 (24px). Footer is usually ~50-60px high.
  // On mobile, bottom-6 might place the Pill directly over the footer content.

  return (
    <div className="fixed bottom-20 left-0 right-0 z-40 flex justify-center pointer-events-none px-4 md:bottom-6">
      <div className="relative w-full max-w-sm">
        {/* The Compass Pill - Centered */}
        <div className="flex justify-center">
            <CompassPill />
        </div>

        {/* The Satellite FAB - Floating to the right, slightly overlapping/above */}
        <div className="absolute -right-2 -top-8 md:-right-16 md:top-auto md:bottom-2">
           <SatelliteFAB />
        </div>
      </div>
    </div>
  );
};
