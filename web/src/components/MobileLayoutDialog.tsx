import { useEffect, useRef } from "react";
import { CloseButton } from "./CloseButton";
import { focusDialogElement } from "./dialogFocus";
import {
  type LayoutMode,
  MOBILE_BREAKPOINT_MAX,
  MOBILE_BREAKPOINT_MIN,
  type SidebarOrder,
  updateLayoutPreferences,
  useLayoutPreferences,
} from "../layoutPreferences";

export function MobileLayoutDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) return focusDialogElement(dialogRef.current);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [open, onClose]);
  const { preferences, mobile, urlOverride } = useLayoutPreferences();
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="modal mobile-layout-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Mobile Layout"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input:not(:disabled), select:not(:disabled)",
            ),
          );
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (
            event.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === event.currentTarget)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="modal-head">
          <div>
            <h2>Mobile Layout</h2>
            <p>Choose display mode, breakpoint, and sidebar order.</p>
          </div>
          <CloseButton label="Close Mobile Layout" onClick={onClose} />
        </div>
        <div className="layout-preferences">
          <label>
            <span>Display mode</span>
            <select
              value={urlOverride ?? preferences.mode}
              onChange={(event) =>
                updateLayoutPreferences({
                  mode: event.target.value as LayoutMode,
                })
              }
            >
              <option value="auto">Automatic</option>
              <option value="mobile">Mobile</option>
              <option value="desktop">Desktop</option>
            </select>
          </label>
          <p className="muted">
            Using {mobile ? "mobile" : "desktop"} layout
            {urlOverride ? " (URL override)" : ""}. Bookmark with ?layout=mobile
            or ?layout=desktop to force a layout.
          </p>
          <label>
            <span>Mobile up to (px)</span>
            <input
              key={preferences.mobileBreakpoint}
              type="number"
              min={MOBILE_BREAKPOINT_MIN}
              max={MOBILE_BREAKPOINT_MAX}
              step={1}
              defaultValue={preferences.mobileBreakpoint}
              onBlur={(event) => {
                if (
                  event.currentTarget.value &&
                  event.currentTarget.validity.valid
                ) {
                  updateLayoutPreferences({
                    mobileBreakpoint: event.currentTarget.valueAsNumber,
                  });
                } else {
                  event.currentTarget.value = String(
                    preferences.mobileBreakpoint,
                  );
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </label>
          {(["mobile", "desktop"] as const).map((view) => (
            <label key={view}>
              <span>{view === "mobile" ? "Mobile" : "Desktop"} sidebar</span>
              <select
                value={preferences[`${view}SidebarOrder`]}
                onChange={(event) =>
                  updateLayoutPreferences({
                    [`${view}SidebarOrder`]: event.target.value as SidebarOrder,
                  })
                }
              >
                <option value="agents-first">Agents on top</option>
                <option value="workspaces-first">Workspaces on top</option>
              </select>
            </label>
          ))}
          <p className="muted">
            Sidebar order applies when Agents is set to Separate.
          </p>
        </div>
        <div className="modal-actions">
          <span className="muted">Changes are saved in this browser.</span>
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
