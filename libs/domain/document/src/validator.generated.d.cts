// Type declaration for `./validator.generated.cjs` — produced by
// `tools/precompile-validators.mjs` from
// `./schema/aqua-document.schema.json`. See the catalog lib's sibling
// `.d.cts` for the rationale.

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
