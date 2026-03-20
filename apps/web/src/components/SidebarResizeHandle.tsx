import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
} from "../ui-preferences";

interface SidebarResizeHandleProps {
  width: number;
  onWidthChange: (width: number) => void;
}

export function SidebarResizeHandle(props: SidebarResizeHandleProps) {
  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const startX = event.clientX;
    const startWidth = props.width;
    element.setPointerCapture(event.pointerId);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      props.onWidthChange(
        clampSidebarWidth(startWidth + moveEvent.clientX - startX)
      );
    };
    const handlePointerFinish = (finishEvent: PointerEvent) => {
      element.removeEventListener("pointermove", handlePointerMove);
      element.removeEventListener("pointerup", handlePointerFinish);
      element.removeEventListener("pointercancel", handlePointerFinish);
      if (element.hasPointerCapture(finishEvent.pointerId)) {
        element.releasePointerCapture(finishEvent.pointerId);
      }
    };

    element.addEventListener("pointermove", handlePointerMove);
    element.addEventListener("pointerup", handlePointerFinish);
    element.addEventListener("pointercancel", handlePointerFinish);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        props.onWidthChange(clampSidebarWidth(props.width - 24));
        break;
      case "ArrowRight":
        event.preventDefault();
        props.onWidthChange(clampSidebarWidth(props.width + 24));
        break;
      case "Home":
        event.preventDefault();
        props.onWidthChange(MIN_SIDEBAR_WIDTH);
        break;
      case "End":
        event.preventDefault();
        props.onWidthChange(MAX_SIDEBAR_WIDTH);
        break;
      default:
        break;
    }
  }

  return (
    <button
      type="button"
      className="sidebar-resize-handle"
      aria-label="Resize session sidebar"
      title="Drag to resize. Use arrow keys to resize when focused. Double-click to reset."
      onDoubleClick={() => props.onWidthChange(DEFAULT_SIDEBAR_WIDTH)}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    />
  );
}
