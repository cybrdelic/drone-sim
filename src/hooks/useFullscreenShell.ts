import { RefObject, useCallback, useEffect, useState } from "react";

export function useFullscreenShell(shellRef: RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPseudoFullscreen, setIsPseudoFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
      if (active) {
        setIsPseudoFullscreen(false);
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    handleFullscreenChange();

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (isPseudoFullscreen) {
        setIsPseudoFullscreen(false);
      } else {
        const target = (shellRef.current ?? document.documentElement) as HTMLElement & {
          webkitRequestFullscreen?: () => Promise<void> | void;
        };

        if (
          document.fullscreenEnabled &&
          typeof target.requestFullscreen === "function"
        ) {
          await target.requestFullscreen();
        } else if (typeof target.webkitRequestFullscreen === "function") {
          await target.webkitRequestFullscreen();
        } else {
          setIsPseudoFullscreen(true);
        }
      }
    } catch {
      setIsPseudoFullscreen(true);
    }
  }, [isPseudoFullscreen, shellRef]);

  useEffect(() => {
    if (!isPseudoFullscreen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsPseudoFullscreen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isPseudoFullscreen]);

  return {
    isFullscreen,
    isImmersive: isFullscreen || isPseudoFullscreen,
    isPseudoFullscreen,
    toggleFullscreen,
  };
}
