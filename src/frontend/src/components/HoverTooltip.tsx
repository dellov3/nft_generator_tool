import { type ReactNode, useCallback, useRef, useState } from "react";

interface HoverTooltipProps {
  content: string;
  children: ReactNode;
}

export default function HoverTooltip({ content, children }: HoverTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [flipToTop, setFlipToTop] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const checkPosition = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const nearBottom = rect.bottom > window.innerHeight - 100;
      setFlipToTop(nearBottom);
    }
  }, []);

  const handleShow = useCallback(() => {
    checkPosition();
    setIsVisible(true);
  }, [checkPosition]);

  const handleHide = useCallback(() => {
    setIsVisible(false);
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative inline-block"
      onMouseEnter={handleShow}
      onMouseLeave={handleHide}
      onFocus={handleShow}
      onBlur={handleHide}
    >
      {children}
      <div
        role="tooltip"
        className={[
          "absolute left-1/2 -translate-x-1/2 px-3 py-1.5",
          "bg-popover text-popover-foreground text-xs rounded-md shadow-lg border border-border",
          "max-w-[200px] break-words text-center z-50 pointer-events-none",
          "transition-[opacity,transform] duration-150 ease-apple",
          flipToTop ? "bottom-full mb-2" : "top-full mt-2",
          isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1",
        ].join(" ")}
      >
        {content}
        <div
          className={[
            "absolute left-1/2 -translate-x-1/2 w-2 h-2 bg-popover border-border rotate-45",
            flipToTop
              ? "top-full -mt-[5px] border-r border-b"
              : "bottom-full -mb-[5px] border-l border-t",
          ].join(" ")}
        />
      </div>
    </div>
  );
}
