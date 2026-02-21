---
name: sql-migration
description: Use when creating Supabase database migrations including schema changes, RLS policies, indexes, functions, triggers, or any SQL that modifies database structure or security
---

# Supabase SQL Migrations

## Overview

Create safe, performant, and secure Supabase database migrations with proper transaction handling, RLS policies, indexes, and rollback capability.

## When to Use

Use this skill when:
- Creating or modifying tables
- Adding or changing RLS policies
- Creating database functions or triggers
- Adding indexes for query optimization
- Modifying database schema

**Do NOT use when:**
- Running ad-hoc queries for data analysis
- Writing application-level SQL queries (use query builders/ORMs)

## Migration Template

Every migration must follow this structure:

```sql
-- Migration: Add posts table with RLS
-- Created: 2024-01-15
-- Description: Creates posts table with user ownership and RLS policies

BEGIN;

-- Your migration SQL here

COMMIT;
```

## Core Patterns

### 1. Transaction Wrapper

**All migrations MUST be wrapped in a transaction.**

```sql
BEGIN;

-- All DDL and DML here
CREATE TABLE public.posts (...);
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
-- etc.

COMMIT;
```

**Why**: Ensures atomicity. If any statement fails, entire migration rolls back.

### 2. Idempotent Migrations

Write migrations that can run multiple times safely.

```sql
-- Tables
CREATE TABLE IF NOT EXISTS public.posts (...);

-- Indexes
DROP INDEX IF EXISTS posts_user_id_idx;
CREATE INDEX posts_user_id_idx ON public.posts(user_id);

-- Policies (drop first, then create)
DROP POLICY IF EXISTS "select_own_posts" ON public.posts;
CREATE POLICY "select_own_posts" ON public.posts
    FOR SELECT
    USING (auth.uid() = user_id);

-- Functions
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers
DROP TRIGGER IF EXISTS set_updated_at ON public.posts;
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON public.posts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
```

### 3. Standard Table Pattern

```sql
CREATE TABLE IF NOT EXISTS public.posts (
    -- Primary key
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Foreign keys
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Data columns
    title TEXT NOT NULL CHECK (char_length(title) <= 500),
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),

    -- Metadata columns (ALWAYS include these)
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Add comments for documentation
COMMENT ON TABLE public.posts IS 'User-created blog posts';
COMMENT ON COLUMN public.posts.status IS 'Post status: draft, published, or archived';
```

### 4. RLS Policies

**Enable RLS and create policies for all operations.**

```sql
-- Enable RLS (REQUIRED)
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

-- SELECT policy - read own posts
DROP POLICY IF EXISTS "select_own_posts" ON public.posts;
CREATE POLICY "select_own_posts" ON public.posts
    FOR SELECT
    USING (auth.uid() = user_id);

-- INSERT policy - prevent user_id spoofing
DROP POLICY IF EXISTS "insert_own_posts" ON public.posts;
CREATE POLICY "insert_own_posts" ON public.posts
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- UPDATE policy - modify own posts only
DROP POLICY IF EXISTS "update_own_posts" ON public.posts;
CREATE POLICY "update_own_posts" ON public.posts
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- DELETE policy - delete own posts only
DROP POLICY IF EXISTS "delete_own_posts" ON public.posts;
CREATE POLICY "delete_own_posts" ON public.posts
    FOR DELETE
    USING (auth.uid() = user_id);
```

**Policy naming convention**: `<operation>_<description>`
- Examples: `select_own_posts`, `insert_if_admin`, `update_published_posts`

### 5. Index Strategy

Create indexes for:
- Foreign keys (essential for joins)
- Columns used in WHERE clauses
- Columns used in ORDER BY
- Columns used in RLS policies

