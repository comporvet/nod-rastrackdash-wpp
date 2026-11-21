import { z } from "zod";

export const ga4EnvironmentSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().trim().min(1).max(80),
  hostPattern: z.string().trim().min(1).max(300),
  pathPattern: z.string().trim().min(1).max(300).optional(),
});

export const ga4EnvironmentsSchema = z
  .array(ga4EnvironmentSchema)
  .min(1)
  .max(6)
  .refine(
    (items) => new Set(items.map((item) => item.key)).size === items.length,
    "Chaves de ambiente repetidas",
  )
  .refine(
    (items) => items.every((item) => isValidPattern(item.hostPattern) && (!item.pathPattern || isValidPattern(item.pathPattern))),
    "Expressão regular inválida",
  );

export type Ga4Environment = z.infer<typeof ga4EnvironmentSchema>;

export const comporvetEnvironmentPreset: Ga4Environment[] = [
  {
    key: "site",
    label: "Site institucional",
    hostPattern: "^(www\\.)?comporvet\\.com\\.br$",
  },
  {
    key: "lp_online",
    label: "LP Online",
    hostPattern: "^consultas\\.comporvet\\.com\\.br$",
    pathPattern: "^/(online/?)?$",
  },
  {
    key: "lp_presencial",
    label: "LP Presencial",
    hostPattern: "^consultas\\.comporvet\\.com\\.br$",
    pathPattern: "^/presencial/?$",
  },
];

function isValidPattern(value: string): boolean {
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
}

type StringFilter = { matchType: "FULL_REGEXP" | "EXACT"; value: string };

export type Ga4FilterExpression =
  | { andGroup: { expressions: Ga4FilterExpression[] } }
  | { notExpression: Ga4FilterExpression }
  | { filter: { fieldName: string; stringFilter?: StringFilter; inListFilter?: { values: string[] } } };

function regexFilter(fieldName: string, value: string): Ga4FilterExpression {
  return { filter: { fieldName, stringFilter: { matchType: "FULL_REGEXP", value } } };
}

export function exactFilter(fieldName: string, value: string): Ga4FilterExpression {
  return { filter: { fieldName, stringFilter: { matchType: "EXACT", value } } };
}

export function inListFilter(fieldName: string, values: string[]): Ga4FilterExpression {
  return { filter: { fieldName, inListFilter: { values } } };
}

export function environmentFilters(environment: Ga4Environment): Ga4FilterExpression[] {
  const filters = [regexFilter("hostName", environment.hostPattern)];
  if (environment.pathPattern) {
    filters.push(regexFilter("pagePath", environment.pathPattern));
  }
  return filters;
}

export function andFilters(filters: Ga4FilterExpression[]): Ga4FilterExpression | undefined {
  if (filters.length === 0) return undefined;
  if (filters.length === 1) return filters[0];
  return { andGroup: { expressions: filters } };
}

export function classifyEnvironment(
  environments: Ga4Environment[],
  hostName: string,
  pagePath: string,
): string | null {
  const match = environments.find(
    (environment) =>
      new RegExp(environment.hostPattern).test(hostName) &&
      (!environment.pathPattern || new RegExp(environment.pathPattern).test(pagePath)),
  );
  return match?.key ?? null;
}
