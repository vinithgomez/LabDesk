import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { useCallback, useEffect, useRef, useState } from "react";

export type ScannerState = "idle" | "starting" | "scanning" | "error";

function cameraErrorMessage(err: unknown): string {
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/NotAllowed|Permission/i.test(text)) return "Camera permission was denied. Allow camera access and try again.";
  if (/NotFound|no camera|Requested device not found/i.test(text)) return "No camera was found on this device.";
  if (/NotReadable|in use/i.test(text)) return "The camera is in use by another app.";
  return "The camera couldn't be started.";
}

/**
 * Owns the camera. It starts only when `start()` is called (from a button
 * tap), never on mount, and is always released on stop or unmount.
 * `regionId` must name an element that is in the DOM when `start()` runs.
 */
export function useQrScanner(regionId: string, onDecoded: (text: string) => void) {
  const scanner = useRef<Html5Qrcode | null>(null);
  const handled = useRef(false);
  const onDecodedRef = useRef(onDecoded);
  onDecodedRef.current = onDecoded;
  const [state, setState] = useState<ScannerState>("idle");
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(async () => {
    const current = scanner.current;
    scanner.current = null;
    if (current) {
      if (current.isScanning) await current.stop().catch(() => undefined);
      current.clear();
    }
    setState((s) => (s === "error" ? s : "idle"));
  }, []);

  const start = useCallback(async () => {
    if (scanner.current) return;
    handled.current = false;
    setError(null);
    setState("starting");
    const instance = new Html5Qrcode(regionId, {
      verbose: false,
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
    });
    scanner.current = instance;
    try {
      await instance.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: (w, h) => {
            const edge = Math.floor(Math.min(w, h) * 0.7);
            return { width: edge, height: edge };
          },
        },
        (text) => {
          // The library can report several decodes before stop() lands.
          if (handled.current) return;
          handled.current = true;
          void stop();
          onDecodedRef.current(text);
        },
        () => undefined, // per-frame "no code here" — expected, ignore
      );
      setState("scanning");
    } catch (err) {
      scanner.current = null;
      instance.clear();
      setError(cameraErrorMessage(err));
      setState("error");
    }
  }, [regionId, stop]);

  useEffect(
    () => () => {
      void stop();
    },
    [stop],
  );

  return { state, error, start, stop };
}
