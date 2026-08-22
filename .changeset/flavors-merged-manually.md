---
---

The version unification to 0.5.0 is applied directly to the source manifests
rather than through a changeset: changesets bumps each package from its own
base, which would have kept the two series apart (0.4.0 → 0.5.0 and
0.2.0 → 0.3.0). The `fixed` group added in this change keeps them together
from here on.
