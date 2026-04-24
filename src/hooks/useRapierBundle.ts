import { useEffect, useRef, useState } from "react";
import type { RapierBundle } from "../physics/rapierBundle";

export function useRapierBundle(enabled: boolean) {
  const cacheRef = useRef<RapierBundle | null>(null);
  const loadPromiseRef = useRef<Promise<RapierBundle> | null>(null);
  const [rapier, setRapier] = useState<RapierBundle | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!enabled) {
      setRapier(null);
      return () => {
        cancelled = true;
      };
    }

    if (cacheRef.current) {
      setRapier(cacheRef.current);
      return () => {
        cancelled = true;
      };
    }

    const promise =
      loadPromiseRef.current ??
      (loadPromiseRef.current = import("@react-three/rapier").then((module) => {
        const bundle: RapierBundle = {
          Physics: module.Physics,
          RigidBody: module.RigidBody,
          CuboidCollider: module.CuboidCollider,
        };
        cacheRef.current = bundle;
        return bundle;
      }));

    promise
      .then((bundle) => {
        if (!cancelled) {
          setRapier(bundle);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRapier(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return rapier;
}
