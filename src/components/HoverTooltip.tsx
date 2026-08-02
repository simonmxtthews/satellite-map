import { useAppStore } from "../store";
import { CATEGORY_COLORS } from "../lib/constants";

export function HoverTooltip() {
  const hoveredId = useAppStore((s) => s.hoveredId);
  const hoveredPos = useAppStore((s) => s.hoveredPos);
  const selectedId = useAppStore((s) => s.selectedId);
  const satelliteById = useAppStore((s) => s.satelliteById);

  if (hoveredId == null || !hoveredPos || hoveredId === selectedId) return null;
  const sat = satelliteById.get(hoveredId);
  if (!sat) return null;

  return (
    <div
      className="hover-tooltip"
      style={{ left: hoveredPos.x + 16, top: hoveredPos.y + 16 }}
    >
      <span className="dot" style={{ background: CATEGORY_COLORS[sat.category] ?? CATEGORY_COLORS.Other }} />
      <span className="sat-name">{sat.name}</span>
      <span className="sat-category">{sat.category}</span>
    </div>
  );
}
