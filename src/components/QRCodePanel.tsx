import { useEffect, useState } from "react";
import { writeQr } from "../services/qr";

interface QRCodePanelProps {
  value: string | Uint8Array;
  label: string;
  compact?: boolean;
}

export function QRCodePanel({ value, label, compact = false }: QRCodePanelProps) {
  const [src, setSrc] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setSrc(undefined);
    setError(undefined);
    writeQr(value).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setSrc(objectUrl);
    }).catch(() => { if (active) setError("The QR software does not start in this browser."); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [value]);

  return (
    <div className={`qr-panel${compact ? " qr-panel--compact" : ""}`} aria-label={label}>
      {src ? <img src={src} alt={label} /> : <div className="qr-loading" role="status">{error ?? "Please wait"}</div>}
    </div>
  );
}
