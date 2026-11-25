export default function Loading() {
  return (
    <div role="status" className="flex flex-col gap-3">
      <p className="text-muted-foreground">Loading</p>
      <div className="h-8 w-64 animate-pulse rounded-md bg-muted" />
      <div className="h-64 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}
