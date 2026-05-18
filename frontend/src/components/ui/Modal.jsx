import { useCallback, useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

export default function Modal({
  isOpen,
  onClose,
  children,
  ariaLabel = "Boite de dialogue",
  closeOnOverlay = true,
  className = "",
  overlayClassName = "",
  initialFocusRef = null,
}) {
  const dialogRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  const handleKeyDown = useCallback(
    (event) => {
      if (!isOpen) return;

      if (event.key === "Escape") {
        event.stopPropagation();
        onClose?.();
        return;
      }

      if (event.key === "Tab" && dialogRef.current) {
        const focusables = Array.from(
          dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR),
        ).filter((element) => !element.hasAttribute("aria-hidden"));

        if (focusables.length === 0) {
          event.preventDefault();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;

        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    },
    [isOpen, onClose],
  );

  useEffect(() => {
    if (!isOpen) return undefined;

    previouslyFocusedRef.current = document.activeElement;

    const focusTarget = initialFocusRef?.current || dialogRef.current?.querySelector(FOCUSABLE_SELECTOR);
    focusTarget?.focus?.();

    document.addEventListener("keydown", handleKeyDown, true);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      const previous = previouslyFocusedRef.current;
      if (previous && typeof previous.focus === "function") {
        previous.focus();
      }
    };
  }, [isOpen, handleKeyDown, initialFocusRef]);

  if (!isOpen) return null;

  const overlayClass = `fixed inset-0 z-[1500] flex items-center justify-center bg-mapgeo-primary/40 px-4 py-6 backdrop-blur-sm ${overlayClassName}`.trim();
  const dialogClass = `w-full max-w-md rounded-3xl border border-mapgeo-line bg-white p-6 text-mapgeo-primary shadow-panel ${className}`.trim();

  return (
    <div
      className={overlayClass}
      role="presentation"
      onMouseDown={(event) => {
        if (closeOnOverlay && event.target === event.currentTarget) {
          onClose?.();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={dialogClass}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
