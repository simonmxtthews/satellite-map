import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useAppStore } from "../store";
import { CATEGORY_COLORS } from "../lib/constants";

export function SearchBar() {
  const satellites = useAppStore((s) => s.satellites);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const selectSatellite = useAppStore((s) => s.selectSatellite);
  const [open, setOpen] = useState(false);

  const results = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const out = [];
    for (const s of satellites) {
      if (s.name.toLowerCase().includes(q) || String(s.id) === q) {
        out.push(s);
        if (out.length >= 8) break;
      }
    }
    return out;
  }, [satellites, searchQuery]);

  return (
    <div className="panel search-panel">
      <div className="search-input-wrap">
        <Search className="search-icon" size={14} strokeWidth={2.25} />
        <input
          className="search-input"
          type="text"
          placeholder="Search satellites (name or NORAD ID)..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
      </div>
      {open && results.length > 0 && (
        <ul className="search-results">
          {results.map((s) => (
            <li
              key={s.id}
              onClick={() => {
                selectSatellite(s.id, true);
                setOpen(false);
              }}
            >
              <span className="dot" style={{ background: categoryDot(s.category) }} />
              <span className="sat-name">{s.name}</span>
              <span className="sat-category">{s.category}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function categoryDot(category: string) {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.Other;
}
