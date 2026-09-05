import { useCallback, useEffect, useState } from "react";
import CaseView from "./pages/CaseView";
import Landing from "./pages/Landing";
import Privacy from "./pages/Privacy";

type Route =
  | { name: "landing" }
  | { name: "case"; caseId: string; token: string }
  | { name: "privacy" };

function parseHash(): Route {
  const h = window.location.hash;
  const m = /^#\/c\/([^?]+)\?token=(.+)$/.exec(h);
  if (m?.[1] && m[2]) {
    return { name: "case", caseId: decodeURIComponent(m[1]), token: decodeURIComponent(m[2]) };
  }
  if (h === "#/privacy") return { name: "privacy" };
  return { name: "landing" };
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash());

  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const onCreated = useCallback((caseId: string, token: string) => {
    window.location.hash = `#/c/${encodeURIComponent(caseId)}?token=${encodeURIComponent(token)}`;
  }, []);

  return (
    <div className="wrap">
      <header className="site-header">
        <a className="brand" href="#/">
          Advocate<span>.</span>
        </a>
        <a className="nav-link" href="#/privacy">
          Privacy
        </a>
      </header>
      <main>
        {route.name === "landing" && <Landing onCreated={onCreated} />}
        {route.name === "case" && <CaseView caseId={route.caseId} token={route.token} />}
        {route.name === "privacy" && <Privacy />}
      </main>
    </div>
  );
}
