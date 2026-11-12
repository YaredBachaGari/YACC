// The optional project stack (plan 009): frameworks and tools the agents
// should know about. The catalog is plain data: adding a tool is adding an entry.
// Domains and skill sources marked `verify` still need checking before the
// backend acts on them (see context/plans/009-stack-and-access.md).

export type StackCategory = "auth" | "payments" | "database" | "analytics" | "security";

export interface SkillSpec {
  source: string;
  skills: string[];
}

export interface StackTool {
  id: string;
  name: string;
  category: "framework" | StackCategory;
  /** Docs sites agents should be able to read. */
  docs: string[];
  /** APIs the app (and agents testing it) call. */
  api: string[];
  /** Env var names the tool needs. HQ never asks for or stores the values. */
  keys: string[];
  /** Agent skills to install: a `npx skills add` source and which of its skills. */
  skills: SkillSpec[];
  /** A hosted MCP server, if the tool has one. */
  mcp?: string;
  /** An optional MCP URL parameter worth suggesting (e.g. Supabase's project_ref); shown as a tip, never required. */
  mcpParam?: { name: string; hint: string };
  /** One line for the agents' ROLE.md. */
  note: string;
  /** For maintainers: not yet checked against the tool's own docs. */
  verify?: boolean;
}

/** What the project picked. `id: "other"` uses name + docsUrl. */
export interface StackChoice {
  id: string;
  /** Frameworks only: where it lives, e.g. apps/web. */
  where?: string;
  name?: string;
  docsUrl?: string;
}

export interface StackConfig {
  frameworks: StackChoice[];
  tools: Partial<Record<StackCategory, StackChoice>>;
}

export const EMPTY_STACK: StackConfig = { frameworks: [], tools: {} };

export const STACK_CATEGORIES: { id: StackCategory; label: string; hint: string }[] = [
  { id: "auth", label: "Auth", hint: "Sign-in and users" },
  { id: "payments", label: "Payments", hint: "Billing and subscriptions" },
  { id: "database", label: "Database", hint: "Data and branches" },
  { id: "analytics", label: "Analytics", hint: "Product analytics" },
  { id: "security", label: "Security", hint: "Bots, rate limits, prompt injection" },
];

const fw = (id: string, name: string, docs: string[], skills: SkillSpec[] = [], verify = false): StackTool => ({
  id, name, category: "framework", docs, api: [], keys: [], skills, note: `${name} app`, verify,
});

const REACT: SkillSpec = { source: "vercel-labs/agent-skills", skills: ["vercel-react-best-practices", "vercel-composition-patterns"] };

