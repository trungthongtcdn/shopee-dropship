"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { IScannerControls } from "@zxing/browser";

const CANCEL_RECEIPT_STATUS_OPTIONS = ["received_full", "received_partial", "not_received", "not_needed"] as const;
const CANCEL_RECEIPT_STATUS_LABELS: Record<(typeof CANCEL_RECEIPT_STATUS_OPTIONS)[number], string> = {
  received_full: "Đã nhận đủ",
  received_partial: "Nhận thiếu",
  not_received: "Chưa nhận",
  not_needed: "Không cần nhận",
};

function toDatetimeLocalValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Short two-tone beep on a successful scan — synthesized via Web Audio so
// no external asset is needed, and it works the same on every device.
function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
    osc.onended = () => ctx.close();
  } catch {
    // Audio isn't essential to the feature — a browser that blocks
    // AudioContext (autoplay policy, etc.) just scans silently.
  }
}

export function BarcodeScanForm() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [manualInput, setManualInput] = useState("");
  const [confirmedAt, setConfirmedAt] = useState(() => toDatetimeLocalValue(new Date()));
  const [cancelReceiptStatus, setCancelReceiptStatus] =
    useState<(typeof CANCEL_RECEIPT_STATUS_OPTIONS)[number]>("received_full");
  const [defectRatePercent, setDefectRatePercent] = useState("0");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Every call site here is a single discrete scan/typed entry, never free
  // text — unlike the Zalo message parser (extractOrderCodes), there's no
  // prose to pull a code out of, so don't filter by its order-id/SPXVN
  // shape. A real trackingCode can be a different carrier's format entirely
  // (confirmed in production: "GYYXUFHV", 8 letters, not SPXVN-prefixed,
  // was silently rejected here before matching was even attempted). Trust
  // whatever was scanned/typed and let the DB match decide.
  function addCode(raw: string) {
    const code = raw.trim().toUpperCase();
    if (!code || codes.includes(code)) return false;
    setCodes((prev) => (prev.includes(code) ? prev : [...prev, code]));
    return true;
  }

  useEffect(() => {
    if (!cameraOn) return;

    let cancelled = false;
    setCameraError(null);

    import("@zxing/browser").then(({ BrowserMultiFormatReader }) => {
      if (cancelled || !videoRef.current) return;
      const reader = new BrowserMultiFormatReader();
      reader
        .decodeFromConstraints({ video: { facingMode: "environment" } }, videoRef.current, (result) => {
          if (!result) return;
          if (addCode(result.getText())) beep();
        })
        .then((controls) => {
          if (cancelled) {
            controls.stop();
            return;
          }
          controlsRef.current = controls;
        })
        .catch((error) => {
          if (cancelled) return;
          setCameraError(error instanceof Error ? error.message : "Không mở được camera");
          setCameraOn(false);
        });
    });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [cameraOn]);

  function removeCode(code: string) {
    setCodes((prev) => prev.filter((c) => c !== code));
  }

  function submitManualInput(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (addCode(manualInput)) {
      setManualInput("");
    } else {
      setStatus(manualInput.trim() ? `"${manualInput.trim()}" đã có trong danh sách` : "Nhập mã trước khi thêm");
    }
  }

  async function submitAll() {
    setSubmitting(true);
    setStatus("Đang xử lý...");
    try {
      const defectRate = defectRatePercent === "" ? null : Number(defectRatePercent) / 100;
      const response = await fetch("/api/don-huy/manual-scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          codes,
          confirmedAt: new Date(confirmedAt).toISOString(),
          cancelReceiptStatus,
          defectRate,
        }),
      });
      const json = await response.json().catch(() => null);
      if (response.ok) {
        setStatus(`Đã khớp ${json.matchedCount}/${codes.length} mã`);
        setCodes([]);
        setDefectRatePercent("0");
        router.refresh();
      } else {
        setStatus(json?.error ?? `Lỗi (${response.status})`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Lỗi khi gửi");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="two-col-layout">
      <div>
        <div className="field" style={{ flexDirection: "row", marginBottom: "var(--space-3)" }}>
          <button
            type="button"
            className={cameraOn ? "btn btn-secondary btn-sm" : "btn btn-primary btn-sm"}
            onClick={() => setCameraOn((on) => !on)}
          >
            {cameraOn ? "Tắt camera" : "Bật camera"}
          </button>
        </div>

        {cameraError && <p className="editor-status">{cameraError}</p>}

        {cameraOn ? (
          <video ref={videoRef} style={{ width: "100%", maxWidth: 360, borderRadius: "var(--radius-md)", marginBottom: "var(--space-3)" }} />
        ) : null}

        <form onSubmit={submitManualInput} className="field">
          <span className="field-label">Nhập mã thủ công</span>
          <div style={{ display: "flex", gap: 4 }}>
            <input
              className="input"
              type="text"
              placeholder="Mã đơn hàng / mã vận đơn"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              style={{ minWidth: 220 }}
            />
            <button type="submit" className="btn btn-secondary btn-sm">
              Thêm
            </button>
          </div>
        </form>
      </div>

      <div>
        <span className="field-label">Mã chờ xác nhận ({codes.length})</span>
        <div className="filter-pill-group" style={{ margin: "6px 0 var(--space-3)" }}>
          {codes.length === 0 ? (
            <span className="cell-muted">Chưa quét/nhập mã nào.</span>
          ) : (
            codes.map((code) => (
              <span key={code} className="filter-pill active" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {code}
                <button
                  type="button"
                  onClick={() => removeCode(code)}
                  aria-label={`Xoá ${code}`}
                  style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, lineHeight: 1 }}
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>

        <div className="field">
          <span className="field-label">Trạng thái nhận huỷ</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {CANCEL_RECEIPT_STATUS_OPTIONS.map((value) => (
              <button
                key={value}
                type="button"
                className={`filter-pill${cancelReceiptStatus === value ? " active" : ""}`}
                onClick={() => setCancelReceiptStatus(value)}
              >
                {CANCEL_RECEIPT_STATUS_LABELS[value]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Ngày giờ nhận huỷ</span>
          <input
            className="input"
            type="datetime-local"
            value={confirmedAt}
            onChange={(e) => setConfirmedAt(e.target.value)}
          />
        </div>

        <div className="field">
          <span className="field-label">Tỷ lệ hỏng (%)</span>
          <input
            className="input"
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={defectRatePercent}
            onChange={(e) => setDefectRatePercent(e.target.value)}
            style={{ maxWidth: 120 }}
          />
        </div>

        <div className="sticky-mobile-actions">
          <div className="field" style={{ flexDirection: "row", alignItems: "center", gap: "var(--space-2)" }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={submitAll} disabled={submitting || codes.length === 0}>
              {submitting ? "Đang xử lý..." : `Xác nhận ${codes.length} mã`}
            </button>
            {status && <span className="editor-status">{status}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
