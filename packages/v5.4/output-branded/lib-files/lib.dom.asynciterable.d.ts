/// <reference no-default-lib="true"/>
/// <reference types="ts-type-forge/global" />

/////////////////////////////
/// Window Async Iterable APIs
/////////////////////////////

interface FileSystemDirectoryHandle {
  [Symbol.asyncIterator](): AsyncIterableIterator<
    readonly [string, FileSystemHandle]
  >;
  entries(): AsyncIterableIterator<readonly [string, FileSystemHandle]>;
  keys(): AsyncIterableIterator<string>;
  values(): AsyncIterableIterator<FileSystemHandle>;
}
