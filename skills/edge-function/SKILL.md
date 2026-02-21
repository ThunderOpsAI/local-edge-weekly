---
name: edge-function
description: Use when creating Supabase Edge Functions with authentication, CORS, error handling, API integrations (especially Anthropic Claude API), or any serverless function that needs production security and reliability
---

# Supabase Edge Functions

## Overview

Create secure, production-ready Supabase Edge Functions with proper authentication, CORS configuration, error handling, input validation, and external API integration patterns.

## When to Use

Use this skill when:
- Creating new Supabase Edge Functions
- Integrating with external APIs (Anthropic, OpenAI, etc.)
- Building authenticated API endpoints
- Creating serverless functions with TypeScript/Deno

**Do NOT use when:**
- Writing client-side code
- Creating database functions (use sql-migration skill)

## Core Patterns

### 1. Function Structure Template

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Environment configuration at top
const CONFIG = {
  anthropicKey: Deno.env.get("ANTHROPIC_API_KEY")!,
  supabaseUrl: Deno.env.get("SUPABASE_URL")!,
  supabaseAnonKey: Deno.env.get("SUPABASE_ANON_KEY")!,
  allowedOrigins: (Deno.env.get("ALLOWED_ORIGINS") || "*").split(","),
  maxMessageLength: parseInt(Deno.env.get("MAX_MESSAGE_LENGTH") || "10000"),
  requestTimeout: parseInt(Deno.env.get("REQUEST_TIMEOUT_MS") || "30000"),
} as const;

// Request/response types
interface FunctionRequest {
  message: string;
  // ... other fields
}

serve(async (req) => {
  const requestId = crypto.randomUUID();

  try {
    // 1. CORS preflight
    if (req.method === "OPTIONS") {
      return corsResponse();
    }

    // 2. Method validation
    if (req.method !== "POST") {
      return errorResponse(405, "Method not allowed", requestId);
    }

    // 3. Environment validation
    validateEnvironment();

    // 4. Authentication
    const user = await authenticateUser(req);

    // 5. Parse and validate input
    const body = await parseAndValidate(req);

    // 6. Business logic
    const result = await processRequest(body, user);

    // 7. Success response
    return successResponse(result, requestId);

  } catch (error) {
    return handleError(error, requestId);
  }
});
```

### 2. CORS Configuration

**Never use wildcard (*) in production.**

```typescript
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": getAllowedOrigin(req),
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400", // 24 hours
};

function getAllowedOrigin(req: Request): string {
  const origin = req.headers.get("origin") || "";
  const allowedOrigins = CONFIG.allowedOrigins;

  // Specific origins only (no wildcard in production)
  if (allowedOrigins.includes(origin)) {
    return origin;
  }

  // Development mode
  if (allowedOrigins.includes("*")) {
    return "*";
  }

  // Default to first allowed origin
  return allowedOrigins[0] || "";
}

function corsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}
```

### 3. Authentication Pattern

```typescript
async function authenticateUser(req: Request) {
  // Extract auth header
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    throw new AuthError("Missing authorization header");
  }

  // Create Supabase client with user's token
  const supabase = createClient(
    CONFIG.supabaseUrl,
    CONFIG.supabaseAnonKey,
    {
      global: {
        headers: { Authorization: authHeader },
      },
    }
  );

  // Verify authentication
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    throw new AuthError("Invalid or expired token");
  }

  return user;
}
```

### 4. Input Validation with Limits

```typescript
async function parseAndValidate(req: Request): Promise<FunctionRequest> {
  // Parse with timeout
  const parseTimeout = setTimeout(() => {
    throw new ValidationError("Request body too large or parse timeout");
  }, 5000);

  let body: unknown;
  try {
    body = await req.json();
  } finally {
    clearTimeout(parseTimeout);
  }

  // Validate structure
  if (!body || typeof body !== "object") {
    throw new ValidationError("Request body must be a JSON object");
  }

  const data = body as Record<string, unknown>;

  // Validate required fields
  if (!data.message || typeof data.message !== "string") {
    throw new ValidationError("Field 'message' is required and must be a string");
  }

  // Validate length limits
  if (data.message.length > CONFIG.maxMessageLength) {
    throw new ValidationError(
      `Message exceeds maximum length of ${CONFIG.maxMessageLength} characters`
    );
  }

  if (data.message.trim().length === 0) {
    throw new ValidationError("Message cannot be empty");
  }

  return {
    message: data.message.trim(),
    // ... other validated fields
  };
}
```

### 5. Anthropic Claude API Integration

```typescript
interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
}

async function callClaudeAPI(
  request: AnthropicRequest
): Promise<ClaudeResponse> {
  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    CONFIG.requestTimeout
  );

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CONFIG.anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Handle rate limits
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      throw new RateLimitError(
        `Rate limit exceeded. Retry after ${retryAfter} seconds`
      );
    }

    // Handle API errors
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new ExternalAPIError(
        `Anthropic API error: ${response.status}`,
        response.status,
        errorData
      );
    }

    return await response.json();

  } catch (error) {
    clearTimeout(timeoutId);

    // Handle timeout
    if (error instanceof Error && error.name === "AbortError") {
      throw new TimeoutError(
        `API request timeout after ${CONFIG.requestTimeout}ms`
      );
    }

    throw error;
  }
}
```

### 6. Error Handling Hierarchy

```typescript
// Base error class
class FunctionError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

