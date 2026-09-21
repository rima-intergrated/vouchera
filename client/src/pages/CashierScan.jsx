import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';

// QR payloads are raw codes (WC-XXXX, SW-XXXXXXXX), but tolerate full
// URLs too (e.g. https://.../cashier/voucher/WC-XXXX or ?code=WC-XXXX)
// so a reprinted/shared QR never dead-ends the till on a 404.
function extractCode(decoded) {
  const raw = String(decoded || '').trim();
  if (!raw) return '';
  try {
    if (/^https?:\/\//i.test(raw)) {
      const url = new URL(raw);
      const param = url.searchParams.get('code');
      if (param) return param.trim().toUpperCase();
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments.length) return segments[segments.length - 1].toUpperCase();
    }
  } catch {
    // Not a parseable URL — fall through to raw-code handling.
  }
  return raw.toUpperCase();
}

// Camera scanner: requests permission, shows preview, stops on first
// detection and hands the decoded code to the validation page.
// Scanning NEVER redeems — it only reads the code.
export default function CashierScan() {
  const navigate = useNavigate();
  const scannerRef = useRef(null);
  const doneRef = useRef(false);
  const [status, setStatus] = useState('starting'); // starting|scanning|denied|none|unsupported|error
  const [detail, setDetail] = useState('');

  useEffect(() => {
    if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      setStatus('unsupported');
      setDetail('Camera scanning needs HTTPS. Use manual code entry instead.');
      return undefined;
    }
    let cancelled = false;
    const start = async () => {
      try {
        const cameras = await Html5Qrcode.getCameras();
        if (cancelled) return;
        if (!cameras?.length) {
          setStatus('none');
          setDetail('No camera found on this device.');
          return;
        }
        const scanner = new Html5Qrcode('cashier-reader');
        scannerRef.current = scanner;
        setStatus('scanning');
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decoded) => {
            if (doneRef.current) return;
            doneRef.current = true;
            const code = extractCode(decoded);
            // Fully shut the camera down BEFORE navigating: leaving while a
            // scan is ongoing makes clear() throw and blanks the whole app.
            (async () => {
              try { await scanner.stop(); } catch { /* already stopped */ }
              try { await scanner.clear(); } catch { /* already cleared */ }
              scannerRef.current = null;
            })().finally(() => {
              if (code) navigate(`/cashier/voucher/${encodeURIComponent(code)}`, { replace: true });
              else navigate('/cashier', { replace: true });
            });
          },
          () => {} // per-frame misses are normal; stay silent
        );
      } catch (err) {
        if (cancelled) return;
        const name = err?.name || '';
        if (name === 'NotAllowedError') {
          setStatus('denied');
          setDetail('Camera permission was denied. Allow camera access in the browser settings, or enter the code manually.');
        } else if (name === 'NotFoundError') {
          setStatus('none');
          setDetail('No camera found on this device.');
        } else if (name === 'NotSupportedError' || name === 'NotReadableError') {
          setStatus('unsupported');
          setDetail('This browser cannot access the camera. Use manual code entry.');
        } else {
          setStatus('error');
          setDetail(err?.message || 'Could not start the camera.');
        }
      }
    };
    start();
    return () => {
      cancelled = true;
      doneRef.current = true;
      // Await stop() before clear(): clear() throws synchronously
      // ("Cannot clear while scan is ongoing") if the camera is still
      // running, and that throw unmounts the app to a white page.
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner) {
        (async () => {
          try { await scanner.stop(); } catch { /* already stopped */ }
          try { await scanner.clear(); } catch { /* already cleared */ }
        })();
      }
    };
  }, [navigate]);

  return (
    <div className="cashier-wrap">
      <h1>VOUCHERA</h1>
      <div id="cashier-reader" className="camera-preview" />
      {status === 'scanning' && <p className="muted scan-hint">Scanning… point the camera at the voucher QR code.</p>}
      {status === 'starting' && <p className="muted scan-hint">Starting camera…</p>}
      {['denied', 'none', 'unsupported', 'error'].includes(status) && (
        <div className="card error-state">
          <p className="error">
            {status === 'denied' && 'Camera permission denied.'}
            {status === 'none' && 'No camera available.'}
            {status === 'unsupported' && 'Camera not supported.'}
            {status === 'error' && 'Camera error.'}
          </p>
          <p className="muted">{detail}</p>
          <Link className="btn" to="/cashier">Enter code manually</Link>
        </div>
      )}
      <p style={{ textAlign: 'center' }}><Link to="/cashier">Cancel</Link></p>
    </div>
  );
}
