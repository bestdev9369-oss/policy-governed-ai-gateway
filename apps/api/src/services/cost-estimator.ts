/**
 * Mock cost estimator.
 *
 * In a real deployment this would call the underlying model provider's
 * pricing API or apply rates from a billing configuration. This mock uses
 * a simple heuristic: simulate token counts based on tool complexity, then
 * apply Claude Sonnet-equivalent pricing.
 */

interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string;
}

const TOOL_TOKEN_PROFILE: Record<string, { input: number; output: number }> = {
  lookup_customer:  { input: 320,  output: 480  },
  wire_transfer:    { input: 480,  output: 280  },
  send_email:       { input: 1200, output: 640  },
  list_orders:      { input: 340,  output: 1200 },
  cancel_order:     { input: 280,  output: 180  },
  create_ticket:    { input: 680,  output: 420  },
  default:          { input: 400,  output: 320  },
};

// Pricing per million tokens (Claude Sonnet 3.5 equivalent rates, for demo)
const INPUT_PRICE_PER_M  = 3.0;   // USD
const OUTPUT_PRICE_PER_M = 15.0;  // USD
const DEMO_MODEL = 'claude-mock-3.5-sonnet';

export function estimateCost(toolName: string): CostEstimate {
  const profile = TOOL_TOKEN_PROFILE[toolName] ?? TOOL_TOKEN_PROFILE['default']!;

  // Add ±20% jitter to simulate realistic variance
  const jitter = () => 1 + (Math.random() * 0.4 - 0.2);
  const inputTokens  = Math.round(profile.input  * jitter());
  const outputTokens = Math.round(profile.output * jitter());

  const costUsd =
    (inputTokens  / 1_000_000) * INPUT_PRICE_PER_M +
    (outputTokens / 1_000_000) * OUTPUT_PRICE_PER_M;

  return {
    inputTokens,
    outputTokens,
    costUsd: Math.round(costUsd * 1_000_000) / 1_000_000, // 6 decimal places
    model: DEMO_MODEL,
  };
}
