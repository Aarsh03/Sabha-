import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Returns a function with a permanently stable identity that always invokes the
 * latest `fn`. Lets memoized children receive handlers without re-rendering and
 * without the stale-closure risk of a hand-maintained `useCallback` dependency list.
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
