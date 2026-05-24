// Type declaration for `./validator.generated.cjs` — produced by
// `tools/precompile-validators.mjs` from `./schema/catalog-entry.schema.json`.
//
// The generated module exports a single AJV-compiled validator function.
// AJV's standalone shape: invoking the function returns a boolean; after
// invocation, the `errors` property (or null on success) holds the failure
// list in AJV's standard `ErrorObject` shape. We don't import AJV's runtime
// type here — duplicating the small surface keeps the generated lib
// independent of AJV's runtime package version at consumer-build time.

interface ValidateError {
  readonly instancePath: string;
  readonly schemaPath: string;
  readonly keyword: string;
  readonly params: Record<string, unknown>;
  readonly message?: string;
}

interface ValidateFunction {
  (data: unknown): boolean;
  errors?: ValidateError[] | null;
}

declare const validate: ValidateFunction;
export = validate;
