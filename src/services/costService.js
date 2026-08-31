export const PRICING = {
  api_call: {
    centsPerThousandCalls: 500, 
  },
  ai_tokens: {
    centsPerThousandInputTokens: 15, 
    centsPerThousandCachedInputTokens: 3, 
    centsPerThousandOutputTokens: 60,
   
  },
};

export function calculateApiCallCost(quantity) {
  return Math.round(
    (quantity * PRICING.api_call.centsPerThousandCalls) / 1000
  );
}

export function calculateAiTokenCost({
  inputTokens = 0,
  cachedInputTokens = 0,
  outputTokens = 0,
  reasoningTokens = 0,
}) {
  const billableOutputTokens = outputTokens + reasoningTokens;

  const inputCost = Math.round(
    (inputTokens * PRICING.ai_tokens.centsPerThousandInputTokens) / 1000
  );
  const cachedInputCost = Math.round(
    (cachedInputTokens *
      PRICING.ai_tokens.centsPerThousandCachedInputTokens) /
      1000
  );
  const outputCost = Math.round(
    (billableOutputTokens * PRICING.ai_tokens.centsPerThousandOutputTokens) /
      1000
  );

  return {
    inputCost,
    cachedInputCost,
    outputCost,
    totalCents: inputCost + cachedInputCost + outputCost,
  };
}

export function calculateMonthlyCost(usage) {
  const apiCallCost = calculateApiCallCost(usage.api_call.total_quantity);

  const tokenCost = calculateAiTokenCost({
    inputTokens: usage.ai_tokens.total_input_tokens,
    cachedInputTokens: usage.ai_tokens.total_cached_input_tokens,
    outputTokens: usage.ai_tokens.total_output_tokens,
    reasoningTokens: usage.ai_tokens.total_reasoning_tokens,
  });

  return {
    apiCallCostCents: apiCallCost,
    aiTokenCostCents: tokenCost.totalCents,
    totalCents: apiCallCost + tokenCost.totalCents,
    breakdown: tokenCost,
  };
}