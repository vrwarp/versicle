import React from 'react';
import { useTTSStore } from '../../store/useTTSStore';
import { CompassPill } from './CompassPill';
import { SatelliteFAB } from './SatelliteFAB';

export const AudioReaderHUD: React.FC = () => {
  const queue = useTTSStore((state) => state.queue);

  // Only show if there is something in the queue
  if (!queue || queue.length === 0) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 bottom-6 pointer-events-none z-40 flex items-end justify-center px-4 safe-area-bottom">
      <div className="relative w-full max-w-lg mx-auto flex items-end justify-center">
        {/* Compass Pill centered */}
        <CompassPill />

        {/* Satellite FAB floated to the right */}
        {/*
           Spec says: "Fixed at the bottom-right quadrant, floating on a Z-plane superior to the Compass Pill.
           It is offset vertically to float above the pill's centerline (bottom-24, right-6)..."

           Since this container is flex centered at bottom, we can use absolute positioning for the FAB relative to this container
           or relative to the pill if we want it to stick together.

           Let's use absolute positioning relative to the wrapper to place it "orbiting" the pill.
           But "bottom-right quadrant" suggests fixed screen coordinates.

           If we want it relative to the pill (so it moves with it on resizing), we can put it here.
           If we want it fixed to screen edge, we should take it out of flex flow.

           The implementation plan says: "Position: Bottom-Right or anchored near Pill."
           Let's anchor it near the pill for the "Satellite" effect.
         */}
         <div className="absolute right-0 bottom-8 md:right-0 md:bottom-8 transform translate-x-2 translate-y-2">
            <SatelliteFAB />
         </div>
      </div>
    </div>
  );
};
