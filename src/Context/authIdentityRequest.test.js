import assert from "node:assert/strict";
import test from "node:test";

import { createIdentityRequestKey } from "./authIdentityRequest.js";

test("identity resolution follows the user and explicit revision, not token rotation", () => {
  const initial = createIdentityRequestKey("user-1", 0);
  const afterTokenRefresh = createIdentityRequestKey("user-1", 0);

  assert.equal(afterTokenRefresh, initial);
  assert.notEqual(createIdentityRequestKey("user-2", 0), initial);
  assert.notEqual(createIdentityRequestKey("user-1", 1), initial);
  assert.equal(createIdentityRequestKey(null, 0), null);
});
