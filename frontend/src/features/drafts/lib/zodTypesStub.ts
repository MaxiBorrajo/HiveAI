/** Minimal zod typings so Monaco can type-check plugin sources in the browser. */
export const ZOD_TYPES_STUB = `
declare module "zod" {
  export interface ZodType<Output = unknown> {
    _output: Output;
    optional(): ZodType<Output | undefined>;
    describe(description: string): this;
  }
  interface ZodStringType extends ZodType<string> {}
  interface ZodNumberType extends ZodType<number> {}
  interface ZodBooleanType extends ZodType<boolean> {}
  interface ZodObjectType<Shape extends Record<string, ZodType>>
    extends ZodType<{ [K in keyof Shape]: Shape[K]["_output"] }> {}
  interface ZodArrayType<Item extends ZodType> extends ZodType<Item["_output"][]> {}

  // z is both a value (the object with .object(), .string(), etc. below)
  // and a namespace (so "z.infer<typeof schema>" resolves) — TypeScript
  // merges the const and the namespace declared under the same name.
  export const z: {
    string(): ZodStringType;
    number(): ZodNumberType;
    boolean(): ZodBooleanType;
    object<Shape extends Record<string, ZodType>>(shape: Shape): ZodObjectType<Shape>;
    array<Item extends ZodType>(item: Item): ZodArrayType<Item>;
    unknown(): ZodType<unknown>;
  };
  export namespace z {
    export type infer<T extends ZodType> = T["_output"];
  }
}
`;