```sql
-- Foreign key index (REQUIRED for performance)
DROP INDEX IF EXISTS posts_user_id_idx;
CREATE INDEX posts_user_id_idx ON public.posts(user_id);

-- Composite index for common queries
DROP INDEX IF EXISTS posts_user_status_created_idx;
CREATE INDEX posts_user_status_created_idx
    ON public.posts(user_id, status, created_at DESC);

-- Partial index for specific queries
DROP INDEX IF EXISTS posts_published_idx;
CREATE INDEX posts_published_idx
    ON public.posts(created_at DESC)
    WHERE status = 'published';
```

### 6. Updated At Trigger

**Always include updated_at with automatic trigger.**

```sql
-- Create reusable updated_at function (do this once)
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$;

-- Add trigger to table
DROP TRIGGER IF EXISTS set_updated_at ON public.posts;
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON public.posts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
```

### 7. Secure Functions

```sql
-- SECURITY INVOKER (default, uses caller's permissions)
-- Use for functions that should respect RLS
CREATE OR REPLACE FUNCTION public.get_user_posts(target_user_id UUID)
RETURNS SETOF public.posts
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
    SELECT * FROM public.posts WHERE user_id = target_user_id;
$$;

-- SECURITY DEFINER (runs with function owner's permissions)
-- Use carefully, set search_path, validate inputs
CREATE OR REPLACE FUNCTION public.admin_delete_post(post_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Validate caller is admin
    IF NOT EXISTS (
        SELECT 1 FROM auth.users
        WHERE id = auth.uid()
        AND raw_user_meta_data->>'role' = 'admin'
    ) THEN
        RAISE EXCEPTION 'Unauthorized: admin access required';
    END IF;

    -- Validate input
    IF post_id IS NULL THEN
        RAISE EXCEPTION 'post_id cannot be null';
    END IF;

    DELETE FROM public.posts WHERE id = post_id;
END;
$$;
```

**SECURITY DEFINER checklist**:
- [ ] SET search_path to prevent schema injection
- [ ] Validate all inputs (check for NULL, validate format)
- [ ] Check authorization explicitly
- [ ] Document why DEFINER is needed

### 8. Permissions

**Never use GRANT ALL.** Grant specific permissions.

```sql
-- Grant specific table permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts TO authenticated;
GRANT SELECT ON public.posts TO anon; -- if public reads allowed

-- Grant sequence permissions (for SERIAL columns)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Grant function execution
GRANT EXECUTE ON FUNCTION public.get_user_posts(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_post(UUID) TO authenticated;
```

## Quick Reference

| Element | Pattern | Example |
|---------|---------|---------|
| Transaction | BEGIN...COMMIT | Wrap entire migration |
| Tables | CREATE IF NOT EXISTS | Idempotent table creation |
| Indexes | DROP + CREATE | Always drop first for idempotency |
| Policies | DROP + CREATE | Drop then create with consistent naming |
| Functions | CREATE OR REPLACE | Use SECURITY INVOKER by default |
| Triggers | DROP + CREATE | Drop then create |
| Timestamps | TIMESTAMPTZ + UTC | `timezone('utc'::text, now())` |
| Foreign Keys | REFERENCES + ON DELETE | Specify CASCADE or SET NULL |
| Permissions | GRANT specific ops | SELECT, INSERT, UPDATE, DELETE (not ALL) |

## Complete Migration Example

