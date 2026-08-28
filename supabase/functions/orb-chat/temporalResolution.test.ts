import { resolveNaturalTaskDate } from "./temporalResolution.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

const now = new Date("2026-08-28T14:00:00.000Z");

Deno.test("resolves Spanish relative due dates in the validated timezone", () => {
  assertEquals(
    resolveNaturalTaskDate("mañana", "due_at", "America/La_Paz", now),
    {
      state: "EXACT",
      value: "2026-08-30T03:59:59.000Z",
      timezone: "America/La_Paz",
    },
  );
  assertEquals(
    resolveNaturalTaskDate(
      "pasado mañana a las 15:30",
      "due_at",
      "America/La_Paz",
      now,
    ),
    {
      state: "EXACT",
      value: "2026-08-30T19:30:00.000Z",
      timezone: "America/La_Paz",
    },
  );
});

Deno.test("uses existing start/end-of-day convention and resolves weekdays", () => {
  assertEquals(
    resolveNaturalTaskDate("próximo lunes", "starts_at", "America/La_Paz", now),
    {
      state: "EXACT",
      value: "2026-09-07T04:00:00.000Z",
      timezone: "America/La_Paz",
    },
  );
  assertEquals(
    resolveNaturalTaskDate("2026-09-10", "due_at", "America/La_Paz", now),
    {
      state: "EXACT",
      value: "2026-09-11T03:59:59.000Z",
      timezone: "America/La_Paz",
    },
  );
  assertEquals(
    resolveNaturalTaskDate("30 de agosto", "due_at", "America/La_Paz", now),
    {
      state: "EXACT",
      value: "2026-08-31T03:59:59.000Z",
      timezone: "America/La_Paz",
    },
  );
  assertEquals(
    resolveNaturalTaskDate(
      "viernes antes de las 5",
      "due_at",
      "America/La_Paz",
      now,
    ),
    {
      state: "EXACT",
      value: "2026-09-04T09:00:00.000Z",
      timezone: "America/La_Paz",
    },
  );
});

Deno.test("never invents timezone or an unclear date", () => {
  assertEquals(resolveNaturalTaskDate("mañana", "due_at", null, now), {
    state: "NEEDS_TIMEZONE",
  });
  assertEquals(
    resolveNaturalTaskDate("algún día", "due_at", "America/La_Paz", now),
    { state: "AMBIGUOUS", reason: "date_not_understood" },
  );
});
