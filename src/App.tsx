import { Suspense, useEffect, useState } from "react";
import { Menu, Satellite, X } from "lucide-react";
import { Scene } from "./components/Scene";
import { SearchBar } from "./components/SearchBar";
import { ObserverLocationPanel } from "./components/ObserverLocationPanel";
import { DetailPanel } from "./components/DetailPanel";
import { HoverTooltip } from "./components/HoverTooltip";
import { CategoryFilterPanel } from "./components/CategoryFilterPanel";
import { TimelineScrubber } from "./components/TimelineScrubber";
import { AmbientAudio } from "./components/AmbientAudio";
import { useCatalog } from "./hooks/useCatalog";
import { useAppStore } from "./store";
import "./App.css";

function App() {
  useCatalog();
  const loading = useAppStore((s) => s.loading);
  const loadError = useAppStore((s) => s.loadError);
  const satellites = useAppStore((s) => s.satellites);
  const selectedId = useAppStore((s) => s.selectedId);

  // Only relevant on mobile (the toggle button that flips this is hidden by
  // CSS above the mobile breakpoint — see .mobile-menu-toggle), where the
  // search/location/category stack is an off-canvas drawer instead of an
  // always-visible sidebar. Closing it on selection means picking a
  // satellite (from search, or by tapping one in the scene) always reveals
  // the scene + detail panel underneath rather than leaving the drawer
  // covering them.
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (selectedId != null) setMenuOpen(false);
  }, [selectedId]);

  return (
    <div className="app">
      <Suspense fallback={null}>
        <Scene />
      </Suspense>

      <button
        className="mobile-menu-toggle icon-btn"
        onClick={() => setMenuOpen((o) => !o)}
        aria-label={menuOpen ? "Close menu" : "Open menu"}
        aria-expanded={menuOpen}
      >
        {menuOpen ? <X size={18} /> : <Menu size={18} />}
      </button>

      <header className="title-bar">
        <span className="brand-mark">
          <Satellite size={17} strokeWidth={2} />
        </span>
        <h1>Satellite Map</h1>
        <span className="title-bar-divider" />
        <p>Every cataloged satellite, tracked live via real orbital telemetry</p>
      </header>

      {menuOpen && <div className="mobile-backdrop" onClick={() => setMenuOpen(false)} />}

      <div className={`ui-left${menuOpen ? " open" : ""}`}>
        <SearchBar />
        <ObserverLocationPanel />
        <CategoryFilterPanel />
      </div>

      <div className="ui-right">
        <DetailPanel />
      </div>

      <HoverTooltip />
      <AmbientAudio />

      <footer className="status-bar">
        {loading && <span>LOADING CATALOG…</span>}
        {loadError && <span className="error">CATALOG LOAD FAILED: {loadError}</span>}
        {!loading && !loadError && (
          <>
            <span className="status-dot" />
            <span>{satellites.length.toLocaleString()} OBJECTS TRACKED · TLE VIA CELESTRAK</span>
          </>
        )}
      </footer>

      {!loading && !loadError && (
        <div className="ui-bottom">
          <TimelineScrubber />
        </div>
      )}
    </div>
  );
}

export default App;
