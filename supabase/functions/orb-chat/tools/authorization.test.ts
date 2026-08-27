import { getOrbToolPermissions } from "./authorization.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Values differ");
  }
}

Deno.test("admin receives all read tool permissions without a lookup", async () => {
  const client = {
    from: () => {
      throw new Error("must not query");
    },
  };
  assertEquals(
    await getOrbToolPermissions(client as never, "user", "organization_admin"),
    {
      projects: true,
      discovery: true,
      area_score: true,
      clients: true,
      calendar: true,
    },
  );
});

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
