// Example: src/add.mts
import { add } from 'typescript-template';

if (import.meta.vitest !== undefined) {
  test('main', () => {
    // embed-sample-code-ignore-above

    const result = add(1, 2);

    assert.isTrue(result === 3);

    // embed-sample-code-ignore-below
  });
}
