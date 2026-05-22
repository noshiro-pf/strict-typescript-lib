/// <reference no-default-lib="true"/>
/// <reference types="ts-type-forge/global" />

declare namespace Intl {
  interface NumberRangeFormatPart extends NumberFormatPart {
    readonly source: 'startRange' | 'endRange' | 'shared';
  }

  interface NumberFormat {
    formatRange(start: number | bigint, end: number | bigint): string;
    formatRangeToParts(
      start: number | bigint,
      end: number | bigint,
    ): NumberRangeFormatPart[];
  }
}
