import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createRestOscarApi, verifyAuthorizedAccess } from "./rest-adapter";
import "./styles.css";

const TOKEN_KEY = "oscar-next-api-token";

function HeadlessRoot() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? "");
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string>();

  async function connect(candidate: string) {
    setChecking(true); setError(undefined);
    try {
      const normalized = candidate.trim();
      await verifyAuthorizedAccess(normalized || undefined);
      if (normalized) localStorage.setItem(TOKEN_KEY, normalized); else localStorage.removeItem(TOKEN_KEY);
      window.oscar = createRestOscarApi(normalized || undefined);
      setToken(normalized); setReady(true);
    } catch (cause) {
      const status = (cause as Error & { status?: number })?.status;
      setError(status === 401 ? "The API token was rejected." : (cause instanceof Error ? cause.message : String(cause)));
    } finally { setChecking(false); }
  }


  useEffect(() => {
    void connect(token);
    // Initial connection is intentionally attempted once. A localhost service
    // without authentication opens immediately; LAN/token deployments fall
    // back to the token form if authorization is required.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) return <main className="headless-connect-shell">
    <section className="panel headless-connect-card">
      <h1>OSCAR Next</h1>
      <p>Headless web edition</p>
      <p>If this OSCAR Next server requires an API token, enter it below. Localhost-only Windows deployments can connect without one. A supplied token is stored only in this browser.</p>
      <label>API token<input type="password" value={token} autoFocus onChange={(event) => setToken(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void connect(token); }} /></label>
      {error && <div className="error">{error}</div>}
      <button disabled={checking} onClick={() => void connect(token)}>{checking ? "Connecting…" : "Connect"}</button>
      <button className="secondary" disabled={checking} onClick={() => void connect("")}>Try without token</button>
      <small>Swagger/OpenAPI documentation remains available at <a href="/docs">/docs</a>.</small>
    </section>
  </main>;

  return <App deployment="browser" />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><HeadlessRoot /></StrictMode>);
