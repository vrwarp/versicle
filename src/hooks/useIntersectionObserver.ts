import { useEffect, useRef, useState } from 'react';

const DEFAULT_OPTIONS: IntersectionObserverInit = { root: null, rootMargin: '100px', threshold: 0.1 };

export function useIntersectionObserver(
  callback: () => void,
  options: IntersectionObserverInit = DEFAULT_OPTIONS
) {
  const targetRef = useRef<HTMLDivElement>(null);
  const [isIntersecting, setIsIntersecting] = useState(false);
  const optionsRef = useRef(options);

  // Update options ref if they change (simplified equality check by reference)
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      setIsIntersecting(entry.isIntersecting);
      if (entry.isIntersecting) {
        callback();
      }
    }, optionsRef.current);

    const currentTarget = targetRef.current;
    if (currentTarget) {
      observer.observe(currentTarget);
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
  }, [callback]); // Removed options from dependencies, using ref

  return { targetRef, isIntersecting };
}
