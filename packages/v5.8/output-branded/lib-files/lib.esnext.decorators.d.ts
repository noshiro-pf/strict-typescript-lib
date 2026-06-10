/// <reference no-default-lib="true"/>
/// <reference types="ts-type-forge/global" />

/// <reference path="./lib.es2015.symbol.d.ts" />
/// <reference path="./lib.decorators.d.ts" />

interface SymbolConstructor {
  readonly metadata: unique symbol;
}

interface Function {
  readonly [Symbol.metadata]: DecoratorMetadata | null;
}
