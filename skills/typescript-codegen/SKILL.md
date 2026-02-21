---
name: typescript-codegen
description: Use when writing TypeScript code including API clients, interfaces, types, data validation, error handling, or any production code that processes external data or requires type safety
---

# TypeScript Code Generation

## Overview

Generate production-ready TypeScript code with runtime validation, proper error handling, branded types, and type safety patterns that prevent bugs at compile time and runtime.

## When to Use

Use this skill when:
- Creating API clients or data fetching logic
- Generating types from external data sources
- Building data transformation pipelines
- Writing code that processes untrusted input
- Creating libraries with strong type contracts

**Do NOT use when:**
- Writing simple internal utility functions
- Prototyping without production requirements
- Types are already validated by framework (e.g., tRPC end-to-end)

## Core Patterns

### 1. Runtime Validation with Zod

**TypeScript types don't exist at runtime.** Always validate external data.

```typescript
import { z } from 'zod';

// Define schema first
const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1),
  createdAt: z.string().datetime(),
});

// Extract type from schema (single source of truth)
type User = z.infer<typeof UserSchema>;

// Validate at runtime
function parseUser(data: unknown): User {
  return UserSchema.parse(data); // Throws if invalid
}

// Or return Result type
function safeParseUser(data: unknown): Result<User, z.ZodError> {
  const result = UserSchema.safeParse(data);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: result.error };
}
```

### 2. Result Types (No Throwing)

**Errors are values, not exceptions.**

```typescript
// Define Result type
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

// Return errors as values
async function loginUser(
  email: string,
  password: string
): Promise<Result<User, AuthError>> {
  // Validate input
  const validation = LoginSchema.safeParse({ email, password });
  if (!validation.success) {
    return { ok: false, error: new ValidationError(validation.error) };
  }

  // Call API
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validation.data),
    });

    if (!response.ok) {
      return { ok: false, error: new HttpError(response.status) };
    }

    const data = await response.json();
    const user = UserSchema.parse(data); // Runtime validation
    return { ok: true, value: user };

  } catch (error) {
    return { ok: false, error: new NetworkError(String(error)) };
  }
}

// Usage
const result = await loginUser(email, password);
if (!result.ok) {
  // TypeScript knows result.error exists
  console.error(result.error);
  return;
}
// TypeScript knows result.value exists
console.log(result.value.email);
```

### 3. Branded Types for Validated Data

Prevent mixing validated and unvalidated data at type level.

```typescript
// Create branded type
type Email = string & { readonly __brand: 'Email' };
type UserId = string & { readonly __brand: 'UserId' };

// Validation returns branded type
function validateEmail(input: string): Result<Email, ValidationError> {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(input)) {
    return { ok: false, error: new ValidationError('Invalid email') };
  }
  return { ok: true, value: input as Email };
}

// Now you can't pass unvalidated strings
function sendEmail(to: Email, subject: string) {
  // Function only accepts validated Email type
}

// This won't compile:
sendEmail("random@string", "Hello"); // Error: string is not assignable to Email

// Must validate first:
const emailResult = validateEmail("user@example.com");
if (emailResult.ok) {
  sendEmail(emailResult.value, "Hello"); // ✓ Works
}
```

### 4. Discriminated Unions with Type Guards

```typescript
// API response types
type ApiResponse<T> =
  | { status: 'success'; data: T }
  | { status: 'error'; error: string; code: number };

// Type guard
function isSuccess<T>(response: ApiResponse<T>): response is { status: 'success'; data: T } {
  return response.status === 'success';
}

// Usage
const response: ApiResponse<User> = await fetchUser();
if (isSuccess(response)) {
  console.log(response.data.email); // TypeScript knows data exists
} else {
  console.error(response.error, response.code); // TypeScript knows error/code exist
}
```

### 5. Immutability with Readonly

