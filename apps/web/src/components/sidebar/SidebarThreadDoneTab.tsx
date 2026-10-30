import { CheckIcon } from "lucide-react";
import { memo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

function findScrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

// Portaled to <body>: the sidebar list clips overflow, and `content-visibility` on the row's <li>
// makes `position: fixed` resolve against it. Clicks bubble through the React tree to the row.
export const SidebarThreadDoneTab = memo(function SidebarThreadDoneTab() {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tabRef = useRef<HTMLDivElement>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tracks DOM geometry outside React
  useEffect(() => {
    const anchor = anchorRef.current;
    const tab = tabRef.current;
    const row = anchor?.closest<HTMLElement>('[data-testid="sidebar-row-card"]');
    if (!anchor || !tab || !row) return;
    const sidebar = row.closest<HTMLElement>('[data-slot="sidebar-inner"]');
    const scrollParent = findScrollParent(row);
    const list = row.closest("ul");

    const place = () => {
      const rowRect = row.getBoundingClientRect();
      const clip = scrollParent?.getBoundingClientRect();
      const visible =
        rowRect.height > 0 &&
        (!clip || (rowRect.top >= clip.top - 1 && rowRect.bottom <= clip.bottom + 1));
      tab.style.visibility = visible ? "visible" : "hidden";
      tab.style.top = `${rowRect.top}px`;
      tab.style.height = `${rowRect.height}px`;
      tab.style.left = `${sidebar?.getBoundingClientRect().right ?? rowRect.right}px`;
    };
    place();

    const resizeObserver = new ResizeObserver(place);
    for (const target of [row, sidebar, scrollParent?.firstElementChild]) {
      if (target) resizeObserver.observe(target);
    }
    const mutationObserver = new MutationObserver(place);
    if (list) mutationObserver.observe(list, { childList: true });
    window.addEventListener("scroll", place, { capture: true, passive: true });
    window.addEventListener("resize", place);
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("scroll", place, { capture: true });
      window.removeEventListener("resize", place);
    };
  }, []);

  return (
    <>
      <span ref={anchorRef} aria-hidden className="hidden" />
      {createPortal(
        <div
          ref={tabRef}
          aria-hidden
          data-testid="sidebar-thread-done-tab"
          className="fixed z-30 cursor-pointer rounded-r-md bg-background transition-transform duration-200 ease-out hover:translate-x-1 motion-reduce:transition-none"
          style={{ visibility: "hidden" }}
        >
          <div className="flex h-full items-center gap-1.5 rounded-r-md border border-l-0 border-success/30 bg-success/12 pr-3.5 pl-2.5 text-sm font-medium whitespace-nowrap text-success-foreground">
            <CheckIcon className="size-4" />
            Done
          </div>
        </div>,
        document.body,
      )}
    </>
  );
});
