type HttpErrorStatus = 400 | 404 | 500;

export function getHttpErrorStatus(error: unknown): HttpErrorStatus {
  if (isZodLikeError(error) || error instanceof SyntaxError) {
    return 400;
  }

  const message = getErrorMessage(error).toLowerCase();
  if (isMissingResourceError(message)) {
    return 404;
  }
  return 500;
}

export function getHttpErrorMessage(error: unknown): string {
  if (isZodLikeError(error)) {
    return error.issues[0]?.message ?? "Request validation failed.";
  }

  return getErrorMessage(error);
}

function isZodLikeError(
  error: unknown
): error is { issues: Array<{ message?: string }> } {
  return (
    typeof error === "object" &&
    error !== null &&
    Array.isArray((error as { issues?: unknown }).issues) &&
    ((error as { name?: unknown }).name === "ZodError" ||
      (error as { issues: Array<{ message?: string }> }).issues.every(
        (issue) => typeof issue === "object" && issue !== null
      ))
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Internal server error.";
}

function isMissingResourceError(message: string): boolean {
  return (
    message.includes("not found") ||
    message.includes("missing session") ||
    message.includes("missing task") ||
    message.includes("missing schedule") ||
    message.includes("missing agent") ||
    message.includes("missing resource")
  );
}
