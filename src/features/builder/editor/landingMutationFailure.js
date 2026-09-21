// Structured failure contract for Builder document mutations.
//
// A rejected mutation must never be indistinguishable from a no-op. The reducer
// records one of these on `state.lastFailure` so editors, tooling, and a future
// programmatic operator can observe *why* an edit was refused while the document
// itself stays untouched.

let failureSequence = 0;

export const BUILDER_MUTATION_FAILED = "BUILDER_MUTATION_FAILED";

const validationErrors = (error) => {
  const supplied = error?.validationErrors;
  if (!Array.isArray(supplied)) return [];
  return supplied
    .filter((item) => item && typeof item === "object")
    .map((item) => ({ path: String(item.path ?? ""), code: String(item.code ?? "") }));
};

const errorCode = (error) => {
  const message = typeof error?.message === "string" ? error.message : "";
  const code = message.split(":")[0].trim();
  return code || BUILDER_MUTATION_FAILED;
};

export function createMutationFailure(error, { operation = null, at = Date.now(), nextSequence = () => { failureSequence += 1; return failureSequence; } } = {}) {
  return {
    id: nextSequence(),
    code: errorCode(error),
    message: typeof error?.message === "string" && error.message ? error.message : BUILDER_MUTATION_FAILED,
    errors: validationErrors(error),
    operation: operation || null,
    at,
  };
}
