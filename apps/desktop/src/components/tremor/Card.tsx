// Adapted for OSCAR Next: local imports, Lucide icons and semantic theme tokens.
// Tremor Card [v1.0.0]

import React from "react"
import { Slot } from "@radix-ui/react-slot"

import { cx } from "./cx"

interface CardProps extends React.ComponentPropsWithoutRef<"div"> {
  asChild?: boolean
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, asChild, ...props }, forwardedRef) => {
    const Component = asChild ? Slot : "div"
    return (
      <Component
        ref={forwardedRef}
        className={cx(
          // base
          "relative w-full rounded-lg border p-4 text-left shadow-none",
          // background color
          "bg-[var(--surface)]",
          // border color
          "border-[var(--border)]",
          className,
        )}
        tremor-id="tremor-raw"
        {...props}
      />
    )
  },
)

Card.displayName = "Card"

export { Card, type CardProps }