export const STACK_CATALOG: StackTool[] = [
  // ---------------------------------------------------------------- frameworks
  fw("nextjs", "Next.js", ["nextjs.org"], [{ source: "vercel/next.js", skills: ["next-dev-loop"] }, REACT]),
  fw("react-vite", "React (Vite)", ["react.dev", "vite.dev"], [REACT]),
  fw("express", "Express", ["expressjs.com"]),
  fw("hono", "Hono", ["hono.dev"]),
  fw("nestjs", "NestJS", ["docs.nestjs.com"]),
  fw("react-router", "React Router", ["reactrouter.com"], [REACT]),
  fw("astro", "Astro", ["docs.astro.build"]),
  fw("sveltekit", "SvelteKit", ["svelte.dev"]),
  fw("nuxt", "Nuxt", ["nuxt.com"]),

  // ---------------------------------------------------------------- auth
  {
    id: "clerk", name: "Clerk", category: "auth",
    docs: ["clerk.com"], api: ["api.clerk.com", "*.clerk.accounts.dev"],
    keys: ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"],
    skills: [{ source: "clerk/skills", skills: ["clerk", "clerk-setup", "clerk-nextjs-patterns", "clerk-react-patterns", "clerk-custom-ui", "clerk-backend-api", "clerk-webhooks", "clerk-orgs"] }],
    note: "Auth uses Clerk",
  },
  {
    id: "better-auth", name: "Better Auth", category: "auth",
    docs: ["better-auth.com"], api: [], keys: ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL"], skills: [],
    note: "Auth uses Better Auth (self-hosted)", verify: true,
  },
  {
    id: "auth0", name: "Auth0", category: "auth",
    docs: ["auth0.com"], api: ["*.auth0.com"], keys: ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET"], skills: [],
    note: "Auth uses Auth0", verify: true,
  },
  {
    id: "supabase-auth", name: "Supabase Auth", category: "auth",
    docs: ["supabase.com"], api: ["*.supabase.co"], keys: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
    skills: [{ source: "supabase/agent-skills", skills: ["supabase"] }],
    note: "Auth uses Supabase Auth", verify: true,
  },

  // ---------------------------------------------------------------- payments
  {
    id: "clerk-billing", name: "Clerk Billing", category: "payments",
    docs: ["clerk.com"], api: ["api.clerk.com"], keys: ["CLERK_SECRET_KEY"],
    skills: [{ source: "clerk/skills", skills: ["clerk-billing", "clerk-setup"] }],
    note: "Subscriptions use Clerk Billing",
  },
  {
    id: "stripe", name: "Stripe", category: "payments",
    docs: ["docs.stripe.com"], api: ["api.stripe.com"], keys: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"],
    skills: [{ source: "stripe/ai", skills: ["stripe-best-practices", "stripe-docs"] }], mcp: "https://mcp.stripe.com", note: "Payments use Stripe (test mode)",
  },
  {
    id: "polar", name: "Polar", category: "payments",
    docs: ["docs.polar.sh"], api: ["api.polar.sh", "sandbox-api.polar.sh"], keys: ["POLAR_ACCESS_TOKEN", "POLAR_WEBHOOK_SECRET"], skills: [],
    note: "Payments use Polar (sandbox)", verify: true,
  },

  // ---------------------------------------------------------------- database
  {
    id: "instacloud", name: "InstaCloud", category: "database",
    docs: ["instacloud.com", "agents.instacloud.com"], api: ["api.instacloud.com"], keys: ["DATABASE_URL"],
    skills: [{ source: "InsForge/instacloud-skills", skills: ["insta"] }], mcp: "https://mcp.instacloud.com/mcp",
    note: "Database and branch environments use InstaCloud (the insta CLI)",
  },
  {
    id: "neon", name: "Neon", category: "database",
    docs: ["neon.com"], api: ["console.neon.tech", "*.neon.tech"], keys: ["DATABASE_URL"], skills: [],
    note: "Database is Neon Postgres", verify: true,
  },
  {
    id: "supabase", name: "Supabase", category: "database",
    docs: ["supabase.com"], api: ["*.supabase.co"], keys: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "DATABASE_URL"],
    skills: [{ source: "supabase/agent-skills", skills: ["supabase", "supabase-postgres-best-practices"] }],
    // Scoped to one project and read-only: without project_ref the MCP reaches every project in the account.
    mcp: "https://mcp.supabase.com/mcp",
    mcpParam: { name: "project_ref", hint: "Tip: add ?project_ref=<id> to limit it to one project (Project Settings → General). Without it, the agent can reach every project in your account." },
    note: "Database is Supabase Postgres", verify: true,
  },
  {
    id: "prisma-postgres", name: "Prisma Postgres", category: "database",
    docs: ["prisma.io"], api: ["db.prisma.io"], keys: ["DATABASE_URL"], skills: [],
    note: "Database is Prisma Postgres with Prisma ORM", verify: true,
  },

  // ---------------------------------------------------------------- analytics
  {
    id: "posthog", name: "PostHog", category: "analytics",
    docs: ["posthog.com"], api: ["us.i.posthog.com", "eu.i.posthog.com", "us-assets.i.posthog.com"],
    keys: ["NEXT_PUBLIC_POSTHOG_KEY", "NEXT_PUBLIC_POSTHOG_HOST"],
    skills: [{ source: "PostHog/skills", skills: ["instrument-integration", "instrument-product-analytics", "instrument-llm-analytics"] }], mcp: "https://mcp.posthog.com",
    note: "Analytics use PostHog",
  },
  {
    id: "plausible", name: "Plausible", category: "analytics",
    docs: ["plausible.io"], api: ["plausible.io"], keys: [], skills: [],
    note: "Analytics use Plausible", verify: true,
  },
  {
    id: "vercel-analytics", name: "Vercel Analytics", category: "analytics",
    docs: ["vercel.com"], api: [], keys: [], skills: [],
    note: "Analytics use Vercel Web Analytics", verify: true,
  },

  // ---------------------------------------------------------------- security
  {
    id: "arcjet", name: "Arcjet", category: "security",
    docs: ["docs.arcjet.com"], api: ["decide.arcjet.com"], keys: ["ARCJET_KEY"], skills: [{ source: "arcjet/skills", skills: ["arcjet"] }],
    note: "Bot protection, rate limiting and prompt-injection checks use Arcjet",
  },
  {
    id: "upstash-ratelimit", name: "Upstash Ratelimit", category: "security",
    docs: ["upstash.com"], api: ["*.upstash.io"], keys: ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"], skills: [],
    note: "Rate limiting uses Upstash Ratelimit", verify: true,
  },
];

