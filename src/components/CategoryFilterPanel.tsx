import { useMemo } from "react";
import { useAppStore } from "../store";
import { CATEGORY_COLORS, CATEGORY_ORDER } from "../lib/constants";

export function CategoryFilterPanel() {
  const satellites = useAppStore((s) => s.satellites);
  const highlightedCategories = useAppStore((s) => s.highlightedCategories);
  const toggleCategory = useAppStore((s) => s.toggleCategory);
  const clearCategories = useAppStore((s) => s.clearCategories);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of satellites) map.set(s.category, (map.get(s.category) ?? 0) + 1);
    return map;
  }, [satellites]);

  return (
    <div className="panel category-panel">
      <div className="category-header">
        <h3>Highlight by type</h3>
        {highlightedCategories.size > 0 && (
          <button className="clear-btn" onClick={clearCategories}>
            Clear
          </button>
        )}
      </div>
      <div className="category-list">
        {CATEGORY_ORDER.filter((c) => (counts.get(c) ?? 0) > 0).map((category) => {
          const active = highlightedCategories.has(category);
          return (
            <button
              key={category}
              className={`category-chip${active ? " active" : ""}`}
              onClick={() => toggleCategory(category)}
              style={active ? { borderColor: CATEGORY_COLORS[category] } : undefined}
            >
              <span className="dot" style={{ background: CATEGORY_COLORS[category] }} />
              {category}
              <span className="count">{counts.get(category)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
