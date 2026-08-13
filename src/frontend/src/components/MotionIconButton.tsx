import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";
import { forwardRef } from "react";

interface MotionIconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

const MotionIconButton = forwardRef<HTMLButtonElement, MotionIconButtonProps>(
  (
    { className, children, disabled, "aria-label": ariaLabel, ...props },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(
          "motion-icon-button inline-flex items-center justify-center",
          // Specific properties only — no transition-all
          "transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-hover ease-apple",
          "hover:scale-110",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          disabled && "opacity-50 cursor-not-allowed pointer-events-none",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);

MotionIconButton.displayName = "MotionIconButton";

export default MotionIconButton;
