import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PASSPHRASE_PART_COUNT } from "./protocol/passphrase";
import { InfoPage, type InfoKind } from "./routes/InfoPage";
import { QrStaticDemoPage } from "./routes/QrStaticDemoPage";
import { TransferReceivePage, TransferSendPage } from "./routes/TransferPages";
import "./styles.css";

type Route = "home" | "send" | "receive" | "qrstatic" | InfoKind;

const ROUTES = ["send", "receive", "qrstatic", "guide", "limitations", "source"];
const BASE_PATH = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;

function href(route: Route): string {
  return route === "home" ? BASE_PATH : `${BASE_PATH}${route}/`;
}

function routeForPath(pathname: string): Route {
  const path = pathname.replace(BASE_PATH, "").replace(/^\//, "").split("/")[0] ?? "";
  return ROUTES.includes(path) ? path as Route : "home";
}

function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => routeForPath(window.location.pathname));
  useEffect(() => {
    const onPop = () => setRoute(routeForPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((next: Route) => {
    window.history.pushState({}, "", href(next));
    setRoute(next);
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);
  return [route, navigate];
}

function AppLink({ route, className, children, onNavigate }: { route: Route; className?: string; children: ReactNode; onNavigate: (route: Route) => void }) {
  return <a href={href(route)} className={className} onClick={(event) => { event.preventDefault(); onNavigate(route); }}>{children}</a>;
}

function Layout({ children, onNavigate }: { children: ReactNode; onNavigate: (route: Route) => void }) {
  return <div className="app-shell">
    <header className="app-header">
      <AppLink route="home" className="wordmark" onNavigate={onNavigate}>Optical Transfer Demo</AppLink>
      <nav aria-label="Main">
        <AppLink route="guide" onNavigate={onNavigate}>Guide</AppLink>
        <AppLink route="limitations" onNavigate={onNavigate}>Limitations</AppLink>
        <AppLink route="source" onNavigate={onNavigate}>Source</AppLink>
      </nav>
    </header>
    {children}
    <footer className="app-footer">
      <span>A demonstration with the MIT license.</span>
      <AppLink route="source" onNavigate={onNavigate}>Source code and licenses</AppLink>
    </footer>
  </div>;
}

function HomePage({ onNavigate }: { onNavigate: (route: Route) => void }) {
  return <main className="home">
    <h1>Send a file with a screen and a camera</h1>
    <p className="lede">
      The first device shows the file as QR codes. The second device reads the QR codes with its camera.
      It then assembles the file in the browser. There is no server, no upload address, no account, and no
      network between the two devices.
    </p>

    <div className="home-actions">
      <button className="button primary" type="button" onClick={() => onNavigate("send")}>Send a file</button>
      <button className="button" type="button" onClick={() => onNavigate("receive")}>Receive a file</button>
    </div>

    <h2>How to use it</h2>
    <ol>
      <li>Open the Receive page on the second device. You can also read the QR code that the first device shows.</li>
      <li>Select a mode and a file on the first device.</li>
      <li>Point the camera of the second device at the screen of the first device. Hold the two devices still.</li>
    </ol>

    <h2>Modes</h2>
    <ul>
      <li><strong>Quick QR</strong> sends QR codes that contain a CRC check and a fountain code. Thus the receiver can lose frames or read frames in a different sequence, and it can still assemble the file. This mode does not encrypt the file.</li>
      <li><strong>Passphrase</strong> sends the same data, but it encrypts the data with AES-GCM. The two browsers make the key from a phrase of {PASSPHRASE_PART_COUNT} parts. The first device shows the phrase. You type the phrase on the second device. The software does not send the phrase.</li>
    </ul>
    <p>
      There is a third transport, QRStatic. It hides data in noise. A camera cannot read it. Thus it is
      only a <AppLink route="qrstatic" onNavigate={onNavigate}>demonstration in the browser</AppLink>.
    </p>

    <h2>Read this first</h2>
    <p>
      This is a demonstration. Send one file at a time. The maximum size is 10 MB. No specialist examined
      the security of this software. No mode identifies the other device. Keep a second copy of each file
      that you send.
    </p>
  </main>;
}

export default function App() {
  const [route, navigate] = useRoute();
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      const baseUrl = new URL(BASE_PATH, window.location.origin);
      navigator.serviceWorker.register(new URL("sw.js", baseUrl), { scope: baseUrl.pathname }).catch(() => undefined);
    }
  }, []);
  const content = route === "home" ? <HomePage onNavigate={navigate} />
    : route === "send" ? <TransferSendPage onNavigate={navigate} />
      : route === "receive" ? <TransferReceivePage onNavigate={navigate} />
        : route === "qrstatic" ? <QrStaticDemoPage onBack={() => navigate("home")} />
          : <InfoPage kind={route} />;
  return <Layout onNavigate={navigate}>{content}</Layout>;
}
