/// <reference no-default-lib="true"/>
/// <reference types="ts-type-forge" />

interface Symbol {
  /**
   * Expose the [[Description]] internal slot of a symbol directly.
   */
  readonly description: string | undefined;
}
