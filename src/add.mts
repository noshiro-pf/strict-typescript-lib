/**
 * @example
 *
 * ```ts
 * const result = add(1, 2);
 *
 * assert.isTrue(result === 3);
 * ```
 */
export const add = (x: number, y: number): number => x + y;

if (import.meta.vitest !== undefined) {
  test('add(2 , 3)', () => {
    expect(add(2, 3)).toBe(5);
  });
}
