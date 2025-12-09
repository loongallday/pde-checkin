interface InlineErrorProps {
  message: string;
}

export const InlineError = ({ message }: InlineErrorProps) => {
  if (!message) return null;

  return (
    <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  );
};
