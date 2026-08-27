import { getOrbToolPermissions } from "./authorization.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Values differ");
  }
}

for (const role of ["founder", "admin"]) {
  Deno.test(`${role} receives all read tool permissions without a lookup`, async () => {
    const client = {
      from: () => {
        throw new Error("must not query");
      },
    };
    assertEquals(await getOrbToolPermissions(client as never, "user", role), {
      projects: true,
      discovery: true,
      area_score: true,
      clients: true,
      calendar: true,
    });
  });
}

Deno.test("member defaults and explicit denial match current module policy", async () => {
  const client = {
    from: () => ({
      select: () => ({
        eq: () =>
          Promise.resolve({
            data: [{ module_key: "projects", enabled: false }],
            error: null,
          }),
      }),
    }),
  };
  assertEquals(await getOrbToolPermissions(client as never, "user", "member"), {
    projects: false,
    discovery: true,
    area_score: false,
    clients: true,
    calendar: true,
  });
});

for (const role of ["area_lead", "member"]) {
  Deno.test(`${role} without area_score remains denied`, async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    };
    const permissions = await getOrbToolPermissions(
      client as never,
      "user",
      role,
    );
    assertEquals(permissions.area_score, false);
  });
}

Deno.test("member area_score follows its explicit module permission", async () => {
  const client = {
    from: () => ({
      select: () => ({
        eq: () =>
          Promise.resolve({
            data: [{ module_key: "area_score", enabled: true }],
            error: null,
          }),
      }),
    }),
  };
  const permissions = await getOrbToolPermissions(
    client as never,
    "user",
    "member",
  );
  assertEquals(permissions.area_score, true);
});

Deno.test("member with area_score disabled remains denied", async () => {
  const client = {
    from: () => ({
      select: () => ({
        eq: () =>
          Promise.resolve({
            data: [{ module_key: "area_score", enabled: false }],
            error: null,
          }),
      }),
    }),
  };
  const permissions = await getOrbToolPermissions(
    client as never,
    "user",
    "member",
  );
  assertEquals(permissions.area_score, false);
});

Deno.test("permission lookup failure fails closed", async () => {
  const client = {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: null, error: new Error("down") }),
      }),
    }),
  };
  assertEquals(await getOrbToolPermissions(client as never, "user", "member"), {
    projects: false,
    discovery: false,
    area_score: false,
    clients: false,
    calendar: false,
  });
});
