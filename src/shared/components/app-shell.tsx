import { ReactNode } from "react";
import { Separator } from "@/components/ui/separator";

interface AppShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  rightSlot?: ReactNode;
}

export const AppShell = ({ title, subtitle, children, rightSlot }: AppShellProps) => {
  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10">
        <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-wide text-muted-foreground">
              Employee Safety Suite
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              {title}
            </h1>
            {subtitle ? (
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          {rightSlot}
        </header>
        <Separator />
        <main className="grid gap-4 md:grid-cols-[2fr,1fr]">{children}</main>
      </div>
    </div>
  );
};