```sql
-- Migration: Create posts table with RLS and triggers
-- Created: 2024-01-15
-- Description: Adds user posts table with full CRUD RLS policies

BEGIN;

-- Create updated_at function (reusable across tables)
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create posts table
CREATE TABLE IF NOT EXISTS public.posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Add table comments
COMMENT ON TABLE public.posts IS 'User blog posts with RLS';
COMMENT ON COLUMN public.posts.status IS 'Status: draft, published, or archived';

-- Enable RLS
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "select_own_posts" ON public.posts;
CREATE POLICY "select_own_posts" ON public.posts
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_posts" ON public.posts;
CREATE POLICY "insert_own_posts" ON public.posts
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_posts" ON public.posts;
CREATE POLICY "update_own_posts" ON public.posts
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_posts" ON public.posts;
CREATE POLICY "delete_own_posts" ON public.posts
    FOR DELETE USING (auth.uid() = user_id);

-- Indexes
DROP INDEX IF EXISTS posts_user_id_idx;
CREATE INDEX posts_user_id_idx ON public.posts(user_id);

DROP INDEX IF EXISTS posts_user_status_created_idx;
CREATE INDEX posts_user_status_created_idx
    ON public.posts(user_id, status, created_at DESC);

DROP INDEX IF EXISTS posts_published_idx;
CREATE INDEX posts_published_idx
    ON public.posts(created_at DESC)
    WHERE status = 'published';

-- Triggers
DROP TRIGGER IF EXISTS set_updated_at ON public.posts;
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON public.posts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts TO authenticated;

COMMIT;
```

## Red Flags - STOP and Fix

| Thought | Reality |
|---------|---------|
| "I don't need a transaction" | Migrations must be atomic. Always use BEGIN...COMMIT. |
| "IF NOT EXISTS is enough" | Policies and indexes need DROP IF EXISTS + CREATE. |
| "RLS is optional" | RLS is REQUIRED for user data. Always enable. |
| "GRANT ALL is simpler" | Security risk. Grant specific permissions only. |
| "I'll add indexes later" | Later never comes. Add indexes now. |
| "Foreign keys don't need indexes" | Performance disaster. Always index foreign keys. |
| "SECURITY DEFINER is fine" | Extremely dangerous. Validate inputs and set search_path. |
| "updated_at can be manual" | Users forget. Use triggers for automatic updates. |
| "Comments are optional" | Documentation saves hours. Comment tables and columns. |

**All of these mean: Follow this skill's patterns. No shortcuts.**

## Common Mistakes

| Mistake | Problem | Fix |
|---------|---------|-----|
| No transaction | Partial migrations on failure | Wrap in BEGIN...COMMIT |
| GRANT ALL | Too permissive | Grant specific operations |
| Missing foreign key indexes | Slow joins and cascades | Index all foreign keys |
| No RLS on user data | Security vulnerability | Always enable RLS |
| SECURITY DEFINER without validation | SQL injection, privilege escalation | Validate inputs, set search_path |
| No updated_at trigger | Stale metadata | Add trigger pattern |
| Non-idempotent migrations | Fails on re-run | Use IF NOT EXISTS, DROP IF EXISTS |
| Missing policy for operation | Users can't perform action | Add policy for SELECT, INSERT, UPDATE, DELETE |
| Forgetting WITH CHECK on INSERT/UPDATE | User can violate constraints | Use WITH CHECK clause |

## Migration Checklist

When creating a migration:

- [ ] Wrapped in BEGIN...COMMIT transaction
- [ ] Migration header with description and date
- [ ] Idempotent (can run multiple times safely)
- [ ] created_at and updated_at columns on tables
- [ ] updated_at trigger added
- [ ] RLS enabled on all user data tables
- [ ] RLS policies for all operations (SELECT, INSERT, UPDATE, DELETE)
- [ ] Indexes on all foreign keys
- [ ] Composite indexes for common query patterns
- [ ] CHECK constraints for data validation
- [ ] Table and column comments added
- [ ] Specific permissions granted (not GRANT ALL)
- [ ] SECURITY DEFINER functions validated properly
- [ ] ON DELETE CASCADE or SET NULL on foreign keys

## Real-World Impact

**Without these patterns:**
- Migration fails halfway, database in inconsistent state
- Missing indexes cause slow queries (seconds → timeouts)
- Missing RLS = users access others' data (security breach)
- GRANT ALL = privilege escalation attacks
- No transaction = production database corrupted

**With these patterns:**
- Migrations are atomic and safe
- Queries are fast with proper indexes
- Data is secure with RLS
- Least privilege with specific grants
- Rollback capability maintains database integrity