```typescript
// Make data structures immutable
interface Config {
  readonly apiUrl: string;
  readonly timeout: number;
  readonly retries: number;
}

// Readonly arrays
type ReadonlyArray<T> = readonly T[];

// Deep readonly
type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

// Const assertions for literals
const STATUS_CODES = {
  OK: 200,
  NOT_FOUND: 404,
  ERROR: 500,
} as const;

type StatusCode = typeof STATUS_CODES[keyof typeof STATUS_CODES]; // 200 | 404 | 500
```

## Quick Reference

| Pattern | When to Use | Example |
|---------|-------------|---------|
| Zod schemas | Validating external data (API, user input, files) | `UserSchema.parse(json)` |
| Result types | Operations that can fail without throwing | `Result<User, AuthError>` |
| Branded types | Ensuring validation happened | `type Email = string & { __brand }` |
| Discriminated unions | Multiple response shapes | `{ status: 'success' \| 'error' }` |
| Readonly types | Immutable data | `readonly T[]`, `DeepReadonly<T>` |
| Type guards | Narrowing unions | `isSuccess(response)` |
| const assertions | Literal types | `as const` |

## Error Hierarchy

Define specific error types for better error handling:

```typescript
// Base error class
class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

// Specific error types
class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
  }
}

class AuthenticationError extends AppError {
  constructor(message: string) {
    super(message, 'AUTH_ERROR', 401);
  }
}

class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 'NOT_FOUND', 404);
  }
}

class NetworkError extends AppError {
  constructor(message: string) {
    super(message, 'NETWORK_ERROR', 503);
  }
}
```

## Red Flags - STOP and Use This Skill

If you're thinking any of these, you're about to write fragile TypeScript code:

| Thought | Reality |
|---------|---------|
| "TypeScript types are enough" | Types don't exist at runtime. Always validate external data. |
| "I'll add validation later" | Later never comes. Validate at boundaries NOW. |
| "Throwing errors is simpler" | Hidden control flow causes bugs. Use Result types. |
| "This API response won't change" | APIs change. Validate responses or get runtime errors. |
| "Type assertions are fine here" | You're lying to TypeScript. Validate instead. |
| "Optional chaining handles this" | You're hiding the problem. Make types stricter. |
| "This is just a quick prototype" | Prototypes become production. Do it right from the start. |
| "The user won't send bad data" | Users always send bad data. Validate everything. |

**All of these mean: Use this skill's patterns. No shortcuts.**

## Common Mistakes

| Mistake | Problem | Fix |
|---------|---------|-----|
| Using `any` type | Disables type checking | Use `unknown` and validate |
| No runtime validation | Types don't exist at runtime | Use Zod/io-ts schemas |
| Throwing instead of Result | Hidden control flow, hard to handle | Return `Result<T, E>` |
| Optional chaining everywhere | Hides missing data issues | Use stricter types, validate early |
| Type assertions (`as`) | Bypasses type safety | Validate and use type guards |
| Mutable shared state | Race conditions, bugs | Use `readonly`, immutable updates |
| Trusting API responses | Runtime errors when API changes | Parse with Zod schemas |

## Implementation Checklist

When generating TypeScript code:

- [ ] Define Zod schemas for external data
- [ ] Extract TypeScript types from schemas (`z.infer<typeof Schema>`)
- [ ] Return Result types for fallible operations
- [ ] Use branded types for validated data
- [ ] Create specific error classes (not generic Error)
- [ ] Make interfaces readonly where appropriate
- [ ] Use discriminated unions for multiple states
- [ ] Write type guards for narrowing unions
- [ ] Validate at system boundaries (API responses, user input)
- [ ] Use strict TypeScript config (`strict: true`, `noUncheckedIndexedAccess: true`)

## Configuration

Ensure `tsconfig.json` has strict settings:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

## Real-World Impact

**Without these patterns:**
- API response changes cause runtime crashes
- Invalid data propagates through system
- Type errors discovered by users, not compiler
- Difficult to trace error origins

**With these patterns:**
- API changes caught immediately by schema validation
- Invalid data rejected at boundary
- Most bugs caught at compile time
- Clear error types with proper context