// Specific error types
class AuthError extends FunctionError {
  constructor(message: string) {
    super(message, 401, "AUTH_ERROR");
  }
}

class ValidationError extends FunctionError {
  constructor(message: string) {
    super(message, 400, "VALIDATION_ERROR");
  }
}

class RateLimitError extends FunctionError {
  constructor(message: string) {
    super(message, 429, "RATE_LIMIT_ERROR");
  }
}

class TimeoutError extends FunctionError {
  constructor(message: string) {
    super(message, 504, "TIMEOUT_ERROR");
  }
}

class ExternalAPIError extends FunctionError {
  constructor(
    message: string,
    statusCode: number,
    public apiError?: unknown
  ) {
    super(message, 502, "EXTERNAL_API_ERROR");
  }
}

// Error response handler
function handleError(error: unknown, requestId: string): Response {
  console.error(`[${requestId}] Error:`, error);

  // Known error types
  if (error instanceof FunctionError) {
    return errorResponse(error.statusCode, error.message, requestId, error.code);
  }

  // Unknown errors - don't leak details
  return errorResponse(
    500,
    "Internal server error",
    requestId,
    "INTERNAL_ERROR"
  );
}
```

### 7. Response Helpers

```typescript
function errorResponse(
  status: number,
  message: string,
  requestId: string,
  code?: string
): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        message,
        code: code || "ERROR",
        requestId,
      },
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        ...CORS_HEADERS,
      },
    }
  );
}

function successResponse(data: unknown, requestId: string): Response {
  return new Response(
    JSON.stringify({
      success: true,
      data,
      requestId,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...CORS_HEADERS,
      },
    }
  );
}
```

### 8. Environment Validation

```typescript
function validateEnvironment(): void {
  const required = [
    "ANTHROPIC_API_KEY",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
  ];

  const missing = required.filter((key) => !Deno.env.get(key));

  if (missing.length > 0) {
    // Log for debugging but don't expose in error response
    console.error(`Missing environment variables: ${missing.join(", ")}`);
    throw new FunctionError("Service configuration error", 500, "CONFIG_ERROR");
  }
}
```

## Quick Reference

| Pattern | Implementation | Notes |
|---------|----------------|-------|
| CORS | Validate origin from allowlist | Never use `*` in production |
| Auth | `supabase.auth.getUser()` | Validate token on every request |
| Input limits | Max length checks | Prevent abuse and DoS |
| Timeouts | AbortController + setTimeout | Set timeout on external calls |
| Error codes | Specific error classes | Client can handle errors properly |
| Request ID | crypto.randomUUID() | Essential for debugging |
| Environment | Validate on startup | Fail fast if misconfigured |
| Rate limits | Handle 429 responses | Retry-After header |

## Security Checklist

- [ ] CORS configured with specific origins (not `*`)
- [ ] Authentication required and validated
- [ ] Input length limits enforced
- [ ] Request timeout configured
- [ ] Environment variables validated
- [ ] Error messages don't leak sensitive data
- [ ] API keys never logged or exposed
- [ ] Rate limiting handled gracefully
- [ ] Request IDs for tracing
- [ ] AbortController for all external API calls

## Complete Example

See the template in "Function Structure Template" section above for a complete working example.

## Red Flags - STOP and Fix

| Thought | Reality |
|---------|---------|
| "CORS * is fine for now" | Gets deployed to production. Use allowlist. |
| "I'll add auth later" | Later never comes. Require auth from start. |
| "Input validation can be loose" | Users send malicious data. Validate strictly. |
| "Errors should be descriptive" | Leaks implementation details. Generic messages only. |
| "No timeout needed" | Function hangs forever. Always set timeouts. |
| "Environment check at request time" | Wastes cycles. Validate once at startup. |
| "Rate limits won't happen" | They will. Handle 429 responses. |
| "Request IDs are overkill" | Impossible to debug production. Always include. |

**All of these mean: Follow this skill's patterns. No shortcuts.**

## Common Mistakes

| Mistake | Problem | Fix |
|---------|---------|-----|
| Wildcard CORS | Security vulnerability | Use origin allowlist |
| No input length limits | DoS attack vector | Enforce max lengths |
| No request timeout | Functions hang indefinitely | Use AbortController |
| Exposing error details | Information disclosure | Generic error messages |
| Missing CORS on errors | CORS failures on error path | Include CORS headers on all responses |
| API keys in logs | Credential leakage | Never log sensitive data |
| No rate limit handling | Function fails on burst traffic | Catch 429, return appropriate error |
| Trusting input types | Runtime type errors | Validate all inputs |

## Real-World Impact

**Without these patterns:**
- CORS wildcard = Cross-site attacks
- No timeouts = Functions hang and cost money
- No input limits = DoS attacks succeed
- Detailed errors = Attackers learn system internals
- No auth = Public access to sensitive operations

**With these patterns:**
- Secure CORS prevents unauthorized access
- Timeouts prevent runaway costs
- Input limits stop abuse
- Generic errors protect implementation
- Auth ensures only authorized users access functions
