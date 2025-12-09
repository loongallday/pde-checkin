"use client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import type { FaceMatchResult } from "@/entities/employee";

interface FaceMatchResultCardProps {
  result: FaceMatchResult | null;
  onReset: () => void;
  onEnroll: () => Promise<boolean> | void;
  hasSnapshot: boolean;
}

export const FaceMatchResultCard = ({ result, onReset, onEnroll, hasSnapshot }: FaceMatchResultCardProps) => {
  const percentage = result ? Math.round(result.score * 100) : 0;
  const statusVariant = result?.status === "matched" ? "default" : "destructive";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Match Insights</CardTitle>
        <CardDescription>Review the latest verification signal.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {result ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Badge variant={statusVariant}>{result.status.toUpperCase()}</Badge>
              <p className="text-sm text-muted-foreground">
                Threshold {Math.round(result.threshold * 100)}%
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Similarity score</p>
              <Progress value={percentage} className="h-2" />
              <p className="text-xs text-muted-foreground">{result.message}</p>
            </div>
            {hasSnapshot ? (
              <div className="overflow-hidden rounded-xl border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={result.snapshotDataUrl} alt="Face snapshot" className="h-48 w-full object-cover" />
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Capture a frame to see results here.</p>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={onReset} className="flex-1" disabled={!result && !hasSnapshot}>
          Reset session
        </Button>
        <Button onClick={onEnroll} disabled={!hasSnapshot} className="flex-1">
          Use snapshot as baseline
        </Button>
      </CardFooter>
    </Card>
  );
};
