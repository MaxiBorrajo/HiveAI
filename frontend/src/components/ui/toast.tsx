import * as React from "react";
import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import {
  CircleCheckIcon,
  InfoIcon,
  OctagonXIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

const toastIconByType: Record<string, React.ReactNode> = {
  success: <CircleCheckIcon className="size-5 text-primary" />,
  info: <InfoIcon className="size-5 text-primary" />,
  warning: <TriangleAlertIcon className="size-5 text-amber-500" />,
  error: <OctagonXIcon className="size-5 text-destructive" />,
};

function ToastProvider({ ...props }: ToastPrimitive.Provider.Props) {
  return <ToastPrimitive.Provider data-slot="toast-provider" {...props} />;
}

function ToastPortal({ ...props }: ToastPrimitive.Portal.Props) {
  return <ToastPrimitive.Portal data-slot="toast-portal" {...props} />;
}

function ToastViewport({ className, ...props }: ToastPrimitive.Viewport.Props) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={cn(
        "fixed top-auto left-4 bottom-4 z-100 mx-auto flex w-96 max-w-[calc(100%-2rem)] flex-col outline-none",
        className,
      )}
      {...props}
    />
  );
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager();

  return toasts.map((toast) => (
    <ToastRoot key={toast.id} toast={toast}>
      <div className="flex flex-1 items-start gap-3">
        {toastIconByType[toast.type ?? "info"] ?? toastIconByType.info}
        <div className="flex-1 min-w-0">
          {toast.title && <ToastTitle>{toast.title}</ToastTitle>}
          {toast.description && (
            <ToastDescription>{toast.description}</ToastDescription>
          )}
        </div>
        <ToastClose />
      </div>
    </ToastRoot>
  ));
}

function ToastRoot({ className, ...props }: ToastPrimitive.Root.Props) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      className={cn(
        "absolute right-0 bottom-0 left-0 rounded-xl bg-popover p-4 text-base text-popover-foreground shadow-lg ring-1 ring-foreground/10 transition-all duration-200 select-none",
        "data-[swipe-direction=right]:translate-x-(--toast-swipe-move-x) data-[swipe-direction=left]:translate-x-(--toast-swipe-move-x)",
        "data-starting-style:translate-y-full data-starting-style:opacity-0",
        "data-ending-style:opacity-0",
        "data-[limited]:opacity-0",
        className,
      )}
      style={{
        zIndex: "calc(1000 - var(--toast-index))",
        transform:
          "translateY(calc(var(--toast-offset-y) * var(--toast-swap, 1))) scale(calc(1 - 0.05 * var(--toast-index)))",
      }}
      {...props}
    />
  );
}

function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn("text-base font-medium leading-snug", className)}
      {...props}
    />
  );
}

function ToastDescription({
  className,
  ...props
}: ToastPrimitive.Description.Props) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn("mt-1 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function ToastClose({ className, ...props }: ToastPrimitive.Close.Props) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      aria-label="Dismiss"
      className={cn(
        "shrink-0 rounded-md p-1 text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      <XIcon className="size-4" />
    </ToastPrimitive.Close>
  );
}

export {
  ToastProvider,
  ToastPortal,
  ToastViewport,
  ToastList,
  ToastRoot,
  ToastTitle,
  ToastDescription,
  ToastClose,
};
