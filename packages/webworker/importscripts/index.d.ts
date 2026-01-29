/// <reference no-default-lib="true"/>
/// <reference types="ts-type-forge" />

/////////////////////////////
/// WorkerGlobalScope APIs
/////////////////////////////
// These are only available in a Web Worker
declare function importScripts(...urls: readonly string[]): void;