export const stackTool = (id: string) => STACK_CATALOG.find((t) => t.id === id);
export const frameworks = () => STACK_CATALOG.filter((t) => t.category === "framework");
export const toolsIn = (category: StackCategory) => STACK_CATALOG.filter((t) => t.category === category);

/** Catalog entries for everything chosen (Other entries have none). */
export function chosenTools(stack: StackConfig | undefined): StackTool[] {
  if (!stack) return [];
  const ids = [...stack.frameworks.map((f) => f.id), ...Object.values(stack.tools).map((c) => c?.id)];
  return [...new Set(ids)].flatMap((id) => (id ? [stackTool(id)].filter((t): t is StackTool => !!t) : []));
}

const hostOf = (url?: string) => {
  try {
    return url ? new URL(/^https?:\/\//.test(url) ? url : `https://${url}`).hostname : null;
  } catch {
    return null;
  }
};

/** Docs and API domains the chosen stack needs, deduplicated (Other entries add their docs host). */
export function stackDomains(stack: StackConfig | undefined): { domain: string; for: string[] }[] {
  if (!stack) return [];
  const map = new Map<string, Set<string>>();
  const add = (domain: string, name: string) => map.set(domain, (map.get(domain) ?? new Set()).add(name));
  for (const t of chosenTools(stack)) for (const d of [...t.docs, ...t.api]) add(d, t.name);
  for (const c of [...stack.frameworks, ...Object.values(stack.tools)]) {
    const host = c?.id === "other" ? hostOf(c.docsUrl) : null;
    if (host) add(host, c?.name || "Other");
  }
  return [...map].map(([domain, names]) => ({ domain, for: [...names] }));
}

/** Env var names the chosen stack needs. */
export function stackKeys(stack: StackConfig | undefined): { key: string; for: string }[] {
  const seen = new Set<string>();
  return chosenTools(stack).flatMap((t) => t.keys.filter((k) => !seen.has(k) && seen.add(k)).map((key) => ({ key, for: t.name })));
}

const choiceName = (c: StackChoice) => (c.id === "other" ? c.name || "Other" : (stackTool(c.id)?.name ?? c.id));

/** The "Stack" section of every agent's ROLE.md (empty when nothing is chosen). */
export function stackRoleMd(stack: StackConfig | undefined): string {
  if (!stack || (!stack.frameworks.length && !Object.values(stack.tools).some(Boolean))) return "";
  const lines = ["## Stack"];
  for (const f of stack.frameworks) lines.push(`- ${choiceName(f)}${f.where ? ` in \`${f.where}\`` : ""}${f.id === "other" && f.docsUrl ? ` (docs: ${f.docsUrl})` : ""}`);
  for (const cat of STACK_CATEGORIES) {
    const c = stack.tools[cat.id];
    if (!c) continue;
    const t = stackTool(c.id);
    const docs = c.id === "other" ? c.docsUrl : t?.docs[0];
    lines.push(`- ${t ? t.note : `${cat.label}: ${choiceName(c)}`}${docs ? ` (docs: ${docs})` : ""}`);
  }
  lines.push(
    "",
    "Use the installed agent skills for these tools before writing integration code, and follow their current docs rather than memory.",
    "Secrets come from environment variables; never hard-code or commit them.",
  );
  return lines.join("\n");
}

/** Every skill the chosen stack installs, merged per source. */
export function stackSkills(stack: StackConfig | undefined): SkillSpec[] {
  const bySource = new Map<string, Set<string>>();
  for (const t of chosenTools(stack)) for (const spec of t.skills) for (const name of spec.skills) bySource.set(spec.source, (bySource.get(spec.source) ?? new Set()).add(name));
  return [...bySource].map(([source, names]) => ({ source, skills: [...names].sort() })).sort((a, b) => a.source.localeCompare(b.source));
}
