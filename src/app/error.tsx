"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html>
      <body className="min-h-screen bg-background px-6 py-12">
        <div className="mx-auto max-w-xl">
          <Alert variant="destructive" className="mb-6">
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>
              {error.message || "An unexpected error occurred. Please try again."}
            </AlertDescription>
          </Alert>
          <Button onClick={reset}>Try again</Button>
        </div>
      </body>
    </html>
  );
}
