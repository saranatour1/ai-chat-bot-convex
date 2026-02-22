"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { BookIcon, ChevronDownIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

export type SourcesProps = ComponentProps<"div">;

export const Sources = ({ className, ...props }: SourcesProps) => (
  <Collapsible
    className={cn("not-prose mb-4 text-primary text-xs", className)}
    {...props}
  />
);

export type SourcesTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  count: number;
};

export const SourcesTrigger = ({
  className,
  count,
  children,
  ...props
}: SourcesTriggerProps) => (
  <CollapsibleTrigger
    className={cn("flex items-center gap-2", className)}
    {...props}
  >
    {children ?? (
      <>
        <p className="font-medium">Used {count} sources</p>
        <ChevronDownIcon className="h-4 w-4" />
      </>
    )}
  </CollapsibleTrigger>
);

export type SourcesContentProps = ComponentProps<typeof CollapsibleContent>;

export const SourcesContent = ({
  className,
  ...props
}: SourcesContentProps) => (
  <CollapsibleContent
    className={cn(
      "mt-3 flex flex-col gap-2",
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className
    )}
    {...props}
  />
);

export type SourceProps = {
  className?: string;
  children?: ReactNode;
  href?: string;
  subtitle?: string;
  title: string;
};

export const Source = ({
  className,
  href,
  subtitle,
  title,
  children,
}: SourceProps) => {
  const content = children ?? (
    <>
      <BookIcon className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="block truncate font-medium">{title}</span>
        {subtitle ? (
          <span className="block truncate text-[11px] text-muted-foreground">
            {subtitle}
          </span>
        ) : null}
      </span>
    </>
  );

  const sharedClassName = cn("flex items-start gap-2", className);
  if (!href) {
    return <div className={sharedClassName}>{content}</div>;
  }

  return (
    <a
      className={sharedClassName}
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      {content}
    </a>
  );
};
