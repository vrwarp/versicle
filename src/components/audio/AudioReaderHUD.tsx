import React from 'react';
import { useTTSStore } from '../../store/useTTSStore';
import { CompassPill } from './CompassPill';
import { SatelliteFAB } from './SatelliteFAB';

export const AudioReaderHUD: React.FC = () => {
  const queue = useTTSStore((state) => state.queue);

  // Only show if there is an active queue
  if (!queue || queue.length === 0) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 bottom-6 pointer-events-none z-40 flex justify-center items-end px-4 safe-area-bottom">
      <div className="relative w-full max-w-md mx-auto flex items-end justify-center">
        {/* Compass Pill - Bottom Center */}
        <div className="w-full">
            <CompassPill />
        </div>

        {/* Satellite FAB - Floating 'Orbit' Position */}
        {/* Positioned absolute relative to the container.
            Bottom-8 to float above pill centerline, Right-0 to align right.
            Adjust logic for different screen sizes if needed. */}
        <div className="absolute bottom-8 -right-2 z-50">
            <SatelliteFAB />
        </div>
      </div>
    </div>
  );
};
